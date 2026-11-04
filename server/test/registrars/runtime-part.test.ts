import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { createRegistrarRuntime, liveClients } from '../../src/registrars/runtime-part.js';
import { testTables } from '../tld/fixtures.js';
import { fakeHttp } from './fake-http.js';

async function deps(env: NodeJS.ProcessEnv) {
  const { http, calls } = fakeHttp([]);
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rt-')));
  return { http, calls, cache, env, tables: testTables() };
}

describe('createRegistrarRuntime', () => {
  it('creates live clients only for fully configured registrars', async () => {
    const d = await deps({});
    expect(liveClients({}, d)).toEqual([]);
    const clients = liveClients(
      {
        spaceship: { apiKey: 'k', apiSecret: 's' },
        cloudflare: { apiToken: 't', accountId: 'a' },
      },
      d,
    );
    expect(clients.map((c) => c.id)).toEqual(['spaceship', 'cloudflare']);
  });

  it('answers from the table with no network call when no keys are set', async () => {
    const d = await deps({});
    const rt = createRegistrarRuntime(d);
    const result = await rt.registrarQuote(['zentrova.site']);
    expect(result.mode).toBe('table');
    expect(d.calls).toHaveLength(0);
    expect(rt.tldInfo('site').tld).toBe('site');
    expect(rt.registrarStatus().registrars.every((r) => !r.configured)).toBe(true);
  });

  it('never puts key values into a failed live quote', async () => {
    const d = await deps({
      CLOUDFLARE_API_TOKEN: 'cf-token-efgh',
      CLOUDFLARE_ACCOUNT_ID: 'acct-9876',
    });
    const rt = createRegistrarRuntime(d);
    const result = await rt.registrarQuote(['zentrova.site']);
    expect(result.mode).toBe('live');
    const text = JSON.stringify(result);
    expect(text).not.toContain('cf-token-efgh');
    expect(text).not.toContain('acct-9876');
  });

  it('uses the bundled tables when none are injected', async () => {
    const d = await deps({});
    const rt = createRegistrarRuntime({ http: d.http, cache: d.cache, env: {} });
    expect(rt.tldInfo('sbs').registrars.find((r) => r.registrar === 'cloudflare')?.sale).toBe(
      'not_sold',
    );
  });
});
