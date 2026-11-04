import { z } from 'zod';
import { nonBlank, RulesetIdSchema, TldSchema } from '../rulesets/schema.js';

export const ARCHETYPES = [
  'sage',
  'hero',
  'creator',
  'explorer',
  'outlaw',
  'magician',
  'lover',
  'jester',
  'everyman',
  'caregiver',
  'ruler',
  'innocent',
] as const;

export const COUNTRY_CODE = /^[A-Z]{2}$/;
export const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const country = z
  .string()
  .regex(COUNTRY_CODE, 'Use an ISO 3166-1 alpha-2 country code such as "DE" or "US".');
const language = z
  .string()
  .regex(LANGUAGE_CODE, 'Use a BCP 47 language code such as "en", "de", or "pt-BR".');
const nameLength = z.number().int().min(1).max(63);

/** The brand brief: the spec's 7-section questionnaire. R fields are required, O fields optional. */
export const BriefSchema = z.object({
  subject: z.object({
    what: nonBlank(300).describe('R: What it is, in one sentence'),
    category: nonBlank(120).describe('R: Category or industry'),
    problem: nonBlank(500).describe('R: Problem it solves, and for whom'),
    features: z.array(nonBlank(120)).max(20).optional().describe('O: Key features or offer'),
    keywords: z.array(nonBlank(60)).max(30).optional().describe('O: Descriptive keywords'),
  }),
  audience: z.object({
    who: nonBlank(300).describe('R: Who buys or uses it'),
    segment: z.enum(['b2b', 'b2c', 'both']).describe('R: B2B, B2C, or both'),
    countries: z.array(country).min(1).max(30).describe('R: Target countries, ISO 3166-1 alpha-2'),
    languages: z.array(language).min(1).max(20).describe('R: Target languages, BCP 47'),
  }),
  positioning: z.object({
    competitors: z
      .array(nonBlank(200))
      .min(1)
      .max(5)
      .optional()
      .describe('O: 3-5 competitors, name or URL'),
    difference: nonBlank(500).optional().describe('O: What makes it different'),
    priceTier: z.enum(['budget', 'mid', 'premium']).describe('R: Price tier'),
  }),
  personality: z.object({
    tone: z.array(nonBlank(30)).length(3).describe('R: Exactly three words for the tone'),
    archetype: z.enum(ARCHETYPES).optional().describe('O: Brand archetype'),
    avoid: z.array(nonBlank(60)).max(20).optional().describe('O: Words or feelings to avoid'),
  }),
  nameRules: z.object({
    rulesets: z
      .array(RulesetIdSchema)
      .min(1)
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length, 'Pick each ruleset once.')
      .describe('R: 1-3 ruleset ids from ruleset_list'),
    overrides: z
      .object({
        minLength: nameLength.optional(),
        maxLength: nameLength.optional(),
        include: z.array(nonBlank(40)).max(20).optional().describe('Words to include'),
        ban: z.array(nonBlank(40)).max(50).optional().describe('Words to ban'),
        extraTlds: z.array(TldSchema).max(10).optional().describe('Extra TLDs, e.g. "app"'),
      })
      .refine(
        (o) => o.minLength === undefined || o.maxLength === undefined || o.minLength <= o.maxLength,
        'minLength must not exceed maxLength.',
      )
      .optional()
      .describe('O: Per-project overrides on top of the rulesets'),
    handles: z
      .array(nonBlank(30))
      .max(12)
      .optional()
      .describe(
        'O: Social handles that matter, lowercase platform ids such as "github", "x", "instagram"',
      ),
  }),
  future: z
    .object({ scope: z.enum(['broad', 'narrow']) })
    .optional()
    .describe('O: broad if the brand will grow past this product, narrow if not'),
  mode: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('startup') }),
      z.object({ type: z.literal('product') }),
      z.object({
        type: z.literal('personal'),
        fullName: nonBlank(120),
        profession: nonBlank(120),
        nameForms: z.array(nonBlank(80)).min(1).max(10).describe('Accepted name forms'),
      }),
    ])
    .describe('R: startup, personal brand, or product'),
});

export type Brief = z.output<typeof BriefSchema>;
