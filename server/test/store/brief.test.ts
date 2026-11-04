import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BriefSchema } from '../../src/store/brief.js';
import { loadBrief } from './brief-fixture.js';

function issues(input: unknown): string[] {
  const parsed = BriefSchema.safeParse(input);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

const TEMPLATE = new URL('../../../skills/brief/templates/brief.md', import.meta.url);

const REQUIRED = [
  'subject.what',
  'subject.category',
  'subject.problem',
  'audience.who',
  'audience.segment',
  'audience.countries',
  'audience.languages',
  'positioning.priceTier',
  'personality.tone',
  'nameRules.rulesets',
  'mode.type',
];

const OPTIONAL = [
  'subject.features',
  'subject.keywords',
  'positioning.competitors',
  'positioning.difference',
  'personality.archetype',
  'personality.avoid',
  'nameRules.overrides',
  'nameRules.handles',
  'future.scope',
];

const PERSONAL = ['mode.fullName', 'mode.profession', 'mode.nameForms'];

describe('BriefSchema', () => {
  it('accepts the filled example brief', async () => {
    expect(issues(await loadBrief())).toEqual([]);
  });

  it('accepts a brief with only the required fields', async () => {
    const brief = await loadBrief();
    const minimal = {
      subject: {
        what: brief.subject.what,
        category: brief.subject.category,
        problem: brief.subject.problem,
      },
      audience: brief.audience,
      positioning: { priceTier: 'budget' },
      personality: { tone: ['calm', 'clear', 'kind'] },
      nameRules: { rulesets: ['budget'] },
      mode: { type: 'product' },
    };
    expect(issues(minimal)).toEqual([]);
  });

  it('rejects a missing required field', async () => {
    const brief = await loadBrief();
    const { what: _what, ...subject } = brief.subject;
    expect(issues({ ...brief, subject })[0]).toMatch(/^subject\.what: /);
  });

  it('rejects a blank answer', async () => {
    const brief = await loadBrief();
    expect(issues({ ...brief, subject: { ...brief.subject, category: '  ' } })).toEqual([
      'subject.category: Must not be blank.',
    ]);
  });

  it('needs exactly three tone words', async () => {
    const brief = await loadBrief();
    const personality = { ...brief.personality, tone: ['warm', 'calm'] };
    expect(issues({ ...brief, personality })[0]).toMatch(/^personality\.tone: /);
  });

  it('does not accept the reserved ruleset id "user"', async () => {
    const brief = await loadBrief();
    const bad = { ...brief, nameRules: { ...brief.nameRules, rulesets: ['user'] } };
    expect(BriefSchema.safeParse(bad).success).toBe(false);
  });

  it('needs one to three distinct rulesets', async () => {
    const brief = await loadBrief();
    const withRulesets = (rulesets: string[]) => ({
      ...brief,
      nameRules: { ...brief.nameRules, rulesets },
    });
    expect(issues(withRulesets([]))).not.toEqual([]);
    expect(issues(withRulesets(['coined', 'compound', 'budget', 'premium']))).not.toEqual([]);
    expect(issues(withRulesets(['coined', 'coined']))).toEqual([
      'nameRules.rulesets: Pick each ruleset once.',
    ]);
  });

  it('uses ISO country codes and BCP 47 language codes', async () => {
    const brief = await loadBrief();
    expect(issues({ ...brief, audience: { ...brief.audience, countries: ['Germany'] } })).toEqual([
      'audience.countries.0: Use an ISO 3166-1 alpha-2 country code such as "DE" or "US".',
    ]);
    expect(issues({ ...brief, audience: { ...brief.audience, languages: ['German'] } })).toEqual([
      'audience.languages.0: Use a BCP 47 language code such as "en", "de", or "pt-BR".',
    ]);
  });

  it('checks override lengths against each other', async () => {
    const brief = await loadBrief();
    const nameRules = { ...brief.nameRules, overrides: { minLength: 9, maxLength: 5 } };
    expect(issues({ ...brief, nameRules })).toEqual([
      'nameRules.overrides: minLength must not exceed maxLength.',
    ]);
  });

  it('requires name details for a personal brand', async () => {
    const brief = await loadBrief();
    expect(issues({ ...brief, mode: { type: 'personal' } })).not.toEqual([]);
    const personal = {
      type: 'personal',
      fullName: 'Jane Doe',
      profession: 'Interior designer',
      nameForms: ['Jane Doe', 'J. Doe', 'Jane Doe Design'],
    };
    expect(issues({ ...brief, mode: personal })).toEqual([]);
  });
});

describe('brief template', () => {
  it('has the seven spec sections in order', async () => {
    const text = await readFile(TEMPLATE, 'utf8');
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      '1. Subject',
      '2. Audience and markets',
      '3. Positioning',
      '4. Personality',
      '5. Name rules',
      '6. Future',
      '7. Mode',
    ]);
  });

  it('has one question per schema field, marked required or optional like the spec', async () => {
    const text = await readFile(TEMPLATE, 'utf8');
    const questions = [...text.matchAll(/^- (.+) <!-- ([a-zA-Z.]+) -->$/gm)].map((m) => ({
      text: m[1] ?? '',
      path: m[2] ?? '',
    }));
    expect(questions.map((q) => q.path).sort()).toEqual(
      [...REQUIRED, ...OPTIONAL, ...PERSONAL].sort(),
    );
    for (const q of questions) {
      if (REQUIRED.includes(q.path)) expect(q.text, q.path).toContain('(required)');
      if (OPTIONAL.includes(q.path)) expect(q.text, q.path).toContain('(optional)');
      if (PERSONAL.includes(q.path))
        expect(q.text, q.path).toContain('(required for personal brand)');
    }
  });
});
