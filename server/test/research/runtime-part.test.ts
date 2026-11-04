import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import type { HttpFetch } from '../../src/http/http.js';
import { HostLimiter } from '../../src/limiter/limiter.js';
import {
  createResearchRuntime,
  type ResearchRuntimeDeps,
} from '../../src/research/runtime-part.js';
import googleRecord from '../fixtures/rdap-domain-google.json' with { type: 'json' };

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

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

async function runtime(
  http: HttpFetch,
  env: NodeJS.ProcessEnv = {},
  extra: Partial<ResearchRuntimeDeps> = {},
) {
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
    ...extra,
  });
}

describe('createResearchRuntime', () => {
  it('wires profileDomain to RDAP and the homepage fetch', async () => {
    const { http, urls } = routeHttp({
      'https://rdap.verisign.com/com/v1/domain/google.com': () => Response.json(googleRecord),
    });
    const homepageUrls: string[] = [];
    const homepage = {
      resolve: async () => PUBLIC_ADDRESS,
      transport: async ({ url }: { url: URL }) => {
        homepageUrls.push(url.href);
        return new Response('<title>Google</title>', { headers: { 'content-type': 'text/html' } });
      },
    };
    const profile = await (await runtime(http, {}, { homepage })).profileDomain('google.com');
    expect(profile).toMatchObject({ status: 'live_site', homepage: { title: 'Google' } });
    expect(urls).toHaveLength(1);
    expect(homepageUrls).toEqual(['https://google.com/']);
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

  it('does not retry a homepage that answers 429', async () => {
    const { http } = routeHttp({
      'https://rdap.verisign.com/com/v1/domain/acme.com': () => Response.json(googleRecord),
    });
    let gets = 0;
    const homepage = {
      resolve: async () => PUBLIC_ADDRESS,
      transport: async () => {
        gets++;
        return new Response('slow down', { status: 429 });
      },
    };
    const rt = await runtime(http, {}, { homepage });
    const profile = await rt.profileDomain('acme.com');
    expect(profile.status).toBe('live_site');
    expect(gets).toBe(1);
  });
});
