import { describe, expect, it } from 'vitest';
import { normalizeHandle, PLATFORMS, profileUrl } from '../../src/research/handles/platforms.js';

describe('normalizeHandle', () => {
  it('strips a leading @ and lower-cases', () => {
    expect(normalizeHandle('github', ' @Acme-HQ ')).toEqual({ ok: true, handle: 'acme-hq' });
  });

  it('applies PEP 503 normalization for PyPI', () => {
    expect(normalizeHandle('pypi', 'Acme__Tools.Py')).toEqual({
      ok: true,
      handle: 'acme-tools-py',
    });
  });

  it('rejects names that break a platform rule, with the rule in the message', () => {
    const result = normalizeHandle('github', 'acme--hq');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('single inner hyphens');
    expect(normalizeHandle('reddit', 'ab').ok).toBe(false);
    expect(normalizeHandle('x', 'acme-hq').ok).toBe(false);
    expect(normalizeHandle('npm', '_acme').ok).toBe(false);
  });

  it('accepts a plain name on every platform', () => {
    for (const platform of PLATFORMS) {
      expect(normalizeHandle(platform, 'acmehq')).toEqual({ ok: true, handle: 'acmehq' });
    }
  });
});

describe('profileUrl', () => {
  it('builds the public profile URL', () => {
    expect(profileUrl('github', 'acme')).toBe('https://github.com/acme');
    expect(profileUrl('youtube', 'acme')).toBe('https://www.youtube.com/@acme');
    expect(profileUrl('pypi', 'acme')).toBe('https://pypi.org/project/acme/');
  });
});
