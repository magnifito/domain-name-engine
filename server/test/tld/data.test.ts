import { describe, expect, it } from 'vitest';
import registrarData from '../../data/registrar-tlds.json' with { type: 'json' };
import reputationData from '../../data/tld-reputation.json' with { type: 'json' };
import {
  PriceRowSchema,
  RegistrarTableSchema,
  ReputationRowSchema,
  ReputationTableSchema,
  UNVERIFIED,
} from '../../src/tld/schema.js';
import { bundledTables } from '../../src/tld/table.js';

const LOW_COST = ['sbs', 'site', 'online', 'store', 'space', 'lol', 'bond', 'xyz'];

describe('bundled registrar-tlds.json', () => {
  it('validates as a whole', () => {
    expect(() => RegistrarTableSchema.parse(registrarData)).not.toThrow();
  });

  it.each(registrarData.rows.map((row) => [`${row.registrar} .${row.tld}`, row]))(
    'row %s validates',
    (_label, row) => {
      expect(() => PriceRowSchema.parse(row)).not.toThrow();
    },
  );

  it('gives every row a source and a check date', () => {
    for (const row of bundledTables().registrars.rows) {
      expect(row.source.length).toBeGreaterThan(0);
      expect(row.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never stores a price on an unverified row', () => {
    for (const row of bundledTables().registrars.rows.filter((r) => r.source === UNVERIFIED)) {
      expect([row.firstYear, row.renewal, row.transfer]).toEqual([null, null, null]);
    }
  });

  it('has a row or a not-sold entry for every low-cost TLD at every registrar', () => {
    const { rows, registrars } = bundledTables().registrars;
    for (const registrar of ['spaceship', 'namecheap', 'cloudflare'] as const) {
      for (const tld of LOW_COST) {
        const listed = rows.some((r) => r.registrar === registrar && r.tld === tld);
        // With full coverage a missing row already means "not sold".
        const meta = registrars[registrar];
        const notSold = meta.coverage === 'full' || meta.notSold.includes(tld);
        expect(listed || notSold, `${registrar} .${tld}`).toBe(true);
      }
    }
  });
});

describe('bundled tld-reputation.json', () => {
  it('validates as a whole', () => {
    expect(() => ReputationTableSchema.parse(reputationData)).not.toThrow();
  });

  it.each(reputationData.rows.map((row) => [row.tld, row]))('row %s validates', (_tld, row) => {
    expect(() => ReputationRowSchema.parse(row)).not.toThrow();
  });

  it('covers every low-cost TLD', () => {
    const tlds = bundledTables().reputation.rows.map((r) => r.tld);
    for (const tld of LOW_COST) expect(tlds).toContain(tld);
  });
});

describe('schemas', () => {
  const base = {
    registrar: 'spaceship',
    tld: 'site',
    firstYear: null,
    renewal: null,
    transfer: null,
    currency: null,
    source: UNVERIFIED,
    checkedAt: '2026-11-04',
  };

  it('rejects a price on an unverified row', () => {
    expect(() => PriceRowSchema.parse({ ...base, firstYear: 1, currency: 'EUR' })).toThrow(
      'unverified row has a price',
    );
  });

  it('rejects a price without a currency', () => {
    expect(() => PriceRowSchema.parse({ ...base, source: 'x', firstYear: 1 })).toThrow(
      'price without currency',
    );
  });

  it('rejects an unknown registrar and a leading dot', () => {
    expect(() => PriceRowSchema.parse({ ...base, registrar: 'godaddy' })).toThrow();
    expect(() => PriceRowSchema.parse({ ...base, tld: '.site' })).toThrow();
  });

  it('rejects duplicate registrar × TLD rows', () => {
    const meta = { coverage: 'partial', notSold: [], note: 'n' };
    expect(() =>
      RegistrarTableSchema.parse({
        schemaVersion: 1,
        registrars: { spaceship: meta, namecheap: meta, cloudflare: meta },
        rows: [base, base],
      }),
    ).toThrow('duplicate row spaceship:site');
  });
});
