import { z } from 'zod';

export const REGISTRARS = ['spaceship', 'namecheap', 'cloudflare'] as const;
export const RegistrarIdSchema = z.enum(REGISTRARS);
export type RegistrarId = z.infer<typeof RegistrarIdSchema>;

export const REGISTRAR_NAMES: Record<RegistrarId, string> = {
  spaceship: 'Spaceship',
  namecheap: 'Namecheap',
  cloudflare: 'Cloudflare',
};

/** Source value for a row whose price nobody has verified yet. */
export const UNVERIFIED = 'unverified';

const TLD = z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/, 'lowercase TLD without a leading dot');
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date as YYYY-MM-DD');
const PRICE = z.number().nonnegative().nullable();

export const PriceRowSchema = z
  .strictObject({
    registrar: RegistrarIdSchema,
    tld: TLD,
    firstYear: PRICE,
    renewal: PRICE,
    transfer: PRICE,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'ISO 4217 code')
      .nullable(),
    source: z.string().min(1),
    checkedAt: ISO_DATE,
  })
  .superRefine((row, ctx) => {
    const hasPrice = row.firstYear !== null || row.renewal !== null || row.transfer !== null;
    if (row.source === UNVERIFIED && hasPrice) {
      ctx.addIssue({
        code: 'custom',
        message: `${row.registrar} .${row.tld}: unverified row has a price`,
      });
    }
    if (hasPrice && row.currency === null) {
      ctx.addIssue({
        code: 'custom',
        message: `${row.registrar} .${row.tld}: price without currency`,
      });
    }
  });
export type PriceRow = z.infer<typeof PriceRowSchema>;

export const RegistrarMetaSchema = z
  .strictObject({
    // full: the rows come from the registrar's complete list; a missing TLD is "not listed by
    // that source", which is not proof that the registrar does not sell it.
    // partial: a missing TLD means the table has no data for it.
    coverage: z.enum(['full', 'partial']),
    // TLDs a source explicitly confirmed this registrar does not sell.
    notSold: z.array(TLD),
    // TLDs missing from a source's list, with that source and the date. Inferred, not confirmed.
    notListed: z
      .array(z.strictObject({ tld: TLD, source: z.string().min(1), checkedAt: ISO_DATE }))
      .default([]),
    // The source and date of the complete list behind a full coverage.
    fullList: z.strictObject({ source: z.string().min(1), checkedAt: ISO_DATE }).optional(),
    note: z.string().min(1),
  })
  .superRefine((meta, ctx) => {
    if (meta.coverage === 'full' && !meta.fullList) {
      ctx.addIssue({ code: 'custom', message: 'full coverage needs fullList' });
    }
  });
export type RegistrarMeta = z.infer<typeof RegistrarMetaSchema>;

export const RegistrarTableSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    registrars: z.strictObject({
      spaceship: RegistrarMetaSchema,
      namecheap: RegistrarMetaSchema,
      cloudflare: RegistrarMetaSchema,
    }),
    rows: z.array(PriceRowSchema),
  })
  .superRefine((table, ctx) => {
    const seen = new Set<string>();
    for (const row of table.rows) {
      const key = `${row.registrar}:${row.tld}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `duplicate row ${key}` });
      seen.add(key);
    }
  });
export type RegistrarTable = z.infer<typeof RegistrarTableSchema>;

export const ReputationSchema = z.enum(['good', 'mixed', 'poor']);
export type Reputation = z.infer<typeof ReputationSchema>;

export const ReputationRowSchema = z.strictObject({
  tld: TLD,
  reputation: ReputationSchema,
  reputationNote: z.string().min(1),
  source: z.string().min(1),
  checkedAt: ISO_DATE,
});
export type ReputationRow = z.infer<typeof ReputationRowSchema>;

export const ReputationTableSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    rows: z.array(ReputationRowSchema),
  })
  .superRefine((table, ctx) => {
    const seen = new Set<string>();
    for (const row of table.rows) {
      if (seen.has(row.tld)) ctx.addIssue({ code: 'custom', message: `duplicate TLD ${row.tld}` });
      seen.add(row.tld);
    }
  });
export type ReputationTable = z.infer<typeof ReputationTableSchema>;
