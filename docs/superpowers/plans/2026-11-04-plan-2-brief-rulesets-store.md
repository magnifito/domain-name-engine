# Plan 2 — Brief, Rulesets, and Project Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the brand brief schema, the 9 built-in naming rulesets plus custom rulesets, a versioned JSON project store with backups, the 12 MCP tools that expose them, and the `brief`, `generate`, and `find-domain` skills.

**Architecture:** Two Plan 2 folders hold the data logic: `server/src/rulesets/` (schema, bundled built-ins, custom ruleset files, scoring) and `server/src/store/` (brief schema, project schema, backup-aware JSON files, `ProjectStore`). `store/runtime-part.ts` exposes both stores as `StoreRuntime`, which `runtime.ts` mixes into `Runtime` with one `extends` entry and one spread line. One file per MCP tool lives in `server/src/tools/`, and `tools/register-plan2.ts` registers all of them with one call from `server.ts`. Skills are Markdown that call the tools by name.

**Tech Stack:** Node 20+, TypeScript 7.0.2, `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7, Vitest 5.1.0, Biome 2.6.4, pnpm 11.27.0. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-domain-name-engine-design.md` (sections Brief, Rulesets, Store and cache, Skills and flow, Honesty rules).

**Coordination:** `docs/superpowers/plans/2026-11-04-plans-2-4-coordination.md` is binding. Work on branch `feat/plan-2-brief-store` in its own worktree off `main`.

**Plan series:** Plan 1 (merged) built `check_domains`. Plan 2 is this plan. Plan 3 builds `profile_domain`, `check_handles`, `search_trademarks`, and the `research`/`language-check` skills. Plan 4 builds registrars, the TLD table, the `report` skill, the README, and the release. Plans 2–4 are built in parallel.

## Global Constraints

Copied from the coordination doc ("Global constraints (all plans)"):

- Node 20+, TypeScript strict, ESM with `.js` relative imports.
- Biome for lint and format (`pnpm check`, `pnpm format` in `server/`). Never use ESLint or Prettier, and never run bare `pnpm lint`.
- Write all code comments in English.
- Vitest. Unit tests use fakes, with no network access. Live tests go under `server/test/live/` and are gated by `LIVE=1`.
- Honesty rules from the spec: never claim "available" without a tool result; label every price with its source and date; never mix currencies.
- API keys come from env vars only. Never print, log or store them.
- Never scrape pages that block bots. Use only official APIs or documented open endpoints.
- Per-host rate limit through the shared `HostLimiter`. Cache through the shared `DiskCache`, with the TTLs the spec gives.

Plan 2 specifics from the coordination doc and the spec:

