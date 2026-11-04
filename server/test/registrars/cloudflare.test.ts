import { describe, expect, it } from 'vitest';
import {
  CF_PUBLIC_PRICES,
  CLOUDFLARE_API,
  createCloudflareClient,
  fetchCloudflarePublicPrices,
} from '../../src/registrars/cloudflare.js';
import { FIXED_NOW, fakeHttp } from './fake-http.js';
import publicPrices from './fixtures/cfdomainpricing-prices.json' with { type: 'json' };
import check from './fixtures/cloudflare-check.json' with { type: 'json' };
import checkError from './fixtures/cloudflare-error.json' with { type: 'json' };

const CREDS = { apiToken: 'cf-token-efgh', accountId: 'cf-account-ijkl' };
const ENDPOINT = `${CLOUDFLARE_API}/accounts/cf-account-ijkl/registrar/domain-check`;

function client(body: unknown, status = 200) {
  const fake = fakeHttp([[ENDPOINT, () => Response.json(body, { status })]]);
  return {
    ...fake,
    client: createCloudflareClient(CREDS, { http: fake.http, now: () => FIXED_NOW }),
  };
}

describe('Cloudflare client', () => {
  it('posts the domains with a bearer token', async () => {
    const { client: c, calls } = client(check);
    await c.quote(['zentrova.site']);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer cf-token-efgh');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ domains: ['zentrova.site'] });
  });

  it('maps registrable, unavailable, premium, and unsupported results', async () => {
    const quotes = await client(check).client.quote([
      'zentrova.site',
      'google.com',
      'rare.io',
      'zentrova.lol',
    ]);
    expect(
      quotes.map((q) => [q.domain, q.availability, q.premium, q.firstYear, q.renewal]),
    ).toEqual([
      ['zentrova.site', 'available', false, 4.99, 27.7],
      ['google.com', 'unavailable', false, null, null],
      ['rare.io', 'unknown', true, 2500, 50],
      ['zentrova.lol', 'unknown', false, null, null],
    ]);
    expect(quotes[3]?.reason).toBe('extension_not_supported_via_api');
    expect(quotes[0]).toMatchObject({ currency: 'USD', checkedAt: '2026-11-04T10:00:00.000Z' });
  });

  it('throws the API error message without the token', async () => {
    const error = await client(checkError, 403)
      .client.quote(['zentrova.site'])
      .catch((e: Error) => e);
    expect(String(error)).toBe('Error: Cloudflare API error: Authentication error');
  });
});

describe('Cloudflare public price file', () => {
  it('builds USD rows with the per-TLD update date and skips undated entries', async () => {
    const { http } = fakeHttp([[CF_PUBLIC_PRICES, () => Response.json(publicPrices)]]);
    expect(await fetchCloudflarePublicPrices(http)).toEqual([
      {
        registrar: 'cloudflare',
        tld: 'com',
        firstYear: 10.46,
        renewal: 10.46,
        transfer: null,
        currency: 'USD',
        source: 'cfdomainpricing.com/prices.json',
        checkedAt: '2026-10-13',
      },
      {
        registrar: 'cloudflare',
        tld: 'site',
        firstYear: 4.99,
        renewal: 27.7,
        transfer: null,
        currency: 'USD',
        source: 'cfdomainpricing.com/prices.json',
        checkedAt: '2026-10-13',
      },
    ]);
  });
});
