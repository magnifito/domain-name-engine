import { describe, expect, it } from 'vitest';
import {
  readCredentials,
  redact,
  registrarStatus,
  secretValues,
} from '../../src/registrars/credentials.js';

const FULL_ENV = {
  SPACESHIP_API_KEY: 'ss-key-1234',
  SPACESHIP_API_SECRET: 'ss-secret-5678',
  NAMECHEAP_API_USER: 'ncuser',
  NAMECHEAP_API_KEY: 'nc-key-abcd',
  NAMECHEAP_CLIENT_IP: '203.0.113.7',
  CLOUDFLARE_API_TOKEN: 'cf-token-efgh',
  CLOUDFLARE_ACCOUNT_ID: 'cf-account-ijkl',
};

describe('readCredentials', () => {
  it('reads every registrar when all its variables are set', () => {
    expect(readCredentials(FULL_ENV)).toEqual({
      spaceship: { apiKey: 'ss-key-1234', apiSecret: 'ss-secret-5678' },
      namecheap: { apiUser: 'ncuser', apiKey: 'nc-key-abcd', clientIp: '203.0.113.7' },
      cloudflare: { apiToken: 'cf-token-efgh', accountId: 'cf-account-ijkl' },
    });
  });

  it('skips a registrar with a missing or blank variable', () => {
    const creds = readCredentials({
      ...FULL_ENV,
      SPACESHIP_API_SECRET: '  ',
      NAMECHEAP_CLIENT_IP: undefined,
    });
    expect(creds.spaceship).toBeUndefined();
    expect(creds.namecheap).toBeUndefined();
    expect(creds.cloudflare).toBeDefined();
  });

  it('treats an unexpanded .mcp.json placeholder as unset', () => {
    const creds = readCredentials({
      ...FULL_ENV,
      CLOUDFLARE_API_TOKEN: '\u0024{CLOUDFLARE_API_TOKEN}',
    });
    expect(creds.cloudflare).toBeUndefined();
  });
});

describe('redact', () => {
  it('replaces every secret value', () => {
    const secrets = secretValues(readCredentials(FULL_ENV));
    const text = 'GET https://api.test/?ApiKey=nc-key-abcd&x=ss-secret-5678 failed';
    expect(redact(text, secrets)).toBe(
      'GET https://api.test/?ApiKey=[redacted]&x=[redacted] failed',
    );
  });
});

describe('registrarStatus', () => {
  it('reports configured registrars and missing variable names, never values', () => {
    const report = registrarStatus({
      SPACESHIP_API_KEY: 'ss-key-1234',
      CLOUDFLARE_API_TOKEN: 'cf-token-efgh',
      CLOUDFLARE_ACCOUNT_ID: 'cf-account-ijkl',
    });
    expect(report.registrars.map((r) => [r.registrar, r.configured, r.missing])).toEqual([
      ['spaceship', false, ['SPACESHIP_API_SECRET']],
      ['namecheap', false, ['NAMECHEAP_API_USER', 'NAMECHEAP_API_KEY', 'NAMECHEAP_CLIENT_IP']],
      ['cloudflare', true, []],
    ]);
    const text = JSON.stringify(report);
    for (const value of ['ss-key-1234', 'cf-token-efgh', 'cf-account-ijkl']) {
      expect(text).not.toContain(value);
    }
  });

  it('lists the optional research keys by name and set state only', () => {
    const report = registrarStatus({ GITHUB_TOKEN: 'gh-token-zzzz', EUIPO_ENV: 'sandbox' });
    expect(report.otherKeys.filter((k) => k.configured).map((k) => k.name)).toEqual([
      'GITHUB_TOKEN',
      'EUIPO_ENV',
    ]);
    expect(report.otherKeys).toHaveLength(7);
    expect(JSON.stringify(report)).not.toContain('gh-token-zzzz');
  });
});
