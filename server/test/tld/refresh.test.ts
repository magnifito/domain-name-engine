import { describe, expect, it, vi } from 'vitest';
import { CF_PUBLIC_PRICES } from '../../src/registrars/cloudflare.js';
import { SPACESHIP_API } from '../../src/registrars/spaceship.js';
import {
  buildJobs,
  diffTables,
  mergeTable,
  runRefresh,
  serializeTable,
} from '../../src/tld/refresh.js';
import { type PriceRow, RegistrarTableSchema } from '../../src/tld/schema.js';
import { fakeHttp } from '../registrars/fake-http.js';
import cfPrices from '../registrars/fixtures/cfdomainpricing-prices.json' with { type: 'json' };
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

describe('saveTable', () => {
  it('writes through writeFileAtomic', async () => {
    vi.resetModules();
    const writeFileAtomic = vi.fn(async () => {});
    vi.doMock('../../src/fs/atomic.js', () => ({ writeFileAtomic }));
    const { saveTable } = await import('../../src/tld/refresh.js');
    const table = testTables().registrars;
    await saveTable('/tmp/x/registrar-tlds.json', table);
    expect(writeFileAtomic).toHaveBeenCalledWith(
      '/tmp/x/registrar-tlds.json',
      serializeTable(table),
    );
    vi.doUnmock('../../src/fs/atomic.js');
  });
});

describe('runRefresh', () => {
  const KEY = 'ss-key-1234';
  const SECRET = 'ss-secret-5678';
  const creds = { spaceship: { apiKey: KEY, apiSecret: SECRET } };
  const logger = () => {
    const lines: string[] = [];
    return { lines, log: (line: string) => lines.push(line) };
  };

  it('keeps current rows when a registrar fails and never logs the key', async () => {
    const { http } = fakeHttp([
      [CF_PUBLIC_PRICES, () => Response.json(cfPrices)],
      [
        SPACESHIP_API,
        () => Response.json({ detail: `bad credentials ${KEY} ${SECRET}` }, { status: 401 }),
      ],
    ]);
    const current = testTables().registrars;
    const { lines, log } = logger();
    const next = await runRefresh(
      current,
      buildJobs(creds, http, '2026-11-05'),
      [KEY, SECRET],
      log,
    );
    expect(next.rows.filter((r) => r.registrar === 'spaceship')).toEqual(
      current.rows.filter((r) => r.registrar === 'spaceship'),
    );
    expect(next.rows.filter((r) => r.registrar === 'cloudflare').map((r) => r.tld)).toEqual([
      'com',
      'site',
    ]);
    const out = lines.join('\n');
    expect(out).toContain('spaceship: failed, keeping current rows');
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(SECRET);
  });

  it('reports registrars without keys and keeps their rows', async () => {
    const { http } = fakeHttp([[CF_PUBLIC_PRICES, () => Response.json(cfPrices)]]);
    const { lines, log } = logger();
    await runRefresh(testTables().registrars, buildJobs({}, http, '2026-11-05'), [], log);
    expect(lines).toContain('spaceship: keys not set, keeping current rows');
    expect(lines).toContain('namecheap: keys not set, keeping current rows');
  });

  it('treats an empty result as a failure and keeps current rows', async () => {
    const current = testTables().registrars;
    const { lines, log } = logger();
    const next = await runRefresh(
      current,
      [{ registrar: 'cloudflare', run: async () => [] }],
      [],
      log,
    );
    expect(next).toEqual(mergeTable(current, []));
    expect(lines.join('\n')).toContain('no rows returned');
  });

  it('refuses to replace a full-coverage registrar with under half of its rows', async () => {
    const current = testTables().registrars; // cloudflare is full with 2 rows
    const extra = ['a', 'b', 'c', 'd'].map(
      (tld): PriceRow => ({ ...fresh, registrar: 'cloudflare', tld }),
    );
    const big = { ...current, rows: [...current.rows, ...extra] };
    const { lines, log } = logger();
    const next = await runRefresh(
      big,
      [{ registrar: 'cloudflare', run: async () => [{ ...fresh, registrar: 'cloudflare' }] }],
      [],
      log,
    );
    expect(next).toEqual(mergeTable(big, []));
    expect(lines.join('\n')).toMatch(/cloudflare: .*keeping current rows.*1 of 6/);
  });

  it('accepts a full-coverage refresh that is at least half the size', async () => {
    const current = testTables().registrars;
    const { log } = logger();
    const next = await runRefresh(
      current,
      [{ registrar: 'cloudflare', run: async () => [{ ...fresh, registrar: 'cloudflare' }] }],
      [],
      log,
    );
    expect(next.rows.filter((r) => r.registrar === 'cloudflare')).toHaveLength(1);
  });

  it('refuses to promote a partial-coverage registrar to full on a tiny result', async () => {
    const current = testTables().registrars; // spaceship is partial
    const { lines, log } = logger();
    const next = await runRefresh(
      current,
      [{ registrar: 'spaceship', run: async () => [fresh] }],
      [],
      log,
    );
    expect(next).toEqual(mergeTable(current, []));
    expect(next.registrars.spaceship.coverage).toBe('partial');
    expect(lines.join('\n')).toMatch(/spaceship: failed.*below the minimum/);
  });

  it('promotes a partial-coverage registrar once the result meets the minimum', async () => {
    const current = testTables().registrars;
    const { log } = logger();
    const next = await runRefresh(
      current,
      [{ registrar: 'spaceship', run: async () => [fresh] }],
      [],
      log,
      1,
    );
    expect(next.registrars.spaceship.coverage).toBe('full');
  });
});
