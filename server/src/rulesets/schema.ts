import { z } from 'zod';
import { normalizeTld, ValidationError } from '../domain/name.js';

export const RULESET_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const RULESET_SCHEMA_VERSION = 1;

export const NAME_STYLES = [
  'descriptive',
  'compound',
  'invented',
  'metaphor',
  'misspelling',
  'affix',
  'person-name',
  'place-service',
] as const;
export type NameStyle = (typeof NAME_STYLES)[number];

export const WEIGHT_KEYS = ['length', 'say', 'spell', 'meaning', 'uniqueness', 'price'] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];

/** A string with at least one non-space character and a length cap. */
export function nonBlank(max: number): z.ZodString {
  return z.string().regex(/\S/, 'Must not be blank.').max(max);
}

export const RulesetIdSchema = z
  .string()
  .regex(RULESET_ID, 'Ruleset ids use 1-40 lowercase letters, digits, or inner hyphens.');

function isCanonicalTld(value: string): boolean {
  try {
    return normalizeTld(value) === value;
  } catch (error) {
    if (error instanceof ValidationError) return false;
    throw error;
  }
}

export const TldSchema = z
  .string()
  .refine(isCanonicalTld, 'Use a lowercase TLD without a leading dot, e.g. "com" or "co.uk".');

const weight = z.number().min(0).max(1);

export const RulesetSchema = z
  .object({
    id: RulesetIdSchema,
    name: nonBlank(60),
    description: nonBlank(400),
    examples: z.array(nonBlank(40)).min(3).max(5),
    styles: z
      .array(z.object({ style: z.enum(NAME_STYLES), weight }))
      .min(1)
      .max(NAME_STYLES.length)
      .describe('Name styles and their share of generated names (0-1 each)'),
    length: z.object({
      min: z.number().int().min(1).max(63),
      max: z.number().int().min(1).max(63),
    }),
    filters: z.object({
      hyphens: z.boolean(),
      numbers: z.boolean(),
      bannedPairs: z
        .array(z.string().regex(/^[a-z]{2}$/, 'Banned pairs are two lowercase letters.'))
        .max(50),
      bannedWords: z.array(nonBlank(40)).max(100),
    }),
    tlds: z.object({
      order: z.array(TldSchema).min(1).max(20).describe('TLDs in priority order'),
      countryFirst: z
        .boolean()
        .default(false)
        .describe("Put the ccTLD of the brief's first target country before the order"),
      com: z.enum(['must', 'nice', 'none']).describe('.com policy'),
      affixes: z
        .array(
          z
            .string()
            .regex(
              /^(?:[a-z0-9]{1,10}-|-[a-z0-9]{1,10})$/,
              'Affixes look like "get-" (prefix) or "-hq" (suffix).',
            ),
        )
        .max(20)
        .describe(
          '.com fallback affixes; the hyphen marks the position and is not part of the domain ("get-" + acme = getacme.com)',
        ),
    }),
    weights: z
      .object({
        length: weight,
        say: weight,
        spell: weight,
        meaning: weight,
        uniqueness: weight,
        price: weight,
      })
      .describe(
        'Score weights (0-1): length, ease of saying, ease of spelling, meaning fit, uniqueness, renewal price',
      ),
  })
  .superRefine((r, ctx) => {
    if (r.length.min > r.length.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['length'],
        message: 'length.min must not exceed length.max.',
      });
    }
    const styles = r.styles.map((s) => s.style);
    if (new Set(styles).size !== styles.length) {
      ctx.addIssue({ code: 'custom', path: ['styles'], message: 'Each style may appear once.' });
    }
    if (!r.styles.some((s) => s.weight > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['styles'],
        message: 'At least one style needs a weight above 0.',
      });
    }
    if (new Set(r.tlds.order).size !== r.tlds.order.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['tlds', 'order'],
        message: 'TLDs in tlds.order must be unique.',
      });
    }
    const hasCom = r.tlds.order.includes('com');
    if (r.tlds.com === 'must' && !hasCom) {
      ctx.addIssue({
        code: 'custom',
        path: ['tlds', 'order'],
        message: 'A ruleset with com "must" lists "com" in tlds.order.',
      });
    }
    if (r.tlds.com === 'none' && hasCom) {
      ctx.addIssue({
        code: 'custom',
        path: ['tlds', 'order'],
        message: 'A ruleset with com "none" does not list "com" in tlds.order.',
      });
    }
    if (!Object.values(r.weights).some((w) => w > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['weights'],
        message: 'At least one score weight must be above 0.',
      });
    }
  });

export type Ruleset = z.output<typeof RulesetSchema>;
export type RulesetInput = z.input<typeof RulesetSchema>;
export type Weights = Ruleset['weights'];
