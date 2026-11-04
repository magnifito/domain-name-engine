import type { HttpFetch } from '../http/http.js';
import type { PriceRow } from '../tld/schema.js';
import type { SpaceshipCreds } from './credentials.js';
import {
  type ClientDeps,
  chunk,
  type LiveClient,
  type LiveQuote,
  toPrice,
  unknownQuote,
} from './types.js';

export const SPACESHIP_API = 'https://spaceship.dev/api';
export const SPACESHIP_TLD_SOURCE = 'Spaceship API /v1/tlds/pricing';
const BATCH = 20;
const PAGE = 25;

interface Money {
  amount?: string;
  currency?: string;
}
interface PriceEntry {
  period?: { value?: number; unit?: string };
  priceInDefaultCurrency?: { finalPrice?: Money; regularPrice?: Money };
}
interface Prices {
  register?: PriceEntry[];
  renew?: PriceEntry[];
  transfer?: PriceEntry[];
}

/** The 1-year final price of an operation, or null when the operation is missing. */
export function oneYear(
  entries: PriceEntry[] | undefined,
): { amount: number; currency: string } | null {
  const entry = entries?.find((e) => e.period?.value === 1 && e.period?.unit === 'y');
  const final = entry?.priceInDefaultCurrency?.finalPrice;
  const amount = toPrice(final?.amount);
  return amount !== null && final?.currency ? { amount, currency: final.currency } : null;
}

export interface SpaceshipAvailability {
  domain: string;
  result: string;
  premiumRegister: { price: number; currency: string } | null;
  premiumRenew: { price: number; currency: string } | null;
}

export function parseSpaceshipAvailability(json: unknown): SpaceshipAvailability[] {
  const items = (json as { domains?: unknown[] }).domains ?? [];
  return items.map((raw) => {
    const item = raw as {
      domain: string;
      result: string;
      premiumPricing?: Array<{ operation?: string; price?: unknown; currency?: string }>;
    };
    const premium = (operation: string) => {
      const p = item.premiumPricing?.find((x) => x.operation === operation);
      const price = toPrice(p?.price);
      return price !== null && p?.currency ? { price, currency: p.currency } : null;
    };
    return {
      domain: item.domain.toLowerCase(),
      result: item.result,
      premiumRegister: premium('register'),
      premiumRenew: premium('renew'),
    };
  });
}

export interface SpaceshipDomainPrice {
  domain: string;
  priceClass: string | null;
  register: { amount: number; currency: string } | null;
  renew: { amount: number; currency: string } | null;
  errorCode?: string;
}

export function parseSpaceshipDomainPrices(json: unknown): SpaceshipDomainPrice[] {
  const items = (json as { domains?: unknown[] }).domains ?? [];
  return items.map((raw) => {
    const item = raw as {
      domain: string;
      priceClass?: string;
      prices?: Prices;
      errorCode?: string;
    };
    return {
      domain: item.domain.toLowerCase(),
      priceClass: item.priceClass ?? null,
      register: oneYear(item.prices?.register),
      renew: oneYear(item.prices?.renew),
      ...(item.errorCode ? { errorCode: item.errorCode } : {}),
    };
  });
}

export function parseSpaceshipTldPrices(json: unknown, checkedAt: string): PriceRow[] {
  const items = (json as { items?: unknown[] }).items ?? [];
  return items.flatMap((raw) => {
    const item = raw as { tld: string; prices?: Prices };
    const register = oneYear(item.prices?.register);
    const renew = oneYear(item.prices?.renew);
    const transfer = oneYear(item.prices?.transfer);
    const currency = register?.currency ?? renew?.currency ?? transfer?.currency ?? null;
    if (currency === null) return [];
    const inCurrency = (p: { amount: number; currency: string } | null) =>
      p && p.currency === currency ? p.amount : null;
    return [
      {
        registrar: 'spaceship' as const,
        tld: item.tld.toLowerCase(),
        firstYear: inCurrency(register),
        renewal: inCurrency(renew),
        transfer: inCurrency(transfer),
        currency,
        source: SPACESHIP_TLD_SOURCE,
        checkedAt,
      },
    ];
  });
}

