import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import type { EuipoClient, EuipoResult } from '../../src/research/trademarks/euipo.js';
import {
  EUIPO_NO_KEY_REASON,
  searchTrademarks,
  type TrademarkDeps,
  USPTO_REASON,
  WIPO_REASON,
} from '../../src/research/trademarks/search.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');

async function makeDeps(euipo?: {
  env: 'production' | 'sandbox';
  result: EuipoResult;
}): Promise<TrademarkDeps & { searches: string[] }> {
  const searches: string[] = [];
  const client: EuipoClient | undefined = euipo && {
    env: euipo.env,
    search: async (mark, classes) => {
      searches.push(`${mark}|${classes.join(',')}`);
      return euipo.result;
    },
  };
  return {
    searches,
    euipo: client,
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-tm-'))),
    now: () => NOW,
  };
}

const match = {
  office: 'euipo' as const,
  mark: 'ACME',
  applicationNumber: '018000001',
  status: 'REGISTERED',
  niceClasses: [9],
  applicants: ['Acme Holdings GmbH'],
  url: 'https://euipo.europa.eu/eSearch/#details/trademarks/018000001',
};

describe('searchTrademarks', () => {
  it('returns unknown everywhere plus links when no EUIPO keys are set', async () => {
    const result = await searchTrademarks({ mark: ' Acme ' }, await makeDeps());
    expect(result.mark).toBe('Acme');
    expect(result.results).toEqual([
      expect.objectContaining({ office: 'euipo', status: 'unknown', reason: EUIPO_NO_KEY_REASON }),
      expect.objectContaining({ office: 'uspto', status: 'unknown', reason: USPTO_REASON }),
      expect.objectContaining({ office: 'wipo', status: 'unknown', reason: WIPO_REASON }),
    ]);
    expect(result.links).toHaveLength(4);
    expect(result.note).toContain('not a clearance');
  });

  it('reports EUIPO matches with high confidence', async () => {
    const deps = await makeDeps({
      env: 'production',
      result: { kind: 'ok', total: 1, matches: [match] },
    });
    const result = await searchTrademarks({ mark: 'acme', niceClasses: [42, 9, 9] }, deps);
    expect(result.niceClasses).toEqual([9, 42]);
    expect(result.results[0]).toEqual({
      office: 'euipo',
      status: 'matches_found',
      confidence: 'high',
      source: 'euipo-api',
      checkedAt: NOW.toISOString(),
      total: 1,
      matches: [match],
      reason: undefined,
    });
    expect(deps.searches).toEqual(['acme|9,42']);
  });

  it('reports no_matches with medium confidence', async () => {
    const deps = await makeDeps({
      env: 'production',
      result: { kind: 'ok', total: 0, matches: [] },
    });
    const [euipo] = (await searchTrademarks({ mark: 'zzqx' }, deps)).results;
    expect(euipo).toMatchObject({ status: 'no_matches', confidence: 'medium' });
  });

  it('labels sandbox results as low confidence', async () => {
    const deps = await makeDeps({
      env: 'sandbox',
      result: { kind: 'ok', total: 1, matches: [match] },
    });
    const [euipo] = (await searchTrademarks({ mark: 'acme' }, deps)).results;
    expect(euipo).toMatchObject({ confidence: 'low', source: 'euipo-api-sandbox' });
  });

  it('turns an EUIPO failure into unknown and does not cache it', async () => {
    const deps = await makeDeps({
      env: 'production',
      result: { kind: 'error', reason: 'EUIPO search returned HTTP 503' },
    });
    const first = await searchTrademarks({ mark: 'acme' }, deps);
    expect(first.results[0]).toMatchObject({
      status: 'unknown',
      reason: 'EUIPO search returned HTTP 503',
    });
    await searchTrademarks({ mark: 'acme' }, deps);
    expect(deps.searches).toHaveLength(2);
  });

  it('caches a successful EUIPO answer per mark and classes', async () => {
    const deps = await makeDeps({
      env: 'production',
      result: { kind: 'ok', total: 0, matches: [] },
    });
    await searchTrademarks({ mark: 'Acme' }, deps);
    await searchTrademarks({ mark: 'acme' }, deps);
    await searchTrademarks({ mark: 'acme', niceClasses: [9] }, deps);
    expect(deps.searches).toEqual(['Acme|', 'acme|9']);
  });
});
