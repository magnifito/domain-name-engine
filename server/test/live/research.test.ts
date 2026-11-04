import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/runtime.js';

const randomLabel = (length: number): string =>
  Array.from({ length }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

async function runtime(extraEnv: NodeJS.ProcessEnv = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dne-live-research-'));
  return createRuntime({ ...process.env, ...extraEnv, DOMAIN_ENGINE_HOME: home });
}

// Runs only through `pnpm test:live`; it uses the real network.
describe.skipIf(!process.env.LIVE)('live research tools', () => {
  it('profiles google.com as a registered live site', async () => {
    const profile = await (await runtime()).profileDomain('google.com');
    expect(profile.registration.status).toBe('registered');
    expect(profile.registration.createdAt).toMatch(/^1997-09-15/);
    expect(['live_site']).toContain(profile.status);
  }, 60_000);

  it('reports known names as taken on GitHub, npm, and PyPI', async () => {
    const rt = await runtime();
    const [github] = await rt.checkHandles(['torvalds'], ['github']);
    const [npm] = await rt.checkHandles(['react'], ['npm']);
    const [pypi] = await rt.checkHandles(['requests'], ['pypi']);
    expect([github?.status, npm?.status, pypi?.status]).toEqual(['taken', 'taken', 'taken']);
  }, 60_000);

  it('reports a random 30-letter name as likely_available on npm and PyPI', async () => {
    const label = randomLabel(30);
    const results = await (await runtime()).checkHandles([label], ['npm', 'pypi']);
    expect(results.map((r) => r.status)).toEqual(['likely_available', 'likely_available']);
  }, 60_000);

  it('reports a random 30-letter name as likely_available on GitHub', async () => {
    const [result] = await (await runtime()).checkHandles([randomLabel(30)], ['github']);
    expect(result?.status).toBe('likely_available');
  }, 60_000);

  it('returns links and honest unknowns for trademarks without EUIPO keys', async () => {
    const rt = await runtime({ EUIPO_CLIENT_ID: '', EUIPO_CLIENT_SECRET: '' });
    const result = await rt.searchTrademarks({ mark: 'acme' });
    expect(result.results.map((r) => r.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(result.links).toHaveLength(4);
  });

  it.skipIf(!process.env.EUIPO_CLIENT_ID)(
    'finds EUIPO marks for "apple" with keys',
    async () => {
      const result = await (await runtime()).searchTrademarks({ mark: 'apple' });
      expect(result.results[0]?.status).toBe('matches_found');
    },
    60_000,
  );

  it.skipIf(!process.env.REDDIT_CLIENT_ID)(
    'finds u/spez on Reddit with keys',
    async () => {
      const [result] = await (await runtime()).checkHandles(['spez'], ['reddit']);
      expect(result?.status).toBe('taken');
    },
    60_000,
  );

  it.skipIf(!process.env.YOUTUBE_API_KEY)(
    'finds @youtube on YouTube with a key',
    async () => {
      const [result] = await (await runtime()).checkHandles(['youtube'], ['youtube']);
      expect(result?.status).toBe('taken');
    },
    60_000,
  );
});
