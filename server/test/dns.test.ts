import { describe, expect, it } from 'vitest';
import { hasNameservers } from '../src/sources/dns.js';

function failingResolver(code: string) {
  return async () => {
    throw Object.assign(new Error(code), { code });
  };
}

describe('hasNameservers', () => {
  it('returns true when NS records exist', async () => {
    expect(await hasNameservers('a.com', async () => ['ns1.a.com'])).toBe(true);
  });

  it('returns false for NXDOMAIN-style errors', async () => {
    expect(await hasNameservers('a.com', failingResolver('ENOTFOUND'))).toBe(false);
    expect(await hasNameservers('a.com', failingResolver('ENODATA'))).toBe(false);
  });

  it('returns null when the lookup itself fails', async () => {
    expect(await hasNameservers('a.com', failingResolver('ETIMEOUT'))).toBeNull();
  });
});
