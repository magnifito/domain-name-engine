import type { HttpFetch } from '../http/http.js';
import type { RegistrarId } from '../tld/schema.js';

/** What a registrar API said about one exact domain. */
export type LiveAvailability = 'available' | 'unavailable' | 'unknown';

export interface LiveQuote {
  registrar: RegistrarId;
  domain: string;
  availability: LiveAvailability;
  premium: boolean | null;
  firstYear: number | null;
  renewal: number | null;
  currency: string | null;
  checkedAt: string;
  reason?: string;
}

export interface LiveClient {
  id: RegistrarId;
  /** Quotes exact, normalized domains. May throw on transport or auth failure. */
  quote(domains: string[]): Promise<LiveQuote[]>;
}

export interface ClientDeps {
  http: HttpFetch;
  now?: () => Date;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Parses a price that may arrive as a string or number; anything else is null. */
export function toPrice(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

export function unknownQuote(
  registrar: RegistrarId,
  domain: string,
  checkedAt: string,
  reason: string,
): LiveQuote {
  return {
    registrar,
    domain,
    availability: 'unknown',
    premium: null,
    firstYear: null,
    renewal: null,
    currency: null,
    checkedAt,
    reason,
  };
}
