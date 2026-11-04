import { describe, expect, it } from 'vitest';
import type { Weights } from '../../src/rulesets/schema.js';
import { computeScore, EQUAL_WEIGHTS } from '../../src/rulesets/score.js';

const weights: Weights = { length: 0.5, say: 1, spell: 0, meaning: 1, uniqueness: 1, price: 1 };

describe('computeScore', () => {
  it('returns the weighted mean of the given parts on a 0-100 scale', () => {
    // (8 * 0.5 + 6 * 1) / 1.5 = 6.667 -> 66.7; spell has weight 0 and is ignored.
    expect(computeScore({ length: 8, say: 6, spell: 4 }, weights)).toBe(66.7);
  });

  it('leaves missing parts out of the mean', () => {
    expect(computeScore({ length: 10, say: 5 }, EQUAL_WEIGHTS)).toBe(75);
  });

  it('returns null when no weighted part is present', () => {
    expect(computeScore({}, EQUAL_WEIGHTS)).toBeNull();
    expect(computeScore({ spell: 9 }, weights)).toBeNull();
  });

  it('gives 100 for perfect parts', () => {
    expect(computeScore({ length: 10, say: 10, meaning: 10 }, weights)).toBe(100);
  });
});
