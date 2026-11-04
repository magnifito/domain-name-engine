import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const skill = await readFile(new URL('../../../skills/research/SKILL.md', import.meta.url), 'utf8');

describe('research skill text', () => {
  it('passes labels, not display names, to check_domains and check_handles (I3)', () => {
    expect(skill).toMatch(/shortlist labels/i);
    expect(skill).toMatch(/lowercase LDH/i);
    expect(skill).toMatch(/batches of 20/);
    expect(skill).toMatch(/match .* by (?:the )?label/i);
    expect(skill).toMatch(/display name.*search_trademarks/is);
  });

  it('requires a full ISO timestamp for competitor findings (M5)', () => {
    expect(skill).toMatch(/full ISO 8601 timestamp with a `Z` or an offset/);
  });

  it('saves the whole search_trademarks response in a one-item array (M6)', () => {
    expect(skill).toMatch(/whole `search_trademarks` response/);
    expect(skill).toMatch(/one-item array/);
  });
});
