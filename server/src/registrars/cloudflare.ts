import type { HttpFetch } from '../http/http.js';
import type { PriceRow } from '../tld/schema.js';
import type { CloudflareCreds } from './credentials.js';
import {
  type ClientDeps,
  chunk,
  type LiveClient,
  type LiveQuote,
  toPrice,
  unknownQuote,
} from './types.js';

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
export const CF_PUBLIC_PRICES = 'https://cfdomainpricing.com/prices.json';
export const CF_PUBLIC_SOURCE = 'cfdomainpricing.com/prices.json';
const BATCH = 20;

interface CheckItem {
  name?: string;
  registrable?: boolean;
  tier?: string;
  reason?: string;
  pricing?: { currency?: string; registration_cost?: string; renewal_cost?: string };
}

export function parseCloudflareCheck(json: unknown, checkedAt: string): LiveQuote[] {
  const envelope = json as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { domains?: CheckItem[] } | null;
  };
  if (envelope.success === false || !envelope.result) {
    const message = envelope.errors?.map((e) => e.message).join('; ') || 'request failed';
    throw new Error(`Cloudflare API error: ${message}`);
  }
  return (envelope.result.domains ?? []).map((item): LiveQuote => {
    const domain = (item.name ?? '').toLowerCase();
    const currency = item.pricing?.currency ?? null;
    const base = {
      registrar: 'cloudflare' as const,
      domain,
      premium: item.tier === 'premium' || item.reason === 'domain_premium',
      firstYear: toPrice(item.pricing?.registration_cost),
      renewal: toPrice(item.pricing?.renewal_cost),
      currency,
      checkedAt,
    };
    if (item.registrable === true) return { ...base, availability: 'available' };
    if (item.reason === 'domain_unavailable') {
      return { ...base, availability: 'unavailable', reason: item.reason };
    }
    // Premium names and unsupported extensions are not registrable through the API,
    // which says nothing certain about whether the name is free.
    return { ...base, availability: 'unknown', reason: item.reason ?? 'not registrable' };
  });
}

export function createCloudflareClient(creds: CloudflareCreds, deps: ClientDeps): LiveClient {
  const now = deps.now ?? (() => new Date());
  const endpoint = `${CLOUDFLARE_API}/accounts/${encodeURIComponent(creds.accountId)}/registrar/domain-check`;
  return {
    id: 'cloudflare',
    async quote(domains) {
      const out: LiveQuote[] = [];
      for (const batch of chunk(domains, BATCH)) {
        const res = await deps.http(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${creds.apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ domains: batch }),
        });
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new Error(`Cloudflare API returned HTTP ${res.status}`);
        }
        const quotes = parseCloudflareCheck(json, now().toISOString());
        for (const domain of batch) {
          out.push(
            quotes.find((q) => q.domain === domain) ??
              unknownQuote('cloudflare', domain, now().toISOString(), 'no check result'),
          );
        }
      }
      return out;
    },
  };
}

/** Rows from the free third-party price file. Prices in that file are USD. */
export function parseCloudflarePublicPrices(json: unknown): PriceRow[] {
  const entries = Object.entries(json as Record<string, unknown>);
  return entries.flatMap(([tld, raw]) => {
    const item = raw as { registration?: unknown; renewal?: unknown; updatedAt?: unknown };
    const checkedAt = typeof item.updatedAt === 'string' ? item.updatedAt.slice(0, 10) : null;
    if (!checkedAt || !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) return [];
    return [
      {
        registrar: 'cloudflare' as const,
        tld: tld.toLowerCase().replace(/^\./, ''),
        firstYear: toPrice(item.registration),
        renewal: toPrice(item.renewal),
        transfer: null,
        currency: 'USD',
        source: CF_PUBLIC_SOURCE,
        checkedAt,
      },
    ];
  });
}

/** Reads the public price file. Used by the maintainer refresh script only; no key needed. */
export async function fetchCloudflarePublicPrices(http: HttpFetch): Promise<PriceRow[]> {
  const res = await http(CF_PUBLIC_PRICES, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${CF_PUBLIC_PRICES} returned HTTP ${res.status}`);
  return parseCloudflarePublicPrices(await res.json());
}
