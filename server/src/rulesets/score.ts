import { WEIGHT_KEYS, type WeightKey, type Weights } from './schema.js';

/** Per-criterion ratings from 0 (poor) to 10 (excellent). */
export type ScoreParts = Partial<Record<WeightKey, number>>;

export const EQUAL_WEIGHTS: Weights = {
  length: 1,
  say: 1,
  spell: 1,
  meaning: 1,
  uniqueness: 1,
  price: 1,
};

/**
 * Weighted mean of the rated parts, scaled to 0-100 with one decimal.
 * Parts that are missing or carry weight 0 are left out of the mean.
 */
export function computeScore(parts: ScoreParts, weights: Weights): number | null {
  let sum = 0;
  let total = 0;
  for (const key of WEIGHT_KEYS) {
    const part = parts[key];
    const weight = weights[key];
    if (part === undefined || weight === 0) continue;
    sum += part * weight;
    total += weight;
  }
  if (total === 0) return null;
  return Math.round((sum / total) * 100) / 10;
}
