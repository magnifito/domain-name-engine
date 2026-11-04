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
});
