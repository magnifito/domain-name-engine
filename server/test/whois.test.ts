import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache/cache.js';
import { HostLimiter } from '../src/limiter/limiter.js';
import {
  parseAvailability,
  parseReferral,
  type WhoisQuery,
  whoisLookup,
} from '../src/sources/whois.js';

const IANA_XYZ = `% IANA WHOIS server
domain:       XYZ
organisation: XYZ.COM LLC
whois:        whois.nic.xyz
status:       ACTIVE
`;

const IANA_NO_WHOIS = `% IANA WHOIS server
domain:       EXAMPLE
status:       ACTIVE
`;

const REGISTERED = `Domain Name: ABC.XYZ
Registry Domain ID: D1234-CNIC
Registrar: Example Registrar, Inc.
Creation Date: 2014-06-02T00:00:00.0Z
`;

const NOT_FOUND = 'The queried object does not exist: DOMAIN NOT FOUND\n';

describe('parseReferral', () => {
  it('reads the whois server from IANA output', () => {
    expect(parseReferral(IANA_XYZ)).toBe('whois.nic.xyz');
  });

  it('returns null when IANA lists no whois server', () => {
    expect(parseReferral(IANA_NO_WHOIS)).toBeNull();
  });
});

describe('parseReferral newline handling', () => {
  it('does not cross newlines', () => {
    expect(parseReferral('whois:\n\nstatus: ACTIVE')).toBeNull();
  });
});

describe('parseAvailability', () => {
  it.each([
    ['No match for "ZZQX.COM".', 'not_found'],
    [NOT_FOUND, 'not_found'],
    ['%% NOT FOUND', 'not_found'],
    ['Status: free', 'not_found'],
    ['No Data Found', 'not_found'],
    [REGISTERED, 'registered'],
    ['Rate limit exceeded', 'unknown'],
    ['% No match for "X.COM"', 'not_found'],
    ['  acme.test is available for registration', 'not_found'],
    [`${REGISTERED}\nTerms: results with no match for your query may be inexact.`, 'registered'],
    [`${REGISTERED}\nNotes: the domain not found in other registries is unaffected.`, 'registered'],
  ])('classifies %j as %s', (text, expected) => {
    expect(parseAvailability(text)).toBe(expected);
  });
});

describe('whoisLookup', () => {
  async function deps(responses: Record<string, string | Error>) {
    const calls: string[] = [];
    const query: WhoisQuery = async (server, q) => {
      calls.push(`${server} ${q}`);
      const reply = responses[`${server} ${q}`];
      if (reply === undefined) throw new Error(`unexpected query ${server} ${q}`);
      if (reply instanceof Error) throw reply;
      return reply;
    };
    return {
      calls,
      deps: {
        query,
        limiter: new HostLimiter({ minIntervalMs: 0 }),
        cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-whois-'))),
      },
    };
  }

  it('follows the IANA referral and classifies the reply', async () => {
    const { deps: d } = await deps({
      'whois.iana.org xyz': IANA_XYZ,
      'whois.nic.xyz abc.xyz': REGISTERED,
    });
    const result = await whoisLookup('abc.xyz', 'xyz', d);
    expect(result).toMatchObject({ kind: 'registered', server: 'whois.nic.xyz' });
  });

  it('caches the referral server', async () => {
    const { deps: d, calls } = await deps({
      'whois.iana.org xyz': IANA_XYZ,
      'whois.nic.xyz a.xyz': NOT_FOUND,
      'whois.nic.xyz b.xyz': NOT_FOUND,
    });
    await whoisLookup('a.xyz', 'xyz', d);
    await whoisLookup('b.xyz', 'xyz', d);
    expect(calls.filter((c) => c.startsWith('whois.iana.org'))).toHaveLength(1);
  });

  it('reports no_server when IANA lists none', async () => {
    const { deps: d } = await deps({ 'whois.iana.org example': IANA_NO_WHOIS });
    expect(await whoisLookup('a.example', 'example', d)).toEqual({ kind: 'no_server' });
  });

  it('reports error when the query fails', async () => {
    const { deps: d } = await deps({ 'whois.iana.org xyz': new Error('ECONNREFUSED') });
    expect(await whoisLookup('a.xyz', 'xyz', d)).toEqual({
      kind: 'error',
      reason: 'ECONNREFUSED',
    });
  });

  it('uses the last label of a multi-label TLD for the referral', async () => {
    const { deps: d } = await deps({
      'whois.iana.org uk': 'domain:       UK\nwhois:        whois.nic.uk\n',
      'whois.nic.uk acme.co.uk': 'No match for "acme.co.uk".',
    });
    expect(await whoisLookup('acme.co.uk', 'co.uk', d)).toMatchObject({ kind: 'not_found' });
  });

  it('still classifies when the referral cache write fails', async () => {
    const { deps: d } = await deps({
      'whois.iana.org xyz': IANA_XYZ,
      'whois.nic.xyz a.xyz': NOT_FOUND,
    });
    d.cache.set = async () => {
      throw new Error('EROFS');
    };
    expect(await whoisLookup('a.xyz', 'xyz', d)).toMatchObject({ kind: 'not_found' });
  });

  it('does not cache a garbled IANA reply', async () => {
    const { deps: d, calls } = await deps({ 'whois.iana.org xyz': 'Rate limit exceeded\n' });
    const expected = { kind: 'error', reason: 'IANA WHOIS reply not understood' };
    expect(await whoisLookup('a.xyz', 'xyz', d)).toEqual(expected);
    expect(await whoisLookup('a.xyz', 'xyz', d)).toEqual(expected);
    expect(calls).toHaveLength(2);
  });

  it('caches null for a real IANA record without a whois server', async () => {
    const { deps: d, calls } = await deps({ 'whois.iana.org example': IANA_NO_WHOIS });
    expect(await whoisLookup('a.example', 'example', d)).toEqual({ kind: 'no_server' });
    expect(await whoisLookup('b.example', 'example', d)).toEqual({ kind: 'no_server' });
    expect(calls).toHaveLength(1);
  });
});
