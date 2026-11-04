import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import type { HttpFetch } from '../../src/http/http.js';
import {
  checkHandles,
  createCheckers,
  type HandleDeps,
  MANUAL_REASONS,
} from '../../src/research/handles/check.js';
import type { Checker, Probe } from '../../src/research/handles/checkers.js';
import { PLATFORMS, type Platform } from '../../src/research/handles/platforms.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');

async function makeDeps(probe: Probe): Promise<HandleDeps & { calls: string[] }> {
  const calls: string[] = [];
  const checker =
    (platform: Platform): Checker =>
    async (handle) => {
      calls.push(`${platform}:${handle}`);
      return probe;
    };
  const checkers = Object.fromEntries(PLATFORMS.map((p) => [p, checker(p)])) as Record<
    Platform,
    Checker
  >;
  return {
    calls,
    checkers,
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-handles-'))),
    now: () => NOW,
  };
}

const taken: Probe = { status: 'taken', confidence: 'high', method: 'api', source: 'github-api' };

describe('checkHandles', () => {
  it('checks every handle × platform pair in order, with profile URLs', async () => {
    const deps = await makeDeps(taken);
    const results = await checkHandles(['Acme', 'zent'], ['github', 'npm'], deps);
    expect(results.map((r) => `${r.platform}:${r.handle}`)).toEqual([
      'github:acme',
      'npm:acme',
      'github:zent',
      'npm:zent',
    ]);
    expect(results[0]).toEqual({
      platform: 'github',
      handle: 'acme',
      status: 'taken',
      confidence: 'high',
      method: 'api',
      source: 'github-api',
      checkedAt: NOW.toISOString(),
      profileUrl: 'https://github.com/acme',
    });
  });

  it('returns invalid without calling the checker when the name breaks a platform rule', async () => {
    const deps = await makeDeps(taken);
    const [result] = await checkHandles(['ab'], ['reddit'], deps);
    expect(result).toMatchObject({ status: 'invalid', confidence: 'high', method: 'none' });
    expect(deps.calls).toEqual([]);
  });

  it('caches taken results but not unknown ones', async () => {
    const deps = await makeDeps(taken);
    await checkHandles(['acme'], ['github'], deps);
    await checkHandles(['acme'], ['github'], deps);
    expect(deps.calls).toEqual(['github:acme']);

    const unknownDeps = await makeDeps({
      status: 'unknown',
      confidence: 'low',
      method: 'api',
      source: 'github-api',
      reason: 'HTTP 403',
    });
    await checkHandles(['acme'], ['github'], unknownDeps);
    await checkHandles(['acme'], ['github'], unknownDeps);
    expect(unknownDeps.calls).toEqual(['github:acme', 'github:acme']);
  });
});

describe('createCheckers', () => {
  const noNetwork: HttpFetch = async () => {
    throw new Error('network must not be used');
  };

  it('uses manual checkers for platforms without keys or open APIs', async () => {
    const checkers = createCheckers(noNetwork, {});
    for (const platform of ['reddit', 'youtube', 'x', 'instagram', 'tiktok', 'linkedin'] as const) {
      const probe = await checkers[platform]('acme');
      expect(probe).toMatchObject({ status: 'unknown', method: 'manual' });
      expect(probe.reason).toBe(MANUAL_REASONS[platform]);
    }
  });

  it('switches Reddit and YouTube to API checkers when keys are set', async () => {
    const checkers = createCheckers(noNetwork, {
      reddit: { clientId: 'a', clientSecret: 'b' },
      youtubeApiKey: 'k',
    });
    expect(await checkers.reddit('acme')).toMatchObject({ status: 'unknown', method: 'api' });
    expect(await checkers.youtube('acme')).toMatchObject({ status: 'unknown', method: 'api' });
  });
});
