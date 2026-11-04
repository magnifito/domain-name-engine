import { describe, expect, it } from 'vitest';
import {
  joinDomain,
  normalizeLabel,
  normalizeTld,
  splitDomain,
  ValidationError,
} from '../src/domain/name.js';

describe('normalizeLabel', () => {
  it('lowercases and trims', () => {
    expect(normalizeLabel('  Acme ')).toBe('acme');
  });

  it('accepts inner hyphens and punycode', () => {
    expect(normalizeLabel('get-acme')).toBe('get-acme');
    expect(normalizeLabel('xn--bcher-kva')).toBe('xn--bcher-kva');
  });

  it.each(['', '-acme', 'acme-', 'ac me', 'acme.com', 'a'.repeat(64), 'ácme', '\u212Aeys'])(
    'rejects %j',
    (input) => {
      expect(() => normalizeLabel(input)).toThrow(ValidationError);
    },
  );
});

describe('normalizeTld', () => {
  it('accepts a 63-character TLD label and rejects Unicode case-folding tricks', () => {
    expect(normalizeTld('a'.repeat(63))).toBe('a'.repeat(63));
    expect(() => normalizeTld('\u212A')).toThrow(ValidationError);
  });

  it('strips a leading dot and lowercases', () => {
    expect(normalizeTld('.IO')).toBe('io');
  });

  it('accepts multi-label TLDs up to three labels', () => {
    expect(normalizeTld('co.uk')).toBe('co.uk');
    expect(normalizeTld('.CO.UK')).toBe('co.uk');
  });

  it.each(['google.com', 'vercel.app', 'github.io'])('rejects non-registry suffix %j', (input) => {
    expect(() => normalizeTld(input)).toThrow(/is not a known registry suffix/);
  });

  it.each(['', '.', 'a.b.c.d', 'c_m', '-io'])('rejects %j', (input) => {
    expect(() => normalizeTld(input)).toThrow(ValidationError);
  });
});

describe('joinDomain and splitDomain', () => {
  it('joins a label and a TLD', () => {
    expect(joinDomain('Acme', '.Dev')).toBe('acme.dev');
  });

  it('splits at the first dot', () => {
    expect(splitDomain('Acme.co.uk.')).toEqual({ label: 'acme', tld: 'co.uk' });
  });

  it('accepts a 63-character label', () => {
    expect(splitDomain(`${'a'.repeat(63)}.com`).label).toBe('a'.repeat(63));
  });

  it('propagates label and TLD errors', () => {
    expect(() => joinDomain('-bad', 'com')).toThrow(ValidationError);
    expect(() => joinDomain('acme', 'not.known')).toThrow(ValidationError);
    expect(() => splitDomain('-bad.com')).toThrow(ValidationError);
  });

  it('rejects an empty label before the TLD', () => {
    expect(() => splitDomain('acme..com')).toThrow(ValidationError);
  });

  it('rejects a domain without a TLD', () => {
    expect(() => splitDomain('acme')).toThrow(ValidationError);
  });
});
