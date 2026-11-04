import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/runtime.js';

// Runs only through `pnpm test:live`; it uses the real network.
describe.skipIf(!process.env.LIVE)('live domain checks', () => {
  async function runtime() {
    const home = await mkdtemp(join(tmpdir(), 'dne-live-'));
    return createRuntime({ ...process.env, DOMAIN_ENGINE_HOME: home });
  }

  it('reports google.com as registered', async () => {
    const [result] = await (await runtime()).checkDomains(['google.com']);
    expect(result?.status).toBe('registered');
  }, 30_000);

  it('reports a random 30-letter .com as likely_available', async () => {
    const label = Array.from({ length: 30 }, () =>
      String.fromCharCode(97 + Math.floor(Math.random() * 26)),
    ).join('');
    const [result] = await (await runtime()).checkDomains([`${label}.com`]);
    expect(result?.status).toBe('likely_available');
  }, 30_000);
});
