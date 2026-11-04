import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache/cache.js';
import { type CheckDeps, checkDomain, checkDomains } from '../src/domain/check.js';
import type { RdapResult } from '../src/sources/rdap.js';
import type { WhoisResult } from '../src/sources/whois.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');

async function makeDeps(opts: {
  rdap: RdapResult;
  whois?: WhoisResult;
  dns?: boolean | null;
}): Promise<CheckDeps & { counts: { rdap: number } }> {
  const counts = { rdap: 0 };
  return {
    counts,
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-check-'))),
    now: () => NOW,
    rdap: async () => {
      counts.rdap++;
      return opts.rdap;
    },
    whois: async () => opts.whois ?? { kind: 'no_server' },
    dns: async () => opts.dns ?? null,
  };
}

const whoisOf = (kind: 'registered' | 'not_found' | 'unknown'): WhoisResult => ({
  kind,
  server: 'whois.nic.test',
  raw: '',
});

describe('checkDomain', () => {
  it.each([
    [{ rdap: { kind: 'registered', record: {} } }, 'registered', 'rdap', 'high'],
    [{ rdap: { kind: 'not_found' }, dns: false }, 'likely_available', 'rdap', 'high'],
    [{ rdap: { kind: 'not_found' }, dns: null }, 'likely_available', 'rdap', 'medium'],
    [{ rdap: { kind: 'not_found' }, dns: true }, 'unknown', 'rdap', 'low'],
    [{ rdap: { kind: 'no_server' }, whois: whoisOf('registered') }, 'registered', 'whois', 'high'],
    [
      { rdap: { kind: 'error', reason: 'x' }, whois: whoisOf('not_found'), dns: false },
      'likely_available',
      'whois',
      'medium',
    ],
    [
      { rdap: { kind: 'no_server' }, whois: whoisOf('not_found'), dns: true },
      'unknown',
      'whois',
      'low',
    ],
    [
      { rdap: { kind: 'no_server' }, whois: whoisOf('unknown'), dns: true },
      'registered',
      'dns',
      'medium',
    ],
    [
      { rdap: { kind: 'no_server' }, whois: { kind: 'no_server' }, dns: false },
      'unknown',
      'none',
      'low',
    ],
  ] as const)('maps %j to %s/%s/%s', async (input, status, source, confidence) => {
    const deps = await makeDeps(input as Parameters<typeof makeDeps>[0]);
    const result = await checkDomain('acme.test', deps);
    expect(result).toMatchObject({
      domain: 'acme.test',
      status,
      source,
      confidence,
      checkedAt: NOW.toISOString(),
    });
  });

  it('explains why a result is unknown', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'error', reason: 'RDAP HTTP 400' },
      whois: { kind: 'error', reason: 'timed out' },
      dns: false,
    });
    const result = await checkDomain('acme.test', deps);
    expect(result.reason).toBe('RDAP: RDAP HTTP 400; WHOIS: timed out');
  });

  it('serves registered results from cache', async () => {
    const deps = await makeDeps({ rdap: { kind: 'registered', record: {} } });
    await checkDomain('acme.test', deps);
    await checkDomain('acme.test', deps);
    expect(deps.counts.rdap).toBe(1);
  });

  it('does not cache unknown results', async () => {
    const deps = await makeDeps({ rdap: { kind: 'no_server' }, dns: false });
    await checkDomain('acme.test', deps);
    await checkDomain('acme.test', deps);
    expect(deps.counts.rdap).toBe(2);
  });
});

describe('checkDomains', () => {
  it('keeps input order', async () => {
    const deps = await makeDeps({ rdap: { kind: 'not_found' }, dns: false });
    const results = await checkDomains(['a.test', 'b.test', 'c.test'], deps, 2);
    expect(results.map((r) => r.domain)).toEqual(['a.test', 'b.test', 'c.test']);
  });
});
