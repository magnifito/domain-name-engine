import { describe, expect, it } from 'vitest';
import type { DomainCheck } from '../../src/domain/types.js';
import type { Runtime } from '../../src/runtime.js';
import { AVAILABILITY_NOTE } from '../../src/tools/check-domains.js';
import { callJson, connectClient } from '../helpers/mcp.js';

function fakeRuntime(): Runtime & { seen: string[][] } {
  const seen: string[][] = [];
  return {
    ...({} as Runtime),
    seen,
    checkDomains: async (domains) => {
      seen.push(domains);
      return domains.map(
        (domain): DomainCheck => ({
          domain,
          status: 'likely_available',
          source: 'rdap',
          confidence: 'high',
          checkedAt: '2026-11-04T10:00:00.000Z',
        }),
      );
    },
  };
}

describe('check_domains tool', () => {
  it('is listed by the server', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('check_domains');
  });

  it('checks every name × TLD pair, normalized and de-duplicated', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    const res = await callJson(client, 'check_domains', {
      names: ['Acme', 'acme', 'zent'],
      tlds: ['com', '.IO'],
    });
    expect(res.isError).toBe(false);
    expect(rt.seen[0]).toEqual(['acme.com', 'acme.io', 'zent.com', 'zent.io']);
    expect(res.data).toMatchObject({ note: AVAILABILITY_NOTE });
    expect((res.data as { results: unknown[] }).results).toHaveLength(4);
  });

  it('returns a tool error for an invalid label', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'check_domains', { names: ['-bad'], tlds: ['com'] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('"-bad" is not a valid domain label');
  });

  it('returns a tool error for a non-registry multi-label suffix', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'check_domains', { names: ['acme'], tlds: ['vercel.app'] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('is not a known registry suffix');
  });

  it('rejects more than 200 domains in one call', async () => {
    const client = await connectClient(fakeRuntime());
    const names = Array.from({ length: 60 }, (_, i) => `name${i}`);
    const res = await callJson(client, 'check_domains', {
      names,
      tlds: ['com', 'io', 'dev', 'app'],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('limit is 200');
  });
});
