import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache/cache.js';
import type { HttpFetch } from '../src/http/http.js';
import {
  IANA_RDAP_BOOTSTRAP,
  loadRdapServers,
  parseBootstrap,
  rdapBaseFor,
  rdapLookup,
} from '../src/sources/rdap.js';
import bootstrap from './fixtures/rdap-bootstrap.json' with { type: 'json' };
import googleRecord from './fixtures/rdap-domain-google.json' with { type: 'json' };

const servers = parseBootstrap(bootstrap as unknown as { services: [string[], string[]][] });

function routeHttp(routes: Record<string, Response | Error>): {
  http: HttpFetch;
  urls: string[];
} {
  const urls: string[] = [];
  const http: HttpFetch = async (url) => {
    urls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response('', { status: 500 });
    if (route instanceof Error) throw route;
    return route.clone();
  };
  return { http, urls };
}

describe('parseBootstrap and rdapBaseFor', () => {
  it('maps every TLD to its servers', () => {
    expect(servers.com).toEqual(['https://rdap.verisign.com/com/v1/']);
    expect(servers.app).toEqual(['https://pubapi.registry.google/rdap/']);
  });

  it('prefers an https server', () => {
    expect(rdapBaseFor(servers, 'uk')).toBe('https://rdap.nominet.uk/uk/');
  });

  it('falls back to the last label for multi-label TLDs', () => {
    expect(rdapBaseFor(servers, 'co.uk')).toBe('https://rdap.nominet.uk/uk/');
  });

  it('returns undefined for a TLD without RDAP', () => {
    expect(rdapBaseFor(servers, 'xyz')).toBeUndefined();
  });
});

describe('loadRdapServers', () => {
  it('fetches the IANA file once and then serves it from cache', async () => {
    const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rdap-')));
    const { http, urls } = routeHttp({
      [IANA_RDAP_BOOTSTRAP]: Response.json(bootstrap),
    });
    await loadRdapServers(http, cache);
    const second = await loadRdapServers(http, cache);
    expect(second.com).toEqual(['https://rdap.verisign.com/com/v1/']);
    expect(urls).toEqual([IANA_RDAP_BOOTSTRAP]);
  });

  it('throws when IANA returns an error status', async () => {
    const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rdap-')));
    const { http } = routeHttp({ [IANA_RDAP_BOOTSTRAP]: new Response('', { status: 503 }) });
    await expect(loadRdapServers(http, cache)).rejects.toThrow('HTTP 503');
  });
});

describe('rdapLookup', () => {
  const deps = (routes: Record<string, Response | Error>) => ({
    http: routeHttp(routes).http,
    servers: async () => servers,
  });

  it('reports registered with the record on HTTP 200', async () => {
    const result = await rdapLookup(
      'google.com',
      'com',
      deps({ 'https://rdap.verisign.com/com/v1/domain/google.com': Response.json(googleRecord) }),
    );
    expect(result.kind).toBe('registered');
    if (result.kind === 'registered') expect(result.record.ldhName).toBe('GOOGLE.COM');
  });

  it('reports not_found on HTTP 404', async () => {
    const result = await rdapLookup(
      'zzqx.com',
      'com',
      deps({
        'https://rdap.verisign.com/com/v1/domain/zzqx.com': new Response('', { status: 404 }),
      }),
    );
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('reports no_server when the TLD has no RDAP service', async () => {
    expect(await rdapLookup('acme.xyz', 'xyz', deps({}))).toEqual({ kind: 'no_server' });
  });

  it('reports error on other statuses and on network failure', async () => {
    const url = 'https://rdap.verisign.com/com/v1/domain/acme.com';
    expect(
      await rdapLookup('acme.com', 'com', deps({ [url]: new Response('', { status: 400 }) })),
    ).toEqual({ kind: 'error', reason: 'RDAP HTTP 400' });
    expect(await rdapLookup('acme.com', 'com', deps({ [url]: new Error('offline') }))).toEqual({
      kind: 'error',
      reason: 'offline',
    });
  });

  it('reports error when the bootstrap cannot load', async () => {
    const result = await rdapLookup('acme.com', 'com', {
      http: routeHttp({}).http,
      servers: async () => {
        throw new Error('IANA down');
      },
    });
    expect(result).toEqual({ kind: 'error', reason: 'IANA down' });
  });
});
