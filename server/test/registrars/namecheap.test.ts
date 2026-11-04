import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import {
  createNamecheapClient,
  fetchNamecheapTldPrices,
  NAMECHEAP_API,
  namecheapErrors,
  parseNamecheapCheck,
} from '../../src/registrars/namecheap.js';
import { FIXED_NOW, fakeHttp } from './fake-http.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const CREDS = { apiUser: 'ncuser', apiKey: 'nc-key-abcd', clientIp: '203.0.113.7' };

function xml(name: string) {
  return () => new Response(fixture(name), { headers: { 'content-type': 'text/xml' } });
}

async function setup(routes: Array<[string, () => Response | Error]>) {
  const fake = fakeHttp(routes);
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-nc-')));
  const client = createNamecheapClient(CREDS, { http: fake.http, cache, now: () => FIXED_NOW });
  return { ...fake, client };
}

const CHECK = `${NAMECHEAP_API}?ApiUser=ncuser&ApiKey=nc-key-abcd&UserName=ncuser&ClientIp=203.0.113.7&Command=namecheap.domains.check`;
const PRICING = `${NAMECHEAP_API}?ApiUser=ncuser&ApiKey=nc-key-abcd&UserName=ncuser&ClientIp=203.0.113.7&Command=namecheap.users.getPricing&ProductType=DOMAIN&ProductCategory=DOMAINS`;

const ROUTES: Array<[string, () => Response | Error]> = [
  [CHECK, xml('namecheap-check.xml')],
  [`${PRICING}&ActionName=REGISTER`, xml('namecheap-pricing-site-register.xml')],
  [`${PRICING}&ActionName=RENEW`, xml('namecheap-pricing-site-renew.xml')],
];

describe('Namecheap parsing', () => {
  it('reads availability, premium flags, and per-domain errors', () => {
    const checks = parseNamecheapCheck(fixture('namecheap-check.xml'));
    expect(checks.map((c) => [c.domain, c.available, c.premium, c.error])).toEqual([
      ['zentrova.site', true, false, null],
      ['google.com', false, false, null],
      ['us.xyz', true, true, null],
      ['broken.site', false, false, 'Error response from provider'],
    ]);
    expect(checks[2]).toMatchObject({ premiumRegistration: 13000, premiumRenewal: 13000 });
  });

  it('reads API errors from an ERROR response', () => {
    expect(namecheapErrors(fixture('namecheap-error.xml'))).toEqual([
      '1011150: Parameter RequestIP is invalid',
    ]);
    expect(namecheapErrors(fixture('namecheap-check.xml'))).toEqual([]);
  });
});

describe('Namecheap client', () => {
  it('quotes a standard domain with 1-year register and renew prices', async () => {
    const { client } = await setup(ROUTES);
    const [quote] = await client.quote(['zentrova.site']);
    expect(quote).toEqual({
      registrar: 'namecheap',
      domain: 'zentrova.site',
      availability: 'available',
      premium: false,
      firstYear: 1.11,
      renewal: 22.22,
      currency: 'USD',
      checkedAt: '2026-11-04T10:00:00.000Z',
    });
  });

  it('uses premium prices for a premium name', async () => {
    const { client } = await setup(ROUTES);
    const quotes = await client.quote(['us.xyz']);
    // The fixture has no .xyz price, so the account currency is unknown and stays null.
    expect(quotes[0]).toMatchObject({
      premium: true,
      firstYear: 13000,
      renewal: 13000,
      currency: null,
    });
  });

  it('marks a taken domain unavailable and a per-domain error unknown', async () => {
    const { client } = await setup(ROUTES);
    const quotes = await client.quote(['google.com', 'broken.site']);
    expect(quotes.map((q) => [q.domain, q.availability])).toEqual([
      ['google.com', 'unavailable'],
      ['broken.site', 'unknown'],
    ]);
  });

  it('caches TLD prices so a second quote does not refetch them', async () => {
    const { client, calls } = await setup(ROUTES);
    await client.quote(['zentrova.site']);
    await client.quote(['zentrova.site']);
    expect(calls.filter((c) => c.url.includes('getPricing'))).toHaveLength(2);
  });

  it('prices 20 domains with at most 2 pricing calls and no per-TLD ProductName (I3)', async () => {
    const domains = Array.from({ length: 20 }, (_, i) => `name${i}.tld${i}`);
    const checkXml = `<?xml version="1.0"?><ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK"><Errors /><CommandResponse Type="namecheap.domains.check">${domains
      .map(
        (d) =>
          `<DomainCheckResult Domain="${d}" Available="true" ErrorNo="0" Description="" IsPremiumName="false" PremiumRegistrationPrice="0" PremiumRenewalPrice="0" />`,
      )
      .join('')}</CommandResponse></ApiResponse>`;
    const { client, calls } = await setup([
      [CHECK, () => new Response(checkXml)],
      [`${PRICING}&ActionName=REGISTER`, xml('namecheap-pricing-site-register.xml')],
      [`${PRICING}&ActionName=RENEW`, xml('namecheap-pricing-site-renew.xml')],
    ]);
    await client.quote(domains);
    const pricing = calls.filter((c) => c.url.includes('getPricing'));
    expect(pricing.length).toBeLessThanOrEqual(2);
    for (const c of pricing) expect(c.url).not.toContain('ProductName');
  });

  it('throws on an API error without the key in the message', async () => {
    const { client } = await setup([[NAMECHEAP_API, xml('namecheap-error.xml')]]);
    const error = await client.quote(['zentrova.site']).catch((e: Error) => e);
    expect(String(error)).toBe(
      'Error: Namecheap API error: 1011150: Parameter RequestIP is invalid',
    );
  });
});

describe('Namecheap TLD prices', () => {
  it('builds one row per sold TLD from getTldList and getPricing', async () => {
    const { http } = fakeHttp([
      [
        `${NAMECHEAP_API}?ApiUser=ncuser&ApiKey=nc-key-abcd&UserName=ncuser&ClientIp=203.0.113.7&Command=namecheap.domains.gettldlist`,
        xml('namecheap-tldlist.xml'),
      ],
      [
        `${NAMECHEAP_API}?ApiUser=ncuser&ApiKey=nc-key-abcd&UserName=ncuser&ClientIp=203.0.113.7&Command=namecheap.users.getPricing`,
        xml('namecheap-pricing-all.xml'),
      ],
    ]);
    expect(await fetchNamecheapTldPrices(CREDS, http, '2026-11-04')).toEqual([
      {
        registrar: 'namecheap',
        tld: 'site',
        firstYear: 1.11,
        renewal: 22.22,
        transfer: 20.2,
        currency: 'USD',
        source: 'Namecheap API namecheap.users.getPricing',
        checkedAt: '2026-11-04',
      },
    ]);
  });
});
