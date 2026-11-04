import type { DiskCache } from '../../cache/cache.js';
import { TTL } from '../../cache/ttl.js';
import type { Confidence } from '../../domain/types.js';
import type { EuipoClient, TrademarkMatch } from './euipo.js';
import { type SearchLink, trademarkSearchLinks } from './links.js';

export type OfficeStatus = 'matches_found' | 'no_matches' | 'unknown';

export interface OfficeResult {
  office: 'euipo' | 'uspto' | 'wipo';
  status: OfficeStatus;
  confidence: Confidence;
  source: string;
  checkedAt: string;
  total?: number;
  matches: TrademarkMatch[];
  reason?: string;
}

export interface TrademarkQuery {
  mark: string;
  niceClasses?: number[];
}

export interface TrademarkSearch {
  mark: string;
  niceClasses: number[];
  results: OfficeResult[];
  links: SearchLink[];
  note: string;
}

export interface TrademarkDeps {
  euipo?: EuipoClient;
  cache: DiskCache;
  now?: () => Date;
}

export const TRADEMARK_NOTE =
  'Automated search covers EUIPO word elements that contain the mark. no_matches is not a clearance: similar-sounding, translated, figurative, and unregistered marks are not covered. Use the links for a manual search and ask a trademark attorney before relying on a name.';

// Reasons carry the date the source situation was last confirmed.
export const USPTO_REASON =
  'USPTO has no official keyless trademark search API (checked 2026-11-04). The tmsearch.uspto.gov backend is unofficial and bot-protected, so it is not queried. Use the USPTO link.';
export const WIPO_REASON =
  'The WIPO Global Brand Database has no public API (checked 2026-11-04). Use the WIPO link.';
export const EUIPO_NO_KEY_REASON =
  'EUIPO search needs free API credentials: set EUIPO_CLIENT_ID and EUIPO_CLIENT_SECRET (register at https://dev.euipo.europa.eu). Use the EUIPO or TMview link meanwhile.';
export const EUIPO_SANDBOX_REASON =
  'EUIPO_ENV=sandbox: results come from test data, not the live register.';

async function searchEuipo(
  mark: string,
  classes: number[],
  checkedAt: string,
  deps: TrademarkDeps,
): Promise<OfficeResult> {
  const client = deps.euipo;
  if (!client) {
    return {
      office: 'euipo',
      status: 'unknown',
      confidence: 'low',
      source: 'none',
      checkedAt,
      matches: [],
      reason: EUIPO_NO_KEY_REASON,
    };
  }
  const key = `trademark:euipo:${client.env}:${mark.toLowerCase()}:${classes.join(',')}`;
  const cached = await deps.cache.get<OfficeResult>(key);
  if (cached) return cached;

  const found = await client.search(mark, classes);
  if (found.kind === 'error') {
    return {
      office: 'euipo',
      status: 'unknown',
      confidence: 'low',
      source: 'euipo-api',
      checkedAt,
      matches: [],
      reason: found.reason,
    };
  }
  const sandbox = client.env === 'sandbox';
  const result: OfficeResult = {
    office: 'euipo',
    status: found.total > 0 ? 'matches_found' : 'no_matches',
    confidence: sandbox ? 'low' : found.total > 0 ? 'high' : 'medium',
    source: sandbox ? 'euipo-api-sandbox' : 'euipo-api',
    checkedAt,
    total: found.total,
    matches: found.matches,
    reason: sandbox ? EUIPO_SANDBOX_REASON : undefined,
  };
  try {
    await deps.cache.set(key, result, TTL.trademarks);
  } catch {
    // The cache is only an optimisation; a write failure must not fail the search.
  }
  return result;
}

function linkOnly(office: 'uspto' | 'wipo', reason: string, checkedAt: string): OfficeResult {
  return {
    office,
    status: 'unknown',
    confidence: 'low',
    source: 'none',
    checkedAt,
    matches: [],
    reason,
  };
}

export async function searchTrademarks(
  query: TrademarkQuery,
  deps: TrademarkDeps,
): Promise<TrademarkSearch> {
  const mark = query.mark.trim();
  const classes = [...new Set(query.niceClasses ?? [])].sort((a, b) => a - b);
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();
  return {
    mark,
    niceClasses: classes,
    results: [
      await searchEuipo(mark, classes, checkedAt, deps),
      linkOnly('uspto', USPTO_REASON, checkedAt),
      linkOnly('wipo', WIPO_REASON, checkedAt),
    ],
    links: trademarkSearchLinks(mark),
    note: TRADEMARK_NOTE,
  };
}
