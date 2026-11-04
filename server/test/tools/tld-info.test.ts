import { describe, expect, it } from 'vitest';
import type { Runtime } from '../../src/runtime.js';
import { tldInfo } from '../../src/tld/info.js';
import { callJson, connectClient } from '../helpers/mcp.js';
import { testTables } from '../tld/fixtures.js';

function fakeRuntime(seen: string[] = []): Runtime {
  return {
    tldInfo: (tld: string) => {
      seen.push(tld);
      return tldInfo(tld, testTables());
    },
  } as Runtime;
}

describe('tld_info tool', () => {
  it('is listed with read-only, closed-world annotations', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'tld_info');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('normalizes the TLD and returns registrars, prices, and reputation', async () => {
    const seen: string[] = [];
    const client = await connectClient(fakeRuntime(seen));
    const res = await callJson(client, 'tld_info', { tld: '.SITE' });
    expect(res.isError).toBe(false);
    expect(seen).toEqual(['site']);
    expect(res.data).toMatchObject({
      tld: 'site',
      reputation: { reputation: 'mixed' },
      cheapestThreeYear: [
        { currency: 'EUR', registrar: 'spaceship' },
        { currency: 'USD', registrar: 'cloudflare' },
      ],
    });
  });

  it('returns a tool error for an invalid TLD', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'tld_info', { tld: 'not a tld' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('is not a valid TLD');
  });
});
