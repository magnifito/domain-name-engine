import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BUILTIN_IDS, BUILTIN_RULESETS } from '../../src/rulesets/builtin.js';
import { type Ruleset, type RulesetInput, RulesetSchema } from '../../src/rulesets/schema.js';

const DATA_DIR = new URL('../../data/rulesets/', import.meta.url);

function builtin(id: string): Ruleset {
  const found = BUILTIN_RULESETS.find((r) => r.id === id);
  if (!found) throw new Error(`missing built-in ${id}`);
  return found;
}

function coined(): RulesetInput {
  return structuredClone(builtin('coined'));
}

function issues(input: unknown): string[] {
  const parsed = RulesetSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe('built-in rulesets', () => {
  it('ships exactly the nine spec rulesets', () => {
    expect(BUILTIN_RULESETS.map((r) => r.id).sort()).toEqual([
      'budget',
      'coined',
      'compound',
      'descriptive',
      'dev-tool',
      'evocative',
      'local-business',
      'personal',
      'premium',
    ]);
    expect(BUILTIN_IDS.size).toBe(9);
  });

  it('has one data file per ruleset, named after its id', async () => {
    const files = (await readdir(DATA_DIR)).filter((file) => file.endsWith('.json')).sort();
    expect(files).toEqual([...BUILTIN_IDS].map((id) => `${id}.json`).sort());
  });

  it('validates every built-in against the schema', () => {
    for (const ruleset of BUILTIN_RULESETS) expect(issues(ruleset), ruleset.id).toEqual([]);
  });

  it('encodes the spec summaries', () => {
    expect(builtin('coined').length).toEqual({ min: 4, max: 8 });
    expect(builtin('coined').styles[0]?.style).toBe('invented');
    expect(builtin('descriptive').length).toEqual({ min: 8, max: 15 });
    expect(builtin('descriptive').tlds.com).toBe('must');
    expect(builtin('descriptive').tlds.affixes.length).toBeGreaterThan(0);
    expect(builtin('compound').length).toEqual({ min: 6, max: 12 });
    expect(builtin('compound').styles.map((s) => s.style)).toEqual(['compound']);
    expect(builtin('evocative').tlds.com).toBe('nice');
    expect(builtin('premium').tlds.com).toBe('must');
    expect(builtin('dev-tool').tlds.order.slice(0, 3)).toEqual(['dev', 'sh', 'io']);
    expect(builtin('personal').styles.map((s) => s.style)).toEqual(['person-name']);
    expect(builtin('local-business').tlds.countryFirst).toBe(true);
    expect(builtin('local-business').styles[0]?.style).toBe('place-service');
    const budget = builtin('budget');
    expect(budget.length).toEqual({ min: 4, max: 15 });
    expect(budget.tlds.order).toEqual([
      'sbs',
      'site',
      'online',
      'store',
      'space',
      'lol',
      'bond',
      'xyz',
    ]);
    expect(budget.weights.price).toBe(1);
    expect(budget.weights.price).toBeGreaterThan(budget.weights.length);
  });
});

describe('RulesetSchema', () => {
  it('rejects a minimum length above the maximum', () => {
    expect(issues({ ...coined(), length: { min: 9, max: 4 } })).toContain(
      'length.min must not exceed length.max.',
    );
  });

  it('requires com in the TLD order when com is a must', () => {
    const r = coined();
    r.tlds = { ...r.tlds, com: 'must', order: ['io'] };
    expect(issues(r)).toContain('A ruleset with com "must" lists "com" in tlds.order.');
  });

  it('forbids com in the TLD order when com is none', () => {
    const r = coined();
    r.tlds = { ...r.tlds, com: 'none', order: ['com', 'io'] };
    expect(issues(r)).toContain('A ruleset with com "none" does not list "com" in tlds.order.');
  });

  it('rejects TLDs with a leading dot or uppercase letters', () => {
    const r = coined();
    r.tlds = { ...r.tlds, order: ['.io', 'COM'] };
    expect(issues(r)).toContain(
      'Use a lowercase TLD without a leading dot, e.g. "com" or "co.uk".',
    );
  });

  it('rejects malformed affixes', () => {
    const r = coined();
    r.tlds = { ...r.tlds, affixes: ['get'] };
    expect(issues(r)).toContain('Affixes look like "get-" (prefix) or "-hq" (suffix).');
  });

  it('rejects duplicate styles', () => {
    const r = coined();
    r.styles = [
      { style: 'invented', weight: 0.5 },
      { style: 'invented', weight: 0.5 },
    ];
    expect(issues(r)).toContain('Each style may appear once.');
  });

  it('rejects an id with uppercase letters', () => {
    expect(issues({ ...coined(), id: 'Coined' })).toContain(
      'Ruleset ids use 1-40 lowercase letters, digits, or inner hyphens.',
    );
  });

  it('rejects Windows reserved device names as ids', () => {
    for (const id of ['con', 'nul', 'com1', 'lpt9', 'aux', 'prn']) {
      expect(issues({ ...coined(), id }), id).not.toEqual([]);
    }
    expect(issues({ ...coined(), id: 'console' })).toEqual([]);
  });

  it('rejects all-zero score weights', () => {
    const weights = { length: 0, say: 0, spell: 0, meaning: 0, uniqueness: 0, price: 0 };
    expect(issues({ ...coined(), weights })).toContain(
      'At least one score weight must be above 0.',
    );
  });

  it('defaults countryFirst to false', () => {
    const r = coined();
    const { countryFirst: _dropped, ...tlds } = r.tlds;
    expect(RulesetSchema.parse({ ...r, tlds }).tlds.countryFirst).toBe(false);
  });
});