- Create or modify only Plan 2's owned paths: `server/src/store/**`, `server/src/rulesets/**`, `server/data/rulesets/**`, `server/src/tools/project-*.ts`, `server/src/tools/ruleset-*.ts`, `server/src/tools/register-plan2.ts`, `server/test/store/**`, `server/test/rulesets/**`, `server/test/tools/project-*.test.ts`, `server/test/tools/ruleset-*.test.ts`, `skills/brief/**`, `skills/generate/**`, `skills/find-domain/**`.
- Shared-file edits allowed, and nothing more:
  - `server/src/server.ts`: ONE import line and ONE call line `registerPlan2Tools(server, rt);` directly after `registerCheckDomains(server, rt);`.
  - `server/src/runtime.ts`: ONE `extends StoreRuntime` entry on `Runtime`, ONE spread line `...createStoreRuntime(paths, { http, limiter, cache }),`, plus the one import line those need.
  - `server/test/tools/check-domains.test.ts`: ONE added line `...({} as Runtime),` in `fakeRuntime()` (Task 6 explains why; this is the coordination doc's own fake-runtime rule applied to the Plan 1 test).
- Do not edit `server/src/config.ts`. Derive paths from `enginePaths(home)`.
- Do NOT run `pnpm build` and commit `server/dist/`. Task 10 builds once to smoke-test and then restores `server/dist/` with `git restore`.
- Do not import from Plan 3 or Plan 4 folders. Shared Plan 1 code only: `server/src/{config,cache,http,limiter,fs,util,domain,sources}/**`.
- Store files carry `schemaVersion: 1` (project files and custom ruleset files). This is the Plan 1 leftover assigned to Plan 2.
- Project file: `~/.domain-engine/projects/<slug>/project.json`; report file path `~/.domain-engine/projects/<slug>/report.md`. Writes are atomic and keep `project.json.bak` from the previous write. On a parse failure the store reads the backup and reports it.
- Custom rulesets: `~/.domain-engine/rulesets/<id>.json`. Custom ids cannot shadow built-in ids.
- Every Plan 2 tool declares MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`).
- Skills: no emoji, no urgency copy. Say "likely available" only after `check_domains` returns `likely_available`.

## Cross-plan contract (what Plans 3 and 4 can rely on)

These shapes are produced here and consumed by other plans' skills through MCP tool names only:

- `project_get({ slug })` returns `{ project, paths: { dir, projectFile, reportFile }, recoveredFromBackup, warning? }`. `project` has `schemaVersion`, `slug`, `title`, `createdAt`, `updatedAt`, `brief: { version, createdAt, data: Brief }`, `briefHistory[]`, `names[]` (`name`, `label`, `rulesetId`, `briefVersion`, `strategy?`, `rationale?`, `scoreParts`, `score`, `notes[]`, `addedAt`), `checks` keyed by label (`domains[]`, `profiles[]`, `handles[]`, `trademarks[]`, `competitors[]`), and `shortlist` (labels). `project_list({})` returns `{ projects: [{ slug, title, createdAt, updatedAt, briefVersion, rulesets, names, shortlist }], invalid }`, so a skill can match the user's project by slug or title, then read names and brief with `project_get`. The `report` skill (Plan 4) writes `paths.reportFile`.
- `project_add_checks({ slug, checks: [{ name, kind, results }] })` with `kind` one of `domain`, `profile`, `handle`, `trademark`, `competitor`. `domain` results are exactly `check_domains` result objects. The other kinds are open JSON payloads: any object is stored as given (raw `profile_domain`, `check_handles`, `search_trademarks` results; competitor findings with `source: "websearch"`, `checkedAt`, and `url`). `source`, `checkedAt` (ISO 8601), and `confidence` (`high` | `medium` | `low`) are validated only when present. Merge rule: `domain` and `profile` results replace earlier ones with the same `domain`; `handle` results replace earlier ones with the same `platform`; a new `trademark` or `competitor` batch replaces the previous batch of that kind.
- `project_add_notes({ slug, notes: [{ name, text, kind?, language?, severity? }] })`. The `language-check` skill (Plan 3) uses `kind: "language"`, `language` as a BCP 47 code (`en`, `de`, `pt-BR`), and `severity` as the risk level `low` | `medium` | `high` (default `low`).
- Brief fields other skills read: `audience.languages` (BCP 47 codes), `audience.countries` (ISO 3166-1 alpha-2, uppercase), `nameRules.handles` (lowercase platform ids such as `github`, `npm`, `pypi`, `reddit`, `x`, `instagram`, `tiktok`, `youtube`, `linkedin`), `nameRules.overrides.extraTlds`.
- `find-domain` invokes the skills `brief`, `generate`, `research`, `language-check`, and `report` by name.

## File Structure

```
server/
  data/rulesets/                       # built-in rulesets, one JSON file each, bundled at build time
    coined.json descriptive.json compound.json evocative.json premium.json
    dev-tool.json personal.json local-business.json budget.json
  src/
    rulesets/
      schema.ts                        # RulesetSchema, ids, styles, weight keys, nonBlank(), TldSchema
      builtin.ts                       # BUILTIN_RULESETS, BUILTIN_IDS (JSON imports, validated at load)
      score.ts                         # computeScore(), EQUAL_WEIGHTS
      store.ts                         # RulesetStore: list/get/save/delete custom rulesets
    store/
      errors.ts                        # StoreError, zodMessage()
      fs-utils.ts                      # isNotFound(), isExists(), fileExists()
      brief.ts                         # BriefSchema (7 questionnaire sections)
      json-file.ts                     # readJsonWithBackup(), writeJsonWithBackup()
      project-schema.ts                # ProjectSchema (schemaVersion 1), NameEntry, checks, notes
      names.ts                         # slugify(), nameLabel()
      project-store.ts                 # ProjectStore
      runtime-part.ts                  # StoreRuntime, createStoreRuntime()
    tools/
      project-common.ts                # runStoreTool(), recoveryWarning(), annotations, assertRulesetsExist()
      ruleset-list.ts ruleset-get.ts ruleset-save.ts ruleset-delete.ts
      project-create.ts project-list.ts project-get.ts project-add-names.ts
      project-add-checks.ts project-add-notes.ts project-shortlist.ts project-update-brief.ts
      register-plan2.ts                # registerPlan2Tools()
    runtime.ts                         # MODIFY: extends StoreRuntime + one spread line
    server.ts                          # MODIFY: one import + one call
  test/
    rulesets/schema.test.ts score.test.ts store.test.ts
    store/brief.test.ts json-file.test.ts project-schema.test.ts names.test.ts
    store/project-store.test.ts runtime-part.test.ts
    store/brief-fixture.ts             # loadBrief() helper (not a test file)
    store/fixtures/brief-example.json
    tools/ruleset-tools.test.ts project-tools.test.ts
    tools/check-domains.test.ts        # MODIFY: one line, see Task 6
skills/
  brief/SKILL.md
  brief/templates/brief.md
  generate/SKILL.md
  generate/references/tlds.md
  find-domain/SKILL.md
```

Design notes:

- Built-in rulesets are imported as JSON (`with { type: 'json' }`) so tsdown bundles them into `dist/index.js`. Plugin users get one file, as Plan 1 requires.
- A name's identity is its domain label (`label`): `"Blue Fern"` becomes `bluefern`. `checks` and `shortlist` are keyed by label, and every tool accepts either the display name or the label.
- `project_add_names` takes per-criterion score parts (0–10). The server computes `score` (0–100) with the ruleset's `weights`, so scores stay consistent across skills.
- The spec says "Editing the brief creates a new version" but its tool table has no tool for it. This plan adds `project_update_brief` (a Plan 2-owned `project-*.ts` file). The brief history is kept in `briefHistory`.

---

### Task 1: Ruleset schema, the 9 built-in rulesets, and scoring

**Files:**
- Create: `server/src/rulesets/schema.ts`, `server/src/rulesets/builtin.ts`, `server/src/rulesets/score.ts`
- Create: `server/data/rulesets/{coined,descriptive,compound,evocative,premium,dev-tool,personal,local-business,budget}.json`
- Test: `server/test/rulesets/schema.test.ts`, `server/test/rulesets/score.test.ts`

**Interfaces:**
- Consumes: `normalizeTld(input: string): string` and `class ValidationError` from `server/src/domain/name.ts` (Plan 1).
- Produces:
  - `RULESET_ID: RegExp`; `RulesetIdSchema: z.ZodString`; `nonBlank(max: number): z.ZodString`; `TldSchema` (lowercase TLD without a dot, e.g. `"com"`, `"co.uk"`).
  - `NAME_STYLES = ['descriptive','compound','invented','metaphor','misspelling','affix','person-name','place-service'] as const`; `type NameStyle`.
  - `WEIGHT_KEYS = ['length','say','spell','meaning','uniqueness','price'] as const`; `type WeightKey`.
  - `RulesetSchema`; `type Ruleset = z.output<typeof RulesetSchema>`; `type RulesetInput = z.input<typeof RulesetSchema>`; `type Weights = Ruleset['weights']`.
  - `RULESET_SCHEMA_VERSION = 1`.
  - `BUILTIN_RULESETS: readonly Ruleset[]`; `BUILTIN_IDS: ReadonlySet<string>`.
  - `type ScoreParts = Partial<Record<WeightKey, number>>`; `EQUAL_WEIGHTS: Weights`; `computeScore(parts: ScoreParts, weights: Weights): number | null` (0–100, one decimal; `null` when no weighted part is present).

- [ ] **Step 1: Write the failing tests**

`server/test/rulesets/schema.test.ts`:
```ts
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
    expect(issues(r)).toContain('Use a lowercase TLD without a leading dot, e.g. "com" or "co.uk".');
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

  it('rejects all-zero score weights', () => {
    const weights = { length: 0, say: 0, spell: 0, meaning: 0, uniqueness: 0, price: 0 };
    expect(issues({ ...coined(), weights })).toContain('At least one score weight must be above 0.');
  });

  it('defaults countryFirst to false', () => {
    const r = coined();
    const { countryFirst: _dropped, ...tlds } = r.tlds;
    expect(RulesetSchema.parse({ ...r, tlds }).tlds.countryFirst).toBe(false);
  });
});
```

`server/test/rulesets/score.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test test/rulesets`
Expected: FAIL with "Failed to load url ../../src/rulesets/builtin.js" (module does not exist).

- [ ] **Step 3: Write the schema**

`server/src/rulesets/schema.ts`:
```ts
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
      .describe('Score weights (0-1): length, ease of saying, ease of spelling, meaning fit, uniqueness, renewal price'),
  })
  .superRefine((r, ctx) => {
    if (r.length.min > r.length.max) {
      ctx.addIssue({ code: 'custom', path: ['length'], message: 'length.min must not exceed length.max.' });
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
      ctx.addIssue({ code: 'custom', path: ['tlds', 'order'], message: 'TLDs in tlds.order must be unique.' });
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
```

- [ ] **Step 4: Write the 9 built-in ruleset files**

`server/data/rulesets/coined.json`:
```json
{
  "id": "coined",
  "name": "Coined word",
  "description": "An invented word with no fixed meaning, 4-8 letters, easy to say and spell. Alternative TLDs are fine.",
  "examples": ["Kodak", "Zalando", "Vimeo", "Hulu"],
  "styles": [
    { "style": "invented", "weight": 0.8 },
    { "style": "misspelling", "weight": 0.2 }
  ],
  "length": { "min": 4, "max": 8 },
  "filters": {
    "hyphens": false,
    "numbers": false,
    "bannedPairs": ["qx", "xq", "jq", "qj", "vq", "wq", "zx", "xz"],
    "bannedWords": []
  },
  "tlds": {
    "order": ["com", "io", "co", "app", "xyz"],
    "countryFirst": false,
    "com": "nice",
    "affixes": ["get-", "try-"]
  },
  "weights": { "length": 0.8, "say": 1, "spell": 0.8, "meaning": 0.3, "uniqueness": 1, "price": 0.4 }
}
```

`server/data/rulesets/descriptive.json`:
```json
{
  "id": "descriptive",
  "name": "Descriptive",
  "description": "Says what the product does, 8-15 letters. Wants .com; falls back to an affix such as get- or -app when the exact .com is taken.",
  "examples": ["Booking", "Hotels", "SiteBuilder", "PhotoPrint"],
  "styles": [
    { "style": "descriptive", "weight": 0.7 },
    { "style": "compound", "weight": 0.2 },
    { "style": "affix", "weight": 0.1 }
  ],
  "length": { "min": 8, "max": 15 },
  "filters": { "hyphens": false, "numbers": false, "bannedPairs": [], "bannedWords": [] },
  "tlds": {
    "order": ["com", "co", "net"],
    "countryFirst": false,
    "com": "must",
    "affixes": ["get-", "try-", "use-", "-app", "-hq"]
  },
  "weights": { "length": 0.4, "say": 0.8, "spell": 1, "meaning": 1, "uniqueness": 0.5, "price": 0.4 }
}
```

`server/data/rulesets/compound.json`:
```json
{
  "id": "compound",
  "name": "Compound",
  "description": "Two real words joined into one, 6-12 letters.",
  "examples": ["Facebook", "Snapchat", "Dropbox", "Mailchimp"],
  "styles": [{ "style": "compound", "weight": 1 }],
  "length": { "min": 6, "max": 12 },
  "filters": { "hyphens": false, "numbers": false, "bannedPairs": [], "bannedWords": [] },
  "tlds": {
    "order": ["com", "io", "co", "app"],
    "countryFirst": false,
    "com": "nice",
    "affixes": ["get-", "-hq"]
  },
  "weights": { "length": 0.6, "say": 1, "spell": 1, "meaning": 0.8, "uniqueness": 0.7, "price": 0.4 }
}
```

`server/data/rulesets/evocative.json`:
```json
{
  "id": "evocative",
  "name": "Evocative",
  "description": "One real word that carries meaning by association, not description. .com is nice to have.",
  "examples": ["Amazon", "Apple", "Oracle", "Slack"],
  "styles": [
    { "style": "metaphor", "weight": 0.9 },
    { "style": "misspelling", "weight": 0.1 }
  ],
  "length": { "min": 4, "max": 10 },
  "filters": { "hyphens": false, "numbers": false, "bannedPairs": [], "bannedWords": [] },
  "tlds": {
    "order": ["com", "co", "io", "ai"],
    "countryFirst": false,
    "com": "nice",
    "affixes": ["get-", "try-", "-hq", "-app"]
  },
  "weights": { "length": 0.6, "say": 0.9, "spell": 0.8, "meaning": 1, "uniqueness": 0.8, "price": 0.3 }
}
```

`server/data/rulesets/premium.json`:
```json
{
  "id": "premium",
  "name": "Premium",
  "description": "Short and easy to say, built on Latin or Greek roots. Requires the exact .com.",
  "examples": ["Nova", "Aeris", "Lumen", "Veritas"],
  "styles": [
    { "style": "invented", "weight": 0.6 },
    { "style": "metaphor", "weight": 0.4 }
  ],
  "length": { "min": 4, "max": 8 },
  "filters": {
    "hyphens": false,
    "numbers": false,
    "bannedPairs": ["qx", "xq", "jq", "qj", "vq", "wq", "zx", "xz"],
    "bannedWords": []
  },
  "tlds": { "order": ["com"], "countryFirst": false, "com": "must", "affixes": [] },
  "weights": { "length": 1, "say": 1, "spell": 1, "meaning": 0.6, "uniqueness": 0.7, "price": 0.2 }
}
```

`server/data/rulesets/dev-tool.json`:
```json
{
  "id": "dev-tool",
  "name": "Developer tool",
  "description": "Lowercase, short, and easy to type in a terminal. Developer TLDs first: .dev, .sh, .io.",
  "examples": ["vite", "deno", "bun", "turso"],
  "styles": [
    { "style": "compound", "weight": 0.4 },
    { "style": "invented", "weight": 0.3 },
    { "style": "descriptive", "weight": 0.3 }
  ],
  "length": { "min": 3, "max": 10 },
  "filters": { "hyphens": false, "numbers": false, "bannedPairs": [], "bannedWords": [] },
  "tlds": {
    "order": ["dev", "sh", "io", "com"],
    "countryFirst": false,
    "com": "nice",
    "affixes": ["get-", "use-", "-hq"]
  },
  "weights": { "length": 1, "say": 0.7, "spell": 1, "meaning": 0.5, "uniqueness": 0.8, "price": 0.3 }
}
```

`server/data/rulesets/personal.json`:
```json
{
  "id": "personal",
  "name": "Personal brand",
  "description": "Forms of the person's name: first name, first plus last, or initials plus role.",
  "examples": ["JaneDoe", "JDoe", "JaneDoeDesign", "JDStudio"],
  "styles": [{ "style": "person-name", "weight": 1 }],
  "length": { "min": 4, "max": 20 },
  "filters": { "hyphens": true, "numbers": false, "bannedPairs": [], "bannedWords": [] },
  "tlds": {
    "order": ["com", "me", "io", "name"],
    "countryFirst": false,
    "com": "nice",
    "affixes": ["by-", "-studio", "-design", "-dev"]
  },
  "weights": { "length": 0.6, "say": 0.8, "spell": 1, "meaning": 1, "uniqueness": 0.3, "price": 0.4 }
}
```

`server/data/rulesets/local-business.json`:
```json
{
  "id": "local-business",
  "name": "Local business",
  "description": "Place plus service, so local customers know what and where. The target country's TLD comes first.",
  "examples": ["BerlinPlumbing", "LondonDental", "AustinMovers"],
  "styles": [
    { "style": "place-service", "weight": 0.8 },
    { "style": "descriptive", "weight": 0.2 }
  ],
  "length": { "min": 6, "max": 20 },
  "filters": { "hyphens": true, "numbers": false, "bannedPairs": [], "bannedWords": [] },
  "tlds": {
    "order": ["com", "net"],
    "countryFirst": true,
    "com": "nice",
    "affixes": ["-pro", "-co"]
  },
  "weights": { "length": 0.5, "say": 0.8, "spell": 1, "meaning": 1, "uniqueness": 0.4, "price": 0.5 }
}
```

`server/data/rulesets/budget.json`:
```json
{
  "id": "budget",
  "name": "Budget",
  "description": "Any style, 4-15 letters, on low-cost TLDs. Scores low renewal price strongly; check the renewal price and TLD reputation before buying.",
  "examples": ["Snapfern", "Bookly", "Pixelnest", "Tidy"],
  "styles": [
    { "style": "descriptive", "weight": 0.2 },
    { "style": "compound", "weight": 0.2 },
    { "style": "invented", "weight": 0.2 },
    { "style": "metaphor", "weight": 0.2 },
    { "style": "affix", "weight": 0.2 }
  ],
  "length": { "min": 4, "max": 15 },
  "filters": { "hyphens": false, "numbers": false, "bannedPairs": [], "bannedWords": [] },
  "tlds": {
    "order": ["sbs", "site", "online", "store", "space", "lol", "bond", "xyz"],
    "countryFirst": false,
    "com": "none",
    "affixes": []
  },
  "weights": { "length": 0.5, "say": 0.5, "spell": 0.5, "meaning": 0.5, "uniqueness": 0.5, "price": 1 }
}
```

- [ ] **Step 5: Write the built-in loader and the scorer**

`server/src/rulesets/builtin.ts`:
```ts
import budget from '../../data/rulesets/budget.json' with { type: 'json' };
import coined from '../../data/rulesets/coined.json' with { type: 'json' };
import compound from '../../data/rulesets/compound.json' with { type: 'json' };
import descriptive from '../../data/rulesets/descriptive.json' with { type: 'json' };
import devTool from '../../data/rulesets/dev-tool.json' with { type: 'json' };
import evocative from '../../data/rulesets/evocative.json' with { type: 'json' };
import localBusiness from '../../data/rulesets/local-business.json' with { type: 'json' };
import personal from '../../data/rulesets/personal.json' with { type: 'json' };
import premium from '../../data/rulesets/premium.json' with { type: 'json' };
import { type Ruleset, RulesetSchema } from './schema.js';

// JSON imports are bundled into dist/index.js, so plugin users need no data files at runtime.
const RAW: readonly unknown[] = [
  coined,
  descriptive,
  compound,
  evocative,
  premium,
  devTool,
  personal,
  localBusiness,
  budget,
];

/** Read-only built-in rulesets, validated once at load. */
export const BUILTIN_RULESETS: readonly Ruleset[] = RAW.map((raw) => RulesetSchema.parse(raw));

export const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_RULESETS.map((r) => r.id));
```

`server/src/rulesets/score.ts`:
```ts
import { type WeightKey, WEIGHT_KEYS, type Weights } from './schema.js';

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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && pnpm test test/rulesets`
Expected: PASS (`schema.test.ts` and `score.test.ts`).

- [ ] **Step 7: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/rulesets server/data/rulesets server/test/rulesets
git commit -m "feat(rulesets): add ruleset schema, 9 built-in rulesets, and scoring"
```

---

### Task 2: Custom ruleset store

**Files:**
- Create: `server/src/store/errors.ts`, `server/src/store/fs-utils.ts`, `server/src/rulesets/store.ts`
- Test: `server/test/rulesets/store.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic(path, data)` from `server/src/fs/atomic.ts`; `BUILTIN_RULESETS`, `BUILTIN_IDS`, `RulesetSchema`, `RULESET_ID`, `RULESET_SCHEMA_VERSION`, `type Ruleset` from Task 1.
- Produces:
  - `class StoreError extends Error` (message is safe to show the user); `zodMessage(error: z.ZodError): string`.
  - `isNotFound(error: unknown): boolean`; `isExists(error: unknown): boolean`; `fileExists(path: string): Promise<boolean>`.
  - `interface RulesetSummary { id: string; name: string; description: string; examples: string[]; builtin: boolean }`.
  - `interface RulesetListing { rulesets: RulesetSummary[]; invalid: Array<{ file: string; error: string }> }`.
  - `class RulesetStore { constructor(dir: string); list(): Promise<RulesetListing>; get(id: string): Promise<{ ruleset: Ruleset; builtin: boolean }>; save(input: unknown): Promise<{ ruleset: Ruleset; created: boolean }>; delete(id: string): Promise<void> }`. All expected failures throw `StoreError`.
  - Custom file format: `<dir>/<id>.json` = `{ "schemaVersion": 1, ...ruleset }`.

- [ ] **Step 1: Write the failing test**

`server/test/rulesets/store.test.ts`:
```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_RULESETS } from '../../src/rulesets/builtin.js';
import type { RulesetInput } from '../../src/rulesets/schema.js';
import { RulesetStore } from '../../src/rulesets/store.js';
import { StoreError } from '../../src/store/errors.js';

async function setup(): Promise<{ store: RulesetStore; dir: string }> {
  const dir = join(await mkdtemp(join(tmpdir(), 'dne-rulesets-')), 'rulesets');
  return { store: new RulesetStore(dir), dir };
}

function custom(id = 'my-coined'): RulesetInput {
  const base = BUILTIN_RULESETS.find((r) => r.id === 'coined');
  if (!base) throw new Error('coined missing');
  return { ...structuredClone(base), id, name: 'My coined' };
}

describe('RulesetStore', () => {
  it('lists the nine built-ins when no custom folder exists', async () => {
    const { store } = await setup();
    const listing = await store.list();
    expect(listing.rulesets).toHaveLength(9);
    expect(listing.rulesets.every((r) => r.builtin)).toBe(true);
    expect(listing.invalid).toEqual([]);
  });

  it('saves a custom ruleset with schemaVersion 1', async () => {
    const { store, dir } = await setup();
    const first = await store.save(custom());
    expect(first.created).toBe(true);
    const onDisk = JSON.parse(await readFile(join(dir, 'my-coined.json'), 'utf8'));
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.id).toBe('my-coined');
    const second = await store.save({ ...custom(), description: 'Changed.' });
    expect(second.created).toBe(false);
    expect((await store.get('my-coined')).ruleset.description).toBe('Changed.');
  });

  it('lists custom rulesets after the built-ins', async () => {
    const { store } = await setup();
    await store.save(custom());
    const listing = await store.list();
    expect(listing.rulesets.at(-1)).toMatchObject({ id: 'my-coined', builtin: false });
  });

  it('reads built-in and custom rulesets', async () => {
    const { store } = await setup();
    await store.save(custom());
    expect(await store.get('premium')).toMatchObject({ builtin: true, ruleset: { id: 'premium' } });
    expect(await store.get('my-coined')).toMatchObject({
      builtin: false,
      ruleset: { id: 'my-coined' },
    });
  });

  it('reports an unknown ruleset id', async () => {
    const { store } = await setup();
    await expect(store.get('nope')).rejects.toThrow(
      'Ruleset "nope" not found. Call ruleset_list to see the available ids.',
    );
  });

  it('rejects ids that could escape the folder', async () => {
    const { store } = await setup();
    await expect(store.get('../x')).rejects.toBeInstanceOf(StoreError);
    await expect(store.delete('../x')).rejects.toBeInstanceOf(StoreError);
  });

  it('refuses to shadow a built-in id', async () => {
    const { store } = await setup();
    await expect(store.save(custom('coined'))).rejects.toThrow(
      '"coined" is a built-in ruleset id; choose a different id for a custom ruleset.',
    );
  });

  it('rejects an invalid ruleset with a readable message', async () => {
    const { store } = await setup();
    const bad = { ...custom(), length: { min: 9, max: 3 } };
    await expect(store.save(bad)).rejects.toThrow(
      'Invalid ruleset: length: length.min must not exceed length.max.',
    );
  });

  it('deletes custom rulesets only', async () => {
    const { store } = await setup();
    await store.save(custom());
    await store.delete('my-coined');
    await expect(store.get('my-coined')).rejects.toThrow('not found');
    await expect(store.delete('my-coined')).rejects.toThrow('Custom ruleset "my-coined" not found.');
    await expect(store.delete('budget')).rejects.toThrow(
      '"budget" is a built-in ruleset and cannot be deleted.',
    );
  });

  it('lists broken custom files under invalid instead of failing', async () => {
    const { store, dir } = await setup();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'broken.json'), '{');
    await writeFile(join(dir, 'old.json'), JSON.stringify({ schemaVersion: 0, ...custom('old') }));
    await writeFile(join(dir, 'wrong.json'), JSON.stringify({ schemaVersion: 1, ...custom('other') }));
    const listing = await store.list();
    expect(listing.rulesets).toHaveLength(9);
    expect(listing.invalid).toEqual([
      { file: 'broken.json', error: 'broken.json is not valid JSON.' },
      { file: 'old.json', error: 'old.json has schemaVersion 0; this engine reads schemaVersion 1.' },
      {
        file: 'wrong.json',
        error: 'wrong.json declares id "other"; the file name must match the id.',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/rulesets/store.test.ts`
Expected: FAIL with "Failed to load url ../../src/rulesets/store.js".

- [ ] **Step 3: Write the error helpers**

`server/src/store/errors.ts`:
```ts
import type { z } from 'zod';

/** An expected store failure whose message is safe to show the user. */
export class StoreError extends Error {
  override name = 'StoreError';
}

/** Formats zod issues as "path: message" pairs on one line. */
export function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}
```

`server/src/store/fs-utils.ts`:
```ts
import { access } from 'node:fs/promises';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

export function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

export function isExists(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
```

- [ ] **Step 4: Write the ruleset store**

`server/src/rulesets/store.ts`:
```ts
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../fs/atomic.js';
import { StoreError, zodMessage } from '../store/errors.js';
import { fileExists, isNotFound } from '../store/fs-utils.js';
import { BUILTIN_IDS, BUILTIN_RULESETS } from './builtin.js';
import { RULESET_ID, RULESET_SCHEMA_VERSION, type Ruleset, RulesetSchema } from './schema.js';

export interface RulesetSummary {
  id: string;
  name: string;
  description: string;
  examples: string[];
  builtin: boolean;
}

export interface RulesetListing {
  rulesets: RulesetSummary[];
  invalid: Array<{ file: string; error: string }>;
}

function summarize(ruleset: Ruleset, builtin: boolean): RulesetSummary {
  const { id, name, description, examples } = ruleset;
  return { id, name, description, examples, builtin };
}

/** Built-in rulesets from the bundle plus custom rulesets stored as <dir>/<id>.json. */
export class RulesetStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async list(): Promise<RulesetListing> {
    const rulesets = BUILTIN_RULESETS.map((r) => summarize(r, true));
    const invalid: RulesetListing['invalid'] = [];
    for (const file of await this.customFiles()) {
      try {
        rulesets.push(summarize(await this.readCustom(file), false));
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        invalid.push({ file, error: error.message });
      }
    }
    return { rulesets, invalid };
  }

  async get(id: string): Promise<{ ruleset: Ruleset; builtin: boolean }> {
    const builtin = BUILTIN_RULESETS.find((r) => r.id === id);
    if (builtin) return { ruleset: builtin, builtin: true };
    this.checkId(id);
    try {
      return { ruleset: await this.readCustom(`${id}.json`), builtin: false };
    } catch (error) {
      if (isNotFound(error)) {
        throw new StoreError(`Ruleset "${id}" not found. Call ruleset_list to see the available ids.`);
      }
      throw error;
    }
  }

  async save(input: unknown): Promise<{ ruleset: Ruleset; created: boolean }> {
    const parsed = RulesetSchema.safeParse(input);
    if (!parsed.success) throw new StoreError(`Invalid ruleset: ${zodMessage(parsed.error)}`);
    const ruleset = parsed.data;
    if (BUILTIN_IDS.has(ruleset.id)) {
      throw new StoreError(
        `"${ruleset.id}" is a built-in ruleset id; choose a different id for a custom ruleset.`,
      );
    }
    const path = this.path(ruleset.id);
    const created = !(await fileExists(path));
    const file = { schemaVersion: RULESET_SCHEMA_VERSION, ...ruleset };
    await writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
    return { ruleset, created };
  }

  async delete(id: string): Promise<void> {
    if (BUILTIN_IDS.has(id)) {
      throw new StoreError(`"${id}" is a built-in ruleset and cannot be deleted.`);
    }
    this.checkId(id);
    try {
      await rm(this.path(id));
    } catch (error) {
      if (isNotFound(error)) throw new StoreError(`Custom ruleset "${id}" not found.`);
      throw error;
    }
  }

  private checkId(id: string): void {
    if (!RULESET_ID.test(id)) {
      throw new StoreError(
        `"${id}" is not a valid ruleset id: use 1-40 lowercase letters, digits, or inner hyphens.`,
      );
    }
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async customFiles(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((file) => file.endsWith('.json')).sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  /** Reads one custom file; a missing file throws the raw ENOENT error, anything else StoreError. */
  private async readCustom(file: string): Promise<Ruleset> {
    const text = await readFile(join(this.dir, file), 'utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new StoreError(`${file} is not valid JSON.`);
    }
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const { schemaVersion, ...rest } = record;
    if (schemaVersion !== RULESET_SCHEMA_VERSION) {
      throw new StoreError(
        `${file} has schemaVersion ${String(schemaVersion)}; this engine reads schemaVersion ${RULESET_SCHEMA_VERSION}.`,
      );
    }
    const parsed = RulesetSchema.safeParse(rest);
    if (!parsed.success) {
      throw new StoreError(`${file} is not a valid ruleset: ${zodMessage(parsed.error)}`);
    }
    if (`${parsed.data.id}.json` !== file) {
      throw new StoreError(`${file} declares id "${parsed.data.id}"; the file name must match the id.`);
    }
    if (BUILTIN_IDS.has(parsed.data.id)) {
      throw new StoreError(`${file} uses the built-in id "${parsed.data.id}" and is ignored.`);
    }
    return parsed.data;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/rulesets`
Expected: PASS.

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/store/errors.ts server/src/store/fs-utils.ts server/src/rulesets/store.ts server/test/rulesets/store.test.ts
git commit -m "feat(rulesets): store custom rulesets with schemaVersion 1"
```

---

### Task 3: Brief schema and the brief template

**Files:**
- Create: `server/src/store/brief.ts`, `skills/brief/templates/brief.md`
- Create: `server/test/store/fixtures/brief-example.json`, `server/test/store/brief-fixture.ts`
- Test: `server/test/store/brief.test.ts`

**Interfaces:**
- Consumes: `nonBlank`, `RulesetIdSchema`, `TldSchema` from Task 1.
- Produces:
  - `ARCHETYPES` (12 lowercase archetypes); `COUNTRY_CODE: RegExp` (`/^[A-Z]{2}$/`); `LANGUAGE_CODE: RegExp` (BCP 47 subset).
  - `BriefSchema` with sections `subject`, `audience`, `positioning`, `personality`, `nameRules`, `future?`, `mode`; `type Brief = z.output<typeof BriefSchema>`.
  - Test helper `loadBrief(): Promise<Brief>` in `server/test/store/brief-fixture.ts` (used by Tasks 5–7).

The schema mirrors the spec questionnaire. Required (R) fields are required in the schema; optional (O) fields are `.optional()`. `mode` is a discriminated union: `personal` adds the required `fullName`, `profession`, and `nameForms`.

- [ ] **Step 1: Write the fixture, the helper, and the failing test**

`server/test/store/fixtures/brief-example.json`:
```json
{
  "subject": {
    "what": "A mobile app that plans weekly meals from what is already in the fridge.",
    "category": "Consumer food tech",
    "problem": "Busy parents waste food and time deciding what to cook each night.",
    "features": ["fridge scan", "weekly plan", "shopping list"],
    "keywords": ["meal", "fridge", "plan", "fresh"]
  },
  "audience": {
    "who": "Parents aged 28-45 who cook at home",
    "segment": "b2c",
    "countries": ["DE", "GB"],
    "languages": ["de", "en"]
  },
  "positioning": {
    "competitors": ["Mealime", "Plan to Eat", "https://www.supercook.com"],
    "difference": "Starts from leftovers, not from recipes.",
    "priceTier": "mid"
  },
  "personality": {
    "tone": ["warm", "practical", "playful"],
    "archetype": "caregiver",
    "avoid": ["diet", "guilt"]
  },
  "nameRules": {
    "rulesets": ["coined", "compound"],
    "overrides": { "maxLength": 10, "ban": ["chef"], "extraTlds": ["app"] },
    "handles": ["instagram", "tiktok"]
  },
  "future": { "scope": "broad" },
  "mode": { "type": "startup" }
}
```

`server/test/store/brief-fixture.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { type Brief, BriefSchema } from '../../src/store/brief.js';

/** Loads and validates the example brief used across store and tool tests. */
export async function loadBrief(): Promise<Brief> {
  const url = new URL('./fixtures/brief-example.json', import.meta.url);
  return BriefSchema.parse(JSON.parse(await readFile(url, 'utf8')));
}
```

`server/test/store/brief.test.ts`:
```ts
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
      if (PERSONAL.includes(q.path)) expect(q.text, q.path).toContain('(required for personal brand)');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/store/brief.test.ts`
Expected: FAIL with "Failed to load url ../../src/store/brief.js".

- [ ] **Step 3: Write the brief schema**

`server/src/store/brief.ts`:
```ts
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
      .describe('O: Social handles that matter, lowercase platform ids such as "github", "x", "instagram"'),
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
```

- [ ] **Step 4: Write the brief template**

`skills/brief/templates/brief.md`:
```markdown
# Brand brief

Fill in this file and give its path to the `brief` skill (or to `find-domain`).
Write each answer on the `Answer:` line under its question. Questions marked
(required) need an answer. Leave an optional answer empty if it does not apply.
Lists can be comma-separated. Country and language names are fine; the skill
converts them to codes.

## 1. Subject

- What is it, in one sentence? (required) <!-- subject.what -->
  Answer:
- What category or industry is it in? (required) <!-- subject.category -->
  Answer:
- What problem does it solve, and for whom? (required) <!-- subject.problem -->
  Answer:
- Key features or offer (optional) <!-- subject.features -->
  Answer:
- Descriptive keywords (optional) <!-- subject.keywords -->
  Answer:

## 2. Audience and markets

- Who buys or uses it? (required) <!-- audience.who -->
  Answer:
- B2B, B2C, or both? (required) <!-- audience.segment -->
  Answer:
- Target countries (required) <!-- audience.countries -->
  Answer:
- Target languages (required) <!-- audience.languages -->
  Answer:

## 3. Positioning

- 3 to 5 competitors, by name or URL (optional) <!-- positioning.competitors -->
  Answer:
- What makes it different? (optional) <!-- positioning.difference -->
  Answer:
- Price tier: budget, mid, or premium? (required) <!-- positioning.priceTier -->
  Answer:

## 4. Personality

- Three words for the tone (required) <!-- personality.tone -->
  Answer:
- Brand archetype (optional): Sage, Hero, Creator, Explorer, Outlaw, Magician, Lover, Jester, Everyman, Caregiver, Ruler, Innocent <!-- personality.archetype -->
  Answer:
- Words or feelings to avoid (optional) <!-- personality.avoid -->
  Answer:

## 5. Name rules

- Rulesets, pick 1 to 3 (required): coined, descriptive, compound, evocative, premium, dev-tool, personal, local-business, budget, or a custom ruleset id. If unsure, leave it empty and the skill will suggest some. <!-- nameRules.rulesets -->
  Answer:
- Overrides for this project only (optional): minimum length, maximum length, words to include, words to ban, extra TLDs <!-- nameRules.overrides -->
  Answer:
- Social handles that matter (optional): github, npm, pypi, reddit, x, instagram, tiktok, youtube, linkedin <!-- nameRules.handles -->
  Answer:

## 6. Future

- Will the brand grow past this product? Answer "broad name" or "narrow name" (optional) <!-- future.scope -->
  Answer:

## 7. Mode

- Startup, personal brand, or product? (required) <!-- mode.type -->
  Answer:
- Personal brand only: your full name (required for personal brand) <!-- mode.fullName -->
  Answer:
- Personal brand only: your profession (required for personal brand) <!-- mode.profession -->
  Answer:
- Personal brand only: name forms you accept, for example "Jane Doe", "J. Doe", "Jane Doe Design" (required for personal brand) <!-- mode.nameForms -->
  Answer:
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/store/brief.test.ts`
Expected: PASS.

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/store/brief.ts server/test/store skills/brief/templates/brief.md
git commit -m "feat(store): add the brief schema and the brief template"
```

---

### Task 4: Backup-aware JSON files and the project schema

**Files:**
- Create: `server/src/store/json-file.ts`, `server/src/store/project-schema.ts`
- Test: `server/test/store/json-file.test.ts`, `server/test/store/project-schema.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic` (Plan 1); `errorMessage(error: unknown): string` from `server/src/util/errors.ts` (Plan 1); `type DomainCheck` from `server/src/domain/types.ts` (Plan 1); `StoreError`, `zodMessage`, `isNotFound` (Task 2); `NAME_STYLES`, `nonBlank`, `RulesetIdSchema` (Task 1); `BriefSchema`, `LANGUAGE_CODE` (Task 3).
- Produces:
  - `backupPath(path: string): string` (`<path>.bak`).
  - `interface JsonRead<T> { value: T; recoveredFromBackup: boolean; problem?: string }`.
  - `readJsonWithBackup<T>(path: string, parse: (raw: unknown) => T): Promise<JsonRead<T>>` — throws the raw ENOENT error when the main file is missing; throws `StoreError` when both main and backup are unreadable.
  - `writeJsonWithBackup(path: string, value: unknown, parse: (raw: unknown) => unknown): Promise<void>` — copies the current file to `.bak` only if `parse` accepts it, then writes atomically.
  - `PROJECT_SCHEMA_VERSION = 1`; `SLUG: RegExp`; `USER_RULESET = 'user'`.
  - `CHECK_KINDS = ['domain','profile','handle','trademark','competitor'] as const`; `type CheckKind`.
  - `NOTE_SEVERITIES = ['low','medium','high'] as const` (the `language-check` risk levels); `type NoteSeverity`.
  - Schemas and types: `DomainCheckSchema`, `ResearchResultSchema` / `ResearchResult`, `ScorePartsSchema`, `NoteSchema` / `Note`, `NameEntrySchema` / `NameEntry`, `NameChecksSchema` / `NameChecks` (`{ domains, profiles, handles, trademarks, competitors }`), `BriefRecordSchema` / `BriefRecord` (`{ version, createdAt, data: Brief }`), `ProjectSchema` / `Project`.
  - `parseProject(raw: unknown): Project` — throws `StoreError` with `schemaVersion is <n>; this engine reads schemaVersion 1.` on a version mismatch.

- [ ] **Step 1: Write the failing tests**

`server/test/store/json-file.test.ts`:
```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StoreError } from '../../src/store/errors.js';
import { isNotFound } from '../../src/store/fs-utils.js';
import { backupPath, readJsonWithBackup, writeJsonWithBackup } from '../../src/store/json-file.js';

interface Doc {
  n: number;
}

function parseDoc(raw: unknown): Doc {
  if (typeof raw !== 'object' || raw === null || typeof (raw as Doc).n !== 'number') {
    throw new StoreError('not a doc');
  }
  return raw as Doc;
}

async function file(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'dne-json-')), 'sub', 'doc.json');
}

describe('writeJsonWithBackup', () => {
  it('writes pretty JSON and creates no backup on the first write', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    expect(await readFile(path, 'utf8')).toBe('{\n  "n": 1\n}\n');
    await expect(readFile(backupPath(path), 'utf8')).rejects.toSatisfy(isNotFound);
  });

  it('keeps the previous valid file as .bak', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeJsonWithBackup(path, { n: 2 }, parseDoc);
    expect(JSON.parse(await readFile(backupPath(path), 'utf8'))).toEqual({ n: 1 });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ n: 2 });
  });

  it('never replaces a good backup with a corrupt file', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeJsonWithBackup(path, { n: 2 }, parseDoc);
    await writeFile(path, '{"n":');
    await writeJsonWithBackup(path, { n: 3 }, parseDoc);
    expect(JSON.parse(await readFile(backupPath(path), 'utf8'))).toEqual({ n: 1 });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ n: 3 });
  });
});

describe('readJsonWithBackup', () => {
  it('reads a valid file', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    expect(await readJsonWithBackup(path, parseDoc)).toEqual({
      value: { n: 1 },
      recoveredFromBackup: false,
    });
  });

  it('falls back to the backup and reports the problem', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeJsonWithBackup(path, { n: 2 }, parseDoc);
    await writeFile(path, '{"n": "two"}');
    expect(await readJsonWithBackup(path, parseDoc)).toEqual({
      value: { n: 1 },
      recoveredFromBackup: true,
      problem: 'not a doc',
    });
  });

  it('throws StoreError when the file is bad and there is no backup', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeFile(path, 'oops');
    await expect(readJsonWithBackup(path, parseDoc)).rejects.toThrow(/is unreadable \(.+\) and has no backup\./);
  });

  it('throws StoreError when both the file and the backup are bad', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeFile(path, 'oops');
    await writeFile(backupPath(path), 'oops');
    await expect(readJsonWithBackup(path, parseDoc)).rejects.toThrow(/its backup is unreadable too/);
  });

  it('throws the raw not-found error for a missing file', async () => {
    await expect(readJsonWithBackup(await file(), parseDoc)).rejects.toSatisfy(isNotFound);
  });
});
```

`server/test/store/project-schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { DomainCheck } from '../../src/domain/types.js';
import {
  DomainCheckSchema,
  parseProject,
  ResearchResultSchema,
} from '../../src/store/project-schema.js';
import { loadBrief } from './brief-fixture.js';

const AT = '2026-11-04T10:00:00.000Z';

async function minimalProject(): Promise<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    slug: 'fridgeplan',
    title: 'FridgePlan',
    createdAt: AT,
    updatedAt: AT,
    brief: { version: 1, createdAt: AT, data: await loadBrief() },
    briefHistory: [],
    names: [],
    checks: {},
    shortlist: [],
  };
}

describe('project schema', () => {
  it('accepts a minimal project', async () => {
    expect(parseProject(await minimalProject()).slug).toBe('fridgeplan');
  });

  it('rejects another schemaVersion with a clear message', async () => {
    const raw = { ...(await minimalProject()), schemaVersion: 2 };
    expect(() => parseProject(raw)).toThrow('schemaVersion is 2; this engine reads schemaVersion 1.');
    const { schemaVersion: _v, ...unversioned } = await minimalProject();
    expect(() => parseProject(unversioned)).toThrow('schemaVersion is undefined');
  });

  it('rejects a project with an invalid field', async () => {
    const raw = { ...(await minimalProject()), slug: 'Bad Slug' };
    expect(() => parseProject(raw)).toThrow(/^not a valid project: slug: /);
  });

  it('accepts check_domains results as domain checks', () => {
    const check: DomainCheck = {
      domain: 'fridgeplan.com',
      status: 'likely_available',
      source: 'rdap',
      confidence: 'high',
      checkedAt: AT,
    };
    expect(DomainCheckSchema.parse(check)).toEqual(check);
  });

  it('keeps research results as open payloads and checks the common fields when present', () => {
    const handle = {
      platform: 'github',
      status: 'taken',
      source: 'github-api',
      checkedAt: AT,
      confidence: 'high',
    };
    expect(ResearchResultSchema.parse(handle)).toEqual(handle);
    const trademarkSearch = { mark: 'FRIDGELY', offices: [{ office: 'euipo', status: 'no_matches' }] };
    expect(ResearchResultSchema.parse(trademarkSearch)).toEqual(trademarkSearch);
    expect(ResearchResultSchema.safeParse({ platform: 'x', checkedAt: 'yesterday' }).success).toBe(false);
    expect(ResearchResultSchema.safeParse({ platform: 'x', confidence: 'certain' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test test/store/json-file.test.ts test/store/project-schema.test.ts`
Expected: FAIL with "Failed to load url ../../src/store/json-file.js" and "... project-schema.js".

- [ ] **Step 3: Write the JSON file helpers**

`server/src/store/json-file.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { writeFileAtomic } from '../fs/atomic.js';
import { errorMessage } from '../util/errors.js';
import { StoreError } from './errors.js';
import { isNotFound } from './fs-utils.js';

export interface JsonRead<T> {
  value: T;
  recoveredFromBackup: boolean;
  problem?: string;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; problem: string };

export function backupPath(path: string): string {
  return `${path}.bak`;
}

/** Reads and parses one file. A missing file throws the raw ENOENT error. */
async function attempt<T>(path: string, parse: (raw: unknown) => T): Promise<Attempt<T>> {
  const text = await readFile(path, 'utf8');
  try {
    return { ok: true, value: parse(JSON.parse(text)) };
  } catch (error) {
    return { ok: false, problem: errorMessage(error) };
  }
}

/** Reads a JSON file; if it does not parse or validate, reads `<path>.bak` and says so. */
export async function readJsonWithBackup<T>(
  path: string,
  parse: (raw: unknown) => T,
): Promise<JsonRead<T>> {
  const main = await attempt(path, parse);
  if (main.ok) return { value: main.value, recoveredFromBackup: false };
  let backup: Attempt<T>;
  try {
    backup = await attempt(backupPath(path), parse);
  } catch (error) {
    if (isNotFound(error)) {
      throw new StoreError(`${path} is unreadable (${main.problem}) and has no backup.`);
    }
    throw error;
  }
  if (!backup.ok) {
    throw new StoreError(
      `${path} is unreadable (${main.problem}) and its backup is unreadable too (${backup.problem}).`,
    );
  }
  return { value: backup.value, recoveredFromBackup: true, problem: main.problem };
}

function accepts(text: string, parse: (raw: unknown) => unknown): boolean {
  try {
    parse(JSON.parse(text));
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes JSON atomically. The current file becomes `<path>.bak` first, but only when it is
 * still valid, so a corrupt file never replaces a good backup.
 */
export async function writeJsonWithBackup(
  path: string,
  value: unknown,
  parse: (raw: unknown) => unknown,
): Promise<void> {
  let current: string | undefined;
  try {
    current = await readFile(path, 'utf8');
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (current !== undefined && accepts(current, parse)) {
    await writeFileAtomic(backupPath(path), current);
  }
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
```

- [ ] **Step 4: Write the project schema**

`server/src/store/project-schema.ts`:
```ts
import { z } from 'zod';
import type { DomainCheck } from '../domain/types.js';
import { NAME_STYLES, nonBlank, RulesetIdSchema } from '../rulesets/schema.js';
import { BriefSchema, LANGUAGE_CODE } from './brief.js';
import { StoreError, zodMessage } from './errors.js';

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
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new StoreError(
      `schemaVersion is ${String(version)}; this engine reads schemaVersion ${PROJECT_SCHEMA_VERSION}.`,
    );
  }
  const parsed = ProjectSchema.safeParse(raw);
  if (!parsed.success) throw new StoreError(`not a valid project: ${zodMessage(parsed.error)}`);
  return parsed.data;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test test/store`
Expected: PASS.

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/store/json-file.ts server/src/store/project-schema.ts server/test/store
git commit -m "feat(store): add backup-aware JSON files and the versioned project schema"
```

---

### Task 5: Project store

**Files:**
- Create: `server/src/store/names.ts`, `server/src/store/project-store.ts`
- Test: `server/test/store/names.test.ts`, `server/test/store/project-store.test.ts`

**Interfaces:**
- Consumes: `normalizeLabel`, `ValidationError` (Plan 1 `domain/name.ts`); `computeScore`, `EQUAL_WEIGHTS`, `type ScoreParts` (Task 1); `type NameStyle`, `type Weights` (Task 1); `StoreError`, `zodMessage`, `isExists`, `isNotFound` (Task 2); `BriefSchema` (Task 3); `readJsonWithBackup`, `writeJsonWithBackup`, `parseProject`, `ProjectSchema`, `DomainCheckSchema`, `ResearchResultSchema`, `SLUG`, `USER_RULESET`, `PROJECT_SCHEMA_VERSION` and the project types (Task 4).
- Produces:
  - `slugify(title: string): string` (ASCII, lowercase, hyphens, at most 40 chars cut at a hyphen, `"project"` when empty).
  - `nameLabel(name: string): string` (strips diacritics, spaces, underscores, and apostrophes, then `normalizeLabel`; throws `ValidationError`).
  - `PROJECT_FILE = 'project.json'`; `REPORT_FILE = 'report.md'`.
  - `interface ProjectPaths { dir: string; projectFile: string; reportFile: string }`.
  - `interface LoadedProject { project: Project; paths: ProjectPaths; recoveredFromBackup: boolean; problem?: string }`.
  - `interface Mutation<T> { result: T; loaded: LoadedProject }`.
  - `interface ProjectSummary { slug; title; createdAt; updatedAt; briefVersion: number; rulesets: string[]; names: number; shortlist: number }`; `interface ProjectListing { projects: ProjectSummary[]; invalid: Array<{ slug: string; error: string }> }`.
  - `interface NewName { name: string; label?: string; rulesetId: string; strategy?: NameStyle; rationale?: string; scoreParts?: ScoreParts }`; `interface AddNamesResult { added: NameEntry[]; skipped: Array<{ name: string; reason: string }> }`.
  - `interface CheckBatch { name: string; kind: CheckKind; results: unknown[] }`; `interface StoredChecks { name: string; kind: CheckKind; stored: number }`.
  - `interface NewNote { name: string; text: string; kind?: string; language?: string; severity?: NoteSeverity }`.
  - `type ShortlistMode = 'set' | 'add' | 'remove'`.
  - `class ProjectStore`:
    - `constructor(dir: string, opts?: { now?: () => Date })`
    - `paths(slug: string): ProjectPaths`
    - `create(brief: unknown, title?: string): Promise<LoadedProject>`
    - `get(slug: string): Promise<LoadedProject>`
    - `list(): Promise<ProjectListing>`
    - `addNames(slug: string, names: NewName[], weights: ReadonlyMap<string, Weights>): Promise<Mutation<AddNamesResult>>`
    - `addChecks(slug: string, batches: CheckBatch[]): Promise<Mutation<StoredChecks[]>>`
    - `addNotes(slug: string, notes: NewNote[]): Promise<Mutation<{ added: number }>>`
    - `setShortlist(slug: string, names: string[], mode?: ShortlistMode): Promise<Mutation<string[]>>`
    - `updateBrief(slug: string, brief: unknown): Promise<Mutation<{ briefVersion: number }>>`
  - Every expected failure throws `StoreError`. A failing mutation writes nothing.

- [ ] **Step 1: Write the failing tests**

`server/test/store/names.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/name.js';
import { nameLabel, slugify } from '../../src/store/names.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('FridgePlan')).toBe('fridgeplan');
    expect(slugify('Zénith Café!')).toBe('zenith-cafe');
  });

  it('cuts long titles at a word boundary within 40 characters', () => {
    expect(slugify('A mobile app that plans weekly meals from what is already in the fridge.')).toBe(
      'a-mobile-app-that-plans-weekly-meals',
    );
  });

  it('falls back to "project"', () => {
    expect(slugify('!!!')).toBe('project');
  });
});

