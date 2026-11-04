import { describe, expect, it } from 'vitest';
import { tldInfo } from '../../src/tld/info.js';
import {
  cheapestThreeYear,
  livePriceLabel,
  TABLE_NOTE,
  tablePriceLabel,
  threeYearTotal,
} from '../../src/tld/pricing.js';
import { testTables } from './fixtures.js';

describe('pricing helpers', () => {
  it('computes a 3-year total as first year plus two renewals', () => {
    expect(threeYearTotal(4.99, 27.7)).toBe(60.39);
    expect(threeYearTotal(1.05, null)).toBeNull();
    expect(threeYearTotal(null, 10)).toBeNull();
  });

  it('labels table and live prices with origin and date', () => {
    expect(tablePriceLabel('spaceship', '2026-11-04')).toBe(
      'reference price from Spaceship, checked 2026-11-04 — verify at registrar',
    );
    expect(livePriceLabel('namecheap', '2026-11-04T10:00:00.000Z')).toBe(
      'live price from Namecheap API, 2026-11-04T10:00:00.000Z',
    );
  });

  it('picks the cheapest option per currency and never mixes currencies', () => {
    const result = cheapestThreeYear([
      { registrar: 'spaceship', currency: 'EUR', threeYearTotal: 61.05 },
      { registrar: 'cloudflare', currency: 'USD', threeYearTotal: 60.39 },
      { registrar: 'namecheap', currency: 'USD', threeYearTotal: 70 },
      { registrar: 'namecheap', currency: null, threeYearTotal: 1 },
    ]);
    expect(result).toEqual([
      { currency: 'EUR', registrar: 'spaceship', threeYearTotal: 61.05 },
      { currency: 'USD', registrar: 'cloudflare', threeYearTotal: 60.39 },
    ]);
  });
});

describe('tldInfo', () => {
  it('lists every registrar with table prices, labels, and reputation', () => {
    const info = tldInfo('site', testTables());
    expect(info.registrars.map((r) => [r.registrar, r.sale])).toEqual([
      ['spaceship', 'listed'],
      ['namecheap', 'unverified'],
      ['cloudflare', 'listed'],
    ]);
    const cloudflare = info.registrars[2];
    expect(cloudflare).toMatchObject({
      firstYear: 4.99,
      renewal: 27.7,
      threeYearTotal: 60.39,
      currency: 'USD',
      source: 'cfdomainpricing.com/prices.json',
      checkedAt: '2026-10-13',
      priceLabel: 'reference price from Cloudflare, checked 2026-10-13 — verify at registrar',
    });
    expect(info.reputation).toMatchObject({ reputation: 'mixed' });
    expect(info.notes).toContain(TABLE_NOTE);
  });

  it('shows an unverified row as unknown, with no price', () => {
    const namecheap = tldInfo('site', testTables()).registrars[1];
    expect(namecheap).toMatchObject({ firstYear: null, renewal: null, threeYearTotal: null });
    expect(namecheap?.priceLabel).toBe('unknown — price not verified, check at Namecheap');
  });

  it('returns one cheapest 3-year option per currency', () => {
    expect(tldInfo('site', testTables()).cheapestThreeYear).toEqual([
      { currency: 'EUR', registrar: 'spaceship', threeYearTotal: 61.05 },
      { currency: 'USD', registrar: 'cloudflare', threeYearTotal: 60.39 },
    ]);
  });

  it('separates "not sold" (full coverage) from "not in table" (partial coverage)', () => {
    const info = tldInfo('io', testTables());
    expect(info.registrars.map((r) => [r.registrar, r.sale, r.priceLabel])).toEqual([
      ['spaceship', 'not_in_table', 'unknown — not in the bundled table'],
      ['namecheap', 'not_in_table', 'unknown — not in the bundled table'],
      ['cloudflare', 'not_sold', 'not sold by Cloudflare'],
    ]);
    expect(info.reputation).toBeNull();
  });

  it('uses notSold for a partial-coverage registrar', () => {
    const tables = testTables();
    tables.registrars.registrars.spaceship.notSold.push('io');
    expect(tldInfo('io', tables).registrars[0]?.sale).toBe('not_sold');
  });
});