function headers(creds: SpaceshipCreds): Record<string, string> {
  return {
    'X-API-Key': creds.apiKey,
    'X-API-Secret': creds.apiSecret,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function readJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    let detail = '';
    try {
      detail = String(((await res.json()) as { detail?: unknown }).detail ?? '');
    } catch {
      // The body is not JSON; the status code is enough.
    }
    throw new Error(`Spaceship API returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

function toQuote(
  domain: string,
  checkedAt: string,
  availability: SpaceshipAvailability | undefined,
  price: SpaceshipDomainPrice | undefined,
): LiveQuote {
  if (!availability) return unknownQuote('spaceship', domain, checkedAt, 'no availability result');
  const premium = availability.premiumRegister !== null || price?.priceClass === 'premium';
  const register = availability.premiumRegister
    ? {
        amount: availability.premiumRegister.price,
        currency: availability.premiumRegister.currency,
      }
    : premium
      ? null
      : (price?.register ?? null);
  const renew = availability.premiumRenew
    ? { amount: availability.premiumRenew.price, currency: availability.premiumRenew.currency }
    : premium
      ? null
      : (price?.renew ?? null);
  const currency = register?.currency ?? renew?.currency ?? null;
  return {
    registrar: 'spaceship',
    domain,
    // Only "available" is documented. Any other value is unknown, never "unavailable".
    availability: availability.result === 'available' ? 'available' : 'unknown',
    premium,
    firstYear: register && register.currency === currency ? register.amount : null,
    renewal: renew && renew.currency === currency ? renew.amount : null,
    currency,
    checkedAt,
    ...(availability.result === 'available'
      ? {}
      : { reason: `undocumented Spaceship result: ${availability.result}` }),
  };
}

export function createSpaceshipClient(creds: SpaceshipCreds, deps: ClientDeps): LiveClient {
  const now = deps.now ?? (() => new Date());
  return {
    id: 'spaceship',
    async quote(domains) {
      const out: LiveQuote[] = [];
      for (const batch of chunk(domains, BATCH)) {
        const body = JSON.stringify({ domains: batch });
        const init = { method: 'POST', headers: headers(creds), body };
        const availability = parseSpaceshipAvailability(
          await readJson(await deps.http(`${SPACESHIP_API}/v1/domains/available`, init)),
        );
        // A pricing failure must not discard the availability answer already received.
        let prices: SpaceshipDomainPrice[] = [];
        let priceFailed = false;
        try {
          prices = parseSpaceshipDomainPrices(
            await readJson(await deps.http(`${SPACESHIP_API}/v1/domains/pricing/query`, init)),
          );
        } catch {
          priceFailed = true;
        }
        const checkedAt = now().toISOString();
        for (const domain of batch) {
          const quote = toQuote(
            domain,
            checkedAt,
            availability.find((a) => a.domain === domain),
            prices.find((p) => p.domain === domain),
          );
          out.push(
            priceFailed && !quote.reason
              ? { ...quote, reason: 'Spaceship pricing call failed; price unknown' }
              : quote,
          );
        }
      }
      return out;
    },
  };
}

/** Reads every TLD price page. Used by the maintainer refresh script only. */
export async function fetchSpaceshipTldPrices(
  creds: SpaceshipCreds,
  http: HttpFetch,
  checkedAt: string,
): Promise<PriceRow[]> {
  const rows: PriceRow[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const url = `${SPACESHIP_API}/v1/tlds/pricing?take=${PAGE}&skip=${skip}`;
    const json = (await readJson(await http(url, { headers: headers(creds) }))) as {
      items?: unknown[];
      total?: number;
    };
    rows.push(...parseSpaceshipTldPrices(json, checkedAt));
    // Without a numeric total we cannot tell a complete list from a cut-off one.
    if (typeof json.total !== 'number' || !Number.isFinite(json.total)) {
      throw new Error('Spaceship TLD pricing response has no numeric total');
    }
    const count = json.items?.length ?? 0;
    if (count === 0 || skip + count >= json.total) break;
  }
  return rows;
}
