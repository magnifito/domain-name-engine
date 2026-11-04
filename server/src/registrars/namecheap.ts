import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import type { HttpFetch } from '../http/http.js';
import type { PriceRow } from '../tld/schema.js';
import type { NamecheapCreds } from './credentials.js';
import {
  type ClientDeps,
  chunk,
  type LiveClient,
  type LiveQuote,
  toPrice,
  unknownQuote,
} from './types.js';

export const NAMECHEAP_API = 'https://api.namecheap.com/xml.response';
export const NAMECHEAP_TLD_SOURCE = 'Namecheap API namecheap.users.getPricing';
const BATCH = 50;

/** Attributes of every <tag ...> element. The Namecheap API puts its data in attributes. */
export function xmlElements(xml: string, tag: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const re = new RegExp(`<${tag}\\s([^>]*?)\\/?>`, 'g');
  for (const match of xml.matchAll(re)) {
    const attrs: Record<string, string> = {};
    for (const a of (match[1] ?? '').matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) {
      attrs[a[1] ?? ''] = a[2] ?? '';
    }
    out.push(attrs);
  }
  return out;
}

/** Error messages when the response status is ERROR, else an empty list. */
export function namecheapErrors(xml: string): string[] {
  if (!/<ApiResponse[^>]*Status="ERROR"/i.test(xml)) return [];
  const errors = [...xml.matchAll(/<Error\b([^>]*)>([\s\S]*?)<\/Error>/g)].map((m) => {
    const number = /Number="(\d+)"/.exec(m[1] ?? '')?.[1];
    return `${number ? `${number}: ` : ''}${(m[2] ?? '').trim()}`;
  });
  return errors.length > 0 ? errors : ['unknown error'];
}

export interface NamecheapCheck {
  domain: string;
  available: boolean;
  premium: boolean;
  premiumRegistration: number | null;
  premiumRenewal: number | null;
  error: string | null;
}

export function parseNamecheapCheck(xml: string): NamecheapCheck[] {
  return xmlElements(xml, 'DomainCheckResult').map((a) => {
    const premium = a.IsPremiumName?.toLowerCase() === 'true';
    return {
      domain: (a.Domain ?? '').toLowerCase(),
      available: a.Available?.toLowerCase() === 'true',
      premium,
      premiumRegistration: premium ? toPrice(a.PremiumRegistrationPrice) : null,
      premiumRenewal: premium ? toPrice(a.PremiumRenewalPrice) : null,
      error: a.ErrorNo && a.ErrorNo !== '0' ? a.Description || `error ${a.ErrorNo}` : null,
    };
  });
}

export interface NamecheapPrice {
  category: string;
  product: string;
  price: number;
  currency: string;
}

/** 1-year prices from a getPricing response, one entry per category × product. */
export function parseNamecheapPricing(xml: string): NamecheapPrice[] {
  const out: NamecheapPrice[] = [];
  const categories = xml.matchAll(
    /<ProductCategory\s+Name="([^"]*)"\s*>([\s\S]*?)<\/ProductCategory>/g,
  );
  for (const [, category = '', categoryBody = ''] of categories) {
    const products = categoryBody.matchAll(/<Product\s+Name="([^"]*)"\s*>([\s\S]*?)<\/Product>/g);
    for (const [, product = '', productBody = ''] of products) {
      const year = xmlElements(productBody, 'Price').find(
        (p) => p.Duration === '1' && p.DurationType?.toUpperCase() === 'YEAR',
      );
      const price = toPrice(year?.Price);
      if (price !== null && year?.Currency) {
        out.push({
          category: category.toLowerCase(),
          product: product.toLowerCase(),
          price,
          currency: year.Currency,
        });
      }
    }
  }
  return out;
}

export function namecheapTldRows(
  prices: NamecheapPrice[],
  soldTlds: Set<string> | null,
  checkedAt: string,
): PriceRow[] {
  const byTld = new Map<string, NamecheapPrice[]>();
  for (const p of prices) {
    if (soldTlds && !soldTlds.has(p.product)) continue;
    byTld.set(p.product, [...(byTld.get(p.product) ?? []), p]);
  }
  return [...byTld].flatMap(([tld, list]) => {
    const pick = (category: string) => list.find((p) => p.category === category) ?? null;
    const register = pick('register');
    const currency = register?.currency ?? list[0]?.currency;
    if (!currency) return [];
    const amount = (p: NamecheapPrice | null) => (p && p.currency === currency ? p.price : null);
    return [
      {
        registrar: 'namecheap' as const,
        tld,
        firstYear: amount(register),
        renewal: amount(pick('renew')),
        transfer: amount(pick('transfer')),
        currency,
        source: NAMECHEAP_TLD_SOURCE,
        checkedAt,
      },
    ];
  });
}

