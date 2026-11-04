import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { ValidationError } from '../../src/domain/name.js';
import { LIVE_NOTE, NO_KEYS_NOTE, quoteDomains } from '../../src/registrars/quote.js';
import type { LiveClient, LiveQuote } from '../../src/registrars/types.js';
import { TABLE_NOTE } from '../../src/tld/pricing.js';
import { testTables } from '../tld/fixtures.js';
import { FIXED_NOW } from './fake-http.js';

async function cache() {
  return new DiskCache(await mkdtemp(join(tmpdir(), 'dne-quote-')));
}

function liveClient(id: LiveClient['id'], make: (domain: string) => Partial<LiveQuote>) {
  const seen: string[][] = [];
  const client: LiveClient = {
    id,
    quote: async (domains) => {
      seen.push(domains);
      return domains.map((domain) => ({
        registrar: id,
        domain,
        availability: 'available',
        premium: false,
        firstYear: null,
        renewal: null,
        currency: null,
        checkedAt: FIXED_NOW.toISOString(),
        ...make(domain),
      }));
    },
  };
  return { client, seen };
}

describe('quoteDomains without keys', () => {
  it('returns table prices for every registrar, with labels and notes', async () => {
    const result = await quoteDomains(['Zentrova.SITE'], {
      tables: testTables(),
      clients: [],
      cache: await cache(),
      secrets: [],
    });
    expect(result.mode).toBe('table');
    expect(result.notes).toEqual([TABLE_NOTE, NO_KEYS_NOTE]);
    const [quote] = result.quotes;
    expect(quote?.domain).toBe('zentrova.site');
    expect(quote?.registrars.map((r) => [r.registrar, r.priceSource, r.availability])).toEqual([
      ['spaceship', 'table', null],
      ['namecheap', 'none', null],
      ['cloudflare', 'table', null],
    ]);
    expect(quote?.registrars[2]?.priceLabel).toBe(
      'reference price from Cloudflare, checked 2026-10-13 — verify at registrar',
    );
    expect(quote?.cheapestThreeYear).toEqual([
      { currency: 'EUR', registrar: 'spaceship', threeYearTotal: 61.05 },
      { currency: 'USD', registrar: 'cloudflare', threeYearTotal: 60.39 },
    ]);
    expect(quote?.reputation?.reputation).toBe('mixed');
  });

  it('rejects an invalid domain', async () => {
    const deps = { tables: testTables(), clients: [], cache: await cache(), secrets: [] };
    await expect(quoteDomains(['nodot'], deps)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('quoteDomains with live clients', () => {
  it('lets a live price override the table price for that registrar', async () => {
    const { client } = liveClient('cloudflare', () => ({
      firstYear: 5.49,
      renewal: 28.2,
      currency: 'USD',
    }));
    const result = await quoteDomains(['zentrova.site'], {
      tables: testTables(),
      clients: [client],
      cache: await cache(),
      secrets: [],
    });
    expect(result.mode).toBe('live');
    expect(result.notes).toEqual([TABLE_NOTE, LIVE_NOTE]);
    expect(result.quotes[0]?.registrars[2]).toMatchObject({
      priceSource: 'live',
      availability: 'available',
      premium: false,
      firstYear: 5.49,
      renewal: 28.2,
      threeYearTotal: 61.89,
      currency: 'USD',
      priceLabel: 'live price from Cloudflare API, 2026-11-04T10:00:00.000Z',
    });
    expect(result.quotes[0]?.registrars[0]?.priceSource).toBe('table');
  });

  it('sets sale to listed when a live registrar price exists, even if the table says not_sold (M5)', async () => {
    const tables = testTables();
    tables.registrars.registrars.spaceship.notSold = ['zzz'];
    const { client } = liveClient('spaceship', () => ({
      firstYear: 3,
      renewal: 12,
      currency: 'EUR',
    }));
    const result = await quoteDomains(['zentrova.zzz'], {
      tables,
      clients: [client],
      cache: await cache(),
      secrets: [],
      now: () => FIXED_NOW,
    });
    expect(result.quotes[0]?.registrars[0]).toMatchObject({ priceSource: 'live', sale: 'listed' });
  });

  it('drops the table price for a premium name without a live price', async () => {
    const { client } = liveClient('spaceship', () => ({ premium: true }));
    const result = await quoteDomains(['zentrova.site'], {
      tables: testTables(),
      clients: [client],
      cache: await cache(),
      secrets: [],
    });
    expect(result.quotes[0]?.registrars[0]).toMatchObject({
      priceSource: 'none',
      premium: true,
      firstYear: null,
      priceLabel: 'unknown — premium name, table price does not apply',
    });
  });

  it('caches known live results for an hour and skips unknown ones', async () => {
    const shared = await cache();
    const { client, seen } = liveClient('cloudflare', (domain) =>
      domain.startsWith('x') ? { availability: 'unknown' } : {},
    );
    const deps = { tables: testTables(), clients: [client], cache: shared, secrets: [] };
    await quoteDomains(['zentrova.site', 'xeno.site'], deps);
    await quoteDomains(['zentrova.site', 'xeno.site'], deps);
    expect(seen).toEqual([['zentrova.site', 'xeno.site'], ['xeno.site']]);
  });

  it('turns a client failure into unknown results with the keys redacted', async () => {
    const client: LiveClient = {
      id: 'namecheap',
      quote: async () => {
        throw new Error('request to https://api.test/?ApiKey=nc-key-abcd failed');
      },
    };
    const result = await quoteDomains(['zentrova.site'], {
      tables: testTables(),
      clients: [client],
      cache: await cache(),
      secrets: ['nc-key-abcd'],
      now: () => FIXED_NOW,
    });
    const entry = result.quotes[0]?.registrars[1];
    expect(entry).toMatchObject({ availability: 'unknown' });
    expect(entry?.reason).toBe('request to https://api.test/?ApiKey=[redacted] failed');
    expect(JSON.stringify(result)).not.toContain('nc-key-abcd');
  });
});
