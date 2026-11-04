import { describe, expect, it } from 'vitest';
import { diffTables, mergeTable, serializeTable } from '../../src/tld/refresh.js';
import { type PriceRow, RegistrarTableSchema } from '../../src/tld/schema.js';
import { testTables } from './fixtures.js';

const fresh: PriceRow = {
  registrar: 'spaceship',
  tld: 'site',
  firstYear: 1.05,
  renewal: 11.11,
  transfer: 10.1,
  currency: 'EUR',
  source: 'Spaceship API /v1/tlds/pricing',
  checkedAt: '2026-11-05',
};

describe('mergeTable', () => {
  it('replaces the fetched registrar rows and marks it full coverage', () => {
    const current = testTables().registrars;
    const next = mergeTable(current, [{ registrar: 'spaceship', rows: [fresh] }]);
    expect(next.rows.filter((r) => r.registrar === 'spaceship')).toEqual([fresh]);
    expect(next.registrars.spaceship.coverage).toBe('full');
    expect(next.registrars.namecheap).toEqual(current.registrars.namecheap);
    expect(next.rows.filter((r) => r.registrar === 'cloudflare')).toHaveLength(2);
    expect(() => RegistrarTableSchema.parse(next)).not.toThrow();
  });

  it('keeps everything when nothing was fetched', () => {
    const current = testTables().registrars;
    expect(mergeTable(current, []).rows).toHaveLength(current.rows.length);
  });
});

describe('diffTables', () => {
  it('lists changed, added, and removed rows', () => {
    const current = testTables().registrars;
    const next = mergeTable(current, [
      { registrar: 'spaceship', rows: [fresh, { ...fresh, tld: 'xyz', firstYear: 1.83 }] },
      { registrar: 'cloudflare', rows: [] },
    ]);
    expect(diffTables(current, next)).toEqual([
      '+ spaceship .xyz: first 1.83, renew 11.11, transfer 10.1 EUR',
      '- cloudflare .com: first 10.46, renew 10.46, transfer unknown USD',
      '- cloudflare .site: first 4.99, renew 27.7, transfer unknown USD',
      '~ spaceship .site: first 1.05, renew 30, transfer unknown EUR -> first 1.05, renew 11.11, transfer 10.1 EUR',
    ]);
  });
});

describe('serializeTable', () => {
  it('writes pretty JSON with a trailing newline that parses back', () => {
    const text = serializeTable(testTables().registrars);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(testTables().registrars);
  });
});
