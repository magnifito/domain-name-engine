import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { ValidationError } from '../../src/domain/name.js';
import type { HomepageResult } from '../../src/research/profile/homepage.js';
import { type ProfileDeps, profileDomain } from '../../src/research/profile/profile.js';
import type { RdapDomain, RdapResult } from '../../src/sources/rdap.js';
import type { WhoisResult } from '../../src/sources/whois.js';
import googleRecord from '../fixtures/rdap-domain-google.json' with { type: 'json' };
import parkedRecord from './fixtures/rdap-domain-parked.json' with { type: 'json' };

const NOW = new Date('2026-11-04T10:00:00.000Z');

const okPage = (
  overrides: Partial<Extract<HomepageResult, { kind: 'ok' }>> = {},
): HomepageResult => ({
  kind: 'ok',
  url: 'https://acme.com/',
  finalUrl: 'https://acme.com/',
  httpStatus: 200,
  title: 'Acme',
  forSale: false,
  parkedPage: false,
  ...overrides,
});

async function makeDeps(parts: {
  rdap?: RdapResult;
  whois?: WhoisResult;
  ns?: string[] | null;
  homepage?: HomepageResult;
}): Promise<ProfileDeps & { calls: string[] }> {
  const calls: string[] = [];
  return {
    calls,
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-profile-'))),
    now: () => NOW,
    rdap: async () => {
      calls.push('rdap');
      return parts.rdap ?? { kind: 'registered', record: googleRecord as RdapDomain };
    },
    whois: async () => {
      calls.push('whois');
      return parts.whois ?? { kind: 'error', reason: 'not used' };
    },
    nameservers: async () => {
      calls.push('dns');
      return parts.ns ?? null;
    },
    homepage: async () => {
      calls.push('http');
      return parts.homepage ?? okPage();
    },
  };
}

describe('profileDomain', () => {
  it('reports a live site with RDAP registration fields', async () => {
    const deps = await makeDeps({});
    const profile = await profileDomain('Google.com', deps);
    expect(profile).toMatchObject({
      domain: 'google.com',
      status: 'live_site',
      confidence: 'medium',
      source: 'rdap+http',
      checkedAt: NOW.toISOString(),
      registration: {
        status: 'registered',
        source: 'rdap',
        createdAt: '1997-09-15T04:00:00Z',
        nameservers: ['ns1.google.com', 'ns2.google.com'],
      },
    });
    expect(deps.calls).toEqual(['rdap', 'http']);
  });

  it('marks parking nameservers as parked with high confidence', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'registered', record: parkedRecord as RdapDomain },
    });
    const profile = await profileDomain('parkedexample.com', deps);
    expect(profile).toMatchObject({
      status: 'parked',
      confidence: 'high',
      parkingProvider: 'sedoparking.com',
      registration: { registrar: 'Example Registrar, LLC' },
    });
  });

  it('prefers for_sale over parked when the page offers the domain', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'registered', record: parkedRecord as RdapDomain },
      homepage: okPage({ forSale: true }),
    });
    expect((await profileDomain('parkedexample.com', deps)).status).toBe('for_sale');
  });

  it('treats a bot wall as a live site with low confidence', async () => {
    const deps = await makeDeps({ homepage: okPage({ httpStatus: 403 }) });
    const profile = await profileDomain('acme.com', deps);
    expect(profile).toMatchObject({ status: 'live_site', confidence: 'low' });
    expect(profile.reason).toContain('not retried or bypassed');
  });

  it('reports no_site when the homepage is unreachable', async () => {
    const deps = await makeDeps({ homepage: { kind: 'error', reason: 'ENOTFOUND' } });
    expect(await profileDomain('acme.com', deps)).toMatchObject({
      status: 'no_site',
      confidence: 'medium',
      reason: 'Homepage unreachable: ENOTFOUND',
    });
  });

  it('falls back to WHOIS and fills nameservers from DNS when WHOIS has none', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'no_server' },
      whois: {
        kind: 'registered',
        server: 'whois.nic.example',
        raw: 'Domain Name: ACME.XYZ\nCreation Date: 2020-01-01T00:00:00Z\n',
      },
      ns: ['ns1.bodis.com'],
    });
    const profile = await profileDomain('acme.xyz', deps);
    expect(profile).toMatchObject({
      status: 'parked',
      source: 'whois+dns+http',
      registration: { source: 'whois', nameserverSource: 'dns', createdAt: '2020-01-01T00:00:00Z' },
    });
    expect(deps.calls).toEqual(['rdap', 'whois', 'dns', 'http']);
  });

  it('returns not_registered without fetching the homepage', async () => {
    const deps = await makeDeps({ rdap: { kind: 'not_found' } });
    const profile = await profileDomain('zzqx.com', deps);
    expect(profile).toMatchObject({ status: 'not_registered', confidence: 'high' });
    expect(profile.homepage).toBeUndefined();
    expect(deps.calls).toEqual(['rdap']);
  });

  it('returns unknown when registration and homepage both fail, and does not cache it', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'error', reason: 'RDAP HTTP 500' },
      whois: { kind: 'error', reason: 'timeout' },
      homepage: { kind: 'error', reason: 'ENOTFOUND' },
    });
    const first = await profileDomain('acme.com', deps);
    expect(first).toMatchObject({ status: 'unknown', confidence: 'low' });
    expect(first.reason).toContain('RDAP: RDAP HTTP 500; WHOIS: timeout');
    await profileDomain('acme.com', deps);
    expect(deps.calls.filter((c) => c === 'rdap')).toHaveLength(2);
  });

  it('serves a second call from the cache', async () => {
    const deps = await makeDeps({});
    await profileDomain('acme.com', deps);
    await profileDomain('acme.com', deps);
    expect(deps.calls).toEqual(['rdap', 'http']);
  });

  it('rejects malformed input', async () => {
    const deps = await makeDeps({});
    await expect(profileDomain('not a domain', deps)).rejects.toBeInstanceOf(ValidationError);
  });
});
