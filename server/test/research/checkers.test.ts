import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  githubChecker,
  manualChecker,
  npmChecker,
  pypiChecker,
} from '../../src/research/handles/checkers.js';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function fakeHttp(respond: (url: string) => Response | Error): { http: HttpFetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const http: HttpFetch = async (url, init) => {
    seen.push({ url, init });
    const out = respond(url);
    if (out instanceof Error) throw out;
    return out;
  };
  return { http, seen };
}

const status = (code: number) => () => new Response(null, { status: code });

describe('githubChecker', () => {
  it('reports taken on 200 with a HEAD to the users API', async () => {
    const { http, seen } = fakeHttp(status(200));
    expect(await githubChecker(http)('acme')).toEqual({
      status: 'taken',
      confidence: 'high',
      method: 'api',
      source: 'github-api',
    });
    expect(seen[0]?.url).toBe('https://api.github.com/users/acme');
    expect(seen[0]?.init?.method).toBe('HEAD');
  });

  it('reports likely_available with medium confidence on 404', async () => {
    const { http } = fakeHttp(status(404));
    expect(await githubChecker(http)('acme')).toMatchObject({
      status: 'likely_available',
      confidence: 'medium',
    });
  });

  it('sends the optional token as a bearer header', async () => {
    const { http, seen } = fakeHttp(status(200));
    await githubChecker(http, 'tok-123')('acme');
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-123');
  });

  it('reports unknown on a rate-limit status, without the token in the reason', async () => {
    const { http } = fakeHttp(status(403));
    const probe = await githubChecker(http, 'tok-123')('acme');
    expect(probe).toMatchObject({ status: 'unknown', confidence: 'low' });
    expect(probe.reason).toBe('github-api returned HTTP 403');
    expect(JSON.stringify(probe)).not.toContain('tok-123');
  });

  it('reports unknown on a network failure', async () => {
    const { http } = fakeHttp(() => new Error('Request to api.github.com failed after 3 tries'));
    expect(await githubChecker(http)('acme')).toMatchObject({
      status: 'unknown',
      reason: 'Request to api.github.com failed after 3 tries',
    });
  });
});

describe('npmChecker and pypiChecker', () => {
  it('query the npm registry document', async () => {
    const { http, seen } = fakeHttp(status(404));
    expect((await npmChecker(http)('acme')).status).toBe('likely_available');
    expect(seen[0]?.url).toBe('https://registry.npmjs.org/acme');
  });

  it('query the PyPI simple API with the JSON media type', async () => {
    const { http, seen } = fakeHttp(status(200));
    expect((await pypiChecker(http)('acme-tools')).status).toBe('taken');
    expect(seen[0]?.url).toBe('https://pypi.org/simple/acme-tools/');
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.accept).toBe('application/vnd.pypi.simple.v1+json');
  });
});

describe('manualChecker', () => {
  it('returns unknown with method manual and makes no request', async () => {
    expect(await manualChecker('check by hand')('acme')).toEqual({
      status: 'unknown',
      confidence: 'low',
      method: 'manual',
      source: 'none',
      reason: 'check by hand',
    });
  });
});
