import { DiskCache } from './cache/cache.js';
import { engineHome, enginePaths } from './config.js';
import { type CheckDeps, checkDomains } from './domain/check.js';
import type { DomainCheck } from './domain/types.js';
import { createHttp } from './http/http.js';
import { HostLimiter } from './limiter/limiter.js';
import { hasNameservers } from './sources/dns.js';
import { loadRdapServers, type RdapServers, rdapLookup } from './sources/rdap.js';
import { tcpWhoisQuery, whoisLookup } from './sources/whois.js';
import { createStoreRuntime, type StoreRuntime } from './store/runtime-part.js';

export interface Runtime extends StoreRuntime {
  checkDomains(domains: string[]): Promise<DomainCheck[]>;
}

export function createRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const paths = enginePaths(engineHome(env));
  const cache = new DiskCache(paths.cache);
  const limiter = new HostLimiter();
  const http = createHttp({ limiter });
  const whoisQuery = tcpWhoisQuery();

  let servers: Promise<RdapServers> | undefined;
  const getServers = (): Promise<RdapServers> => {
    servers ??= loadRdapServers(http, cache).catch((error: unknown) => {
      // Allow a retry on the next call instead of caching the failure.
      servers = undefined;
      throw error;
    });
    return servers;
  };

  const deps: CheckDeps = {
    cache,
    rdap: (domain, tld) => rdapLookup(domain, tld, { http, servers: getServers }),
    whois: (domain, tld) => whoisLookup(domain, tld, { query: whoisQuery, limiter, cache }),
    dns: (domain) => hasNameservers(domain),
  };

  return {
    checkDomains: (domains) => checkDomains(domains, deps),
    ...createStoreRuntime(paths, { http, limiter, cache }),
  };
}
