import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import { splitDomain } from '../domain/name.js';
import { type TldInfo, type TldRegistrarEntry, tldInfo } from '../tld/info.js';
import {
  type CheapestOption,
  cheapestThreeYear,
  livePriceLabel,
  TABLE_NOTE,
  threeYearTotal,
  UNKNOWN,
} from '../tld/pricing.js';
import type { RegistrarId } from '../tld/schema.js';
import type { TldTables } from '../tld/table.js';
import { errorMessage } from '../util/errors.js';
import { redact } from './credentials.js';
import { type LiveAvailability, type LiveClient, type LiveQuote, unknownQuote } from './types.js';

export const MAX_QUOTE_DOMAINS = 20;

export type PriceSource = 'live' | 'table' | 'none';

export interface RegistrarQuoteEntry {
  registrar: RegistrarId;
  registrarName: string;
  sale: TldRegistrarEntry['sale'];
  priceSource: PriceSource;
  availability: LiveAvailability | null;
  premium: boolean | null;
  firstYear: number | null;
  renewal: number | null;
  transfer: number | null;
  threeYearTotal: number | null;
  currency: string | null;
  source: string | null;
  checkedAt: string | null;
  priceLabel: string;
  reason?: string;
}

export interface DomainQuote {
  domain: string;
  tld: string;
  registrars: RegistrarQuoteEntry[];
  cheapestThreeYear: CheapestOption[];
  reputation: TldInfo['reputation'];
}

export interface QuoteResult {
  mode: 'table' | 'live';
  liveRegistrars: RegistrarId[];
  quotes: DomainQuote[];
  notes: string[];
}

export interface QuoteDeps {
  tables: TldTables;
  clients: LiveClient[];
  cache: DiskCache;
  secrets: readonly string[];
  now?: () => Date;
}

export const NO_KEYS_NOTE =
  'No registrar API keys are set, so these are bundled table prices only. Availability comes from check_domains; premium status is unknown.';
export const LIVE_NOTE =
  'Live results come from registrar APIs and are cached for 1 hour. Live prices override table prices for the same registrar.';

const cacheKey = (registrar: RegistrarId, domain: string) =>
  `registrar-live:${registrar}:${domain}`;

async function liveQuotes(
  client: LiveClient,
  domains: string[],
  deps: QuoteDeps,
): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  const missing: string[] = [];
  for (const domain of domains) {
    const cached = await deps.cache.get<LiveQuote>(cacheKey(client.id, domain));
    if (cached) out.set(domain, cached);
    else missing.push(domain);
  }
  if (missing.length === 0) return out;

  let fresh: LiveQuote[];
  try {
    fresh = await client.quote(missing);
  } catch (error) {
    const checkedAt = (deps.now?.() ?? new Date()).toISOString();
    const reason = redact(errorMessage(error), deps.secrets);
    fresh = missing.map((domain) => unknownQuote(client.id, domain, checkedAt, reason));
  }
  for (const quote of fresh) {
    const safe = quote.reason ? { ...quote, reason: redact(quote.reason, deps.secrets) } : quote;
    out.set(safe.domain, safe);
    if (safe.availability !== 'unknown') {
      await deps.cache
        .set(cacheKey(client.id, safe.domain), safe, TTL.registrarLive)
        .catch(() => undefined);
    }
  }
  return out;
}

function merge(table: TldRegistrarEntry, live: LiveQuote | undefined): RegistrarQuoteEntry {
  const base: RegistrarQuoteEntry = {
    ...table,
    priceSource: 'table',
    availability: null,
    premium: null,
  };
  if (table.firstYear === null && table.renewal === null && table.transfer === null) {
    base.priceSource = 'none';
  }
  if (!live) return base;

  const withLive: RegistrarQuoteEntry = {
    ...base,
    availability: live.availability,
    premium: live.premium,
    ...(live.reason ? { reason: live.reason } : {}),
  };
  const livePriced = live.currency !== null && (live.firstYear !== null || live.renewal !== null);
  if (livePriced) {
    return {
      ...withLive,
      priceSource: 'live',
      firstYear: live.firstYear,
      renewal: live.renewal,
      transfer: null,
      threeYearTotal: threeYearTotal(live.firstYear, live.renewal),
      currency: live.currency,
      source: `${table.registrarName} API`,
      checkedAt: live.checkedAt,
      priceLabel: livePriceLabel(table.registrar, live.checkedAt),
    };
  }
  if (live.premium) {
    // A premium name never sells at the standard table price.
    return {
      ...withLive,
      priceSource: 'none',
      firstYear: null,
      renewal: null,
      transfer: null,
      threeYearTotal: null,
      currency: null,
      priceLabel: `${UNKNOWN} — premium name, table price does not apply`,
    };
  }
  return withLive;
}

export async function quoteDomains(domains: string[], deps: QuoteDeps): Promise<QuoteResult> {
  const parsed = [...new Set(domains.map((d) => d.trim().toLowerCase().replace(/\.$/, '')))].map(
    (domain) => {
      const { label, tld } = splitDomain(domain);
      return { domain: `${label}.${tld}`, tld };
    },
  );
  const names = parsed.map((p) => p.domain);
  const live = new Map<RegistrarId, Map<string, LiveQuote>>();
  await Promise.all(
    deps.clients.map(async (client) => {
      live.set(client.id, await liveQuotes(client, names, deps));
    }),
  );

  const quotes = parsed.map(({ domain, tld }): DomainQuote => {
    const info = tldInfo(tld, deps.tables);
    const registrars = info.registrars.map((entry) =>
      merge(entry, live.get(entry.registrar)?.get(domain)),
    );
    return {
      domain,
      tld,
      registrars,
      cheapestThreeYear: cheapestThreeYear(registrars),
      reputation: info.reputation,
    };
  });

  const liveRegistrars = deps.clients.map((c) => c.id);
  return {
    mode: liveRegistrars.length > 0 ? 'live' : 'table',
    liveRegistrars,
    quotes,
    notes: [TABLE_NOTE, liveRegistrars.length > 0 ? LIVE_NOTE : NO_KEYS_NOTE],
  };
}
