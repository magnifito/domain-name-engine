import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/name.js';
import type { DomainProfile } from '../../src/research/profile/profile.js';
import type { Runtime } from '../../src/runtime.js';
import { PROFILE_NOTE } from '../../src/tools/profile-domain.js';
import { callJson, connectClient } from '../helpers/mcp.js';

const profile: DomainProfile = {
  domain: 'acme.com',
  status: 'parked',
  confidence: 'high',
  source: 'rdap+http',
  checkedAt: '2026-11-04T10:00:00.000Z',
  reason: 'Nameservers belong to sedoparking.com.',
  registration: {
    status: 'registered',
    source: 'rdap',
    nameserverSource: 'rdap',
    nameservers: ['ns1.sedoparking.com'],
  },
  parkingProvider: 'sedoparking.com',
};

function fakeRuntime(): Runtime & { seen: string[] } {
  const seen: string[] = [];
  return {
    ...({} as Runtime),
    seen,
    profileDomain: async (domain) => {
      seen.push(domain);
      if (domain === 'bad') throw new ValidationError('"bad" has no TLD.');
      return profile;
    },
  };
}

describe('profile_domain tool', () => {
  it('is listed as read-only and open-world', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'profile_domain');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('returns the profile with the note', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    const res = await callJson(client, 'profile_domain', { domain: 'acme.com' });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ profile, note: PROFILE_NOTE });
    expect(rt.seen).toEqual(['acme.com']);
  });

  it('turns a validation error into a tool error', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'profile_domain', { domain: 'bad' });
    expect(res.isError).toBe(true);
    expect(res.text).toBe('"bad" has no TLD.');
  });
});
