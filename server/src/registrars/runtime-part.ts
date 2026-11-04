import type { DiskCache } from '../cache/cache.js';
import type { HttpFetch } from '../http/http.js';
import { type TldInfo, tldInfo } from '../tld/info.js';
import { bundledTables, type TldTables } from '../tld/table.js';
import { createCloudflareClient } from './cloudflare.js';
import {
  type Credentials,
  type RegistrarStatusReport,
  readCredentials,
  registrarStatus,
  secretValues,
} from './credentials.js';
import { createNamecheapClient } from './namecheap.js';
import { type QuoteResult, quoteDomains } from './quote.js';
import { createSpaceshipClient } from './spaceship.js';
import type { LiveClient } from './types.js';

export interface RegistrarRuntime {
  tldInfo(tld: string): TldInfo;
  registrarQuote(domains: string[]): Promise<QuoteResult>;
  registrarStatus(): RegistrarStatusReport;
}

export interface RegistrarRuntimeDeps {
  http: HttpFetch;
  cache: DiskCache;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
  tables?: TldTables;
}

/** One live client per registrar whose keys are all set, in the fixed registrar order. */
export function liveClients(
  creds: Credentials,
  deps: Pick<RegistrarRuntimeDeps, 'http' | 'cache' | 'now'>,
): LiveClient[] {
  const clients: LiveClient[] = [];
  if (creds.spaceship) clients.push(createSpaceshipClient(creds.spaceship, deps));
  if (creds.namecheap) clients.push(createNamecheapClient(creds.namecheap, deps));
  if (creds.cloudflare) clients.push(createCloudflareClient(creds.cloudflare, deps));
  return clients;
}

export function createRegistrarRuntime(deps: RegistrarRuntimeDeps): RegistrarRuntime {
  const creds = readCredentials(deps.env);
  const secrets = secretValues(creds);
  const clients = liveClients(creds, deps);
  const tables = () => deps.tables ?? bundledTables();
  return {
    tldInfo: (tld) => tldInfo(tld, tables()),
    registrarQuote: (domains) =>
      quoteDomains(domains, {
        tables: tables(),
        clients,
        cache: deps.cache,
        secrets,
        now: deps.now,
      }),
    registrarStatus: () => registrarStatus(deps.env),
  };
}
