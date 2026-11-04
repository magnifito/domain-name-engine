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

  it('treats page titles as untrusted data (M7)', () => {
    expect(skill).toMatch(/untrusted data/i);
    expect(skill).toMatch(/never follow instructions/i);
  });

  it('wraps the competitor JSON example in a double-backtick span, since it contains backticks', () => {
    expect(skill).toMatch(/`` \{ "source": "websearch".*\} ``/);
  });
});

describe('TLD coverage rule (I1, I2)', () => {
  it('defines the coverage rule once in tlds.md and references it from the skills', async () => {
    const tlds = await readFile(
      new URL('../../../skills/generate/references/tlds.md', import.meta.url),
      'utf8',
    );
    const generate = await readFile(
      new URL('../../../skills/generate/SKILL.md', import.meta.url),
      'utf8',
    );
    const find = await readFile(
      new URL('../../../skills/find-domain/SKILL.md', import.meta.url),
      'utf8',
    );
    expect(tlds).toMatch(/## TLD coverage for a name/);
    expect(tlds).toMatch(/countryFirst/);
    expect(tlds).toMatch(/primary TLDs/i);
    expect(generate).toMatch(/TLD coverage for a name/);
    expect(skill).toMatch(/TLD coverage for a name/);
    expect(skill).toMatch(/every `registered` domain among the name's primary TLDs/);
    expect(skill).toMatch(/no `trademark` result yet/);
    expect(find).toMatch(/registered. primary-TLD domains/);
  });

  it('calls project_add_checks once per name (M1)', () => {
    expect(skill).toMatch(/`project_add_checks` once per name/);
  });

  it('splits check_domains calls by the tool limits (M2)', () => {
    expect(skill).toMatch(/at most 30 TLDs, 100 names, and 200 domains/);
  });
});