describe('nameLabel', () => {
  it('turns a display name into a domain label', () => {
    expect(nameLabel('Blue Fern')).toBe('bluefern');
    expect(nameLabel('Zénith')).toBe('zenith');
    expect(nameLabel("Mom's_Kitchen")).toBe('momskitchen');
    expect(nameLabel('get-acme')).toBe('get-acme');
  });

  it('rejects names that cannot be a label', () => {
    expect(() => nameLabel('a!b')).toThrow(ValidationError);
  });
});
```

`server/test/store/project-store.test.ts`:
```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DomainCheck } from '../../src/domain/types.js';
import { BUILTIN_RULESETS } from '../../src/rulesets/builtin.js';
import type { Weights } from '../../src/rulesets/schema.js';
import { StoreError } from '../../src/store/errors.js';
import { ProjectStore } from '../../src/store/project-store.js';
import { loadBrief } from './brief-fixture.js';

const AT = '2026-11-04T10:00:00.000Z';

async function setup(): Promise<{ store: ProjectStore; dir: string }> {
  const dir = join(await mkdtemp(join(tmpdir(), 'dne-projects-')), 'projects');
  let tick = 0;
  // Each call returns a later time so updatedAt ordering is deterministic.
  const now = () => new Date(Date.parse(AT) + 1000 * tick++);
  return { store: new ProjectStore(dir, { now }), dir };
}

