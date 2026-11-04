import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { quoteDomains } from '../../src/registrars/quote.js';
import type { Runtime } from '../../src/runtime.js';
import { callJson, connectClient } from '../helpers/mcp.js';
import { testTables } from '../tld/fixtures.js';

async function fakeRuntime(): Promise<Runtime> {
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rq-')));
  return {
    registrarQuote: (domains: string[]) =>
      quoteDomains(domains, { tables: testTables(), clients: [], cache, secrets: [] }),
  } as Runtime;
}

describe('registrar_quote tool', () => {
  it('is listed with read-only, open-world annotations', async () => {
    const client = await connectClient(await fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'registrar_quote');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('returns table quotes when no keys are set', async () => {
    const client = await connectClient(await fakeRuntime());
    const res = await callJson(client, 'registrar_quote', { domains: ['zentrova.site'] });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      mode: 'table',
      liveRegistrars: [],
      quotes: [{ domain: 'zentrova.site', tld: 'site' }],
    });
  });

  it('returns a tool error for a domain without a TLD', async () => {
    const client = await connectClient(await fakeRuntime());
    const res = await callJson(client, 'registrar_quote', { domains: ['zentrova'] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('has no TLD');
  });

  it('rejects more than 20 domains', async () => {
    const client = await connectClient(await fakeRuntime());
    const domains = Array.from({ length: 21 }, (_, i) => `name${i}.site`);
    const res = await callJson(client, 'registrar_quote', { domains });
    expect(res.isError).toBe(true);
  });
});
