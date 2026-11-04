import { describe, expect, it } from 'vitest';
import { runStartup, type StartupIo } from '../src/startup.js';

function io(env: NodeJS.ProcessEnv = {}): StartupIo & { out: string[]; codes: number[] } {
  const out: string[] = [];
  const codes: number[] = [];
  return { out, codes, env, stderr: (t) => out.push(t), exit: (c) => codes.push(c) };
}

describe('runStartup', () => {
  it('does nothing extra when start succeeds', async () => {
    const fake = io();
    await runStartup(async () => undefined, fake);
    expect(fake.out).toEqual([]);
    expect(fake.codes).toEqual([]);
  });

  it('writes one stderr line and exits 1 when start fails', async () => {
    const fake = io();
    await runStartup(async () => {
      throw new Error('EACCES: permission denied, mkdir /root/.domain-engine');
    }, fake);
    expect(fake.out).toEqual([
      'domain-name-engine: failed to start: EACCES: permission denied, mkdir /root/.domain-engine\n',
    ]);
    expect(fake.codes).toEqual([1]);
  });

  it('redacts registrar keys from the message', async () => {
    const fake = io({ CLOUDFLARE_API_TOKEN: 'cf-token-efgh', CLOUDFLARE_ACCOUNT_ID: 'acct-9876' });
    await runStartup(async () => {
      throw new Error('bad token cf-token-efgh');
    }, fake);
    expect(fake.out[0]).toBe('domain-name-engine: failed to start: bad token [redacted]\n');
  });

  it('redacts the research keys of the other plans too (M5)', async () => {
    const fake = io({
      GITHUB_TOKEN: 'gh-token-1111',
      REDDIT_CLIENT_ID: 'rd-id-2222',
      REDDIT_CLIENT_SECRET: 'rd-secret-3333',
      YOUTUBE_API_KEY: 'yt-key-4444',
      EUIPO_CLIENT_ID: 'eu-id-5555',
      EUIPO_CLIENT_SECRET: 'eu-secret-6666',
    });
    await runStartup(async () => {
      throw new Error(
        'x gh-token-1111 rd-id-2222 rd-secret-3333 yt-key-4444 eu-id-5555 eu-secret-6666',
      );
    }, fake);
    expect(fake.out[0]).toBe(
      'domain-name-engine: failed to start: x [redacted] [redacted] [redacted] [redacted] [redacted] [redacted]\n',
    );
  });

  it('redacts the trimmed form of a key value with surrounding whitespace (M4)', async () => {
    const fake = io({ GITHUB_TOKEN: '  gh-token-1111\n' });
    await runStartup(async () => {
      throw new Error('bad gh-token-1111 and "  gh-token-1111\n"');
    }, fake);
    expect(fake.out[0]).not.toContain('gh-token-1111');
  });
});
