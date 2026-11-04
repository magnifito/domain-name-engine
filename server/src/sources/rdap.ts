import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import type { HttpFetch } from '../http/http.js';
import { errorMessage } from '../util/errors.js';

export const IANA_RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const BOOTSTRAP_CACHE_KEY = 'rdap:bootstrap';

export type RdapServers = Record<string, string[]>;

export interface RdapDomain {
  ldhName?: string;
  status?: string[];
  events?: Array<{ eventAction: string; eventDate: string }>;
  nameservers?: Array<{ ldhName?: string }>;
  entities?: unknown[];
}

export type RdapResult =
  | { kind: 'registered'; record: RdapDomain }
  | { kind: 'not_found' }
  | { kind: 'no_server' }
  | { kind: 'error'; reason: string };

export function parseBootstrap(file: { services: [string[], string[]][] }): RdapServers {
  const servers: RdapServers = {};
  for (const [tlds, urls] of file.services) {
    for (const tld of tlds) servers[tld.toLowerCase()] = urls;
  }
  return servers;
}

export async function loadRdapServers(http: HttpFetch, cache: DiskCache): Promise<RdapServers> {
  const cached = await cache.get<RdapServers>(BOOTSTRAP_CACHE_KEY);
  if (cached) return cached;
  const res = await http(IANA_RDAP_BOOTSTRAP);
  if (!res.ok) throw new Error(`IANA RDAP bootstrap returned HTTP ${res.status}`);
  const servers = parseBootstrap((await res.json()) as { services: [string[], string[]][] });
  await cache.set(BOOTSTRAP_CACHE_KEY, servers, TTL.rdapBootstrap);
  return servers;
}

export function rdapBaseFor(servers: RdapServers, tld: string): string | undefined {
  const candidates = [tld, tld.split('.').at(-1) ?? tld];
  for (const candidate of candidates) {
    const urls = servers[candidate];
    if (urls && urls.length > 0) return urls.find((u) => u.startsWith('https://')) ?? urls[0];
  }
  return undefined;
}

export async function rdapLookup(
  domain: string,
  tld: string,
  deps: { http: HttpFetch; servers: () => Promise<RdapServers> },
): Promise<RdapResult> {
  let servers: RdapServers;
  try {
    servers = await deps.servers();
  } catch (error) {
    return { kind: 'error', reason: errorMessage(error) };
  }
  const base = rdapBaseFor(servers, tld);
  if (!base) return { kind: 'no_server' };

  const url = new URL(`domain/${domain}`, base.endsWith('/') ? base : `${base}/`).toString();
  try {
    const res = await deps.http(url, { headers: { accept: 'application/rdap+json' } });
    if (res.status === 404) return { kind: 'not_found' };
    if (res.ok) return { kind: 'registered', record: (await res.json()) as RdapDomain };
    return { kind: 'error', reason: `RDAP HTTP ${res.status}` };
  } catch (error) {
    return { kind: 'error', reason: errorMessage(error) };
  }
}
