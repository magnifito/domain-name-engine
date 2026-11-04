import { describe, expect, it } from 'vitest';
import {
  createSpaceshipClient,
  fetchSpaceshipTldPrices,
  parseSpaceshipTldPrices,
  SPACESHIP_API,
} from '../../src/registrars/spaceship.js';
import { FIXED_NOW, fakeHttp } from './fake-http.js';
import available from './fixtures/spaceship-available.json' with { type: 'json' };
import domainPrices from './fixtures/spaceship-domain-prices.json' with { type: 'json' };
import tldPrices from './fixtures/spaceship-tld-prices.json' with { type: 'json' };

const CREDS = { apiKey: 'ss-key-1234', apiSecret: 'ss-secret-5678' };

function client() {
  const fake = fakeHttp([
    [`${SPACESHIP_API}/v1/domains/available`, () => Response.json(available)],
    [`${SPACESHIP_API}/v1/domains/pricing/query`, () => Response.json(domainPrices)],
  ]);
  return {
    ...fake,
    client: createSpaceshipClient(CREDS, { http: fake.http, now: () => FIXED_NOW }),
  };
}

describe('Spaceship client', () => {
  it('sends the key headers and both POST requests', async () => {
    const { client: c, calls } = client();
    await c.quote(['zentrova.site']);
    expect(calls.map((x) => [x.method, x.url])).toEqual([
      ['POST', `${SPACESHIP_API}/v1/domains/available`],
      ['POST', `${SPACESHIP_API}/v1/domains/pricing/query`],
    ]);
    expect(calls[0]?.headers.get('x-api-key')).toBe('ss-key-1234');
    expect(calls[0]?.headers.get('x-api-secret')).toBe('ss-secret-5678');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ domains: ['zentrova.site'] });
  });

  it('maps a standard available domain to its 1-year prices', async () => {
    const [quote] = await client().client.quote(['zentrova.site']);
    expect(quote).toEqual({
      registrar: 'spaceship',
      domain: 'zentrova.site',
      availability: 'available',
      premium: false,
      firstYear: 1.05,
      renewal: 11.11,
      currency: 'EUR',
      checkedAt: '2026-11-04T10:00:00.000Z',
    });
  });

  it('maps an undocumented result value to unknown with a reason, not to unavailable', async () => {
    const [quote] = await client().client.quote(['google.com']);
    expect(quote).toMatchObject({ availability: 'unknown' });
    expect(quote?.reason).toContain('taken');
  });

  it('keeps the availability answer when the pricing call fails (M4)', async () => {
    const fake = fakeHttp([
      [`${SPACESHIP_API}/v1/domains/available`, () => Response.json(available)],
      [`${SPACESHIP_API}/v1/domains/pricing/query`, () => new Response('boom', { status: 500 })],
    ]);
    const c = createSpaceshipClient(CREDS, { http: fake.http, now: () => FIXED_NOW });
    const [quote] = await c.quote(['zentrova.site']);
    expect(quote).toMatchObject({
      availability: 'available',
      firstYear: null,
      renewal: null,
      currency: null,
    });
    expect(quote?.reason).toContain('pricing');
  });

  it('uses premium pricing for a premium domain', async () => {
    const [quote] = await client().client.quote(['rare.io']);
    expect(quote).toMatchObject({
      availability: 'available',
      premium: true,
      firstYear: 999.99,
      renewal: 59.98,
      currency: 'USD',
    });
  });

  it('returns unknown for a domain missing from the response', async () => {
    const [quote] = await client().client.quote(['absent.site']);
    expect(quote).toMatchObject({ availability: 'unknown', reason: 'no availability result' });
  });

  it('throws on an HTTP error without echoing the keys', async () => {
    const { http } = fakeHttp([
      [
        'https://spaceship.dev/',
        () => Response.json({ detail: 'Invalid API key' }, { status: 401 }),
      ],
    ]);
    const c = createSpaceshipClient(CREDS, { http });
    const error = await c.quote(['zentrova.site']).catch((e: Error) => e);
    expect(String(error)).toContain('HTTP 401: Invalid API key');
    expect(String(error)).not.toContain('ss-key-1234');
  });
});

describe('Spaceship TLD prices', () => {
  it('parses rows with first-year, renewal, and transfer in one currency', () => {
    expect(parseSpaceshipTldPrices(tldPrices, '2026-11-04')).toEqual([
      {
        registrar: 'spaceship',
        tld: 'site',
        firstYear: 1.05,
        renewal: 11.11,
        transfer: 10.1,
        currency: 'EUR',
        source: 'Spaceship API /v1/tlds/pricing',
        checkedAt: '2026-11-04',
      },
    ]);
  });

  it('pages until total is reached', async () => {
    const { http, calls } = fakeHttp([
      [`${SPACESHIP_API}/v1/tlds/pricing`, () => Response.json(tldPrices)],
    ]);
    const rows = await fetchSpaceshipTldPrices(CREDS, http, '2026-11-04');
    expect(rows).toHaveLength(1);
    expect(calls.map((c) => c.url)).toEqual([`${SPACESHIP_API}/v1/tlds/pricing?take=25&skip=0`]);
  });

  it.each([
    [{ items: [] }],
    [{ items: [{ tld: 'site', prices: {} }] }],
    [{ items: [{ tld: 'site' }], total: 'many' }],
  ])('fails when total is missing or not a number (%j)', async (page) => {
    const { http } = fakeHttp([[`${SPACESHIP_API}/v1/tlds/pricing`, () => Response.json(page)]]);
    await expect(fetchSpaceshipTldPrices(CREDS, http, '2026-11-04')).rejects.toThrow('total');
  });
});