function weightsOf(...ids: string[]): Map<string, Weights> {
  return new Map(
    BUILTIN_RULESETS.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.weights]),
  );
}

function domain(name: string, status: DomainCheck['status'] = 'likely_available'): DomainCheck {
  return { domain: name, status, source: 'rdap', confidence: 'high', checkedAt: AT };
}

async function withProject(): Promise<{ store: ProjectStore; dir: string; slug: string }> {
  const { store, dir } = await setup();
  const { project } = await store.create(await loadBrief(), 'FridgePlan');
  return { store, dir, slug: project.slug };
}

describe('ProjectStore.create', () => {
  it('writes a versioned project.json under the slug folder', async () => {
    const { store, dir } = await setup();
    const created = await store.create(await loadBrief(), 'FridgePlan');
    expect(created.paths).toEqual({
      dir: join(dir, 'fridgeplan'),
      projectFile: join(dir, 'fridgeplan', 'project.json'),
      reportFile: join(dir, 'fridgeplan', 'report.md'),
    });
    const onDisk = JSON.parse(await readFile(created.paths.projectFile, 'utf8'));
    expect(onDisk).toMatchObject({
      schemaVersion: 1,
      slug: 'fridgeplan',
      title: 'FridgePlan',
      brief: { version: 1 },
      briefHistory: [],
      names: [],
      checks: {},
      shortlist: [],
    });
  });

  it('picks a free slug and derives the title from the brief when none is given', async () => {
    const { store } = await setup();
    await store.create(await loadBrief(), 'FridgePlan');
    expect((await store.create(await loadBrief(), 'FridgePlan')).project.slug).toBe('fridgeplan-2');
    const untitled = await store.create(await loadBrief());
    expect(untitled.project.slug).toBe('a-mobile-app-that-plans-weekly-meals');
    expect(untitled.project.title).toBe(
      'A mobile app that plans weekly meals from what is already in the fridge.',
    );
  });

  it('rejects an invalid brief', async () => {
    const { store } = await setup();
    const brief = await loadBrief();
    await expect(store.create({ ...brief, mode: { type: 'personal' } })).rejects.toThrow(
      /^Invalid brief: mode/,
    );
  });
});

describe('ProjectStore.get and list', () => {
  it('reports a missing project', async () => {
    const { store } = await setup();
    await expect(store.get('nope')).rejects.toThrow(
      'Project "nope" not found. Call project_list to see existing projects.',
    );
    await expect(store.get('../etc')).rejects.toBeInstanceOf(StoreError);
  });

  it('recovers from a corrupt project.json using the backup', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    const { paths } = await store.get(slug);
    await writeFile(paths.projectFile, '{ broken');
    const loaded = await store.get(slug);
    expect(loaded.recoveredFromBackup).toBe(true);
    expect(loaded.problem).toBeTruthy();
    expect(loaded.project.names).toEqual([]);
    // The next write repairs project.json and keeps the good backup.
    const { loaded: after } = await store.addNotes(slug, []);
    expect(after.recoveredFromBackup).toBe(true);
    expect((await store.get(slug)).recoveredFromBackup).toBe(false);
    JSON.parse(await readFile(`${paths.projectFile}.bak`, 'utf8'));
  });

  it('refuses a project with another schemaVersion', async () => {
    const { store, slug } = await withProject();
    const { paths } = await store.get(slug);
    const raw = JSON.parse(await readFile(paths.projectFile, 'utf8'));
    await writeFile(paths.projectFile, JSON.stringify({ ...raw, schemaVersion: 2 }));
    await expect(store.get(slug)).rejects.toThrow(/schemaVersion is 2; this engine reads schemaVersion 1\./);
  });

  it('lists projects newest first and reports unreadable ones', async () => {
    const { store, dir } = await setup();
    await store.create(await loadBrief(), 'First');
    await store.create(await loadBrief(), 'Second');
    await mkdir(join(dir, 'empty'));
    const listing = await store.list();
    expect(listing.projects.map((p) => p.slug)).toEqual(['second', 'first']);
    expect(listing.projects[0]).toMatchObject({
      title: 'Second',
      briefVersion: 1,
      rulesets: ['coined', 'compound'],
      names: 0,
      shortlist: 0,
    });
    expect(listing.invalid).toEqual([
      { slug: 'empty', error: 'Project "empty" not found. Call project_list to see existing projects.' },
    ]);
  });

  it('lists nothing when the projects folder does not exist', async () => {
    const { store } = await setup();
    expect(await store.list()).toEqual({ projects: [], invalid: [] });
  });
});

describe('ProjectStore.addNames', () => {
  it('adds names with label, brief version, and a computed score', async () => {
    const { store, slug } = await withProject();
    const { result } = await store.addNames(
      slug,
      [
        {
          name: 'Fridgely',
          rulesetId: 'coined',
          strategy: 'invented',
          rationale: 'Fridge plus a friendly ending.',
          scoreParts: { length: 8, say: 9, spell: 7 },
        },
        { name: 'Leftover Lab', rulesetId: 'compound', strategy: 'compound' },
      ],
      weightsOf('coined', 'compound'),
    );
    expect(result.skipped).toEqual([]);
    // coined weights: length 0.8, say 1, spell 0.8 -> (6.4 + 9 + 5.6) / 2.6 = 8.08 -> 80.8
    expect(result.added[0]).toMatchObject({
      name: 'Fridgely',
      label: 'fridgely',
      rulesetId: 'coined',
      briefVersion: 1,
      score: 80.8,
      notes: [],
    });
    expect(result.added[1]).toMatchObject({ label: 'leftoverlab', score: null });
    expect((await store.get(slug)).project.names).toHaveLength(2);
  });

  it('skips duplicates, bad labels, and rulesets outside the brief', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    const { result } = await store.addNames(
      slug,
      [
        { name: 'FRIDGELY', rulesetId: 'coined' },
        { name: 'a!b', rulesetId: 'coined' },
        { name: 'Pantrypal', rulesetId: 'premium' },
        { name: 'My Own Pick', rulesetId: 'user' },
      ],
      weightsOf('coined', 'premium'),
    );
    expect(result.added.map((n) => n.label)).toEqual(['myownpick']);
    expect(result.skipped.map((s) => s.name)).toEqual(['FRIDGELY', 'a!b', 'Pantrypal']);
    expect(result.skipped[0]?.reason).toBe('"fridgely" is already in the project.');
    expect(result.skipped[2]?.reason).toBe(
      'ruleset "premium" is not one of this project\'s rulesets (coined, compound, user).',
    );
  });

  it('serializes concurrent writes to one project', async () => {
    const { store, slug } = await withProject();
    await Promise.all(
      ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((name) =>
        store.addNames(slug, [{ name, rulesetId: 'coined' }], weightsOf('coined')),
      ),
    );
    expect((await store.get(slug)).project.names).toHaveLength(5);
  });
});

describe('ProjectStore.addChecks', () => {
  it('merges domain results by domain and keys them by label', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    await store.addChecks(slug, [
      { name: 'Fridgely', kind: 'domain', results: [domain('fridgely.com'), domain('fridgely.io')] },
    ]);
    const { result } = await store.addChecks(slug, [
      { name: 'fridgely', kind: 'domain', results: [domain('fridgely.com', 'registered')] },
    ]);
    expect(result).toEqual([{ name: 'fridgely', kind: 'domain', stored: 2 }]);
    const checks = (await store.get(slug)).project.checks.fridgely;
    expect(checks?.domains.map((d) => [d.domain, d.status])).toEqual([
      ['fridgely.com', 'registered'],
      ['fridgely.io', 'likely_available'],
    ]);
  });

  it('merges handles by platform and replaces trademarks and competitors per batch', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    const common = { checkedAt: AT, confidence: 'high' };
    await store.addChecks(slug, [
      {
        name: 'Fridgely',
        kind: 'handle',
        results: [
          { ...common, source: 'github-api', platform: 'github', status: 'available' },
          { ...common, source: 'npm', platform: 'npm', status: 'taken' },
        ],
      },
      {
        name: 'Fridgely',
        kind: 'trademark',
        results: [
          { ...common, source: 'uspto', mark: 'FRIDGELY' },
          { ...common, source: 'uspto', mark: 'FRIDGELEY' },
          { ...common, source: 'euipo', mark: 'FRIDGE LY' },
        ],
      },
    ]);
    await store.addChecks(slug, [
      {
        name: 'Fridgely',
        kind: 'handle',
        results: [{ ...common, source: 'github-api', platform: 'github', status: 'taken' }],
      },
      { name: 'Fridgely', kind: 'trademark', results: [{ ...common, source: 'uspto', mark: 'NONE' }] },
      {
        name: 'Fridgely',
        kind: 'competitor',
        results: [{ source: 'websearch', checkedAt: AT, url: 'https://fridgely.example', finding: 'Same-name app' }],
      },
    ]);
    const checks = (await store.get(slug)).project.checks.fridgely;
    expect(checks?.handles.map((h) => [h.platform, h.status])).toEqual([
      ['github', 'taken'],
      ['npm', 'taken'],
    ]);
    expect(checks?.trademarks.map((t) => [t.source, t.mark])).toEqual([['uspto', 'NONE']]);
    expect(checks?.competitors.map((c) => c.url)).toEqual(['https://fridgely.example']);
  });

  it('rejects unknown names and invalid results without writing', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    await expect(
      store.addChecks(slug, [
        { name: 'Fridgely', kind: 'domain', results: [domain('fridgely.com')] },
        { name: 'Nobody', kind: 'domain', results: [domain('nobody.com')] },
      ]),
    ).rejects.toThrow('"Nobody" is not in project "fridgeplan"; add it with project_add_names first.');
    await expect(
      store.addChecks(slug, [{ name: 'Fridgely', kind: 'domain', results: [{ domain: 'x.com' }] }]),
    ).rejects.toThrow(/^Invalid domain results for "Fridgely": 0\.status/);
    expect((await store.get(slug)).project.checks).toEqual({});
  });
});

