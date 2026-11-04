import { z } from 'zod';
import type { DomainCheck } from '../domain/types.js';
import { NAME_STYLES, nonBlank, RulesetIdSchema } from '../rulesets/schema.js';
import { BriefSchema, LANGUAGE_CODE } from './brief.js';
import { NewerVersionError, StoreError, zodMessage } from './errors.js';

export const PROJECT_SCHEMA_VERSION = 1;
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
/** Ruleset id recorded for names the user supplied instead of generated ones. */
export const USER_RULESET = 'user';

export const CHECK_KINDS = ['domain', 'profile', 'handle', 'trademark', 'competitor'] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

// Matches the risk levels the language-check skill (Plan 3) assigns.
export const NOTE_SEVERITIES = ['low', 'medium', 'high'] as const;
export type NoteSeverity = (typeof NOTE_SEVERITIES)[number];

const iso = z.iso.datetime({ offset: true });
const confidence = z.enum(['high', 'medium', 'low']);
const part = z.number().min(0).max(10);

export const DomainCheckSchema = z.object({
  domain: z.string().min(1).max(253),
  status: z.enum(['registered', 'likely_available', 'unknown']),
  source: z.enum(['rdap', 'whois', 'dns', 'none']),
  confidence,
  checkedAt: iso,
  reason: z.string().max(500).optional(),
}) satisfies z.ZodType<DomainCheck>;

/**
 * Open payload for profile_domain, check_handles, search_trademarks, and competitor findings.
 * Any object is accepted and kept as is; the common fields are validated only when present.
 */
export const ResearchResultSchema = z.looseObject({
  source: z.string().min(1).max(60).optional(),
  checkedAt: iso.optional(),
  confidence: confidence.optional(),
});
export type ResearchResult = z.output<typeof ResearchResultSchema>;

export const ScorePartsSchema = z.object({
  length: part.optional(),
  say: part.optional(),
  spell: part.optional(),
  meaning: part.optional(),
  uniqueness: part.optional(),
  price: part.optional(),
});

export const NoteSchema = z.object({
  kind: nonBlank(40),
  text: nonBlank(2000),
  language: z.string().regex(LANGUAGE_CODE).optional(),
  severity: z.enum(NOTE_SEVERITIES),
  createdAt: iso,
});
export type Note = z.output<typeof NoteSchema>;

export const NameEntrySchema = z.object({
  name: nonBlank(63),
  label: z.string().min(1).max(63),
  rulesetId: RulesetIdSchema,
  briefVersion: z.number().int().min(1),
  strategy: z.enum(NAME_STYLES).optional(),
  rationale: nonBlank(500).optional(),
  scoreParts: ScorePartsSchema,
  score: z.number().min(0).max(100).nullable(),
  notes: z.array(NoteSchema),
  addedAt: iso,
});
export type NameEntry = z.output<typeof NameEntrySchema>;

export const NameChecksSchema = z.object({
  domains: z.array(DomainCheckSchema),
  profiles: z.array(ResearchResultSchema),
  handles: z.array(ResearchResultSchema),
  trademarks: z.array(ResearchResultSchema),
  competitors: z.array(ResearchResultSchema),
});
export type NameChecks = z.output<typeof NameChecksSchema>;

export const BriefRecordSchema = z.object({
  version: z.number().int().min(1),
  createdAt: iso,
  data: BriefSchema,
});
export type BriefRecord = z.output<typeof BriefRecordSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  slug: z.string().regex(SLUG),
  title: nonBlank(80),
  createdAt: iso,
  updatedAt: iso,
  brief: BriefRecordSchema,
  briefHistory: z.array(BriefRecordSchema),
  names: z.array(NameEntrySchema),
  checks: z.record(z.string(), NameChecksSchema),
  shortlist: z.array(z.string()),
});
export type Project = z.output<typeof ProjectSchema>;

/** Validates a parsed project.json, checking schemaVersion first for a clear upgrade message. */
export function parseProject(raw: unknown): Project {
  const version =
    typeof raw === 'object' && raw !== null
      ? (raw as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (typeof version === 'number' && version > PROJECT_SCHEMA_VERSION) {
    const slug =
      typeof (raw as { slug?: unknown }).slug === 'string'
        ? `Project "${(raw as { slug: string }).slug}"`
        : 'This project';
    throw new NewerVersionError(
      `${slug} was written by a newer engine (schemaVersion ${version}); upgrade the plugin.`,
    );
  }
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new StoreError(
      `schemaVersion is ${String(version)}; this engine reads schemaVersion ${PROJECT_SCHEMA_VERSION}.`,
    );
  }
  const parsed = ProjectSchema.safeParse(raw);
  if (!parsed.success) throw new StoreError(`not a valid project: ${zodMessage(parsed.error)}`);
  return parsed.data;
}
