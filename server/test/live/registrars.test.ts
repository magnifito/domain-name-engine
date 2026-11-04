import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { createHttp } from '../../src/http/http.js';
import { HostLimiter } from '../../src/limiter/limiter.js';
import { fetchCloudflarePublicPrices } from '../../src/registrars/cloudflare.js';
import { readCredentials } from '../../src/registrars/credentials.js';
import { liveClients } from '../../src/registrars/runtime-part.js';
import type { RegistrarId } from '../../src/tld/schema.js';

// Runs only through `pnpm test:live`. Registrar cases also need that registrar's keys.
const LIVE = Boolean(process.env.LIVE);
const creds = readCredentials(process.env);

function randomLabel(): string {
  return Array.from({ length: 30 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('');
}

async function client(id: RegistrarId) {
  const http = createHttp({ limiter: new HostLimiter() });
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-live-reg-')));
  const found = liveClients(creds, { http, cache }).find((c) => c.id === id);
  if (!found) throw new Error(`${id} keys are not set`);
  return found;
}

describe.skipIf(!LIVE)('live Cloudflare public price file', () => {
  it('lists hundreds of TLDs including .com in USD', async () => {
    const rows = await fetchCloudflarePublicPrices(createHttp({ limiter: new HostLimiter() }));
    expect(rows.length).toBeGreaterThan(300);
    expect(rows.find((r) => r.tld === 'com')).toMatchObject({ currency: 'USD' });
  }, 30_000);
});

for (const id of ['spaceship', 'namecheap', 'cloudflare'] as const) {
  describe.skipIf(!LIVE || !creds[id])(`live ${id} quotes`, () => {
    it('reports google.com as unavailable', async () => {
      const [quote] = await (await client(id)).quote(['google.com']);
      expect(quote?.availability).toBe('unavailable');
    }, 30_000);

    it('reports a random 30-letter .com as available with a price', async () => {
      const [quote] = await (await client(id)).quote([`${randomLabel()}.com`]);
      expect(quote?.availability).toBe('available');
      expect(quote?.firstYear).not.toBeNull();
      expect(quote?.currency).toMatch(/^[A-Z]{3}$/);
    }, 30_000);
  });
}