describe('ProjectStore notes, shortlist, and brief versions', () => {
  it('adds notes with defaults', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    await store.addNotes(slug, [
      { name: 'Fridgely', text: 'Easy to say.' },
      {
        name: 'Fridgely',
        kind: 'language',
        language: 'de',
        severity: 'medium',
        text: 'Reads as "Fridge-li" in German.',
      },
    ]);
    const [entry] = (await store.get(slug)).project.names;
    expect(entry?.notes).toEqual([
      { kind: 'general', severity: 'low', text: 'Easy to say.', createdAt: expect.any(String) },
      {
        kind: 'language',
        language: 'de',
        severity: 'medium',
        text: 'Reads as "Fridge-li" in German.',
        createdAt: expect.any(String),
      },
    ]);
  });

  it('sets, extends, and trims the shortlist', async () => {
    const { store, slug } = await withProject();
    await store.addNames(
      slug,
      ['Alpha', 'Bravo', 'Charlie'].map((name) => ({ name, rulesetId: 'coined' })),
      weightsOf('coined'),
    );
    expect((await store.setShortlist(slug, ['Alpha', 'bravo', 'Alpha'])).result).toEqual([
      'alpha',
      'bravo',
    ]);
    expect((await store.setShortlist(slug, ['Charlie'], 'add')).result).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
    expect((await store.setShortlist(slug, ['bravo'], 'remove')).result).toEqual(['alpha', 'charlie']);
    expect((await store.setShortlist(slug, [])).result).toEqual([]);
    await expect(store.setShortlist(slug, ['Zulu'])).rejects.toThrow('"Zulu" is not in project');
  });

  it('versions the brief and tags new names with the new version', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    const brief = await loadBrief();
    const next = { ...brief, nameRules: { ...brief.nameRules, rulesets: ['premium'] } };
    expect((await store.updateBrief(slug, next)).result).toEqual({ briefVersion: 2 });
    await store.addNames(slug, [{ name: 'Aeron', rulesetId: 'premium' }], weightsOf('premium'));
    const { project } = await store.get(slug);
    expect(project.brief.version).toBe(2);
    expect(project.briefHistory.map((b) => b.version)).toEqual([1]);
    expect(project.names.map((n) => [n.label, n.briefVersion])).toEqual([
      ['fridgely', 1],
      ['aeron', 2],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test test/store/names.test.ts test/store/project-store.test.ts`
Expected: FAIL with "Failed to load url ../../src/store/names.js" and "... project-store.js".

- [ ] **Step 3: Write the name helpers**

`server/src/store/names.ts`:
```ts
import { normalizeLabel } from '../domain/name.js';

const SLUG_MAX = 40;

function stripMarks(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '');
}

/** Folder-safe slug from a title: ASCII, lowercase, hyphens, cut at a word boundary. */
export function slugify(title: string): string {
  let slug = stripMarks(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_MAX) {
    const cut = slug.slice(0, SLUG_MAX + 1).lastIndexOf('-');
    slug = slug.slice(0, cut > 0 ? cut : SLUG_MAX).replace(/-+$/, '');
  }
  return slug || 'project';
}

/** Domain label for a display name: "Blue Fern" -> "bluefern". Throws ValidationError. */
export function nameLabel(name: string): string {
  return normalizeLabel(stripMarks(name).replace(/[\s_'’]+/g, ''));
}
```

- [ ] **Step 4: Write the project store**

`server/src/store/project-store.ts`:
```ts
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ValidationError } from '../domain/name.js';
import type { NameStyle, Weights } from '../rulesets/schema.js';
import { computeScore, EQUAL_WEIGHTS, type ScoreParts } from '../rulesets/score.js';
import { BriefSchema } from './brief.js';
import { StoreError, zodMessage } from './errors.js';
import { isExists, isNotFound } from './fs-utils.js';
import { readJsonWithBackup, writeJsonWithBackup } from './json-file.js';
import { nameLabel, slugify } from './names.js';
import {
  type CheckKind,
  DomainCheckSchema,
  type NameChecks,
  type NameEntry,
  type NoteSeverity,
  PROJECT_SCHEMA_VERSION,
  type Project,
  ProjectSchema,
  parseProject,
  type ResearchResult,
  ResearchResultSchema,
  SLUG,
  USER_RULESET,
} from './project-schema.js';

export const PROJECT_FILE = 'project.json';
export const REPORT_FILE = 'report.md';
const TITLE_MAX = 80;

export interface ProjectPaths {
  dir: string;
  projectFile: string;
  reportFile: string;
}

export interface LoadedProject {
  project: Project;
  paths: ProjectPaths;
  recoveredFromBackup: boolean;
  problem?: string;
}

export interface Mutation<T> {
  result: T;
  loaded: LoadedProject;
}

export interface ProjectSummary {
  slug: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  briefVersion: number;
  rulesets: string[];
  names: number;
  shortlist: number;
}

export interface ProjectListing {
  projects: ProjectSummary[];
  invalid: Array<{ slug: string; error: string }>;
}

export interface NewName {
  name: string;
  label?: string;
  rulesetId: string;
  strategy?: NameStyle;
  rationale?: string;
  scoreParts?: ScoreParts;
}

export interface AddNamesResult {
  added: NameEntry[];
  skipped: Array<{ name: string; reason: string }>;
}

export interface CheckBatch {
  name: string;
  kind: CheckKind;
  results: unknown[];
}

export interface StoredChecks {
  name: string;
  kind: CheckKind;
  stored: number;
}

export interface NewNote {
  name: string;
  text: string;
  kind?: string;
  language?: string;
  severity?: NoteSeverity;
}

export type ShortlistMode = 'set' | 'add' | 'remove';

export interface ProjectStoreOptions {
  now?: () => Date;
}

const RESEARCH_BUCKET = {
  profile: 'profiles',
  handle: 'handles',
  trademark: 'trademarks',
  competitor: 'competitors',
} as const;

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StoreError(`${what}: ${zodMessage(parsed.error)}`);
  return parsed.data;
}

function summarize(project: Project): ProjectSummary {
  return {
    slug: project.slug,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    briefVersion: project.brief.version,
    rulesets: project.brief.data.nameRules.rulesets,
    names: project.names.length,
    shortlist: project.shortlist.length,
  };
}

function emptyChecks(): NameChecks {
  return { domains: [], profiles: [], handles: [], trademarks: [], competitors: [] };
}

/** Merges by key; an incoming item replaces an existing one in place. */
function mergeBy<T>(existing: T[], incoming: T[], key: (item: T) => string): T[] {
  const merged = new Map(existing.map((item) => [key(item), item]));
  for (const item of incoming) merged.set(key(item), item);
  return [...merged.values()];
}

function identity(result: ResearchResult, field: string): string {
  const value = result[field];
  // Without the identity field, the result is kept as its own entry.
  return typeof value === 'string' ? value : JSON.stringify(result);
}

function mergeResearch(
  kind: Exclude<CheckKind, 'domain'>,
  existing: ResearchResult[],
  incoming: ResearchResult[],
): ResearchResult[] {
  if (kind === 'trademark' || kind === 'competitor') {
    // A trademark search or competitor scan is a full result set, so the newest batch replaces the old one.
    return incoming;
  }
  return mergeBy(existing, incoming, (r) => identity(r, kind === 'handle' ? 'platform' : 'domain'));
}

function findName(project: Project, name: string): NameEntry {
  let label: string | undefined;
  try {
    label = nameLabel(name);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }
  const entry = project.names.find((n) => n.name === name || n.label === name || n.label === label);
  if (!entry) {
    throw new StoreError(
      `"${name}" is not in project "${project.slug}"; add it with project_add_names first.`,
    );
  }
  return entry;
}

/** JSON project store: <dir>/<slug>/project.json with a .bak of the previous write. */
export class ProjectStore {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(dir: string, opts: ProjectStoreOptions = {}) {
    this.dir = dir;
    this.now = opts.now ?? (() => new Date());
  }

  paths(slug: string): ProjectPaths {
    const dir = join(this.dir, slug);
    return { dir, projectFile: join(dir, PROJECT_FILE), reportFile: join(dir, REPORT_FILE) };
  }

  async create(brief: unknown, title?: string): Promise<LoadedProject> {
    const data = parseOrThrow(BriefSchema, brief, 'Invalid brief');
    const finalTitle = (title?.trim() || data.subject.what.trim()).slice(0, TITLE_MAX).trim();
    const at = this.now().toISOString();
    await mkdir(this.dir, { recursive: true });
    const slug = await this.claimSlug(slugify(finalTitle));
    const project: Project = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      slug,
      title: finalTitle,
      createdAt: at,
      updatedAt: at,
      brief: { version: 1, createdAt: at, data },
      briefHistory: [],
      names: [],
      checks: {},
      shortlist: [],
    };
    await this.write(project);
    return { project, paths: this.paths(slug), recoveredFromBackup: false };
  }

  async get(slug: string): Promise<LoadedProject> {
    if (!SLUG.test(slug)) throw new StoreError(`"${slug}" is not a valid project slug.`);
    const paths = this.paths(slug);
    try {
      const read = await readJsonWithBackup(paths.projectFile, parseProject);
      return {
        project: read.value,
        paths,
        recoveredFromBackup: read.recoveredFromBackup,
        ...(read.problem === undefined ? {} : { problem: read.problem }),
      };
    } catch (error) {
      if (isNotFound(error)) {
        throw new StoreError(`Project "${slug}" not found. Call project_list to see existing projects.`);
      }
      throw error;
    }
  }

  async list(): Promise<ProjectListing> {
    let slugs: string[];
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      slugs = entries.filter((e) => e.isDirectory() && SLUG.test(e.name)).map((e) => e.name);
    } catch (error) {
      if (isNotFound(error)) return { projects: [], invalid: [] };
      throw error;
    }
    const projects: ProjectSummary[] = [];
    const invalid: ProjectListing['invalid'] = [];
    for (const slug of slugs.sort()) {
      try {
        projects.push(summarize((await this.get(slug)).project));
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        invalid.push({ slug, error: error.message });
      }
    }
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.slug.localeCompare(b.slug));
    return { projects, invalid };
  }

  addNames(
    slug: string,
    names: NewName[],
    weights: ReadonlyMap<string, Weights>,
  ): Promise<Mutation<AddNamesResult>> {
    return this.update(slug, (project, at) => {
      const allowed = [...project.brief.data.nameRules.rulesets, USER_RULESET];
      const known = new Set(project.names.map((n) => n.label));
      const result: AddNamesResult = { added: [], skipped: [] };
      for (const item of names) {
        let label: string;
        try {
          label = nameLabel(item.label ?? item.name);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          result.skipped.push({ name: item.name, reason: error.message });
          continue;
        }
        if (!allowed.includes(item.rulesetId)) {
          result.skipped.push({
            name: item.name,
            reason: `ruleset "${item.rulesetId}" is not one of this project's rulesets (${allowed.join(', ')}).`,
          });
          continue;
        }
        if (known.has(label)) {
          result.skipped.push({ name: item.name, reason: `"${label}" is already in the project.` });
          continue;
        }
        const scoreParts = item.scoreParts ?? {};
        const entry: NameEntry = {
          name: item.name,
          label,
          rulesetId: item.rulesetId,
          briefVersion: project.brief.version,
          strategy: item.strategy,
          rationale: item.rationale,
          scoreParts,
          score: computeScore(scoreParts, weights.get(item.rulesetId) ?? EQUAL_WEIGHTS),
          notes: [],
          addedAt: at,
        };
        project.names.push(entry);
        known.add(label);
        result.added.push(entry);
      }
      return result;
    });
  }

  addChecks(slug: string, batches: CheckBatch[]): Promise<Mutation<StoredChecks[]>> {
    return this.update(slug, (project) =>
      batches.map((batch) => {
        const entry = findName(project, batch.name);
        let checks = project.checks[entry.label];
        if (!checks) {
          checks = emptyChecks();
          project.checks[entry.label] = checks;
        }
        if (batch.kind === 'domain') {
          const incoming = parseOrThrow(
            z.array(DomainCheckSchema),
            batch.results,
            `Invalid domain results for "${batch.name}"`,
          );
          checks.domains = mergeBy(checks.domains, incoming, (c) => c.domain);
          return { name: entry.label, kind: batch.kind, stored: checks.domains.length };
        }
        const incoming = parseOrThrow(
          z.array(ResearchResultSchema),
          batch.results,
          `Invalid ${batch.kind} results for "${batch.name}"`,
        );
        const bucket = RESEARCH_BUCKET[batch.kind];
        checks[bucket] = mergeResearch(batch.kind, checks[bucket], incoming);
        return { name: entry.label, kind: batch.kind, stored: checks[bucket].length };
      }),
    );
  }

  addNotes(slug: string, notes: NewNote[]): Promise<Mutation<{ added: number }>> {
    return this.update(slug, (project, at) => {
      for (const note of notes) {
        findName(project, note.name).notes.push({
          kind: note.kind ?? 'general',
          text: note.text,
          ...(note.language === undefined ? {} : { language: note.language }),
          severity: note.severity ?? 'low',
          createdAt: at,
        });
      }
      return { added: notes.length };
    });
  }

  setShortlist(slug: string, names: string[], mode: ShortlistMode = 'set'): Promise<Mutation<string[]>> {
    return this.update(slug, (project) => {
      const labels = names.map((name) => findName(project, name).label);
      if (mode === 'remove') {
        const drop = new Set(labels);
        project.shortlist = project.shortlist.filter((label) => !drop.has(label));
      } else {
        const base = mode === 'add' ? project.shortlist : [];
        project.shortlist = [...new Set([...base, ...labels])];
      }
      return project.shortlist;
    });
  }

  async updateBrief(slug: string, brief: unknown): Promise<Mutation<{ briefVersion: number }>> {
    const data = parseOrThrow(BriefSchema, brief, 'Invalid brief');
    return this.update(slug, (project, at) => {
      project.briefHistory.push(project.brief);
      project.brief = { version: project.brief.version + 1, createdAt: at, data };
      return { briefVersion: project.brief.version };
    });
  }

  /** Loads, changes, and writes one project under a per-slug lock. Nothing is written on a throw. */
  private update<T>(slug: string, change: (project: Project, at: string) => T): Promise<Mutation<T>> {
    return this.lock(slug, async () => {
      const loaded = await this.get(slug);
      const at = this.now().toISOString();
      const result = change(loaded.project, at);
      loaded.project.updatedAt = at;
      await this.write(loaded.project);
      return { result, loaded };
    });
  }

  private async write(project: Project): Promise<void> {
    const valid = parseOrThrow(ProjectSchema, project, 'Refusing to save an invalid project');
    await writeJsonWithBackup(this.paths(project.slug).projectFile, valid, parseProject);
  }

  /** Claims a slug by creating its folder; mkdir fails with EEXIST when the slug is taken. */
  private async claimSlug(base: string): Promise<string> {
    for (let n = 1; n < 1000; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      try {
        await mkdir(join(this.dir, slug));
        return slug;
      } catch (error) {
        if (!isExists(error)) throw error;
      }
    }
    throw new StoreError(`No free project slug for "${base}".`);
  }

  /** Runs tasks for the same key one after another. */
  private lock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const settled = run.catch(() => undefined);
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return run;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test test/store`
Expected: PASS.

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/store/names.ts server/src/store/project-store.ts server/test/store
git commit -m "feat(store): add the JSON project store with backups and per-project locking"
```

---

### Task 6: Runtime wiring and the ruleset tools

**Files:**
- Create: `server/src/store/runtime-part.ts`, `server/src/tools/project-common.ts`, `server/src/tools/ruleset-list.ts`, `server/src/tools/ruleset-get.ts`, `server/src/tools/ruleset-save.ts`, `server/src/tools/ruleset-delete.ts`, `server/src/tools/register-plan2.ts`
- Modify: `server/src/runtime.ts` (one import, one `extends`, one spread line), `server/src/server.ts` (one import, one call), `server/test/tools/check-domains.test.ts` (one line)
- Test: `server/test/store/runtime-part.test.ts`, `server/test/tools/ruleset-tools.test.ts`

**Interfaces:**
- Consumes: `enginePaths(home)` type (Plan 1 `config.ts`); `HttpFetch` (Plan 1 `http/http.ts`); `HostLimiter` (Plan 1 `limiter/limiter.ts`); `DiskCache` (Plan 1 `cache/cache.ts`); `toolJson`, `toolError` (Plan 1 `tools/result.ts`); `RulesetStore` (Task 2); `ProjectStore`, `LoadedProject` (Task 5); `RulesetSchema` (Task 1); `StoreError` (Task 2); `ValidationError` (Plan 1).
- Produces:
  - `type EnginePaths = ReturnType<typeof enginePaths>`.
  - `interface StoreRuntime { projectStore: ProjectStore; rulesetStore: RulesetStore }`.
  - `interface StoreRuntimeDeps { http: HttpFetch; limiter: HostLimiter; cache: DiskCache }`.
  - `createStoreRuntime(paths: EnginePaths, deps: StoreRuntimeDeps): StoreRuntime`.
  - `Runtime` now `extends StoreRuntime`.
  - `runStoreTool(task: () => Promise<CallToolResult>): Promise<CallToolResult>` (turns `StoreError`/`ValidationError` into `toolError`).
  - `recoveryWarning(loaded: Pick<LoadedProject, 'recoveredFromBackup' | 'problem'>): { warning?: string }`.
  - `assertRulesetsExist(rt: Pick<StoreRuntime, 'rulesetStore'>, ids: readonly string[]): Promise<void>`.
  - Annotation constants `READ_ONLY`, `LOCAL_WRITE`, `LOCAL_OVERWRITE`, `LOCAL_DELETE` (all `openWorldHint: false`).
  - `registerPlan2Tools(server: McpServer, rt: StoreRuntime): void` (this task registers the 4 ruleset tools; Task 7 adds the project tools).
  - MCP tools `ruleset_list`, `ruleset_get`, `ruleset_save`, `ruleset_delete`.

Why the one-line edit to `check-domains.test.ts`: once `Runtime extends StoreRuntime`, the Plan 1 test's `fakeRuntime()` object literal no longer satisfies `Runtime` and `pnpm typecheck` fails. Adding `...({} as Runtime),` is the coordination doc's fake-runtime rule (`{} as Runtime` plus only the needed fields). Plans 3 and 4 hit the same error; if they add the identical line, git merges the identical hunks cleanly.

- [ ] **Step 1: Write the failing tests**

`server/test/store/runtime-part.test.ts`:
```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { enginePaths } from '../../src/config.js';
import type { HttpFetch } from '../../src/http/http.js';
import { HostLimiter } from '../../src/limiter/limiter.js';
import { BUILTIN_RULESETS } from '../../src/rulesets/builtin.js';
import { createRuntime } from '../../src/runtime.js';
import { createStoreRuntime } from '../../src/store/runtime-part.js';
import { loadBrief } from './brief-fixture.js';

const noHttp: HttpFetch = async () => {
  throw new Error('no network in unit tests');
};

describe('createStoreRuntime', () => {
  it('puts projects and custom rulesets under the engine paths', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dne-home-'));
    const paths = enginePaths(home);
    const rt = createStoreRuntime(paths, {
      http: noHttp,
      limiter: new HostLimiter(),
      cache: new DiskCache(paths.cache),
    });
    const base = BUILTIN_RULESETS[0];
    if (!base) throw new Error('no built-ins');
    await rt.rulesetStore.save({ ...base, id: 'mine' });
    expect(JSON.parse(await readFile(join(home, 'rulesets', 'mine.json'), 'utf8')).id).toBe('mine');
    const created = await rt.projectStore.create(await loadBrief(), 'Home Test');
    expect(created.paths.dir).toBe(join(home, 'projects', 'home-test'));
  });

  it('is part of the full runtime', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dne-home-'));
    const rt = createRuntime({ DOMAIN_ENGINE_HOME: home });
    expect((await rt.rulesetStore.list()).rulesets).toHaveLength(9);
    expect(await rt.projectStore.list()).toEqual({ projects: [], invalid: [] });
  });
});
```

`server/test/tools/ruleset-tools.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import { RulesetStore } from '../../src/rulesets/store.js';
import type { Runtime } from '../../src/runtime.js';
import { ProjectStore } from '../../src/store/project-store.js';
import { callJson, connectClient } from '../helpers/mcp.js';

async function setup(): Promise<Client> {
  const home = await mkdtemp(join(tmpdir(), 'dne-ruleset-tools-'));
  const rt: Runtime = {
    ...({} as Runtime),
    projectStore: new ProjectStore(join(home, 'projects')),
    rulesetStore: new RulesetStore(join(home, 'rulesets')),
  };
  return connectClient(rt);
}

async function coinedCopy(client: Client, id: string): Promise<Record<string, unknown>> {
  const res = await callJson(client, 'ruleset_get', { id: 'coined' });
  const { ruleset } = res.data as { ruleset: Record<string, unknown> };
  return { ...ruleset, id, name: 'My coined' };
}

describe('ruleset tools', () => {
  it('registers the four ruleset tools with annotations', async () => {
    const client = await setup();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('ruleset_list')?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(byName.get('ruleset_get')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get('ruleset_save')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get('ruleset_delete')?.annotations).toMatchObject({ destructiveHint: true });
  });

  it('lists the built-in rulesets', async () => {
    const client = await setup();
    const res = await callJson(client, 'ruleset_list', {});
    expect(res.isError).toBe(false);
    const data = res.data as { rulesets: Array<{ id: string; builtin: boolean }>; invalid: unknown[] };
    expect(data.rulesets).toHaveLength(9);
    expect(data.invalid).toEqual([]);
  });

  it('reads one ruleset', async () => {
    const client = await setup();
    const res = await callJson(client, 'ruleset_get', { id: 'dev-tool' });
    expect(res.data).toMatchObject({ builtin: true, ruleset: { id: 'dev-tool' } });
    const missing = await callJson(client, 'ruleset_get', { id: 'nope' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe('Ruleset "nope" not found. Call ruleset_list to see the available ids.');
  });

  it('saves, lists, and deletes a custom ruleset', async () => {
    const client = await setup();
    const saved = await callJson(client, 'ruleset_save', {
      ruleset: await coinedCopy(client, 'my-coined'),
    });
    expect(saved.data).toMatchObject({ created: true, ruleset: { id: 'my-coined' } });
    const listed = await callJson(client, 'ruleset_list', {});
    expect((listed.data as { rulesets: Array<{ id: string; builtin: boolean }> }).rulesets.at(-1)).toEqual(
      expect.objectContaining({ id: 'my-coined', builtin: false }),
    );
    const deleted = await callJson(client, 'ruleset_delete', { id: 'my-coined' });
    expect(deleted.data).toEqual({ deleted: 'my-coined' });
  });

  it('refuses to overwrite or delete a built-in', async () => {
    const client = await setup();
    const saved = await callJson(client, 'ruleset_save', { ruleset: await coinedCopy(client, 'coined') });
    expect(saved.isError).toBe(true);
    expect(saved.text).toContain('is a built-in ruleset id');
    const deleted = await callJson(client, 'ruleset_delete', { id: 'coined' });
    expect(deleted.isError).toBe(true);
    expect(deleted.text).toBe('"coined" is a built-in ruleset and cannot be deleted.');
  });

  it('rejects an invalid ruleset', async () => {
    const client = await setup();
    const ruleset = { ...(await coinedCopy(client, 'bad-one')), length: { min: 9, max: 3 } };
    const res = await callJson(client, 'ruleset_save', { ruleset });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('length.min must not exceed length.max.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test test/store/runtime-part.test.ts test/tools/ruleset-tools.test.ts`
Expected: FAIL. `runtime-part.test.ts` fails with "Failed to load url ../../src/store/runtime-part.js". `ruleset-tools.test.ts` fails because the `ruleset_*` tools are not registered yet (the annotation checks see `undefined`, and calls return `Tool ruleset_get not found`).

- [ ] **Step 3: Write the runtime part**

`server/src/store/runtime-part.ts`:
```ts
import type { DiskCache } from '../cache/cache.js';
import type { enginePaths } from '../config.js';
import type { HttpFetch } from '../http/http.js';
import type { HostLimiter } from '../limiter/limiter.js';
import { RulesetStore } from '../rulesets/store.js';
import { ProjectStore } from './project-store.js';

export type EnginePaths = ReturnType<typeof enginePaths>;

export interface StoreRuntime {
  projectStore: ProjectStore;
  rulesetStore: RulesetStore;
}

/** Shared runtime services. Every plan's runtime part takes the same deps; the store needs none yet. */
export interface StoreRuntimeDeps {
  http: HttpFetch;
  limiter: HostLimiter;
  cache: DiskCache;
}

export function createStoreRuntime(paths: EnginePaths, _deps: StoreRuntimeDeps): StoreRuntime {
  return {
    projectStore: new ProjectStore(paths.projects),
    rulesetStore: new RulesetStore(paths.rulesets),
  };
}
```

- [ ] **Step 4: Make the three allowed shared-file edits**

In `server/src/runtime.ts`, add the import line after the `./sources/whois.js` import:
```ts
import { createStoreRuntime, type StoreRuntime } from './store/runtime-part.js';
```

Change the interface declaration line from:
```ts
export interface Runtime {
```
to:
```ts
export interface Runtime extends StoreRuntime {
```

In the returned object at the end of `createRuntime`, add one spread line after `checkDomains`:
```ts
  return {
    checkDomains: (domains) => checkDomains(domains, deps),
    ...createStoreRuntime(paths, { http, limiter, cache }),
  };
```

In `server/src/server.ts`, add the import line after the `./tools/check-domains.js` import:
```ts
import { registerPlan2Tools } from './tools/register-plan2.js';
```
and the call line directly after `registerCheckDomains(server, rt);`:
```ts
  registerPlan2Tools(server, rt);
```

In `server/test/tools/check-domains.test.ts`, add one line at the top of the object returned by `fakeRuntime()`:
```ts
  return {
    ...({} as Runtime),
    seen,
```

Make no other changes to these three files.

- [ ] **Step 5: Write the shared tool helpers**

`server/src/tools/project-common.ts`:
```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ValidationError } from '../domain/name.js';
import { StoreError } from '../store/errors.js';
import type { LoadedProject } from '../store/project-store.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { toolError } from './result.js';

// Annotations for Plan 2 tools. All of them touch only local files under the engine home.
export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
export const LOCAL_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
export const LOCAL_OVERWRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
export const LOCAL_DELETE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Runs a store-backed tool body and turns expected store failures into tool errors. */
export async function runStoreTool(task: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof StoreError || error instanceof ValidationError) {
      return toolError(error.message);
    }
    throw error;
  }
}

/** A warning to attach to a tool result when project.json was read from its backup. */
export function recoveryWarning(
  loaded: Pick<LoadedProject, 'recoveredFromBackup' | 'problem'>,
): { warning?: string } {
  if (!loaded.recoveredFromBackup) return {};
  return {
    warning: `project.json could not be read (${loaded.problem ?? 'unknown problem'}); the backup project.json.bak was used. Changes made after that backup are lost; tell the user.`,
  };
}

/** Throws StoreError naming the first ruleset id that does not exist. */
export async function assertRulesetsExist(
  rt: Pick<StoreRuntime, 'rulesetStore'>,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) await rt.rulesetStore.get(id);
}
```

- [ ] **Step 6: Write the four ruleset tools and the registrar**

`server/src/tools/ruleset-list.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { READ_ONLY, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerRulesetList(server: McpServer, rt: Pick<StoreRuntime, 'rulesetStore'>): void {
  server.registerTool(
    'ruleset_list',
    {
      title: 'List naming rulesets',
      description:
        'List the 9 built-in and any custom naming rulesets with id, name, description, examples, and builtin flag. Custom files that fail validation are listed under invalid.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runStoreTool(async () => toolJson(await rt.rulesetStore.list())),
  );
}
```

`server/src/tools/ruleset-get.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StoreRuntime } from '../store/runtime-part.js';
import { READ_ONLY, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerRulesetGet(server: McpServer, rt: Pick<StoreRuntime, 'rulesetStore'>): void {
  server.registerTool(
    'ruleset_get',
    {
      title: 'Read a naming ruleset',
      description:
        'Read one ruleset in full: styles and weights, length, filters, TLD order and .com policy, fallback affixes, and score weights.',
      inputSchema: { id: z.string().min(1).max(40).describe('Ruleset id from ruleset_list') },
      annotations: READ_ONLY,
    },
    async ({ id }) => runStoreTool(async () => toolJson(await rt.rulesetStore.get(id))),
  );
}
```

`server/src/tools/ruleset-save.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RulesetSchema } from '../rulesets/schema.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_OVERWRITE, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerRulesetSave(server: McpServer, rt: Pick<StoreRuntime, 'rulesetStore'>): void {
  server.registerTool(
    'ruleset_save',
    {
      title: 'Save a custom ruleset',
      description:
        'Create or replace a custom ruleset in ~/.domain-engine/rulesets/<id>.json. Built-in ids cannot be used. To copy a built-in, read it with ruleset_get, change the id and fields, then save.',
      inputSchema: { ruleset: RulesetSchema },
      annotations: LOCAL_OVERWRITE,
    },
    async ({ ruleset }) => runStoreTool(async () => toolJson(await rt.rulesetStore.save(ruleset))),
  );
}
```

`server/src/tools/ruleset-delete.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_DELETE, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerRulesetDelete(server: McpServer, rt: Pick<StoreRuntime, 'rulesetStore'>): void {
  server.registerTool(
    'ruleset_delete',
    {
      title: 'Delete a custom ruleset',
      description:
        'Delete a custom ruleset file. Built-in rulesets cannot be deleted. Projects keep the ruleset id on names they already have.',
      inputSchema: { id: z.string().min(1).max(40).describe('Custom ruleset id') },
      annotations: LOCAL_DELETE,
    },
    async ({ id }) =>
      runStoreTool(async () => {
        await rt.rulesetStore.delete(id);
        return toolJson({ deleted: id });
      }),
  );
}
```

`server/src/tools/register-plan2.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { registerRulesetDelete } from './ruleset-delete.js';
import { registerRulesetGet } from './ruleset-get.js';
import { registerRulesetList } from './ruleset-list.js';
import { registerRulesetSave } from './ruleset-save.js';

/** Registers every Plan 2 tool: rulesets and the project store. */
export function registerPlan2Tools(server: McpServer, rt: StoreRuntime): void {
  registerRulesetList(server, rt);
  registerRulesetGet(server, rt);
  registerRulesetSave(server, rt);
  registerRulesetDelete(server, rt);
}
```

- [ ] **Step 7: Run all tests and the typecheck**

Run: `cd server && pnpm test && pnpm typecheck`
Expected: all test files PASS (including Plan 1's `check-domains.test.ts`), and `tsc --noEmit` exits 0.

- [ ] **Step 8: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/store/runtime-part.ts server/src/tools/project-common.ts server/src/tools/ruleset-*.ts server/src/tools/register-plan2.ts server/src/runtime.ts server/src/server.ts server/test/store/runtime-part.test.ts server/test/tools/ruleset-tools.test.ts server/test/tools/check-domains.test.ts
git commit -m "feat(server): wire the store runtime and add the ruleset tools"
```

---

### Task 7: Project tools

**Files:**
- Create: `server/src/tools/project-create.ts`, `server/src/tools/project-list.ts`, `server/src/tools/project-get.ts`, `server/src/tools/project-add-names.ts`, `server/src/tools/project-add-checks.ts`, `server/src/tools/project-add-notes.ts`, `server/src/tools/project-shortlist.ts`, `server/src/tools/project-update-brief.ts`
- Modify: `server/src/tools/register-plan2.ts`
- Test: `server/test/tools/project-tools.test.ts`

**Interfaces:**
- Consumes: `BriefSchema` (Task 3); `nonBlank`, `NAME_STYLES`, `type Weights` (Task 1); `CHECK_KINDS`, `NOTE_SEVERITIES`, `LANGUAGE_CODE`, `ScorePartsSchema`, `USER_RULESET` (Tasks 3–4); `ProjectStore` methods (Task 5); `StoreError` (Task 2); `StoreRuntime`, `runStoreTool`, `recoveryWarning`, `assertRulesetsExist`, `READ_ONLY`, `LOCAL_WRITE`, `LOCAL_OVERWRITE` (Task 6).
- Produces MCP tools (inputs → JSON output):
  - `project_create({ brief, title? })` → `{ slug, title, briefVersion, paths }`
  - `project_list({})` → `{ projects: ProjectSummary[], invalid }`
  - `project_get({ slug })` → `{ project, paths, recoveredFromBackup, warning? }`
  - `project_add_names({ slug, names: [{ name, label?, rulesetId, strategy?, rationale?, scoreParts? }] })` → `{ added: [{ name, label, rulesetId, score }], skipped: [{ name, reason }], warning? }`
  - `project_add_checks({ slug, checks: [{ name, kind, results }] })` → `{ stored: [{ name, kind, stored }], warning? }`
  - `project_add_notes({ slug, notes: [{ name, text, kind?, language?, severity? }] })` → `{ added, warning? }`
  - `project_shortlist({ slug, names, mode? })` → `{ shortlist: string[], warning? }`
  - `project_update_brief({ slug, brief })` → `{ slug, briefVersion, warning? }`

- [ ] **Step 1: Write the failing test**

`server/test/tools/project-tools.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import { RulesetStore } from '../../src/rulesets/store.js';
import type { Runtime } from '../../src/runtime.js';
import { ProjectStore } from '../../src/store/project-store.js';
import { loadBrief } from '../store/brief-fixture.js';
import { callJson, connectClient } from '../helpers/mcp.js';

const AT = '2026-11-04T10:00:00.000Z';

const PROJECT_TOOLS = [
  'project_create',
  'project_list',
  'project_get',
  'project_add_names',
  'project_add_checks',
  'project_add_notes',
  'project_shortlist',
  'project_update_brief',
];

async function setup(): Promise<{ client: Client; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'dne-project-tools-'));
  const rt: Runtime = {
    ...({} as Runtime),
    projectStore: new ProjectStore(join(home, 'projects'), { now: () => new Date(AT) }),
    rulesetStore: new RulesetStore(join(home, 'rulesets')),
  };
  return { client: await connectClient(rt), home };
}

async function created(client: Client): Promise<string> {
  const res = await callJson(client, 'project_create', {
    brief: await loadBrief(),
    title: 'FridgePlan',
  });
  expect(res.isError).toBe(false);
  return (res.data as { slug: string }).slug;
}

function domain(name: string, status = 'likely_available') {
  return { domain: name, status, source: 'rdap', confidence: 'high', checkedAt: AT };
}

describe('project tools', () => {
  it('registers all project tools with local-only annotations', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of PROJECT_TOOLS) {
      expect(byName.get(name)?.annotations?.openWorldHint, name).toBe(false);
    }
    expect(byName.get('project_get')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('project_list')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('project_create')?.annotations?.readOnlyHint).toBe(false);
  });

  it('creates a project and returns its slug and paths', async () => {
    const { client, home } = await setup();
    const res = await callJson(client, 'project_create', { brief: await loadBrief(), title: 'FridgePlan' });
    expect(res.data).toEqual({
      slug: 'fridgeplan',
      title: 'FridgePlan',
      briefVersion: 1,
      paths: {
        dir: join(home, 'projects', 'fridgeplan'),
        projectFile: join(home, 'projects', 'fridgeplan', 'project.json'),
        reportFile: join(home, 'projects', 'fridgeplan', 'report.md'),
      },
    });
  });

  it('rejects a brief with a missing required field', async () => {
    const { client } = await setup();
    const brief = await loadBrief();
    const { what: _what, ...subject } = brief.subject;
    const res = await callJson(client, 'project_create', { brief: { ...brief, subject } });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Input validation error');
    expect(res.text).toContain('what');
  });

  it('rejects a brief that names an unknown ruleset', async () => {
    const { client } = await setup();
    const brief = await loadBrief();
    const res = await callJson(client, 'project_create', {
      brief: { ...brief, nameRules: { rulesets: ['nope'] } },
    });
    expect(res.isError).toBe(true);
    expect(res.text).toBe('Ruleset "nope" not found. Call ruleset_list to see the available ids.');
  });

  it('runs a full round: names, checks, notes, shortlist, get', async () => {
    const { client } = await setup();
    const slug = await created(client);

    const names = await callJson(client, 'project_add_names', {
      slug,
      names: [
        {
          name: 'Fridgely',
          rulesetId: 'coined',
          strategy: 'invented',
          scoreParts: { length: 8, say: 9, spell: 7 },
        },
        { name: 'Leftover Lab', rulesetId: 'compound', strategy: 'compound' },
        { name: 'Fridgely', rulesetId: 'coined' },
        { name: 'Ghost', rulesetId: 'nope' },
      ],
    });
    expect(names.data).toEqual({
      added: [
        { name: 'Fridgely', label: 'fridgely', rulesetId: 'coined', score: 80.8 },
        { name: 'Leftover Lab', label: 'leftoverlab', rulesetId: 'compound', score: null },
      ],
      skipped: [
        { name: 'Fridgely', reason: '"fridgely" is already in the project.' },
        {
          name: 'Ghost',
          reason: 'ruleset "nope" is not one of this project\'s rulesets (coined, compound, user).',
        },
      ],
    });

    const checks = await callJson(client, 'project_add_checks', {
      slug,
      checks: [
        { name: 'Fridgely', kind: 'domain', results: [domain('fridgely.com'), domain('fridgely.io')] },
        {
          name: 'Fridgely',
          kind: 'handle',
          results: [
            { platform: 'github', status: 'available', source: 'github-api', checkedAt: AT, confidence: 'high' },
          ],
        },
      ],
    });
    expect(checks.data).toEqual({
      stored: [
        { name: 'fridgely', kind: 'domain', stored: 2 },
        { name: 'fridgely', kind: 'handle', stored: 1 },
      ],
    });

    const notes = await callJson(client, 'project_add_notes', {
      slug,
      notes: [{ name: 'Fridgely', kind: 'language', language: 'de', severity: 'low', text: 'Fine in German.' }],
    });
    expect(notes.data).toEqual({ added: 1 });

    const shortlist = await callJson(client, 'project_shortlist', { slug, names: ['Fridgely', 'Leftover Lab'] });
    expect(shortlist.data).toEqual({ shortlist: ['fridgely', 'leftoverlab'] });
    const trimmed = await callJson(client, 'project_shortlist', {
      slug,
      names: ['leftoverlab'],
      mode: 'remove',
    });
    expect(trimmed.data).toEqual({ shortlist: ['fridgely'] });

    const got = await callJson(client, 'project_get', { slug });
    const data = got.data as {
      project: {
        schemaVersion: number;
        names: Array<{ label: string; notes: unknown[] }>;
        checks: Record<string, { domains: unknown[]; handles: unknown[] }>;
        shortlist: string[];
      };
      recoveredFromBackup: boolean;
      paths: { reportFile: string };
    };
    expect(data.recoveredFromBackup).toBe(false);
    expect(data.project.schemaVersion).toBe(1);
    expect(data.project.names.map((n) => n.label)).toEqual(['fridgely', 'leftoverlab']);
    expect(data.project.names[0]?.notes).toHaveLength(1);
    expect(data.project.checks.fridgely?.domains).toHaveLength(2);
    expect(data.project.checks.fridgely?.handles).toHaveLength(1);
    expect(data.project.shortlist).toEqual(['fridgely']);
    expect(data.paths.reportFile.endsWith(join('fridgeplan', 'report.md'))).toBe(true);
  });

  it('returns tool errors for unknown projects and names', async () => {
    const { client } = await setup();
    const missing = await callJson(client, 'project_get', { slug: 'nope' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe('Project "nope" not found. Call project_list to see existing projects.');
    const slug = await created(client);
    const res = await callJson(client, 'project_add_checks', {
      slug,
      checks: [{ name: 'Nobody', kind: 'domain', results: [domain('nobody.com')] }],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toBe('"Nobody" is not in project "fridgeplan"; add it with project_add_names first.');
  });

  it('versions the brief', async () => {
    const { client } = await setup();
    const slug = await created(client);
    const brief = await loadBrief();
    const res = await callJson(client, 'project_update_brief', {
      slug,
      brief: { ...brief, positioning: { ...brief.positioning, priceTier: 'premium' } },
    });
    expect(res.data).toEqual({ slug, briefVersion: 2 });
    const got = await callJson(client, 'project_get', { slug });
    expect(got.data).toMatchObject({
      project: { brief: { version: 2, data: { positioning: { priceTier: 'premium' } } } },
    });
  });

  it('lists projects', async () => {
    const { client } = await setup();
    await created(client);
    const res = await callJson(client, 'project_list', {});
    expect(res.data).toMatchObject({
      projects: [{ slug: 'fridgeplan', title: 'FridgePlan', briefVersion: 1, names: 0 }],
      invalid: [],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/tools/project-tools.test.ts`
Expected: FAIL; the first test reports `undefined` annotations for `project_create` (tool not registered), and the calls return `Tool project_create not found` errors.

- [ ] **Step 3: Write the eight project tools**

`server/src/tools/project-create.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nonBlank } from '../rulesets/schema.js';
import { BriefSchema } from '../store/brief.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { assertRulesetsExist, LOCAL_WRITE, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectCreate(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_create',
    {
      title: 'Create a naming project',
      description:
        'Create a project from a brief the user has confirmed. Rejects a brief with missing required fields or unknown ruleset ids. Returns the slug that every other project_* tool takes, and the project paths.',
      inputSchema: {
        brief: BriefSchema,
        title: nonBlank(80)
          .optional()
          .describe('Short project title; the slug is derived from it. Defaults to subject.what.'),
      },
      annotations: LOCAL_WRITE,
    },
    async ({ brief, title }) =>
      runStoreTool(async () => {
        await assertRulesetsExist(rt, brief.nameRules.rulesets);
        const { project, paths } = await rt.projectStore.create(brief, title);
        return toolJson({
          slug: project.slug,
          title: project.title,
          briefVersion: project.brief.version,
          paths,
        });
      }),
  );
}
```

`server/src/tools/project-list.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { READ_ONLY, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectList(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_list',
    {
      title: 'List naming projects',
      description:
        'List saved projects, newest first, with slug, title, brief version, rulesets, and name and shortlist counts. Unreadable projects are listed under invalid.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runStoreTool(async () => toolJson(await rt.projectStore.list())),
  );
}
```

`server/src/tools/project-get.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StoreRuntime } from '../store/runtime-part.js';
import { READ_ONLY, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectGet(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_get',
    {
      title: 'Read a naming project',
      description:
        'Read a full project: brief (current version and history), names with ruleset, brief version, score and notes, checks keyed by name label, and shortlist. Also returns paths, including reportFile for report.md. If project.json was damaged, the backup is returned with a warning.',
      inputSchema: { slug: z.string().min(1).max(60).describe('Project slug from project_list') },
      annotations: READ_ONLY,
    },
    async ({ slug }) =>
      runStoreTool(async () => {
        const loaded = await rt.projectStore.get(slug);
        return toolJson({
          project: loaded.project,
          paths: loaded.paths,
          recoveredFromBackup: loaded.recoveredFromBackup,
          ...recoveryWarning(loaded),
        });
      }),
  );
}
```

`server/src/tools/project-add-names.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NAME_STYLES, nonBlank, type Weights } from '../rulesets/schema.js';
import { StoreError } from '../store/errors.js';
import { ScorePartsSchema, USER_RULESET } from '../store/project-schema.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_WRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectAddNames(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_add_names',
    {
      title: 'Add names to a project',
      description:
        'Add generated or user-supplied names. Each name records its ruleset and the current brief version. Give scoreParts (0-10 per criterion); the server computes score (0-100) with the ruleset weights. Duplicates and names from rulesets outside the brief are skipped with a reason.',
      inputSchema: {
        slug: z.string().min(1).max(60),
        names: z
          .array(
            z.object({
              name: nonBlank(63).describe('Display form, e.g. "Leftover Lab"'),
              label: z
                .string()
                .max(63)
                .optional()
                .describe('Domain label if it differs from the name without spaces'),
              rulesetId: z
                .string()
                .min(1)
                .max(40)
                .describe(`Ruleset the name came from, or "${USER_RULESET}" for a name the user supplied`),
              strategy: z.enum(NAME_STYLES).optional(),
              rationale: nonBlank(500).optional().describe('One line on why the name fits the brief'),
              scoreParts: ScorePartsSchema.optional().describe(
                'Ratings 0-10: length, say, spell, meaning, uniqueness, price. Leave price out until prices are known.',
              ),
            }),
          )
          .min(1)
          .max(100),
      },
      annotations: LOCAL_WRITE,
    },
    async ({ slug, names }) =>
      runStoreTool(async () => {
        const weights = new Map<string, Weights>();
        for (const id of new Set(names.map((n) => n.rulesetId))) {
          if (id === USER_RULESET) continue;
          try {
            weights.set(id, (await rt.rulesetStore.get(id)).ruleset.weights);
          } catch (error) {
            // Unknown ids are skipped per name by the store with a clearer reason.
            if (!(error instanceof StoreError)) throw error;
          }
        }
        const { result, loaded } = await rt.projectStore.addNames(slug, names, weights);
        return toolJson({
          added: result.added.map(({ name, label, rulesetId, score }) => ({
            name,
            label,
            rulesetId,
            score,
          })),
          skipped: result.skipped,
          ...recoveryWarning(loaded),
        });
      }),
  );
}
```

`server/src/tools/project-add-checks.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CHECK_KINDS } from '../store/project-schema.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_WRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectAddChecks(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_add_checks',
    {
      title: 'Attach check results to names',
      description:
        'Store check results under a name. kind "domain" takes check_domains results as returned. kinds "profile", "handle", and "trademark" take profile_domain, check_handles, and search_trademarks results as returned; kind "competitor" takes competitor-scan findings (source "websearch", checkedAt, url). Non-domain results are stored as given. Newer results replace older ones for the same domain (domain, profile) or platform (handle); a new trademark or competitor batch replaces the previous one.',
      inputSchema: {
        slug: z.string().min(1).max(60),
        checks: z
          .array(
            z.object({
              name: z.string().min(1).max(63).describe('Name or label already in the project'),
              kind: z.enum(CHECK_KINDS),
              results: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
            }),
          )
          .min(1)
          .max(100),
      },
      annotations: LOCAL_WRITE,
    },
    async ({ slug, checks }) =>
      runStoreTool(async () => {
        const { result, loaded } = await rt.projectStore.addChecks(slug, checks);
        return toolJson({ stored: result, ...recoveryWarning(loaded) });
      }),
  );
}
```

`server/src/tools/project-add-notes.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { nonBlank } from '../rulesets/schema.js';
import { LANGUAGE_CODE } from '../store/brief.js';
import { NOTE_SEVERITIES } from '../store/project-schema.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_WRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectAddNotes(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_add_notes',
    {
      title: 'Attach notes to names',
      description:
        'Append notes to names, for example language-check findings (kind "language", language as a BCP 47 code). severity is the risk level: low, medium, or high.',
      inputSchema: {
        slug: z.string().min(1).max(60),
        notes: z
          .array(
            z.object({
              name: z.string().min(1).max(63).describe('Name or label already in the project'),
              text: nonBlank(2000),
              kind: nonBlank(40).optional().describe('Defaults to "general"'),
              language: z.string().regex(LANGUAGE_CODE).optional(),
              severity: z.enum(NOTE_SEVERITIES).optional().describe('Defaults to "low"'),
            }),
          )
          .min(1)
          .max(200),
      },
      annotations: LOCAL_WRITE,
    },
    async ({ slug, notes }) =>
      runStoreTool(async () => {
        const { result, loaded } = await rt.projectStore.addNotes(slug, notes);
        return toolJson({ ...result, ...recoveryWarning(loaded) });
      }),
  );
}
```

`server/src/tools/project-shortlist.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_OVERWRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectShortlist(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_shortlist',
    {
      title: 'Set the shortlist',
      description:
        'Set, extend, or trim the shortlist of names for research and the report. mode "set" (default) replaces it, "add" appends, "remove" drops. An empty list with mode "set" clears it.',
      inputSchema: {
        slug: z.string().min(1).max(60),
        names: z.array(z.string().min(1).max(63)).max(50),
        mode: z.enum(['set', 'add', 'remove']).default('set'),
      },
      annotations: LOCAL_OVERWRITE,
    },
    async ({ slug, names, mode }) =>
      runStoreTool(async () => {
        const { result, loaded } = await rt.projectStore.setShortlist(slug, names, mode);
        return toolJson({ shortlist: result, ...recoveryWarning(loaded) });
      }),
  );
}
```

`server/src/tools/project-update-brief.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BriefSchema } from '../store/brief.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { assertRulesetsExist, LOCAL_WRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectUpdateBrief(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_update_brief',
    {
      title: 'Save a new brief version',
      description:
        'Replace the brief with an edited, user-confirmed version. The old brief moves to briefHistory and the version number goes up by one; existing names keep the version they were made with.',
      inputSchema: { slug: z.string().min(1).max(60), brief: BriefSchema },
      annotations: LOCAL_WRITE,
    },
    async ({ slug, brief }) =>
      runStoreTool(async () => {
        await assertRulesetsExist(rt, brief.nameRules.rulesets);
        const { result, loaded } = await rt.projectStore.updateBrief(slug, brief);
        return toolJson({ slug, ...result, ...recoveryWarning(loaded) });
      }),
  );
}
```

- [ ] **Step 4: Register the project tools**

Replace `server/src/tools/register-plan2.ts` with:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { registerProjectAddChecks } from './project-add-checks.js';
import { registerProjectAddNames } from './project-add-names.js';
import { registerProjectAddNotes } from './project-add-notes.js';
import { registerProjectCreate } from './project-create.js';
import { registerProjectGet } from './project-get.js';
import { registerProjectList } from './project-list.js';
import { registerProjectShortlist } from './project-shortlist.js';
import { registerProjectUpdateBrief } from './project-update-brief.js';
import { registerRulesetDelete } from './ruleset-delete.js';
import { registerRulesetGet } from './ruleset-get.js';
import { registerRulesetList } from './ruleset-list.js';
import { registerRulesetSave } from './ruleset-save.js';

/** Registers every Plan 2 tool: rulesets and the project store. */
export function registerPlan2Tools(server: McpServer, rt: StoreRuntime): void {
  registerRulesetList(server, rt);
  registerRulesetGet(server, rt);
  registerRulesetSave(server, rt);
  registerRulesetDelete(server, rt);
  registerProjectCreate(server, rt);
  registerProjectList(server, rt);
  registerProjectGet(server, rt);
  registerProjectAddNames(server, rt);
  registerProjectAddChecks(server, rt);
  registerProjectAddNotes(server, rt);
  registerProjectShortlist(server, rt);
  registerProjectUpdateBrief(server, rt);
}
```

