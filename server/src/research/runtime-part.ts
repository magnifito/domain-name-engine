import { resolveNs as dnsResolveNs } from 'node:dns/promises';
import type { DiskCache } from '../cache/cache.js';
import type { HttpFetch } from '../http/http.js';
import type { HostLimiter } from '../limiter/limiter.js';
import { type RdapServers, rdapLookup } from '../sources/rdap.js';
import { type WhoisQuery, whoisLookup } from '../sources/whois.js';
import { checkHandles, createCheckers, type HandleCheck } from './handles/check.js';
import type { Platform } from './handles/platforms.js';
import { readResearchKeys } from './keys.js';
import { fetchHomepage } from './profile/homepage.js';
import { type DomainProfile, profileDomain } from './profile/profile.js';
import { createGuardedHttp, type GuardOptions } from './profile/safe-fetch.js';
import { createEuipoClient } from './trademarks/euipo.js';
import {
  searchTrademarks,
  type TrademarkQuery,
  type TrademarkSearch,
} from './trademarks/search.js';

export interface ResearchRuntime {
  profileDomain(domain: string): Promise<DomainProfile>;
  checkHandles(handles: string[], platforms: readonly Platform[]): Promise<HandleCheck[]>;
  searchTrademarks(query: TrademarkQuery): Promise<TrademarkSearch>;
}

export interface ResearchRuntimeDeps {
  http: HttpFetch;
  limiter: HostLimiter;
  cache: DiskCache;
  env: NodeJS.ProcessEnv;
  rdapServers: () => Promise<RdapServers>;
  whoisQuery: WhoisQuery;
  resolveNs?: (domain: string) => Promise<string[]>;
  /** Test seam for the homepage request: DNS resolver and transport. */
  homepage?: Pick<GuardOptions, 'resolve' | 'transport'>;
}

export function createResearchRuntime(deps: ResearchRuntimeDeps): ResearchRuntime {
  const { http, limiter, cache } = deps;
  const keys = readResearchKeys(deps.env);
  const resolveNs = deps.resolveNs ?? dnsResolveNs;
  // Homepages are untrusted URLs: vetted addresses only, pinned, no retries, shared limiter.
  const homepageHttp = createGuardedHttp({ limiter, ...deps.homepage });
  const checkers = createCheckers(http, keys);
  const euipo = keys.euipo ? createEuipoClient(http, keys.euipo) : undefined;

  return {
    profileDomain: (domain) =>
      profileDomain(domain, {
        cache,
        rdap: (d, tld) => rdapLookup(d, tld, { http, servers: deps.rdapServers }),
        whois: (d, tld) => whoisLookup(d, tld, { query: deps.whoisQuery, limiter, cache }),
        nameservers: async (d) => {
          try {
            return (await resolveNs(d)).map((ns) => ns.toLowerCase().replace(/\.$/, ''));
          } catch {
            return null;
          }
        },
        homepage: (d) => fetchHomepage(d, homepageHttp),
      }),
    checkHandles: (handles, platforms) => checkHandles(handles, platforms, { checkers, cache }),
    searchTrademarks: (query) => searchTrademarks(query, { euipo, cache }),
  };
}
