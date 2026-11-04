import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import type { HttpFetch } from '../../src/http/http.js';
import { HostLimiter } from '../../src/limiter/limiter.js';
import { createResearchRuntime } from '../../src/research/runtime-part.js';
import googleRecord from '../fixtures/rdap-domain-google.json' with { type: 'json' };

function routeHttp(routes: Record<string, () => Response>): { http: HttpFetch; urls: string[] } {
  const urls: string[] = [];
  const http: HttpFetch = async (url) => {
    urls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`no route for ${url}`);
    return route();
  };
  return { http, urls };
}

async function runtime(http: HttpFetch, env: NodeJS.ProcessEnv = {}) {
  return createResearchRuntime({
    http,
    limiter: new HostLimiter({ minIntervalMs: 0 }),
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rt-'))),
    env,
    rdapServers: async () => ({ com: ['https://rdap.verisign.com/com/v1/'] }),
    whoisQuery: async () => {
      throw new Error('WHOIS must not be used');
    },
    resolveNs: async () => [],
  });
}

describe('createResearchRuntime', () => {
  it('wires profileDomain to RDAP and the homepage fetch', async () => {
    const { http, urls } = routeHttp({
      'https://rdap.verisign.com/com/v1/domain/google.com': () => Response.json(googleRecord),
      'https://google.com/': () =>
        new Response('<title>Google</title>', { headers: { 'content-type': 'text/html' } }),
    });
    const profile = await (await runtime(http)).profileDomain('google.com');
    expect(profile).toMatchObject({ status: 'live_site', homepage: { title: 'Google' } });
    expect(urls).toHaveLength(2);
  });

  it('wires checkHandles to the GitHub API and manual platforms', async () => {
    const { http } = routeHttp({
      'https://api.github.com/users/acme': () => new Response(null, { status: 200 }),
    });
    const results = await (await runtime(http)).checkHandles(['acme'], ['github', 'x']);
    expect(results.map((r) => [r.platform, r.status, r.method])).toEqual([
      ['github', 'taken', 'api'],
      ['x', 'unknown', 'manual'],
    ]);
  });

  it('runs searchTrademarks without EUIPO keys and without network', async () => {
    const { http, urls } = routeHttp({});
    const result = await (await runtime(http)).searchTrademarks({ mark: 'acme' });
    expect(result.results.every((r) => r.status === 'unknown')).toBe(true);
    expect(urls).toEqual([]);
  });

  it('enables EUIPO when both credentials are in env', async () => {
    const { http, urls } = routeHttp({});
    const rt = await runtime(http, { EUIPO_CLIENT_ID: 'id', EUIPO_CLIENT_SECRET: 'secret' });
    const result = await rt.searchTrademarks({ mark: 'acme' });
    expect(result.results[0]).toMatchObject({ office: 'euipo', source: 'euipo-api' });
    expect(urls[0]).toBe('https://euipo.europa.eu/cas-server-webapp/oidc/accessToken');
  });
});