- [ ] **Step 5: Run all tests and the typecheck**

Run: `cd server && pnpm test && pnpm typecheck`
Expected: all test files PASS; `tsc --noEmit` exits 0.

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/tools/project-*.ts server/src/tools/register-plan2.ts server/test/tools/project-tools.test.ts
git commit -m "feat(server): add the project tools"
```

---

### Task 8: The `brief` skill

**Files:**
- Create: `skills/brief/SKILL.md`
- Test: `server/test/tools/project-skills.test.ts`

**Interfaces:**
- Consumes: MCP tools `ruleset_list`, `ruleset_get`, `ruleset_save`, `project_create`, `project_list`, `project_get`, `project_update_brief` (Tasks 6–7); `skills/brief/templates/brief.md` (Task 3).
- Produces: skill `brief` (invoked by name from `find-domain`). It ends with a saved project and reports the slug.

- [ ] **Step 1: Write the failing skill check**

`server/test/tools/project-skills.test.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Runtime } from '../../src/runtime.js';
import { connectClient } from '../helpers/mcp.js';

const SKILLS = ['brief'];

// Tool names from the spec's MCP tools table, plus Plan 2's project_update_brief.
const KNOWN_TOOLS = [
  'check_domains',
  'profile_domain',
  'check_handles',
  'search_trademarks',
  'project_create',
  'project_list',
  'project_get',
  'project_add_names',
  'project_add_checks',
  'project_add_notes',
  'project_shortlist',
  'project_update_brief',
  'ruleset_list',
  'ruleset_get',
  'ruleset_save',
  'ruleset_delete',
  'tld_info',
  'registrar_quote',
  'registrar_status',
];

