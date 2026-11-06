import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import type { HttpFetch } from '../../src/http/http.js';
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
    const env = { CLOUDFLARE_API_TOKEN: 'cf-token-efgh', CLOUDFLARE_ACCOUNT_ID: 'acct-9876' };
    const d = await deps(env);
    // The failure echoes the request URL and headers, like a verbose network error would.
    const http: HttpFetch = async (url, init = {}) => {
      throw new Error(`fetch failed: ${url} ${JSON.stringify(init.headers)}`);
    };
    const rt = createRegistrarRuntime({ ...d, http });
    const result = await rt.registrarQuote(['zentrova.site']);
    expect(result.mode).toBe('live');
    const text = JSON.stringify(result);
    // Prove the fake really leaks: the unredacted error would contain both values.
    expect(text).toContain('[redacted]');
    expect(text).not.toContain('cf-token-efgh');
    expect(text).not.toContain('acct-9876');
  });

  it('uses the bundled tables when none are injected', async () => {
    const d = await deps({});
    const rt = createRegistrarRuntime({ http: d.http, cache: d.cache, env: {} });
    expect(rt.tldInfo('sbs').registrars.find((r) => r.registrar === 'cloudflare')?.sale).toBe(
      'not_listed',
    );
  });
});

describe('createRegistrarRuntime with a key file', () => {
  it('uses keys saved to the file after start, without a restart', async () => {
    const { createKeySource, keyFilePath } = await import('../../src/util/key-file.js');
    const { writeFile } = await import('node:fs/promises');
    const d = await deps({});
    const path = keyFilePath(await mkdtemp(join(tmpdir(), 'dne-rt-keys-')));
    const keys = createKeySource({}, path);
    const rt = createRegistrarRuntime({ ...d, keys });

    expect(rt.keysSetup()).toMatchObject({ created: true, path });
    expect(rt.registrarStatus().registrars[0]?.configured).toBe(false);
    expect((await rt.registrarQuote(['zentrova.site'])).mode).toBe('table');

    await writeFile(path, 'SPACESHIP_API_KEY=ss-key-1234\nSPACESHIP_API_SECRET=ss-secret-5678\n');
    const status = rt.registrarStatus();
    expect(status.registrars[0]).toMatchObject({ registrar: 'spaceship', configured: true });
    expect(status.keyFile).toMatchObject({ path, exists: true });
    expect(JSON.stringify(status)).not.toContain('ss-key-1234');
    expect((await rt.registrarQuote(['zentrova.site'])).mode).toBe('live');
  });
});