function url(creds: NamecheapCreds, command: string, params: Record<string, string>): string {
  // Namecheap takes credentials as query parameters. This URL must never be logged or returned.
  const query = new URLSearchParams({
    ApiUser: creds.apiUser,
    ApiKey: creds.apiKey,
    UserName: creds.apiUser,
    ClientIp: creds.clientIp,
    Command: command,
    ...params,
  });
  return `${NAMECHEAP_API}?${query}`;
}

async function call(
  http: HttpFetch,
  creds: NamecheapCreds,
  command: string,
  params: Record<string, string>,
): Promise<string> {
  const res = await http(url(creds, command, params));
  if (!res.ok) throw new Error(`Namecheap API returned HTTP ${res.status}`);
  const xml = await res.text();
  const errors = namecheapErrors(xml);
  if (errors.length > 0) throw new Error(`Namecheap API error: ${errors.join('; ')}`);
  return xml;
}

export interface NamecheapDeps extends ClientDeps {
  cache: DiskCache;
}

export function createNamecheapClient(creds: NamecheapCreds, deps: NamecheapDeps): LiveClient {
  const now = deps.now ?? (() => new Date());

  async function tldPrice(
    tld: string,
    action: 'REGISTER' | 'RENEW',
  ): Promise<NamecheapPrice | null> {
    const key = `namecheap-price:${action}:${tld}`;
    const cached = await deps.cache.get<NamecheapPrice | null>(key);
    if (cached !== undefined) return cached;
    const xml = await call(deps.http, creds, 'namecheap.users.getPricing', {
      ProductType: 'DOMAIN',
      ProductCategory: 'DOMAINS',
      ActionName: action,
      ProductName: tld.toUpperCase(),
    });
    const price = parseNamecheapPricing(xml).find((p) => p.product === tld) ?? null;
    await deps.cache.set(key, price, TTL.registrarLive).catch(() => undefined);
    return price;
  }

  return {
    id: 'namecheap',
    async quote(domains) {
      const out: LiveQuote[] = [];
      for (const batch of chunk(domains, BATCH)) {
        const xml = await call(deps.http, creds, 'namecheap.domains.check', {
          DomainList: batch.join(','),
        });
        const checks = parseNamecheapCheck(xml);
        const checkedAt = now().toISOString();
        for (const domain of batch) {
          const check = checks.find((c) => c.domain === domain);
          if (!check) {
            out.push(unknownQuote('namecheap', domain, checkedAt, 'no check result'));
            continue;
          }
          if (check.error) {
            out.push(unknownQuote('namecheap', domain, checkedAt, check.error));
            continue;
          }
          const tld = domain.slice(domain.indexOf('.') + 1);
          const register = await tldPrice(tld, 'REGISTER');
          const renew = check.premium ? null : await tldPrice(tld, 'RENEW');
          // Premium prices carry no currency attribute; they use the account currency,
          // which the TLD price response reports.
          const currency = register?.currency ?? renew?.currency ?? null;
          out.push({
            registrar: 'namecheap',
            domain,
            availability: check.available ? 'available' : 'unavailable',
            premium: check.premium,
            firstYear: check.premium ? check.premiumRegistration : (register?.price ?? null),
            renewal: check.premium ? check.premiumRenewal : (renew?.price ?? null),
            currency,
            checkedAt,
          });
        }
      }
      return out;
    },
  };
}

/** Reads the TLD list and all domain prices. Used by the maintainer refresh script only. */
export async function fetchNamecheapTldPrices(
  creds: NamecheapCreds,
  http: HttpFetch,
  checkedAt: string,
): Promise<PriceRow[]> {
  const list = await call(http, creds, 'namecheap.domains.gettldlist', {});
  const sold = new Set(xmlElements(list, 'Tld').map((t) => (t.Name ?? '').toLowerCase()));
  const pricing = await call(http, creds, 'namecheap.users.getPricing', { ProductType: 'DOMAIN' });
  return namecheapTldRows(parseNamecheapPricing(pricing), sold.size > 0 ? sold : null, checkedAt);
}
