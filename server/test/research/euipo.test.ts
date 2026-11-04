import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  buildEuipoQuery,
  createEuipoClient,
  EUIPO_ENDPOINTS,
  parseEuipoSearch,
} from '../../src/research/trademarks/euipo.js';
import { trademarkSearchLinks } from '../../src/research/trademarks/links.js';
import searchFixture from './fixtures/euipo-search-acme.json' with { type: 'json' };

const SECRET = 'EUIPO-SECRET-99';
const creds = { clientId: 'client-1', clientSecret: SECRET, env: 'production' as const };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeHttp(responses: Array<Response | Error>): { http: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const http: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  };
  return { http, calls };
}

const token = (value = 'tok-1') => Response.json({ access_token: value, expires_in: 7200 });

describe('buildEuipoQuery', () => {
  it('builds a contains query on the word element', () => {
    expect(buildEuipoQuery('acme', [])).toBe('wordMarkSpecification.verbalElement==*acme*');
  });

  it('quotes values with spaces and strips quotes', () => {
    expect(buildEuipoQuery('acme "co"', [])).toBe(
      'wordMarkSpecification.verbalElement=="*acme co*"',
    );
  });

  it('adds a Nice class filter', () => {
    expect(buildEuipoQuery('acme', [9, 42])).toBe(
      'wordMarkSpecification.verbalElement==*acme* and niceClasses=in=(9,42)',
    );
  });
});

describe('parseEuipoSearch', () => {
  it('maps records and skips items without an application number', () => {
    const result = parseEuipoSearch(searchFixture);
    expect(result).toEqual({
      kind: 'ok',
      total: 2,
      matches: [
        {
          office: 'euipo',
          mark: 'ACME',
          applicationNumber: '018000001',
          status: 'REGISTERED',
          niceClasses: [9, 42],
          applicationDate: '2019-01-15',
          applicants: ['Acme Holdings GmbH'],
          url: 'https://euipo.europa.eu/eSearch/#details/trademarks/018000001',
        },
        {
          office: 'euipo',
          mark: '(no word element)',
          applicationNumber: '018000002',
          status: 'EXPIRED',
          niceClasses: [35],
          applicationDate: undefined,
          applicants: [],
          url: 'https://euipo.europa.eu/eSearch/#details/trademarks/018000002',
        },
      ],
    });
  });

  it('reports an error for an unknown shape', () => {
    expect(parseEuipoSearch({ results: [] })).toEqual({
      kind: 'error',
      reason: 'EUIPO response shape not recognized',
    });
  });
});

describe('createEuipoClient', () => {
  it('gets a client-credentials token, then searches with bearer and client id headers', async () => {
    const { http, calls } = fakeHttp([token(), Response.json(searchFixture)]);
    const result = await createEuipoClient(http, creds).search('acme', [9]);
    expect(result.kind).toBe('ok');

    expect(calls[0]?.url).toBe(EUIPO_ENDPOINTS.production.token);
    expect(calls[0]?.init?.method).toBe('POST');
    const form = new URLSearchParams(String(calls[0]?.init?.body));
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('uid');

    const search = new URL(calls[1]?.url ?? '');
    expect(`${search.origin}${search.pathname}`).toBe(
      'https://api.euipo.europa.eu/trademark-search/trademarks',
    );
    expect(search.searchParams.get('query')).toBe(
      'wordMarkSpecification.verbalElement==*acme* and niceClasses=in=(9)',
    );
    expect(search.searchParams.get('size')).toBe('25');
    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-1');
    expect(headers['x-ibm-client-id']).toBe('client-1');
  });

  it('reuses the token across searches', async () => {
    const { http, calls } = fakeHttp([
      token(),
      Response.json(searchFixture),
      Response.json(searchFixture),
    ]);
    const client = createEuipoClient(http, creds, () => 0);
    await client.search('acme', []);
    await client.search('zent', []);
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([
      EUIPO_ENDPOINTS.production.token,
      'https://api.euipo.europa.eu/trademark-search/trademarks',
      'https://api.euipo.europa.eu/trademark-search/trademarks',
    ]);
  });

  it('refreshes the token once on 401', async () => {
    const { http, calls } = fakeHttp([
      token('old'),
      new Response(null, { status: 401 }),
      token('new'),
      Response.json(searchFixture),
    ]);
    const result = await createEuipoClient(http, creds).search('acme', []);
    expect(result.kind).toBe('ok');
    expect(((calls[3]?.init?.headers ?? {}) as Record<string, string>).authorization).toBe(
      'Bearer new',
    );
  });

  it('returns an error without the secret when the token request fails', async () => {
    const { http } = fakeHttp([new Response(`bad secret ${SECRET}`, { status: 401 })]);
    const result = await createEuipoClient(http, creds).search('acme', []);
    expect(result).toEqual({ kind: 'error', reason: 'EUIPO token request returned HTTP 401' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('uses the sandbox endpoints when asked', async () => {
    const { http, calls } = fakeHttp([token(), Response.json(searchFixture)]);
    await createEuipoClient(http, { ...creds, env: 'sandbox' }).search('acme', []);
    expect(calls[0]?.url).toBe(EUIPO_ENDPOINTS.sandbox.token);
    expect(calls[1]?.url).toContain('https://api-sandbox.euipo.europa.eu/trademark-search/');
  });
});

describe('trademarkSearchLinks', () => {
  it('returns one encoded link per office', () => {
    const links = trademarkSearchLinks('acme co');
    expect(links.map((l) => l.office)).toEqual(['uspto', 'euipo', 'tmview', 'wipo']);
    expect(links[0]?.url).toBe(
      'https://tmsearch.uspto.gov/search/search-results?query=acme%20co&section=default',
    );
    expect(links[3]?.note).toContain('"acme co"');
  });
});

describe('parseEuipoSearch shape checks', () => {
  it('errors when results are listed but none can be parsed', () => {
    const result = parseEuipoSearch({ trademarks: [{ unexpected: true }], totalElements: 1 });
    expect(result.kind).toBe('error');
  });

  it('errors when totalElements is missing or not a number', () => {
    expect(parseEuipoSearch({ trademarks: [] }).kind).toBe('error');
    expect(parseEuipoSearch({ trademarks: [], totalElements: '0' }).kind).toBe('error');
  });

  it('accepts a genuinely empty result', () => {
    expect(parseEuipoSearch({ trademarks: [], totalElements: 0 })).toEqual({
      kind: 'ok',
      total: 0,
      matches: [],
    });
  });
});