const TOOL_TOKEN = /\b(?:check|profile|search|project|ruleset|tld|registrar)_[a-z_]+\b/g;

async function skill(name: string): Promise<string> {
  return readFile(new URL(`../../../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
}

describe('Plan 2 skills', () => {
  it.each(SKILLS)('%s has frontmatter with its name and a trigger description', async (name) => {
    const match = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(await skill(name));
    expect(match?.[1]).toBe(name);
    expect(match?.[2]).toMatch(/^Use when /);
  });

  it.each(SKILLS)('%s names only known tools', async (name) => {
    const tokens = (await skill(name)).match(TOOL_TOKEN) ?? [];
    expect(tokens.filter((token) => !KNOWN_TOOLS.includes(token))).toEqual([]);
  });

  it.each(SKILLS)('%s has no emoji', async (name) => {
    expect(await skill(name)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('every project_* and ruleset_* tool a skill names is registered', async () => {
    const client = await connectClient({} as Runtime);
    const registered = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const name of SKILLS) {
      for (const token of (await skill(name)).match(TOOL_TOKEN) ?? []) {
        if (/^(?:project|ruleset)_/.test(token)) expect(registered.has(token), token).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && pnpm test test/tools/project-skills.test.ts`
Expected: FAIL with `ENOENT: no such file or directory` for `skills/brief/SKILL.md`.

- [ ] **Step 3: Write the skill**

`skills/brief/SKILL.md`:
````markdown
---
name: brief
description: Use when starting or editing the brief for a brand naming project - the user describes a product, startup, or personal brand that needs a name or domain, hands over a filled brief template, or wants to change a brief, its rulesets, or a custom naming ruleset. Fills the fixed 7-section questionnaire, picks 1-3 naming rulesets, confirms with the user, and saves the project.
---

# Brief

The brief is the subject matter of the brand. Every later step (`generate`, `research`, `language-check`, `report`) reads it, so it comes from a fixed questionnaire and is saved only after the user confirms it.

## Tools

- `ruleset_list`, `ruleset_get`, `ruleset_save`: rulesets to pick from, and custom rulesets.
- `project_create`: save a new project from a confirmed brief.
- `project_list`, `project_get`, `project_update_brief`: find an existing project and save a new version of its brief.

## Rules

- Ask one question at a time. Offer multiple-choice options when the field has fixed values.
- Never invent answers to required questions. Take them from what the user gave you, or ask.
- Do not save before the user confirms the summary.
- No emoji and no urgency copy.

## Step 1: Pick the input path

- The user gave a file path (usually a filled copy of `templates/brief.md` from this skill's folder): read it and go to Step 3.
- The user pasted a description of the product: go to Step 3.
- Otherwise run the interview in Step 2. If the user would rather fill a file, give them the path of `templates/brief.md` in this skill's folder and wait for it.
- The user wants to change an existing project's brief: call `project_list`, let them pick, call `project_get`, and use `project.brief.data` as the starting answers. Ask what to change, then go to Step 5.

## Step 2: Interview

Ask in this order. R = required, O = optional. Tell the user they can skip optional questions.

### 1. Subject
1. R `subject.what`: What is it, in one sentence?
2. R `subject.category`: What category or industry is it in?
3. R `subject.problem`: What problem does it solve, and for whom?
4. O `subject.features`: Key features or offer?
5. O `subject.keywords`: Descriptive keywords? Offer 5-8 keywords from the earlier answers to accept or edit.

### 2. Audience and markets
6. R `audience.who`: Who buys or uses it?
7. R `audience.segment`: Options: B2B (`b2b`), B2C (`b2c`), both (`both`).
8. R `audience.countries`: Which countries? Store ISO 3166-1 alpha-2 codes in uppercase (`DE`, `US`, `GB`).
9. R `audience.languages`: Which languages? Store BCP 47 codes (`en`, `de`, `pt-BR`). Suggest the main languages of the chosen countries.

### 3. Positioning
10. O `positioning.competitors`: 3-5 competitors, by name or URL (store at most 5).
11. O `positioning.difference`: What makes it different?
12. R `positioning.priceTier`: Options: budget, mid, premium.

### 4. Personality
13. R `personality.tone`: Three words for the tone, exactly three. Offer two or three sets that fit the earlier answers.
14. O `personality.archetype`: Options: Sage, Hero, Creator, Explorer, Outlaw, Magician, Lover, Jester, Everyman, Caregiver, Ruler, Innocent. Store it in lowercase.
15. O `personality.avoid`: Words or feelings to avoid.

### 5. Name rules
16. R `nameRules.rulesets`: Pick 1-3 rulesets. See Step 4.
17. O `nameRules.overrides`: For this project only: `minLength`, `maxLength`, words to `include`, words to `ban`, `extraTlds` (lowercase, no dot: `app`, `co.uk`).
18. O `nameRules.handles`: Which social handles matter? Options: github, npm, pypi, reddit, x, instagram, tiktok, youtube, linkedin.

### 6. Future
19. O `future.scope`: Will the brand grow past this product? Options: broad name (`broad`), narrow name (`narrow`).

### 7. Mode
20. R `mode.type`: Options: startup (`startup`), personal brand (`personal`), product (`product`).
21. Personal brand only, all required: `mode.fullName` (full name), `mode.profession` (profession), `mode.nameForms` (accepted name forms, for example "Jane Doe", "J. Doe", "Jane Doe Design").

If the first message already suggests a personal brand, ask question 20 right after question 1 so the later questions fit.

## Step 3: Template or free text

- Template: each question in the file has a `<!-- field.path -->` marker and an `Answer:` line. Map every non-empty answer to its field. Convert country names to ISO codes and language names to BCP 47 codes. Split comma-separated lists.
- Free text: fill every field the text supports. Leave out fields the text does not support; do not guess them.
- Then ask only for the required fields that are still missing, one at a time, as in Step 2. Offer the remaining optional questions in one message the user can skip.

## Step 4: Pick rulesets

Call `ruleset_list`. Suggest 1-3 rulesets with one line each on why. Starting points:

| Brief signal | Suggest |
|---|---|
| `mode.type` is `personal` | `personal` |
| Developer audience: CLI, API, library, open-source tool | `dev-tool` |
| Local service in one place | `local-business` |
| `priceTier` premium, or a short exact `.com` is the goal | `premium` |
| `priceTier` budget, or the lowest renewal cost matters most | `budget` |
| Plain names that say what it does | `descriptive` |
| A distinctive brand, open to new words | `coined`, `evocative`, `compound` |

Custom rulesets are in the same list with `builtin: false`. Suggest them when they fit.

If the user wants a custom ruleset:
1. Copy: call `ruleset_get` on a built-in, change what the user asks (length, styles, TLD order, `.com` policy, affixes, weights), give it a new lowercase id that is not a built-in id, and save it with `ruleset_save`.
2. From scratch: ask for `name`, `description`, 3-5 `examples`, `styles` with weights (descriptive, compound, invented, metaphor, misspelling, affix, person-name, place-service), `length` min and max, `filters` (hyphens, numbers, banned letter pairs, banned words), `tlds` (`order`, `countryFirst`, `com` as must, nice, or none, and `affixes` such as `get-` or `-hq`), and `weights` from 0 to 1 for length, say, spell, meaning, uniqueness, and price. Save it with `ruleset_save`.
3. If `ruleset_save` returns an error, explain it in plain words, fix the field with the user, and save again.

## Step 5: Confirm and save

1. Show the brief as a short summary grouped by the 7 sections, with the chosen rulesets. Show skipped optional fields as "not given".
2. Ask the user to confirm or correct it. If anything changes, show the summary again.
3. On confirmation:
   - New project: call `project_create` with the brief and a short `title` (the working name, or the product in 2-4 words).
   - Existing project: call `project_update_brief`. Tell the user this saves brief version N and that existing names keep the version they were made with.
4. If the tool returns an error, explain it in plain words, ask for the missing or wrong field, and call the tool again.
5. Tell the user the project slug and the next step, `generate`. When `find-domain` invoked this skill, it continues on its own.

## Brief shape

`project_create` and `project_update_brief` take this shape. Optional fields may be left out.

```json
{
  "subject": { "what": "...", "category": "...", "problem": "...", "features": ["..."], "keywords": ["..."] },
  "audience": { "who": "...", "segment": "b2c", "countries": ["DE"], "languages": ["de", "en"] },
  "positioning": { "competitors": ["..."], "difference": "...", "priceTier": "mid" },
  "personality": { "tone": ["warm", "practical", "playful"], "archetype": "caregiver", "avoid": ["..."] },
  "nameRules": {
    "rulesets": ["coined", "compound"],
    "overrides": { "minLength": 4, "maxLength": 10, "include": ["..."], "ban": ["..."], "extraTlds": ["app"] },
    "handles": ["instagram"]
  },
  "future": { "scope": "broad" },
  "mode": { "type": "startup" }
}
```

For a personal brand, `mode` is `{ "type": "personal", "fullName": "...", "profession": "...", "nameForms": ["..."] }`.
````

- [ ] **Step 4: Run the skill check to verify it passes**

Run: `cd server && pnpm test test/tools/project-skills.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual eval prompt (run by hand before release, per the spec)**

With the plugin loaded (`claude --plugin-dir .` from the repo root, after a local `cd server && pnpm build`; do not commit the build), send:
`I'm building a mobile app that plans weekly meals from leftovers in the fridge, for busy parents in Germany and the UK. Help me set up the naming brief.`
Expected: the skill extracts the subject, audience, and countries (`DE`, `GB`), asks one question at a time for the missing required fields (price tier, tone, mode, rulesets), suggests 1-3 rulesets after `ruleset_list`, shows a 7-section summary, and calls `project_create` only after you confirm. Afterwards run `git restore server/dist`.

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm test && cd ..
git add skills/brief/SKILL.md server/test/tools/project-skills.test.ts
git commit -m "feat(skills): add the brief skill"
```

---

### Task 9: The `generate` skill and the TLD guide

**Files:**
- Create: `skills/generate/SKILL.md`, `skills/generate/references/tlds.md`
- Modify: `server/test/tools/project-skills.test.ts` (one line: the `SKILLS` list)

**Interfaces:**
- Consumes: MCP tools `project_list`, `project_get`, `ruleset_get`, `project_add_names`, `project_add_checks`, `project_shortlist` (Tasks 6–7) and `check_domains` (Plan 1). `check_domains` returns `{ results: DomainCheck[], note }` and accepts at most 200 domains per call.
- Produces: skill `generate`. It leaves the project with names (each with `rulesetId`, `briefVersion`, `score`), domain checks for each ruleset's first TLDs, and a user-picked shortlist.

- [ ] **Step 1: Extend the skill check so it fails**

In `server/test/tools/project-skills.test.ts`, change:
```ts
const SKILLS = ['brief'];
```
to:
```ts
const SKILLS = ['brief', 'generate'];
```

Run: `cd server && pnpm test test/tools/project-skills.test.ts`
Expected: FAIL with `ENOENT` for `skills/generate/SKILL.md`.

- [ ] **Step 2: Write the skill**

`skills/generate/SKILL.md`:
````markdown
---
name: generate
description: Use when a naming project has a saved brief and needs name candidates, or the user asks for more or different names - produces 30-60 names split across the project's rulesets, applies each ruleset's filters and score weights, saves them, runs a quick domain availability filter on each ruleset's first TLDs, and asks the user for a shortlist.
---

# Generate

## Tools

- `project_list`, `project_get`: read the brief, earlier names, and the shortlist.
- `ruleset_get`: the full rules for each chosen ruleset.
- `project_add_names`: save names with ruleset, strategy, rationale, and score parts.
- `check_domains`: the quick availability filter.
- `project_add_checks`: save the domain results.
- `project_shortlist`: save the names the user picks.

`references/tlds.md` in this skill's folder explains TLD choices.

## Rules

- Say "likely available" only for a domain whose `check_domains` status is `likely_available`. Say "registered" for `registered` and "unknown" for `unknown`. Never write "available" on its own, and never guess a status.
- `likely_available` cannot see premium or registry-reserved names. Repeat the tool's `note` once in your summary.
- Do not mention prices. The `report` skill shows prices with their source and date.
- No emoji, no urgency copy.

## Step 1: Load

1. Take the slug from the conversation, or call `project_list` and ask which project.
2. Call `project_get`. Use `project.brief.data` (the current brief) and `project.brief.version`.
3. Call `ruleset_get` for each id in `brief.nameRules.rulesets`.
4. Collect the existing labels (`project.names[].label`) so you do not repeat them. If the user gave feedback on an earlier round (liked, disliked, why), use it.

## Step 2: Plan the round

- Total: 30-60 names per round. Split across rulesets: 1 ruleset gets about 40, 2 get about 25 each, 3 get 15-20 each. Fewer is fine when a ruleset's rules are tight, such as `personal`.
- Within a ruleset, split by its `styles` weights. Example: `invented` 0.8 and `misspelling` 0.2 with 20 names gives 16 and 4.
- Seed words: `subject.keywords`, `subject.category`, `subject.features`, words from `subject.what` and `subject.problem`, and `nameRules.overrides.include`. Look at the competitors' naming patterns and stay clear of them.
- `personality.tone` and `personality.archetype` steer word choice and sound. `future.scope` broad means avoid names tied to one feature; narrow allows them.
- For `mode.type` personal, build names only from `mode.fullName` and `mode.nameForms`, plus `mode.profession` for forms such as initials plus role.

## Step 3: Generate and filter

Write the candidates, then drop every name that breaks a rule. The ruleset sets the base rules; `nameRules.overrides` apply on top for this project only.

- Length of the domain label: between `length.min` and `length.max`. `overrides.minLength` and `overrides.maxLength` replace them when set.
- No hyphens unless `filters.hyphens` is true. No digits unless `filters.numbers` is true.
- No letter pair from `filters.bannedPairs` anywhere in the label.
- No word from `filters.bannedWords`, `overrides.ban`, or `personality.avoid`, also not inside a compound.
- The label must be a valid domain label: lowercase ASCII letters, digits, and inner hyphens, 1-63 characters.
- Drop well-known brand names and near copies of a competitor's name.

## Step 4: Score

Rate each name from 0 to 10 on each criterion and send the ratings as `scoreParts`. The server computes `score` (0-100) with the ruleset's `weights`.

- `length`: shorter within the ruleset range scores higher.
- `say`: easy to say on first sight in the brief's languages.
- `spell`: easy to spell after hearing it once.
- `meaning`: fits the subject, tone, and archetype.
- `uniqueness`: distinct from competitors and common words.
- Leave out `price`. Renewal prices are not known at this step.

## Step 5: Save

Call `project_add_names` (up to 100 names per call). For each name send `name` (display form), `rulesetId`, `strategy` (the style used), a one-line `rationale`, and `scoreParts`. Send `label` only when the domain label is not the name without spaces. For names the user brings, use `rulesetId` `"user"`.
Mention skipped names only when the reason matters to the user.

## Step 6: Quick availability filter

For each ruleset:

1. Start from `tlds.order`. If `tlds.countryFirst` is true, put the ccTLD of the first country in `audience.countries` first: the lowercase code, except `GB`, which uses `uk`. Remove duplicates.
2. Take the first 2 TLDs. If `tlds.com` is `must` and `com` is not among them, add `com`.
3. Call `check_domains` with that ruleset's new labels and those TLDs. Keep each call at 200 domains or fewer (labels times TLDs); split into more calls when needed.
4. If `tlds.com` is `must` and a name's `.com` is `registered`, check up to 3 of the ruleset's `tlds.affixes` on `.com`. The hyphen only marks the position: `get-` means `get<label>.com`, and `-hq` means `<label>hq.com`.
5. Save every result with `project_add_checks`, kind `"domain"`, under the base name, affix variants included. Pass the result objects exactly as `check_domains` returned them.
6. If `check_domains` returns a tool error, tell the user, keep the names, and go on without the filter.

Do not check `overrides.extraTlds` here. The `research` skill checks them for the shortlist.

## Step 7: Present and shortlist

1. Show the top names grouped by ruleset and sorted by score: name, strategy, score, and each checked domain with its status in the exact words from the Rules. Put names with at least one `likely_available` domain first.
2. Ask the user to pick a shortlist (suggest 5-10 names), to ask for another round, or to change the brief (then use the `brief` skill).
3. Save the pick with `project_shortlist`: mode `set`, or `add` to extend an existing shortlist.
4. For another round, repeat from Step 2 with the user's feedback. New names carry the current brief version automatically.
````

`skills/generate/references/tlds.md`:
```markdown
# TLD guide

Use this when choosing TLDs and explaining them to the user. It has no prices: prices come from `tld_info` and `registrar_quote` in the `report` step, with their source and date.

## .com

- Still the TLD people type by default and trust most, especially for B2C and outside tech.
- A short exact `.com` is often registered. Affix fallbacks (`get`, `try`, `use`, `hq`, `app`) keep the brand on `.com` at the cost of length.

## Generic alternatives

- `.co`, `.io`, `.ai`, `.app`, `.dev`, `.sh`, and `.xyz` are common for startups and tech products.
- `.app` and `.dev` are on the HSTS preload list, so sites on them must use HTTPS.
- `.io` (British Indian Ocean Territory), `.ai` (Anguilla), and `.sh` (Saint Helena) are country codes used as generic TLDs. Their registry rules follow those territories.

## Country TLDs

- A country TLD signals a local business and can build local trust: `.de`, `.fr`, `.nl`, `.uk`, `.ca`, `.com.au`.
- Some need a local presence or a registered business, for example `.ca`, `.com.au`, and `.fr` for holders outside the EU. Check the registry rules before recommending one.
- Map ISO country codes to ccTLDs in lowercase. The exception is `GB`, which uses `.uk`.

## Low-cost TLDs

- `.sbs`, `.site`, `.online`, `.store`, `.space`, `.lol`, `.bond`, and `.xyz` often have a very low first-year price and a much higher renewal price. Compare renewal prices, not first-year prices.
- Spam filters and security tools flag several low-cost TLDs more often. That can hurt email delivery and trust. The `report` step shows each TLD's reputation note.
- Not every registrar sells every TLD.

## Status words

- `likely_available` from `check_domains` means RDAP, WHOIS, and DNS found no registration. These free sources cannot see premium or registry-reserved names, so the user must confirm at a registrar.
```

- [ ] **Step 3: Run the skill check to verify it passes**

Run: `cd server && pnpm test test/tools/project-skills.test.ts`
Expected: PASS.

- [ ] **Step 4: Manual eval prompt (run by hand before release)**

With the plugin loaded and the project from Task 8's eval in place, send:
`Generate names for my fridgeplan project.`
Expected: about 30-60 names split across the brief's rulesets, saved with `project_add_names`; `check_domains` calls of at most 200 domains each on each ruleset's first two TLDs; results saved with `project_add_checks`; statuses shown only as "likely available", "registered", or "unknown"; no prices; a request to pick a shortlist, saved with `project_shortlist`.

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm test && cd ..
git add skills/generate server/test/tools/project-skills.test.ts
git commit -m "feat(skills): add the generate skill and the TLD guide"
```

---

### Task 10: The `find-domain` orchestrator and final verification

**Files:**
- Create: `skills/find-domain/SKILL.md`
- Modify: `server/test/tools/project-skills.test.ts` (one line: the `SKILLS` list)

**Interfaces:**
- Consumes: skills `brief`, `generate` (Tasks 8–9), `research`, `language-check` (Plan 3), `report` (Plan 4), invoked by name; MCP tools `project_list`, `project_get`, `project_shortlist`, `check_domains`.
- Produces: skill `find-domain`, the plugin's entry point.

- [ ] **Step 1: Extend the skill check so it fails**

In `server/test/tools/project-skills.test.ts`, change:
```ts
const SKILLS = ['brief', 'generate'];
```
to:
```ts
const SKILLS = ['brief', 'generate', 'find-domain'];
```

Run: `cd server && pnpm test test/tools/project-skills.test.ts`
Expected: FAIL with `ENOENT` for `skills/find-domain/SKILL.md`.

- [ ] **Step 2: Write the skill**

`skills/find-domain/SKILL.md`:
````markdown
---
name: find-domain
description: Use when the user wants to find a brand name and domain end to end - for example "help me name my startup", "find a domain for my product", or "continue my naming project". Runs the brief, generate, research, language-check, and report skills in order on one saved project, and resumes an existing project at the first unfinished step.
---

# Find domain

The entry point for the full flow. Each step is its own skill and also runs alone. This skill picks the next step, runs it, and keeps the user informed.

## Flow

| Step | Skill | Done when |
|---|---|---|
| 1 | `brief` | `project_create` returned a slug |
| 2 | `generate` | the project has names and the user picked a shortlist with `project_shortlist` |
| 3 | `research` | every shortlisted name has domain checks for its TLDs, plus profile, handle, and trademark results |
| 4 | `language-check` | every shortlisted name has a note with kind `language` for each code in `audience.languages` |
| 5 | `report` | `report.md` exists at the project's `paths.reportFile` |

## Rules

- Pause for the user at two points: confirming the brief (inside `brief`) and picking the shortlist (inside `generate`). Run the other steps without asking, and say in one line which step you are starting.
- Say "likely available" only when `check_domains` returned `likely_available`. Never say a domain is available without a tool result.
- Every price names its source and date: "reference price from <registrar>, checked <date> — verify at registrar" for table prices, "live price from <registrar> API, <time>" for live prices. Show first-year and renewal side by side, show a missing value as "unknown", and never add up different currencies. Do not state prices from memory; they come from the `report` step.
- When a tool returns an error, tell the user in plain words. A failed check stops only that check; continue with the next step and say what is missing.
- No emoji, no urgency copy.

## Step 0: New or resume

1. Call `project_list`.
2. If projects exist, ask whether to continue one (show slug, title, and last update) or start a new one. If the user named a project, use it.
3. To resume, call `project_get` and start at the first step in the table whose "done when" is not met. For step 5, check whether the file at `paths.reportFile` exists.
4. If `project_get` returns `recoveredFromBackup: true`, show its `warning` to the user before going on.

## Step 1: Brief

Invoke the `brief` skill with what the user has given so far: the idea in their words, or the path of a filled brief template. Continue when it reports a slug.

## Step 2: Names and shortlist

Invoke the `generate` skill for the slug. It saves names, runs the quick availability filter, and asks the user for a shortlist. If the user wants another round, run `generate` again. If the user wants to change the brief, go back to `brief` (it saves a new brief version) and then run `generate`.

## Step 3: Research

Invoke the `research` skill for the slug. It checks the shortlisted names' domains across the chosen TLDs, the profiles of taken domains, social handles, and trademarks, and runs the competitor scan.

## Step 4: Language check

Invoke the `language-check` skill for the slug. It reviews meaning and pronunciation in the brief's target languages and saves notes.

## Step 5: Report

Invoke the `report` skill for the slug. It ranks the names and writes `report.md`.

## Step 6: Wrap up

1. Give the user the path of `report.md` and the top 3 names, one line each, in the report's wording.
2. Say that `likely_available` is not a guarantee: free sources cannot see premium or registry-reserved names, so the user must confirm at a registrar.
3. Offer the next moves: another naming round (`generate`), a brief change (`brief`), or research on more names (add them with `project_shortlist`, then run `research`).

## If a skill is missing

If `research`, `language-check`, or `report` is not installed, say so, skip that step, and continue. Never fill the gap with guessed availability, handles, trademarks, or prices.
````

- [ ] **Step 3: Run the full suite**

Run: `cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test`
Expected: Biome reports no errors, `tsc --noEmit` exits 0, and every test file passes.

- [ ] **Step 4: Bundle smoke test, then restore dist**

The built-in rulesets are JSON imports; this checks that tsdown bundles them. The build output is not committed (coordination rule).

Run (from repo root):
```bash
(cd server && pnpm build)
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ruleset_list","arguments":{}}}' \
  | DOMAIN_ENGINE_HOME="$(mktemp -d)" node server/dist/index.js | grep -o 'local-business' | head -1
git restore server/dist
git status --short server/dist
```
Expected: the pipeline prints `local-business`; `git status --short server/dist` prints nothing.

- [ ] **Step 5: Validate the plugin**

Run: `claude plugin validate .`
Expected: validation passes with the three new skills.

- [ ] **Step 6: Manual eval prompt (run by hand before release)**

Send: `Help me find a name and domain for my startup.`
Expected: `project_list` first; on a new project the `brief` interview starts with one question; after confirmation `generate` runs; after the shortlist the skill invokes `research`, `language-check`, and `report` in order, or says which ones are not installed and skips them without guessing results.

- [ ] **Step 7: Commit**

```bash
git add skills/find-domain server/test/tools/project-skills.test.ts
git commit -m "feat(skills): add the find-domain orchestrator"
```

---

## Done criteria for Plan 2

- `cd server && pnpm check && pnpm typecheck && pnpm test` all exit 0 on `feat/plan-2-brief-store`.
- `tools/list` shows `check_domains` plus the 12 Plan 2 tools: `project_create`, `project_list`, `project_get`, `project_add_names`, `project_add_checks`, `project_add_notes`, `project_shortlist`, `project_update_brief`, `ruleset_list`, `ruleset_get`, `ruleset_save`, `ruleset_delete`. Each has annotations.
- `server/dist/` is unchanged on the branch (`git diff main -- server/dist` is empty).
- Shared files differ from `main` only by the allowed lines: `git diff main -- server/src/server.ts server/src/runtime.ts server/test/tools/check-domains.test.ts` shows 2, 3, and 1 added lines and 1 changed line (`interface Runtime extends StoreRuntime`).
- `claude plugin validate .` passes.

## Self-review against the spec

- Brief: three input paths (interview, template file, free text) in `skills/brief/SKILL.md` Steps 1–3; the 7 sections with R/O marks in the schema (Task 3), the template (Task 3, checked by test), and the skill interview (Task 8); confirmation before save (Task 8 Step 5); `project_create` rejects missing required fields (Task 7 test); versioning with `briefHistory` and per-name `briefVersion` (Tasks 5, 7).
- Rulesets: schema fields `id`, `name`, `description`, 3–5 examples, `styles`, `length`, `filters`, `tlds` (order, `.com` policy, affixes), `weights` (Task 1); the 9 built-ins with the spec summaries (Task 1 test); custom rulesets in `~/.domain-engine/rulesets/<id>.json`, same schema, no shadowing (Task 2); copy or interview creation (Task 8).
- Store: `projects/<slug>/project.json` with brief, names (name, strategy, score, notes), checks keyed by name, shortlist (Tasks 4–5); `report.md` path in `paths.reportFile`; atomic writes plus `project.json.bak`, backup read with a report on parse failure (Tasks 4–5); `schemaVersion: 1` (Tasks 2, 4).
- Skills: `brief` uses `ruleset_list` and `project_create`; `generate` produces 30–60 names across rulesets, applies filters and weights, runs the quick filter on each ruleset's first TLDs with `check_domains`, and saves with `project_add_names`; `find-domain` runs `brief`, `generate`, `research`, `language-check`, `report` in order (Tasks 8–10).
- Honesty rules: in all three skills; checked for emoji by test.
- Cache TTLs: Plan 2 adds no cached source, so no TTL work here.
