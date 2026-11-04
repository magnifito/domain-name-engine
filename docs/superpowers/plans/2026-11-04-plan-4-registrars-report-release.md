# Plan 4: Registrars, Report, and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the bundled registrar TLD table and reputation table, the MCP tools `tld_info`, `registrar_quote` and `registrar_status` with optional live Spaceship, Namecheap and Cloudflare APIs, the maintainer refresh script, the `report` skill, and the release work (MCP annotations, startup error handling, plugin icon, env passing, full README).

**Architecture:** All Plan 4 server code lives in `server/src/tld/**` (table schemas, bundled data, price math, `tldInfo`, refresh helpers) and `server/src/registrars/**` (credentials, one live client per registrar, the quote service, and `RegistrarRuntime`). Tools are thin wrappers registered through `register-plan4.ts`. Without keys every answer comes from the bundled table; with keys, live API results for exact domains override table prices and are cached for 1 hour in the shared `DiskCache`. All HTTP goes through the shared `createHttp` and `HostLimiter`.

**Tech Stack:** TypeScript 7 (strict, nodenext ESM), `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7, Vitest 5.1.0, Biome 2.6.4, tsdown 0.23.5, pnpm 11.27.0, `tsx` 4.23.15 (dev only, for the maintainer script).

**Branch:** `feat/plan-4-registrars-release` in its own worktree off `main`.

## Global Constraints

From the coordination rules (`docs/superpowers/plans/2026-11-04-plans-2-4-coordination.md`), all plans:

- Node 20+, TypeScript strict, ESM with `.js` relative imports.
- Biome for lint and format (`pnpm check`, `pnpm format` in `server/`). Never use ESLint or Prettier, and never run bare `pnpm lint`.
- Write all code comments in English.
- Vitest. Unit tests use fakes, with no network access. Live tests go under `server/test/live/` and are gated by `LIVE=1`.
- Honesty rules from the spec: never claim "available" without a tool result; label every price with its source and date; never mix currencies.
- API keys come from env vars only. Never print, log or store them.
- Never scrape pages that block bots. Use only official APIs or documented open endpoints.
- Per-host rate limit through the shared `HostLimiter`. Cache through the shared `DiskCache`, with the TTLs the spec gives.

Plan 4 specifics:

- File ownership: Plan 4 creates or changes only `server/src/registrars/**`, `server/src/tld/**`, `server/data/registrar-tlds.json`, `server/data/tld-reputation.json`, `server/scripts/refresh-registrar-tlds.ts`, `server/src/tools/{tld-info,registrar-quote,registrar-status}.ts`, `server/src/tools/register-plan4.ts`, `server/test/registrars/**`, `server/test/tld/**`, `server/test/tools/{tld-info,registrar-quote,registrar-status}.test.ts`, `skills/report/**`, `README.md`, `.claude-plugin/**`, `.github/**`, plus the Plan 1 leftovers assigned to Plan 4: `server/src/index.ts` and the `check_domains` annotations.
- Shared-file edits, and nothing more:
  - `server/src/server.ts`: one import line and one call line, `registerPlan4Tools(server, rt);`, placed last in `createServer`.
  - `server/src/runtime.ts`: one import line, one `extends RegistrarRuntime` entry on `Runtime`, one spread line `...createRegistrarRuntime({ http, cache, env }),`. Reuse the existing `http` and `cache`; never create second instances. Do not use the field names `projectStore` or `rulesetStore` (Plan 2 owns them).
  - `server/test/tools/check-domains.test.ts`: add `...({} as Runtime),` as the FIRST property of the fake runtime object, byte for byte the same edit Plans 2 and 3 make, plus one annotation test.
  - `server/package.json`: one `refresh:tlds` script and one dev dependency `tsx@4.23.15`.
  - `server/tsconfig.json`: add `"scripts"` to `include`.
  - `.mcp.json`: add an `env` map so the server receives the optional keys.
- Do not edit `server/src/config.ts`. Do not rebuild or commit `server/dist/`; the controller rebuilds it after all merges. CI's dist drift check stays as it is, so it fails on this branch until that rebuild.
- Fake runtimes in tests are built as `{...} as Runtime` with only the fields the test needs.
- Spec values: Spaceship is the main registrar, Namecheap second, Cloudflare third (at-cost). Env vars: `SPACESHIP_API_KEY`, `SPACESHIP_API_SECRET` (scope `domains:read`), `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_CLIENT_IP` (IP must be allow-listed), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Live results are cached for 1 hour (`TTL.registrarLive`). Spaceship pricing allows 25 requests per 5 seconds; the shared limiter's default of 1 request per second per host is stricter, so no limiter change is needed.
- Seed facts (2026-11-04): Spaceship first-year EUR prices `.sbs` 0.86, `.site` 1.05, `.online` 1.05, `.store` 1.05, `.space` 1.05, `.lol` 1.10, `.bond` 1.28, `.xyz` 1.83. Cloudflare's public file has no `.sbs` or `.bond`; `.store` is USD 4.99 first year and 42.20 renewal, `.site` and `.online` USD 4.99 and 27.70.
- Never fabricate a price. Where there is no verified price, the row stores `null` prices and the source `"unverified"`. Every row carries `source` and `checkedAt`.
- Price labels, word for word: table `reference price from <Registrar>, checked <YYYY-MM-DD> — verify at registrar`; live `live price from <Registrar> API, <ISO time>`. Missing values are `unknown`. Never convert or add up different currencies.
- Spaceship and Namecheap price web pages return a Cloudflare bot challenge. Never fetch them; use only the official APIs and the documented public JSON file.
- Verified API facts this plan codes against (checked 2026-11-04 with WebFetch and context7):
  - Spaceship, base `https://spaceship.dev/api`, headers `X-API-Key` and `X-API-Secret`: `POST /v1/domains/available` with `{ domains }` (max 20) returns `domains[].{ domain, result, premiumPricing[{ operation, price, currency }] }`; `"available"` is the only documented `result` value. `POST /v1/domains/pricing/query` with `{ domains }` returns `domains[].{ domain, priceClass, prices.{ register, renew, transfer }[{ period: { value, unit }, priceInDefaultCurrency: { finalPrice: { amount, currency } } }] }`. `GET /v1/tlds/pricing?take=1..25&skip=n` returns `{ items[{ tld, prices }], total }`. Errors are `application/problem+json` with `detail`.
  - Namecheap, `https://api.namecheap.com/xml.response` with `ApiUser`, `ApiKey`, `UserName`, `ClientIp`, `Command`: `namecheap.domains.check` (`DomainList`, max 50) returns `DomainCheckResult` attributes `Domain`, `Available`, `ErrorNo`, `Description`, `IsPremiumName`, `PremiumRegistrationPrice`, `PremiumRenewalPrice`. `namecheap.users.getPricing` (`ProductType=DOMAIN`, optional `ProductCategory=DOMAINS`, `ActionName`, `ProductName`) returns `ProductCategory` > `Product` > `Price` with `Duration`, `DurationType`, `Price`, `YourPrice`, `Currency`. `namecheap.domains.gettldlist` returns `Tld Name="..."`. Errors: `Status="ERROR"` with `<Error Number="...">`.
  - Cloudflare: `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/registrar/domain-check` with `{ domains }` (1 to 20) and `Authorization: Bearer`, envelope `{ success, errors[{ code, message }], result: { domains[{ name, registrable, tier, reason, pricing: { currency, registration_cost, renewal_cost } }] } }`. `https://cfdomainpricing.com/prices.json` is `{ <tld>: { registration, renewal, updatedAt } }` in USD, 430 TLDs.

---

## File Structure

```
server/
  data/
    registrar-tlds.json            # CREATE: one row per registrar × TLD, with source and checkedAt
    tld-reputation.json            # CREATE: one row per TLD: good | mixed | poor, note, source
  scripts/
    refresh-registrar-tlds.ts      # CREATE: maintainer script, `pnpm refresh:tlds`
  src/
    index.ts                       # MODIFY: start through runStartup
    startup.ts                     # CREATE: clean stderr line and exit 1 on startup failure
    runtime.ts                     # MODIFY: extends RegistrarRuntime, one spread line
    server.ts                      # MODIFY: registerPlan4Tools last
    tld/
      schema.ts                    # zod schemas for both tables, registrar ids and names
      table.ts                     # bundledTables(): validated tables, loaded once
      pricing.ts                   # 3-year total, price labels, cheapest option per currency
      info.ts                      # tldInfo(): registrars, prices, reputation for one TLD
      refresh.ts                   # mergeTable, diffTables, serializeTable for the script
    registrars/
      types.ts                     # LiveQuote, LiveClient, ClientDeps, small helpers
      credentials.ts               # env keys, redaction, registrarStatus()
      spaceship.ts                 # Spaceship live client and TLD price fetch
      namecheap.ts                 # Namecheap live client and TLD price fetch
      cloudflare.ts                # Cloudflare live client and public price file
      quote.ts                     # quoteDomains(): table plus live merge, 1 hour cache
      runtime-part.ts              # RegistrarRuntime and createRegistrarRuntime()
    tools/
      check-domains.ts             # MODIFY: annotations only
      tld-info.ts                  # tld_info tool
      registrar-quote.ts           # registrar_quote tool
      registrar-status.ts          # registrar_status tool
      register-plan4.ts            # registerPlan4Tools(server, rt)
  test/
    startup.test.ts
    tld/{data,info,refresh,report-skill}.test.ts, tld/fixtures.ts
    registrars/{credentials,spaceship,namecheap,cloudflare,quote,runtime-part}.test.ts
    registrars/fake-http.ts, registrars/fixtures/*
    tools/{tld-info,registrar-quote,registrar-status}.test.ts
    tools/check-domains.test.ts    # MODIFY: fake runtime spread and annotation test
    live/registrars.test.ts        # LIVE=1 only; keyed cases need keys
  package.json                     # MODIFY: refresh:tlds script, tsx dev dependency
  tsconfig.json                    # MODIFY: include scripts
skills/report/
  SKILL.md
  references/report-template.md
.claude-plugin/
  plugin.json                      # MODIFY: icon, description
  marketplace.json                 # MODIFY: description
  icon.png                         # CREATE: 256×256 PNG generated by a script
.mcp.json                          # MODIFY: pass optional env vars to the server
README.md                          # REWRITE
```

Run every command below from the repository root unless a step says `cd server`.

---

### Task 1: Table schemas and the bundled data

**Files:**
- Create: `server/src/tld/schema.ts`, `server/src/tld/table.ts`, `server/data/registrar-tlds.json`, `server/data/tld-reputation.json`
- Test: `server/test/tld/data.test.ts`

**Interfaces:**
- Consumes: `zod` (`z.strictObject`, `superRefine`).
- Produces:
  - `REGISTRARS = ['spaceship', 'namecheap', 'cloudflare'] as const`; `type RegistrarId`; `RegistrarIdSchema`; `REGISTRAR_NAMES: Record<RegistrarId, string>` (`Spaceship`, `Namecheap`, `Cloudflare`); `UNVERIFIED = 'unverified'`.
  - `PriceRowSchema` / `type PriceRow = { registrar: RegistrarId; tld: string; firstYear: number | null; renewal: number | null; transfer: number | null; currency: string | null; source: string; checkedAt: string /* YYYY-MM-DD */ }`.
  - `RegistrarMetaSchema` / `type RegistrarMeta = { coverage: 'full' | 'partial'; notSold: string[]; note: string }`.
  - `RegistrarTableSchema` / `type RegistrarTable = { schemaVersion: 1; registrars: Record<RegistrarId, RegistrarMeta>; rows: PriceRow[] }`.
  - `ReputationSchema` (`good | mixed | poor`), `ReputationRowSchema` / `type ReputationRow = { tld; reputation; reputationNote; source; checkedAt }`, `ReputationTableSchema` / `type ReputationTable = { schemaVersion: 1; rows: ReputationRow[] }`.
  - `interface TldTables { registrars: RegistrarTable; reputation: ReputationTable }`; `bundledTables(): TldTables`.

Coverage semantics: the spec says a TLD missing for a registrar means that registrar does not sell it. That holds only for a registrar whose rows came from a full refresh (`coverage: "full"`). The seed table is partial, so a missing row there means "not in the table", and `notSold` lists TLDs known to be unsold. After the first full refresh the spec rule applies as written.

- [ ] **Step 1: Write the failing test**

`server/test/tld/data.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import registrarData from '../../data/registrar-tlds.json' with { type: 'json' };
import reputationData from '../../data/tld-reputation.json' with { type: 'json' };
import {
  PriceRowSchema,
  RegistrarTableSchema,
  ReputationRowSchema,
  ReputationTableSchema,
  UNVERIFIED,
} from '../../src/tld/schema.js';
import { bundledTables } from '../../src/tld/table.js';

const LOW_COST = ['sbs', 'site', 'online', 'store', 'space', 'lol', 'bond', 'xyz'];

describe('bundled registrar-tlds.json', () => {
  it('validates as a whole', () => {
    expect(() => RegistrarTableSchema.parse(registrarData)).not.toThrow();
  });

  it.each(registrarData.rows.map((row) => [`${row.registrar} .${row.tld}`, row]))(
    'row %s validates',
    (_label, row) => {
      expect(() => PriceRowSchema.parse(row)).not.toThrow();
    },
  );

  it('gives every row a source and a check date', () => {
    for (const row of bundledTables().registrars.rows) {
      expect(row.source.length).toBeGreaterThan(0);
      expect(row.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never stores a price on an unverified row', () => {
    for (const row of bundledTables().registrars.rows.filter((r) => r.source === UNVERIFIED)) {
      expect([row.firstYear, row.renewal, row.transfer]).toEqual([null, null, null]);
    }
  });

  it('has a row or a not-sold entry for every low-cost TLD at every registrar', () => {
    const { rows, registrars } = bundledTables().registrars;
    for (const registrar of ['spaceship', 'namecheap', 'cloudflare'] as const) {
      for (const tld of LOW_COST) {
        const listed = rows.some((r) => r.registrar === registrar && r.tld === tld);
        // With full coverage a missing row already means "not sold".
        const meta = registrars[registrar];
        const notSold = meta.coverage === 'full' || meta.notSold.includes(tld);
        expect(listed || notSold, `${registrar} .${tld}`).toBe(true);
      }
    }
  });
});

describe('bundled tld-reputation.json', () => {
  it('validates as a whole', () => {
    expect(() => ReputationTableSchema.parse(reputationData)).not.toThrow();
  });

  it.each(reputationData.rows.map((row) => [row.tld, row]))('row %s validates', (_tld, row) => {
    expect(() => ReputationRowSchema.parse(row)).not.toThrow();
  });

  it('covers every low-cost TLD', () => {
    const tlds = bundledTables().reputation.rows.map((r) => r.tld);
    for (const tld of LOW_COST) expect(tlds).toContain(tld);
  });
});

describe('schemas', () => {
  const base = {
    registrar: 'spaceship',
    tld: 'site',
    firstYear: null,
    renewal: null,
    transfer: null,
    currency: null,
    source: UNVERIFIED,
    checkedAt: '2026-11-04',
  };

  it('rejects a price on an unverified row', () => {
    expect(() => PriceRowSchema.parse({ ...base, firstYear: 1, currency: 'EUR' })).toThrow(
      'unverified row has a price',
    );
  });

  it('rejects a price without a currency', () => {
    expect(() => PriceRowSchema.parse({ ...base, source: 'x', firstYear: 1 })).toThrow(
      'price without currency',
    );
  });

  it('rejects an unknown registrar and a leading dot', () => {
    expect(() => PriceRowSchema.parse({ ...base, registrar: 'godaddy' })).toThrow();
    expect(() => PriceRowSchema.parse({ ...base, tld: '.site' })).toThrow();
  });

  it('rejects duplicate registrar × TLD rows', () => {
    const meta = { coverage: 'partial', notSold: [], note: 'n' };
    expect(() =>
      RegistrarTableSchema.parse({
        schemaVersion: 1,
        registrars: { spaceship: meta, namecheap: meta, cloudflare: meta },
        rows: [base, base],
      }),
    ).toThrow('duplicate row spaceship:site');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && pnpm test test/tld/data.test.ts`
Expected: FAIL, Vitest cannot resolve `../../data/registrar-tlds.json` and `../../src/tld/schema.js`.

- [ ] **Step 3: Write the schemas**

`server/src/tld/schema.ts`:
```ts
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

export const RegistrarMetaSchema = z.strictObject({
  // full: a TLD missing for this registrar means it is not sold.
  // partial: a missing TLD means the table has no data for it.
  coverage: z.enum(['full', 'partial']),
  // TLDs a source confirmed this registrar does not sell (used with partial coverage).
  notSold: z.array(TLD),
  note: z.string().min(1),
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
```

- [ ] **Step 4: Write the bundled registrar table**

Every price below is verified: Spaceship first-year prices from the user's spaceship.com record (EUR); Cloudflare prices copied from `https://cfdomainpricing.com/prices.json` on 2026-11-04, with each row's `checkedAt` set to that entry's `updatedAt`. Namecheap rows have no verified price, so they are `null` with source `unverified`. Do not add or change any number.

`server/data/registrar-tlds.json`:
```json
{
  "schemaVersion": 1,
  "registrars": {
    "spaceship": {
      "coverage": "partial",
      "notSold": [],
      "note": "Seed rows: first-year prices for 8 low-cost TLDs recorded from spaceship.com on 2026-11-04. Renewal prices stay unknown until the first refresh with API keys."
    },
    "namecheap": {
      "coverage": "partial",
      "notSold": [],
      "note": "Seed rows without verified prices. The first refresh with API keys fills them from namecheap.users.getPricing."
    },
    "cloudflare": {
      "coverage": "partial",
      "notSold": ["bond", "sbs"],
      "note": "Seed rows from cfdomainpricing.com/prices.json, a free third-party list of Cloudflare Registrar prices in USD. That file has no .bond or .sbs entry. Run refresh:tlds to load every TLD."
    }
  },
  "rows": [
    {
      "registrar": "spaceship",
      "tld": "bond",
      "firstYear": 1.28,
      "renewal": null,
      "transfer": null,
      "currency": "EUR",
      "source": "spaceship.com price list, recorded by maintainer",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "spaceship",
      "tld": "lol",
      "firstYear": 1.1,
      "renewal": null,
      "transfer": null,
      "currency": "EUR",
      "source": "spaceship.com price list, recorded by maintainer",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "spaceship",
      "tld": "online",
      "firstYear": 1.05,
      "renewal": null,
      "transfer": null,
      "currency": "EUR",
      "source": "spaceship.com price list, recorded by maintainer",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "spaceship",
      "tld": "sbs",
      "firstYear": 0.86,
      "renewal": null,
      "transfer": null,
      "currency": "EUR",
      "source": "spaceship.com price list, recorded by maintainer",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "spaceship",
      "tld": "site",
      "firstYear": 1.05,
      "renewal": null,
      "transfer": null,
      "currency": "EUR",
      "source": "spaceship.com price list, recorded by maintainer",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "spaceship",
      "tld": "space",
      "firstYear": 1.05,
      "renewal": null,
      "transfer": null,
      "currency": "EUR",
      "source": "spaceship.com price list, recorded by maintainer",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "spaceship",
      "tld": "store",
      "firstYear": 1.05,
      "renewal": null,
      "transfer": null,
      "currency": "EUR",
      "source": "spaceship.com price list, recorded by maintainer",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "spaceship",
      "tld": "xyz",
      "firstYear": 1.83,
      "renewal": null,
      "transfer": null,
      "currency": "EUR",
      "source": "spaceship.com price list, recorded by maintainer",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "namecheap",
      "tld": "bond",
      "firstYear": null,
      "renewal": null,
      "transfer": null,
      "currency": null,
      "source": "unverified",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "namecheap",
      "tld": "lol",
      "firstYear": null,
      "renewal": null,
      "transfer": null,
      "currency": null,
      "source": "unverified",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "namecheap",
      "tld": "online",
      "firstYear": null,
      "renewal": null,
      "transfer": null,
      "currency": null,
      "source": "unverified",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "namecheap",
      "tld": "sbs",
      "firstYear": null,
      "renewal": null,
      "transfer": null,
      "currency": null,
      "source": "unverified",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "namecheap",
      "tld": "site",
      "firstYear": null,
      "renewal": null,
      "transfer": null,
      "currency": null,
      "source": "unverified",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "namecheap",
      "tld": "space",
      "firstYear": null,
      "renewal": null,
      "transfer": null,
      "currency": null,
      "source": "unverified",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "namecheap",
      "tld": "store",
      "firstYear": null,
      "renewal": null,
      "transfer": null,
      "currency": null,
      "source": "unverified",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "namecheap",
      "tld": "xyz",
      "firstYear": null,
      "renewal": null,
      "transfer": null,
      "currency": null,
      "source": "unverified",
      "checkedAt": "2026-11-04"
    },
    {
      "registrar": "cloudflare",
      "tld": "ai",
      "firstYear": 80,
      "renewal": 80,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-10"
    },
    {
      "registrar": "cloudflare",
      "tld": "app",
      "firstYear": 8.2,
      "renewal": 14.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "co",
      "firstYear": 30,
      "renewal": 30,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "com",
      "firstYear": 10.46,
      "renewal": 10.46,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "dev",
      "firstYear": 8.2,
      "renewal": 12.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-09"
    },
    {
      "registrar": "cloudflare",
      "tld": "io",
      "firstYear": 32,
      "renewal": 50,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "lol",
      "firstYear": 25.2,
      "renewal": 20.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-07"
    },
    {
      "registrar": "cloudflare",
      "tld": "me",
      "firstYear": 16.56,
      "renewal": 16.56,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "net",
      "firstYear": 11.86,
      "renewal": 11.86,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "online",
      "firstYear": 4.99,
      "renewal": 27.7,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "org",
      "firstYear": 8.5,
      "renewal": 11.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "sh",
      "firstYear": 45,
      "renewal": 45,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "shop",
      "firstYear": 30.2,
      "renewal": 30.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "site",
      "firstYear": 4.99,
      "renewal": 27.7,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    },
    {
      "registrar": "cloudflare",
      "tld": "space",
      "firstYear": 4.99,
      "renewal": 25.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-09-23"
    },
    {
      "registrar": "cloudflare",
      "tld": "store",
      "firstYear": 4.99,
      "renewal": 42.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-09"
    },
    {
      "registrar": "cloudflare",
      "tld": "tech",
      "firstYear": 9.99,
      "renewal": 49.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-09-24"
    },
    {
      "registrar": "cloudflare",
      "tld": "xyz",
      "firstYear": 12.3,
      "renewal": 11.2,
      "transfer": null,
      "currency": "USD",
      "source": "cfdomainpricing.com/prices.json",
      "checkedAt": "2026-10-13"
    }
  ]
}
```

- [ ] **Step 5: Write the reputation table**

These are maintainer judgments, and the `source` says so.

`server/data/tld-reputation.json`:
```json
{
  "schemaVersion": 1,
  "rows": [
    {
      "tld": "ai",
      "reputation": "good",
      "reputationNote": "Country code of Anguilla, widely used by AI products. High first-year and renewal prices.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "app",
      "reputation": "good",
      "reputationNote": "Google Registry TLD on the HSTS preload list: sites must serve HTTPS.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "bond",
      "reputation": "poor",
      "reputationNote": "Low-cost TLD that is common in bulk and throwaway registrations. Some spam filters and security tools score it lower, which can hurt email delivery and visitor trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "co",
      "reputation": "good",
      "reputationNote": "Country code of Colombia, widely used as a short alternative to .com. Common typo target for .com.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "com",
      "reputation": "good",
      "reputationNote": "The default commercial TLD. Most trusted by users and mail filters.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "dev",
      "reputation": "good",
      "reputationNote": "Google Registry TLD on the HSTS preload list: sites must serve HTTPS. Popular with developer tools.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "io",
      "reputation": "good",
      "reputationNote": "Country code of the British Indian Ocean Territory, widely used by tech startups. Long-term status of the ccTLD has had public debate.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "lol",
      "reputation": "mixed",
      "reputationNote": "Low-cost TLD that is common in bulk and throwaway registrations. Some spam filters and security tools score it lower, which can hurt email delivery and visitor trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "me",
      "reputation": "good",
      "reputationNote": "Country code of Montenegro, often used for personal brands.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "net",
      "reputation": "good",
      "reputationNote": "Long-standing generic TLD with broad trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "online",
      "reputation": "mixed",
      "reputationNote": "Low-cost TLD that is common in bulk and throwaway registrations. Some spam filters and security tools score it lower, which can hurt email delivery and visitor trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "org",
      "reputation": "good",
      "reputationNote": "Long-standing generic TLD, associated with non-profits and communities.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "sbs",
      "reputation": "poor",
      "reputationNote": "Low-cost TLD that is common in bulk and throwaway registrations. Some spam filters and security tools score it lower, which can hurt email delivery and visitor trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "sh",
      "reputation": "good",
      "reputationNote": "Country code of Saint Helena, popular with developer tools and shell-related names.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "shop",
      "reputation": "mixed",
      "reputationNote": "Generic TLD for online stores. Trust varies with how it is used.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "site",
      "reputation": "mixed",
      "reputationNote": "Low-cost TLD that is common in bulk and throwaway registrations. Some spam filters and security tools score it lower, which can hurt email delivery and visitor trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "space",
      "reputation": "mixed",
      "reputationNote": "Low-cost TLD that is common in bulk and throwaway registrations. Some spam filters and security tools score it lower, which can hurt email delivery and visitor trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "store",
      "reputation": "mixed",
      "reputationNote": "Low-cost TLD that is common in bulk and throwaway registrations. Some spam filters and security tools score it lower, which can hurt email delivery and visitor trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "tech",
      "reputation": "mixed",
      "reputationNote": "Generic TLD for technology brands. Low first-year promotions draw bulk registrations, so some filters score it lower.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    },
    {
      "tld": "xyz",
      "reputation": "mixed",
      "reputationNote": "Low-cost TLD that is common in bulk and throwaway registrations. Some spam filters and security tools score it lower, which can hurt email delivery and visitor trust.",
      "source": "maintainer assessment, not a measured abuse rate; check current abuse statistics before relying on it",
      "checkedAt": "2026-11-04"
    }
  ]
}
```

- [ ] **Step 6: Write the table loader**

`server/src/tld/table.ts`:
```ts
import registrarData from '../../data/registrar-tlds.json' with { type: 'json' };
import reputationData from '../../data/tld-reputation.json' with { type: 'json' };
import {
  type RegistrarTable,
  RegistrarTableSchema,
  type ReputationTable,
  ReputationTableSchema,
} from './schema.js';

export interface TldTables {
  registrars: RegistrarTable;
  reputation: ReputationTable;
}

let bundled: TldTables | undefined;

/** The tables shipped in server/data, validated once on first use. */
export function bundledTables(): TldTables {
  bundled ??= {
    registrars: RegistrarTableSchema.parse(registrarData),
    reputation: ReputationTableSchema.parse(reputationData),
  };
  return bundled;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd server && pnpm test test/tld/data.test.ts`
Expected: PASS (64 tests).

- [ ] **Step 8: Format, check, typecheck, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/tld/schema.ts server/src/tld/table.ts server/data/registrar-tlds.json server/data/tld-reputation.json server/test/tld/data.test.ts
git commit -m "feat(tld): add registrar and reputation tables with schemas"
```

---

### Task 2: Price helpers and `tldInfo`

**Files:**
- Create: `server/src/tld/pricing.ts`, `server/src/tld/info.ts`
- Test: `server/test/tld/fixtures.ts`, `server/test/tld/info.test.ts`

**Interfaces:**
- Consumes: `REGISTRARS`, `REGISTRAR_NAMES`, `RegistrarId`, `UNVERIFIED`, `PriceRow`, `ReputationRow` from `tld/schema.ts`; `TldTables` from `tld/table.ts`.
- Produces:
  - `pricing.ts`: `UNKNOWN = 'unknown'`; `TABLE_NOTE`; `roundMoney(value: number): number`; `threeYearTotal(firstYear: number | null, renewal: number | null): number | null` (first year plus two renewals); `tablePriceLabel(registrar: RegistrarId, checkedAt: string): string`; `livePriceLabel(registrar: RegistrarId, checkedAt: string): string`; `interface PricedOption { registrar: RegistrarId; currency: string | null; threeYearTotal: number | null }`; `interface CheapestOption { currency: string; registrar: RegistrarId; threeYearTotal: number }`; `cheapestThreeYear(options: PricedOption[]): CheapestOption[]` (one per currency, sorted by currency).
  - `info.ts`: `type SaleStatus = 'listed' | 'not_sold' | 'not_in_table'`; `interface TldRegistrarEntry { registrar; registrarName; sale: SaleStatus; firstYear; renewal; transfer; threeYearTotal; currency; source: string | null; checkedAt: string | null; priceLabel: string }`; `interface TldReputation`; `interface TldInfo { tld; registrars: TldRegistrarEntry[]; cheapestThreeYear: CheapestOption[]; reputation: TldReputation | null; notes: string[] }`; `tldInfo(tld: string, tables: TldTables): TldInfo` (throws `ValidationError` for an invalid TLD).
  - Test helper `testTables(): TldTables` in `test/tld/fixtures.ts` (used by Tasks 7 and 8).

- [ ] **Step 1: Write the test fixture tables**

`server/test/tld/fixtures.ts`:
```ts
import type { PriceRow } from '../../src/tld/schema.js';
import type { TldTables } from '../../src/tld/table.js';

function row(partial: Partial<PriceRow> & Pick<PriceRow, 'registrar' | 'tld'>): PriceRow {
  return {
    firstYear: null,
    renewal: null,
    transfer: null,
    currency: null,
    source: 'unverified',
    checkedAt: '2026-11-04',
    ...partial,
  };
}

/** A small, fixed table for unit tests; it does not depend on the bundled data. */
export function testTables(): TldTables {
  return {
    registrars: {
      schemaVersion: 1,
      registrars: {
        spaceship: { coverage: 'partial', notSold: [], note: 'test' },
        namecheap: { coverage: 'partial', notSold: [], note: 'test' },
        cloudflare: { coverage: 'full', notSold: [], note: 'test' },
      },
      rows: [
        row({
          registrar: 'spaceship',
          tld: 'site',
          firstYear: 1.05,
          renewal: 30,
          currency: 'EUR',
          source: 'spaceship.com price list, recorded by maintainer',
        }),
        row({ registrar: 'namecheap', tld: 'site' }),
        row({
          registrar: 'cloudflare',
          tld: 'site',
          firstYear: 4.99,
          renewal: 27.7,
          currency: 'USD',
          source: 'cfdomainpricing.com/prices.json',
          checkedAt: '2026-10-13',
        }),
        row({
          registrar: 'cloudflare',
          tld: 'com',
          firstYear: 10.46,
          renewal: 10.46,
          currency: 'USD',
          source: 'cfdomainpricing.com/prices.json',
          checkedAt: '2026-10-13',
        }),
      ],
    },
    reputation: {
      schemaVersion: 1,
      rows: [
        {
          tld: 'site',
          reputation: 'mixed',
          reputationNote: 'Low-cost TLD.',
          source: 'maintainer assessment',
          checkedAt: '2026-11-04',
        },
      ],
    },
  };
}
```

- [ ] **Step 2: Write the failing test**

`server/test/tld/info.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { tldInfo } from '../../src/tld/info.js';
import {
  cheapestThreeYear,
  livePriceLabel,
  TABLE_NOTE,
  tablePriceLabel,
  threeYearTotal,
} from '../../src/tld/pricing.js';
import { testTables } from './fixtures.js';

describe('pricing helpers', () => {
  it('computes a 3-year total as first year plus two renewals', () => {
    expect(threeYearTotal(4.99, 27.7)).toBe(60.39);
    expect(threeYearTotal(1.05, null)).toBeNull();
    expect(threeYearTotal(null, 10)).toBeNull();
  });

  it('labels table and live prices with origin and date', () => {
    expect(tablePriceLabel('spaceship', '2026-11-04')).toBe(
      'reference price from Spaceship, checked 2026-11-04 — verify at registrar',
    );
    expect(livePriceLabel('namecheap', '2026-11-04T10:00:00.000Z')).toBe(
      'live price from Namecheap API, 2026-11-04T10:00:00.000Z',
    );
  });

  it('picks the cheapest option per currency and never mixes currencies', () => {
    const result = cheapestThreeYear([
      { registrar: 'spaceship', currency: 'EUR', threeYearTotal: 61.05 },
      { registrar: 'cloudflare', currency: 'USD', threeYearTotal: 60.39 },
      { registrar: 'namecheap', currency: 'USD', threeYearTotal: 70 },
      { registrar: 'namecheap', currency: null, threeYearTotal: 1 },
    ]);
    expect(result).toEqual([
      { currency: 'EUR', registrar: 'spaceship', threeYearTotal: 61.05 },
      { currency: 'USD', registrar: 'cloudflare', threeYearTotal: 60.39 },
    ]);
  });
});

describe('tldInfo', () => {
  it('lists every registrar with table prices, labels, and reputation', () => {
    const info = tldInfo('site', testTables());
    expect(info.registrars.map((r) => [r.registrar, r.sale])).toEqual([
      ['spaceship', 'listed'],
      ['namecheap', 'listed'],
      ['cloudflare', 'listed'],
    ]);
    const cloudflare = info.registrars[2];
    expect(cloudflare).toMatchObject({
      firstYear: 4.99,
      renewal: 27.7,
      threeYearTotal: 60.39,
      currency: 'USD',
      source: 'cfdomainpricing.com/prices.json',
      checkedAt: '2026-10-13',
      priceLabel: 'reference price from Cloudflare, checked 2026-10-13 — verify at registrar',
    });
    expect(info.reputation).toMatchObject({ reputation: 'mixed' });
    expect(info.notes).toContain(TABLE_NOTE);
  });

  it('shows an unverified row as unknown, with no price', () => {
    const namecheap = tldInfo('site', testTables()).registrars[1];
    expect(namecheap).toMatchObject({ firstYear: null, renewal: null, threeYearTotal: null });
    expect(namecheap?.priceLabel).toBe('unknown — price not verified, check at Namecheap');
  });

  it('returns one cheapest 3-year option per currency', () => {
    expect(tldInfo('site', testTables()).cheapestThreeYear).toEqual([
      { currency: 'EUR', registrar: 'spaceship', threeYearTotal: 61.05 },
      { currency: 'USD', registrar: 'cloudflare', threeYearTotal: 60.39 },
    ]);
  });

  it('separates "not sold" (full coverage) from "not in table" (partial coverage)', () => {
    const info = tldInfo('io', testTables());
    expect(info.registrars.map((r) => [r.registrar, r.sale, r.priceLabel])).toEqual([
      ['spaceship', 'not_in_table', 'unknown — not in the bundled table'],
      ['namecheap', 'not_in_table', 'unknown — not in the bundled table'],
      ['cloudflare', 'not_sold', 'not sold by Cloudflare'],
    ]);
    expect(info.reputation).toBeNull();
  });

  it('uses notSold for a partial-coverage registrar', () => {
    const tables = testTables();
    tables.registrars.registrars.spaceship.notSold.push('io');
    expect(tldInfo('io', tables).registrars[0]?.sale).toBe('not_sold');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd server && pnpm test test/tld/info.test.ts`
Expected: FAIL, `../../src/tld/info.js` and `../../src/tld/pricing.js` do not exist.

- [ ] **Step 4: Write the price helpers**

`server/src/tld/pricing.ts`:
```ts
import { REGISTRAR_NAMES, type RegistrarId } from './schema.js';

export const UNKNOWN = 'unknown';

export const TABLE_NOTE =
  'Table prices are reference prices from the bundled table and can be out of date; verify at the registrar. Prices are never converted between currencies.';

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** First year plus two renewals; null when either price is unknown. */
export function threeYearTotal(firstYear: number | null, renewal: number | null): number | null {
  if (firstYear === null || renewal === null) return null;
  return roundMoney(firstYear + 2 * renewal);
}

export function tablePriceLabel(registrar: RegistrarId, checkedAt: string): string {
  return `reference price from ${REGISTRAR_NAMES[registrar]}, checked ${checkedAt} — verify at registrar`;
}

export function livePriceLabel(registrar: RegistrarId, checkedAt: string): string {
  return `live price from ${REGISTRAR_NAMES[registrar]} API, ${checkedAt}`;
}

export interface PricedOption {
  registrar: RegistrarId;
  currency: string | null;
  threeYearTotal: number | null;
}

export interface CheapestOption {
  currency: string;
  registrar: RegistrarId;
  threeYearTotal: number;
}

/** The cheapest 3-year option per currency. Totals in different currencies are never compared. */
export function cheapestThreeYear(options: PricedOption[]): CheapestOption[] {
  const best = new Map<string, CheapestOption>();
  for (const option of options) {
    if (option.currency === null || option.threeYearTotal === null) continue;
    const current = best.get(option.currency);
    if (!current || option.threeYearTotal < current.threeYearTotal) {
      best.set(option.currency, {
        currency: option.currency,
        registrar: option.registrar,
        threeYearTotal: option.threeYearTotal,
      });
    }
  }
  return [...best.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
```

- [ ] **Step 5: Write `tldInfo`**

`server/src/tld/info.ts`:
```ts
import {
  type CheapestOption,
  cheapestThreeYear,
  TABLE_NOTE,
  tablePriceLabel,
  threeYearTotal,
  UNKNOWN,
} from './pricing.js';
import {
  REGISTRAR_NAMES,
  REGISTRARS,
  type RegistrarId,
  type Reputation,
  UNVERIFIED,
} from './schema.js';
import type { TldTables } from './table.js';

/** listed: the table has a row. not_sold: a source confirms the registrar does not sell it. */
export type SaleStatus = 'listed' | 'not_sold' | 'not_in_table';

export interface TldRegistrarEntry {
  registrar: RegistrarId;
  registrarName: string;
  sale: SaleStatus;
  firstYear: number | null;
  renewal: number | null;
  transfer: number | null;
  threeYearTotal: number | null;
  currency: string | null;
  source: string | null;
  checkedAt: string | null;
  priceLabel: string;
}

export interface TldReputation {
  reputation: Reputation;
  reputationNote: string;
  source: string;
  checkedAt: string;
}

export interface TldInfo {
  tld: string;
  registrars: TldRegistrarEntry[];
  cheapestThreeYear: CheapestOption[];
  reputation: TldReputation | null;
  notes: string[];
}

function emptyEntry(
  registrar: RegistrarId,
  sale: SaleStatus,
  priceLabel: string,
): TldRegistrarEntry {
  return {
    registrar,
    registrarName: REGISTRAR_NAMES[registrar],
    sale,
    firstYear: null,
    renewal: null,
    transfer: null,
    threeYearTotal: null,
    currency: null,
    source: null,
    checkedAt: null,
    priceLabel,
  };
}

function registrarEntry(tld: string, registrar: RegistrarId, tables: TldTables): TldRegistrarEntry {
  const meta = tables.registrars.registrars[registrar];
  const row = tables.registrars.rows.find((r) => r.registrar === registrar && r.tld === tld);
  if (!row) {
    if (meta.coverage === 'full' || meta.notSold.includes(tld)) {
      return emptyEntry(registrar, 'not_sold', `not sold by ${REGISTRAR_NAMES[registrar]}`);
    }
    return emptyEntry(registrar, 'not_in_table', `${UNKNOWN} — not in the bundled table`);
  }
  const verified = row.source !== UNVERIFIED;
  return {
    registrar,
    registrarName: REGISTRAR_NAMES[registrar],
    sale: 'listed',
    firstYear: row.firstYear,
    renewal: row.renewal,
    transfer: row.transfer,
    threeYearTotal: threeYearTotal(row.firstYear, row.renewal),
    currency: row.currency,
    source: row.source,
    checkedAt: row.checkedAt,
    priceLabel: verified
      ? tablePriceLabel(registrar, row.checkedAt)
      : `${UNKNOWN} — price not verified, check at ${REGISTRAR_NAMES[registrar]}`,
  };
}

export function tldInfo(tld: string, tables: TldTables): TldInfo {
  const registrars = REGISTRARS.map((registrar) => registrarEntry(tld, registrar, tables));
  const rep = tables.reputation.rows.find((r) => r.tld === tld);
  return {
    tld,
    registrars,
    cheapestThreeYear: cheapestThreeYear(registrars),
    reputation: rep
      ? {
          reputation: rep.reputation,
          reputationNote: rep.reputationNote,
          source: rep.source,
          checkedAt: rep.checkedAt,
        }
      : null,
    notes: [TABLE_NOTE],
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && pnpm test test/tld/info.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Format, check, typecheck, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/tld/pricing.ts server/src/tld/info.ts server/test/tld/fixtures.ts server/test/tld/info.test.ts
git commit -m "feat(tld): add price labels, 3-year totals, and tldInfo"
```

---

### Task 3: Live client types, credentials, redaction, and key status

**Files:**
- Create: `server/src/registrars/types.ts`, `server/src/registrars/credentials.ts`
- Test: `server/test/registrars/credentials.test.ts`

**Interfaces:**
- Consumes: `HttpFetch` from `http/http.ts`; `REGISTRARS`, `REGISTRAR_NAMES`, `RegistrarId` from `tld/schema.ts`.
- Produces:
  - `types.ts`: `type LiveAvailability = 'available' | 'unavailable' | 'unknown'`; `interface LiveQuote { registrar; domain; availability; premium: boolean | null; firstYear: number | null; renewal: number | null; currency: string | null; checkedAt: string; reason?: string }`; `interface LiveClient { id: RegistrarId; quote(domains: string[]): Promise<LiveQuote[]> }`; `interface ClientDeps { http: HttpFetch; now?: () => Date }`; `chunk<T>(items: T[], size: number): T[][]`; `toPrice(value: unknown): number | null`; `unknownQuote(registrar, domain, checkedAt, reason): LiveQuote`.
  - `credentials.ts`: `SpaceshipCreds { apiKey; apiSecret }`, `NamecheapCreds { apiUser; apiKey; clientIp }`, `CloudflareCreds { apiToken; accountId }`, `Credentials { spaceship?; namecheap?; cloudflare? }`; `ENV_VARS`; `OTHER_ENV_VARS` (the 7 optional research keys of Plan 3: `GITHUB_TOKEN`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `EUIPO_CLIENT_ID`, `EUIPO_CLIENT_SECRET`, `EUIPO_ENV`, names only); `readCredentials(env): Credentials`; `secretValues(creds): string[]`; `redact(text, secrets): string`; `RegistrarStatusEntry`, `OtherKeyStatus`, `RegistrarStatusReport { registrars; otherKeys; note }`; `STATUS_NOTE`; `registrarStatus(env): RegistrarStatusReport`.

A value that is empty, blank, or still the literal `${VAR}` placeholder (left by `.mcp.json` when a variable is unset) counts as unset.

- [ ] **Step 1: Write the failing test**

`server/test/registrars/credentials.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  readCredentials,
  redact,
  registrarStatus,
  secretValues,
} from '../../src/registrars/credentials.js';

const FULL_ENV = {
  SPACESHIP_API_KEY: 'ss-key-1234',
  SPACESHIP_API_SECRET: 'ss-secret-5678',
  NAMECHEAP_API_USER: 'ncuser',
  NAMECHEAP_API_KEY: 'nc-key-abcd',
  NAMECHEAP_CLIENT_IP: '203.0.113.7',
  CLOUDFLARE_API_TOKEN: 'cf-token-efgh',
  CLOUDFLARE_ACCOUNT_ID: 'cf-account-ijkl',
};

describe('readCredentials', () => {
  it('reads every registrar when all its variables are set', () => {
    expect(readCredentials(FULL_ENV)).toEqual({
      spaceship: { apiKey: 'ss-key-1234', apiSecret: 'ss-secret-5678' },
      namecheap: { apiUser: 'ncuser', apiKey: 'nc-key-abcd', clientIp: '203.0.113.7' },
      cloudflare: { apiToken: 'cf-token-efgh', accountId: 'cf-account-ijkl' },
    });
  });

  it('skips a registrar with a missing or blank variable', () => {
    const creds = readCredentials({
      ...FULL_ENV,
      SPACESHIP_API_SECRET: '  ',
      NAMECHEAP_CLIENT_IP: undefined,
    });
    expect(creds.spaceship).toBeUndefined();
    expect(creds.namecheap).toBeUndefined();
    expect(creds.cloudflare).toBeDefined();
  });

  it('treats an unexpanded .mcp.json placeholder as unset', () => {
    const creds = readCredentials({
      ...FULL_ENV,
      CLOUDFLARE_API_TOKEN: '\u0024{CLOUDFLARE_API_TOKEN}',
    });
    expect(creds.cloudflare).toBeUndefined();
  });
});

describe('redact', () => {
  it('replaces every secret value', () => {
    const secrets = secretValues(readCredentials(FULL_ENV));
    const text = 'GET https://api.test/?ApiKey=nc-key-abcd&x=ss-secret-5678 failed';
    expect(redact(text, secrets)).toBe(
      'GET https://api.test/?ApiKey=[redacted]&x=[redacted] failed',
    );
  });
});

describe('registrarStatus', () => {
  it('reports configured registrars and missing variable names, never values', () => {
    const report = registrarStatus({
      SPACESHIP_API_KEY: 'ss-key-1234',
      CLOUDFLARE_API_TOKEN: 'cf-token-efgh',
      CLOUDFLARE_ACCOUNT_ID: 'cf-account-ijkl',
    });
    expect(report.registrars.map((r) => [r.registrar, r.configured, r.missing])).toEqual([
      ['spaceship', false, ['SPACESHIP_API_SECRET']],
      ['namecheap', false, ['NAMECHEAP_API_USER', 'NAMECHEAP_API_KEY', 'NAMECHEAP_CLIENT_IP']],
      ['cloudflare', true, []],
    ]);
    const text = JSON.stringify(report);
    for (const value of ['ss-key-1234', 'cf-token-efgh', 'cf-account-ijkl']) {
      expect(text).not.toContain(value);
    }
  });

  it('lists the optional research keys by name and set state only', () => {
    const report = registrarStatus({ GITHUB_TOKEN: 'gh-token-zzzz', EUIPO_ENV: 'sandbox' });
    expect(report.otherKeys.filter((k) => k.configured).map((k) => k.name)).toEqual([
      'GITHUB_TOKEN',
      'EUIPO_ENV',
    ]);
    expect(report.otherKeys).toHaveLength(7);
    expect(JSON.stringify(report)).not.toContain('gh-token-zzzz');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && pnpm test test/registrars/credentials.test.ts`
Expected: FAIL, `../../src/registrars/credentials.js` does not exist.

- [ ] **Step 3: Write the shared live client types**

`server/src/registrars/types.ts`:
```ts
import type { HttpFetch } from '../http/http.js';
import type { RegistrarId } from '../tld/schema.js';

/** What a registrar API said about one exact domain. */
export type LiveAvailability = 'available' | 'unavailable' | 'unknown';

export interface LiveQuote {
  registrar: RegistrarId;
  domain: string;
  availability: LiveAvailability;
  premium: boolean | null;
  firstYear: number | null;
  renewal: number | null;
  currency: string | null;
  checkedAt: string;
  reason?: string;
}

export interface LiveClient {
  id: RegistrarId;
  /** Quotes exact, normalized domains. May throw on transport or auth failure. */
  quote(domains: string[]): Promise<LiveQuote[]>;
}

export interface ClientDeps {
  http: HttpFetch;
  now?: () => Date;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Parses a price that may arrive as a string or number; anything else is null. */
export function toPrice(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

export function unknownQuote(
  registrar: RegistrarId,
  domain: string,
  checkedAt: string,
  reason: string,
): LiveQuote {
  return {
    registrar,
    domain,
    availability: 'unknown',
    premium: null,
    firstYear: null,
    renewal: null,
    currency: null,
    checkedAt,
    reason,
  };
}
```

- [ ] **Step 4: Write credentials and status**

`server/src/registrars/credentials.ts`:
```ts
import { REGISTRAR_NAMES, REGISTRARS, type RegistrarId } from '../tld/schema.js';

export interface SpaceshipCreds {
  apiKey: string;
  apiSecret: string;
}

export interface NamecheapCreds {
  apiUser: string;
  apiKey: string;
  clientIp: string;
}

export interface CloudflareCreds {
  apiToken: string;
  accountId: string;
}

export interface Credentials {
  spaceship?: SpaceshipCreds;
  namecheap?: NamecheapCreds;
  cloudflare?: CloudflareCreds;
}

export const ENV_VARS: Record<RegistrarId, readonly string[]> = {
  spaceship: ['SPACESHIP_API_KEY', 'SPACESHIP_API_SECRET'],
  namecheap: ['NAMECHEAP_API_USER', 'NAMECHEAP_API_KEY', 'NAMECHEAP_CLIENT_IP'],
  cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
};

const LIVE_FEATURES: Record<RegistrarId, string> = {
  spaceship: 'live availability, premium flag, and price',
  namecheap: 'live availability, premium flag, and price (the caller IP must be allow-listed)',
  cloudflare: 'live availability, premium tier, and price (Registrar API, beta)',
};

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  // An unexpanded "${VAR}" placeholder from .mcp.json means the variable is not set.
  return value && !value.startsWith('${') ? value : undefined;
}

/** Reads registrar keys from env. A registrar counts only when all its variables are set. */
export function readCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const creds: Credentials = {};
  const ssKey = read(env, 'SPACESHIP_API_KEY');
  const ssSecret = read(env, 'SPACESHIP_API_SECRET');
  if (ssKey && ssSecret) creds.spaceship = { apiKey: ssKey, apiSecret: ssSecret };

  const ncUser = read(env, 'NAMECHEAP_API_USER');
  const ncKey = read(env, 'NAMECHEAP_API_KEY');
  const ncIp = read(env, 'NAMECHEAP_CLIENT_IP');
  if (ncUser && ncKey && ncIp) creds.namecheap = { apiUser: ncUser, apiKey: ncKey, clientIp: ncIp };

  const cfToken = read(env, 'CLOUDFLARE_API_TOKEN');
  const cfAccount = read(env, 'CLOUDFLARE_ACCOUNT_ID');
  if (cfToken && cfAccount) creds.cloudflare = { apiToken: cfToken, accountId: cfAccount };
  return creds;
}

/** Every configured value, longest first, so redaction never leaves a partial secret. */
export function secretValues(creds: Credentials): string[] {
  const values = [creds.spaceship, creds.namecheap, creds.cloudflare].flatMap((c) =>
    c ? Object.values(c) : [],
  );
  return [...new Set(values.filter((v) => v.length >= 4))].sort((a, b) => b.length - a.length);
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out;
}

export interface RegistrarStatusEntry {
  registrar: RegistrarId;
  name: string;
  configured: boolean;
  envVars: string[];
  missing: string[];
  liveFeatures: string;
}

/** A non-registrar key that another tool reads. Only the name and whether it is set are shown. */
export interface OtherKeyStatus {
  name: string;
  usedFor: string;
  configured: boolean;
}

export interface RegistrarStatusReport {
  registrars: RegistrarStatusEntry[];
  otherKeys: OtherKeyStatus[];
  note: string;
}

/** Optional research keys (read by the research tools), listed so one tool shows every key. */
export const OTHER_ENV_VARS: ReadonlyArray<{ name: string; usedFor: string }> = [
  { name: 'GITHUB_TOKEN', usedFor: 'check_handles: higher GitHub rate limit' },
  { name: 'REDDIT_CLIENT_ID', usedFor: 'check_handles: Reddit username lookup' },
  { name: 'REDDIT_CLIENT_SECRET', usedFor: 'check_handles: Reddit username lookup' },
  { name: 'YOUTUBE_API_KEY', usedFor: 'check_handles: YouTube handle lookup' },
  { name: 'EUIPO_CLIENT_ID', usedFor: 'search_trademarks: EUIPO trademark search' },
  { name: 'EUIPO_CLIENT_SECRET', usedFor: 'search_trademarks: EUIPO trademark search' },
  { name: 'EUIPO_ENV', usedFor: 'search_trademarks: "sandbox" for EUIPO test data' },
];

export const STATUS_NOTE =
  'Key values are never returned, logged, or stored. Without keys, registrar_quote returns bundled table prices only.';

export function registrarStatus(env: NodeJS.ProcessEnv = process.env): RegistrarStatusReport {
  return {
    registrars: REGISTRARS.map((registrar) => {
      const envVars = [...ENV_VARS[registrar]];
      const missing = envVars.filter((name) => !read(env, name));
      return {
        registrar,
        name: REGISTRAR_NAMES[registrar],
        configured: missing.length === 0,
        envVars,
        missing,
        liveFeatures: LIVE_FEATURES[registrar],
      };
    }),
    otherKeys: OTHER_ENV_VARS.map(({ name, usedFor }) => ({
      name,
      usedFor,
      configured: read(env, name) !== undefined,
    })),
    note: STATUS_NOTE,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/registrars/credentials.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Format, check, typecheck, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/registrars/types.ts server/src/registrars/credentials.ts server/test/registrars/credentials.test.ts
git commit -m "feat(registrars): read optional keys from env with redaction and status"
```

---

### Task 4: Spaceship client

**Files:**
- Create: `server/src/registrars/spaceship.ts`
- Test: `server/test/registrars/fake-http.ts`, `server/test/registrars/fixtures/spaceship-available.json`, `server/test/registrars/fixtures/spaceship-domain-prices.json`, `server/test/registrars/fixtures/spaceship-tld-prices.json`, `server/test/registrars/spaceship.test.ts`

**Interfaces:**
- Consumes: `HttpFetch` from `http/http.ts`; `ClientDeps`, `LiveClient`, `LiveQuote`, `chunk`, `toPrice`, `unknownQuote` from `registrars/types.ts`; `SpaceshipCreds` from `registrars/credentials.ts`; `PriceRow` from `tld/schema.ts`.
- Produces: `SPACESHIP_API = 'https://spaceship.dev/api'`; `SPACESHIP_TLD_SOURCE = 'Spaceship API /v1/tlds/pricing'`; `oneYear(...)`; `parseSpaceshipAvailability(json)`; `parseSpaceshipDomainPrices(json)`; `parseSpaceshipTldPrices(json: unknown, checkedAt: string): PriceRow[]`; `createSpaceshipClient(creds: SpaceshipCreds, deps: ClientDeps): LiveClient`; `fetchSpaceshipTldPrices(creds: SpaceshipCreds, http: HttpFetch, checkedAt: string): Promise<PriceRow[]>`. Test helpers: `fakeHttp(routes: Array<[string, () => Response | Error]>): { http: HttpFetch; calls: Array<{ method; url; headers: Headers; body?: string }> }` (first matching URL prefix wins) and `FIXED_NOW` (2026-11-04T10:00:00.000Z), both in `test/registrars/fake-http.ts`.

Behavior: domains go in batches of 20 to `POST /v1/domains/available` and `POST /v1/domains/pricing/query`. A premium name takes its price from `premiumPricing`. Any `result` other than `"available"` is `unavailable` with the reason `Spaceship result: <value>`, because the docs list no other values. A domain missing from the response is `unknown`. An HTTP error throws `Spaceship API returned HTTP <status>: <detail>`; the message never contains a key. Fixture prices are synthetic test values, not real prices.

- [ ] **Step 1: Write the fake HTTP helper**

`server/test/registrars/fake-http.ts`:
```ts
import type { HttpFetch } from '../../src/http/http.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

/** A fake HttpFetch that answers by URL prefix and records every call. No network. */
export function fakeHttp(routes: Array<[prefix: string, reply: () => Response | Error]>): {
  http: HttpFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const http: HttpFetch = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    if (!route) return new Response('no route', { status: 500 });
    const reply = route[1]();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { http, calls };
}

export const FIXED_NOW = new Date('2026-11-04T10:00:00.000Z');
```

- [ ] **Step 2: Write the fixtures**

`server/test/registrars/fixtures/spaceship-available.json`:
```json
{
  "domains": [
    { "domain": "zentrova.site", "result": "available", "premiumPricing": [] },
    { "domain": "google.com", "result": "taken" },
    {
      "domain": "rare.io",
      "result": "available",
      "premiumPricing": [
        { "operation": "register", "price": 999.99, "currency": "USD" },
        { "operation": "renew", "price": 59.98, "currency": "USD" }
      ]
    }
  ]
}
```

`server/test/registrars/fixtures/spaceship-domain-prices.json`:
```json
{
  "domains": [
    {
      "domain": "zentrova.site",
      "priceClass": "standard",
      "prices": {
        "register": [
          {
            "period": { "value": 1, "unit": "y" },
            "priceInDefaultCurrency": {
              "finalPrice": { "amount": "1.05", "currency": "EUR" },
              "regularPrice": { "amount": "11.11", "currency": "EUR" }
            }
          }
        ],
        "renew": [
          {
            "period": { "value": 1, "unit": "y" },
            "priceInDefaultCurrency": {
              "finalPrice": { "amount": "11.11", "currency": "EUR" },
              "regularPrice": { "amount": "11.11", "currency": "EUR" }
            }
          }
        ]
      }
    },
    {
      "domain": "google.com",
      "priceClass": "standard",
      "prices": {
        "register": [
          {
            "period": { "value": 1, "unit": "y" },
            "priceInDefaultCurrency": {
              "finalPrice": { "amount": "9.99", "currency": "EUR" },
              "regularPrice": { "amount": "9.99", "currency": "EUR" }
            }
          }
        ]
      }
    },
    { "domain": "rare.io", "priceClass": "premium", "prices": {} }
  ]
}
```

`server/test/registrars/fixtures/spaceship-tld-prices.json`:
```json
{
  "items": [
    {
      "tld": "site",
      "prices": {
        "register": [
          {
            "period": { "value": 1, "unit": "y" },
            "priceInDefaultCurrency": {
              "finalPrice": { "amount": "1.05", "currency": "EUR" },
              "regularPrice": { "amount": "11.11", "currency": "EUR" }
            }
          }
        ],
        "renew": [
          {
            "period": { "value": 1, "unit": "y" },
            "priceInDefaultCurrency": {
              "finalPrice": { "amount": "11.11", "currency": "EUR" },
              "regularPrice": { "amount": "11.11", "currency": "EUR" }
            }
          }
        ],
        "transfer": [
          {
            "period": { "value": 1, "unit": "y" },
            "priceInDefaultCurrency": {
              "finalPrice": { "amount": "10.10", "currency": "EUR" },
              "regularPrice": { "amount": "10.10", "currency": "EUR" }
            }
          }
        ]
      }
    },
    { "tld": "id", "prices": {} }
  ],
  "total": 2
}
```

- [ ] **Step 3: Write the failing test**

`server/test/registrars/spaceship.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  createSpaceshipClient,
  fetchSpaceshipTldPrices,
  parseSpaceshipTldPrices,
  SPACESHIP_API,
} from '../../src/registrars/spaceship.js';
import { FIXED_NOW, fakeHttp } from './fake-http.js';
import available from './fixtures/spaceship-available.json' with { type: 'json' };
import domainPrices from './fixtures/spaceship-domain-prices.json' with { type: 'json' };
import tldPrices from './fixtures/spaceship-tld-prices.json' with { type: 'json' };

const CREDS = { apiKey: 'ss-key-1234', apiSecret: 'ss-secret-5678' };

function client() {
  const fake = fakeHttp([
    [`${SPACESHIP_API}/v1/domains/available`, () => Response.json(available)],
    [`${SPACESHIP_API}/v1/domains/pricing/query`, () => Response.json(domainPrices)],
  ]);
  return {
    ...fake,
    client: createSpaceshipClient(CREDS, { http: fake.http, now: () => FIXED_NOW }),
  };
}

describe('Spaceship client', () => {
  it('sends the key headers and both POST requests', async () => {
    const { client: c, calls } = client();
    await c.quote(['zentrova.site']);
    expect(calls.map((x) => [x.method, x.url])).toEqual([
      ['POST', `${SPACESHIP_API}/v1/domains/available`],
      ['POST', `${SPACESHIP_API}/v1/domains/pricing/query`],
    ]);
    expect(calls[0]?.headers.get('x-api-key')).toBe('ss-key-1234');
    expect(calls[0]?.headers.get('x-api-secret')).toBe('ss-secret-5678');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ domains: ['zentrova.site'] });
  });

  it('maps a standard available domain to its 1-year prices', async () => {
    const [quote] = await client().client.quote(['zentrova.site']);
    expect(quote).toEqual({
      registrar: 'spaceship',
      domain: 'zentrova.site',
      availability: 'available',
      premium: false,
      firstYear: 1.05,
      renewal: 11.11,
      currency: 'EUR',
      checkedAt: '2026-11-04T10:00:00.000Z',
    });
  });

  it('treats any result other than "available" as unavailable', async () => {
    const [quote] = await client().client.quote(['google.com']);
    expect(quote).toMatchObject({ availability: 'unavailable', reason: 'Spaceship result: taken' });
  });

  it('uses premium pricing for a premium domain', async () => {
    const [quote] = await client().client.quote(['rare.io']);
    expect(quote).toMatchObject({
      availability: 'available',
      premium: true,
      firstYear: 999.99,
      renewal: 59.98,
      currency: 'USD',
    });
  });

  it('returns unknown for a domain missing from the response', async () => {
    const [quote] = await client().client.quote(['absent.site']);
    expect(quote).toMatchObject({ availability: 'unknown', reason: 'no availability result' });
  });

  it('throws on an HTTP error without echoing the keys', async () => {
    const { http } = fakeHttp([
      [
        'https://spaceship.dev/',
        () => Response.json({ detail: 'Invalid API key' }, { status: 401 }),
      ],
    ]);
    const c = createSpaceshipClient(CREDS, { http });
    const error = await c.quote(['zentrova.site']).catch((e: Error) => e);
    expect(String(error)).toContain('HTTP 401: Invalid API key');
    expect(String(error)).not.toContain('ss-key-1234');
  });
});

describe('Spaceship TLD prices', () => {
  it('parses rows with first-year, renewal, and transfer in one currency', () => {
    expect(parseSpaceshipTldPrices(tldPrices, '2026-11-04')).toEqual([
      {
        registrar: 'spaceship',
        tld: 'site',
        firstYear: 1.05,
        renewal: 11.11,
        transfer: 10.1,
        currency: 'EUR',
        source: 'Spaceship API /v1/tlds/pricing',
        checkedAt: '2026-11-04',
      },
    ]);
  });

  it('pages until total is reached', async () => {
    const { http, calls } = fakeHttp([
      [`${SPACESHIP_API}/v1/tlds/pricing`, () => Response.json(tldPrices)],
    ]);
    const rows = await fetchSpaceshipTldPrices(CREDS, http, '2026-11-04');
    expect(rows).toHaveLength(1);
    expect(calls.map((c) => c.url)).toEqual([`${SPACESHIP_API}/v1/tlds/pricing?take=25&skip=0`]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd server && pnpm test test/registrars/spaceship.test.ts`
Expected: FAIL, `../../src/registrars/spaceship.js` does not exist.

- [ ] **Step 5: Write the client**

`server/src/registrars/spaceship.ts`:
```ts
import type { HttpFetch } from '../http/http.js';
import type { PriceRow } from '../tld/schema.js';
import type { SpaceshipCreds } from './credentials.js';
import {
  type ClientDeps,
  chunk,
  type LiveClient,
  type LiveQuote,
  toPrice,
  unknownQuote,
} from './types.js';

export const SPACESHIP_API = 'https://spaceship.dev/api';
export const SPACESHIP_TLD_SOURCE = 'Spaceship API /v1/tlds/pricing';
const BATCH = 20;
const PAGE = 25;

interface Money {
  amount?: string;
  currency?: string;
}
interface PriceEntry {
  period?: { value?: number; unit?: string };
  priceInDefaultCurrency?: { finalPrice?: Money; regularPrice?: Money };
}
interface Prices {
  register?: PriceEntry[];
  renew?: PriceEntry[];
  transfer?: PriceEntry[];
}

/** The 1-year final price of an operation, or null when the operation is missing. */
export function oneYear(
  entries: PriceEntry[] | undefined,
): { amount: number; currency: string } | null {
  const entry = entries?.find((e) => e.period?.value === 1 && e.period?.unit === 'y');
  const final = entry?.priceInDefaultCurrency?.finalPrice;
  const amount = toPrice(final?.amount);
  return amount !== null && final?.currency ? { amount, currency: final.currency } : null;
}

export interface SpaceshipAvailability {
  domain: string;
  result: string;
  premiumRegister: { price: number; currency: string } | null;
  premiumRenew: { price: number; currency: string } | null;
}

export function parseSpaceshipAvailability(json: unknown): SpaceshipAvailability[] {
  const items = (json as { domains?: unknown[] }).domains ?? [];
  return items.map((raw) => {
    const item = raw as {
      domain: string;
      result: string;
      premiumPricing?: Array<{ operation?: string; price?: unknown; currency?: string }>;
    };
    const premium = (operation: string) => {
      const p = item.premiumPricing?.find((x) => x.operation === operation);
      const price = toPrice(p?.price);
      return price !== null && p?.currency ? { price, currency: p.currency } : null;
    };
    return {
      domain: item.domain.toLowerCase(),
      result: item.result,
      premiumRegister: premium('register'),
      premiumRenew: premium('renew'),
    };
  });
}

export interface SpaceshipDomainPrice {
  domain: string;
  priceClass: string | null;
  register: { amount: number; currency: string } | null;
  renew: { amount: number; currency: string } | null;
  errorCode?: string;
}

export function parseSpaceshipDomainPrices(json: unknown): SpaceshipDomainPrice[] {
  const items = (json as { domains?: unknown[] }).domains ?? [];
  return items.map((raw) => {
    const item = raw as {
      domain: string;
      priceClass?: string;
      prices?: Prices;
      errorCode?: string;
    };
    return {
      domain: item.domain.toLowerCase(),
      priceClass: item.priceClass ?? null,
      register: oneYear(item.prices?.register),
      renew: oneYear(item.prices?.renew),
      ...(item.errorCode ? { errorCode: item.errorCode } : {}),
    };
  });
}

export function parseSpaceshipTldPrices(json: unknown, checkedAt: string): PriceRow[] {
  const items = (json as { items?: unknown[] }).items ?? [];
  return items.flatMap((raw) => {
    const item = raw as { tld: string; prices?: Prices };
    const register = oneYear(item.prices?.register);
    const renew = oneYear(item.prices?.renew);
    const transfer = oneYear(item.prices?.transfer);
    const currency = register?.currency ?? renew?.currency ?? transfer?.currency ?? null;
    if (currency === null) return [];
    const inCurrency = (p: { amount: number; currency: string } | null) =>
      p && p.currency === currency ? p.amount : null;
    return [
      {
        registrar: 'spaceship' as const,
        tld: item.tld.toLowerCase(),
        firstYear: inCurrency(register),
        renewal: inCurrency(renew),
        transfer: inCurrency(transfer),
        currency,
        source: SPACESHIP_TLD_SOURCE,
        checkedAt,
      },
    ];
  });
}

function headers(creds: SpaceshipCreds): Record<string, string> {
  return {
    'X-API-Key': creds.apiKey,
    'X-API-Secret': creds.apiSecret,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

async function readJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    let detail = '';
    try {
      detail = String(((await res.json()) as { detail?: unknown }).detail ?? '');
    } catch {
      // The body is not JSON; the status code is enough.
    }
    throw new Error(`Spaceship API returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

function toQuote(
  domain: string,
  checkedAt: string,
  availability: SpaceshipAvailability | undefined,
  price: SpaceshipDomainPrice | undefined,
): LiveQuote {
  if (!availability) return unknownQuote('spaceship', domain, checkedAt, 'no availability result');
  const premium = availability.premiumRegister !== null || price?.priceClass === 'premium';
  const register = availability.premiumRegister
    ? {
        amount: availability.premiumRegister.price,
        currency: availability.premiumRegister.currency,
      }
    : premium
      ? null
      : (price?.register ?? null);
  const renew = availability.premiumRenew
    ? { amount: availability.premiumRenew.price, currency: availability.premiumRenew.currency }
    : premium
      ? null
      : (price?.renew ?? null);
  const currency = register?.currency ?? renew?.currency ?? null;
  return {
    registrar: 'spaceship',
    domain,
    // Only "available" is documented; any other value is treated as not available.
    availability: availability.result === 'available' ? 'available' : 'unavailable',
    premium,
    firstYear: register && register.currency === currency ? register.amount : null,
    renewal: renew && renew.currency === currency ? renew.amount : null,
    currency,
    checkedAt,
    ...(availability.result === 'available'
      ? {}
      : { reason: `Spaceship result: ${availability.result}` }),
  };
}

export function createSpaceshipClient(creds: SpaceshipCreds, deps: ClientDeps): LiveClient {
  const now = deps.now ?? (() => new Date());
  return {
    id: 'spaceship',
    async quote(domains) {
      const out: LiveQuote[] = [];
      for (const batch of chunk(domains, BATCH)) {
        const body = JSON.stringify({ domains: batch });
        const init = { method: 'POST', headers: headers(creds), body };
        const availability = parseSpaceshipAvailability(
          await readJson(await deps.http(`${SPACESHIP_API}/v1/domains/available`, init)),
        );
        const prices = parseSpaceshipDomainPrices(
          await readJson(await deps.http(`${SPACESHIP_API}/v1/domains/pricing/query`, init)),
        );
        const checkedAt = now().toISOString();
        for (const domain of batch) {
          out.push(
            toQuote(
              domain,
              checkedAt,
              availability.find((a) => a.domain === domain),
              prices.find((p) => p.domain === domain),
            ),
          );
        }
      }
      return out;
    },
  };
}

/** Reads every TLD price page. Used by the maintainer refresh script only. */
export async function fetchSpaceshipTldPrices(
  creds: SpaceshipCreds,
  http: HttpFetch,
  checkedAt: string,
): Promise<PriceRow[]> {
  const rows: PriceRow[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const url = `${SPACESHIP_API}/v1/tlds/pricing?take=${PAGE}&skip=${skip}`;
    const json = (await readJson(await http(url, { headers: headers(creds) }))) as {
      items?: unknown[];
      total?: number;
    };
    rows.push(...parseSpaceshipTldPrices(json, checkedAt));
    const count = json.items?.length ?? 0;
    if (count === 0 || skip + count >= (json.total ?? 0)) break;
  }
  return rows;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && pnpm test test/registrars/spaceship.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Format, check, typecheck, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/registrars/spaceship.ts server/test/registrars/fake-http.ts server/test/registrars/fixtures/spaceship-*.json server/test/registrars/spaceship.test.ts
git commit -m "feat(registrars): add Spaceship live client and TLD price fetch"
```

---

### Task 5: Namecheap client

**Files:**
- Create: `server/src/registrars/namecheap.ts`
- Test: `server/test/registrars/fixtures/namecheap-check.xml`, `namecheap-pricing-site-register.xml`, `namecheap-pricing-site-renew.xml`, `namecheap-pricing-all.xml`, `namecheap-tldlist.xml`, `namecheap-error.xml` (all in `server/test/registrars/fixtures/`), `server/test/registrars/namecheap.test.ts`

**Interfaces:**
- Consumes: `DiskCache` from `cache/cache.ts`; `TTL.registrarLive` from `cache/ttl.ts`; `HttpFetch`; `ClientDeps`, `LiveClient`, `LiveQuote`, `chunk`, `toPrice`, `unknownQuote` from `registrars/types.ts`; `NamecheapCreds`; `PriceRow`; `fakeHttp`, `FIXED_NOW` (Task 4).
- Produces: `NAMECHEAP_API = 'https://api.namecheap.com/xml.response'`; `NAMECHEAP_TLD_SOURCE = 'Namecheap API namecheap.users.getPricing'`; `xmlElements(xml: string, tag: string): Array<Record<string, string>>`; `namecheapErrors(xml: string): string[]`; `interface NamecheapCheck`; `parseNamecheapCheck(xml): NamecheapCheck[]`; `interface NamecheapPrice`; `parseNamecheapPricing(xml): NamecheapPrice[]`; `namecheapTldRows(prices, soldTlds: Set<string> | null, checkedAt): PriceRow[]`; `interface NamecheapDeps extends ClientDeps { cache: DiskCache }`; `createNamecheapClient(creds: NamecheapCreds, deps: NamecheapDeps): LiveClient`; `fetchNamecheapTldPrices(creds, http, checkedAt): Promise<PriceRow[]>`.

Behavior: the Namecheap API takes its credentials in the query string, so a request URL must never be logged or put in an error; errors read `Namecheap API returned HTTP <status>` or `Namecheap API error: <number>: <message>`. Domains go in batches of 50 to `namecheap.domains.check`. Standard prices come from `namecheap.users.getPricing` (1-year `REGISTER` and `RENEW` per TLD), cached per action and TLD for `TTL.registrarLive`. A premium name uses `PremiumRegistrationPrice` and `PremiumRenewalPrice`; the API does not state their currency, so the client takes the currency from that TLD's `getPricing` response and leaves it `null` when there is none. The parser is a small regex reader for these flat attribute-only responses, so no XML dependency is added. Fixture prices are synthetic.

- [ ] **Step 1: Write the fixtures**

`server/test/registrars/fixtures/namecheap-check.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <Warnings />
  <RequestedCommand>namecheap.domains.check</RequestedCommand>
  <CommandResponse Type="namecheap.domains.check">
    <DomainCheckResult Domain="zentrova.site" Available="true" ErrorNo="0" Description="" IsPremiumName="false" PremiumRegistrationPrice="0" PremiumRenewalPrice="0" PremiumRestorePrice="0" PremiumTransferPrice="0" IcannFee="0" EapFee="0" />
    <DomainCheckResult Domain="google.com" Available="false" ErrorNo="0" Description="" IsPremiumName="false" PremiumRegistrationPrice="0" PremiumRenewalPrice="0" PremiumRestorePrice="0" PremiumTransferPrice="0" IcannFee="0" EapFee="0" />
    <DomainCheckResult Domain="us.xyz" Available="true" ErrorNo="0" Description="" IsPremiumName="true" PremiumRegistrationPrice="13000.0000" PremiumRenewalPrice="13000.0000" PremiumRestorePrice="65.0000" PremiumTransferPrice="13000.0000" IcannFee="0.0000" EapFee="0.0000" />
    <DomainCheckResult Domain="broken.site" Available="false" ErrorNo="3031510" Description="Error response from provider" IsPremiumName="false" PremiumRegistrationPrice="0" PremiumRenewalPrice="0" PremiumRestorePrice="0" PremiumTransferPrice="0" IcannFee="0" EapFee="0" />
  </CommandResponse>
  <Server>TEST</Server>
  <GMTTimeDifference>--5:00</GMTTimeDifference>
  <ExecutionTime>0.1</ExecutionTime>
</ApiResponse>
```

`server/test/registrars/fixtures/namecheap-pricing-site-register.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <RequestedCommand>namecheap.users.getPricing</RequestedCommand>
  <CommandResponse Type="namecheap.users.getPricing">
    <UserGetPricingResult>
      <ProductType Name="DOMAIN">
        <ProductCategory Name="REGISTER">
          <Product Name="site">
            <Price Duration="1" DurationType="YEAR" Price="1.11" RegularPrice="22.22" YourPrice="22.22" CouponPrice="" Currency="USD" />
            <Price Duration="2" DurationType="YEAR" Price="23.33" RegularPrice="44.44" YourPrice="44.44" CouponPrice="" Currency="USD" />
          </Product>
        </ProductCategory>
      </ProductType>
    </UserGetPricingResult>
  </CommandResponse>
  <Server>TEST</Server>
  <GMTTimeDifference>--5:00</GMTTimeDifference>
  <ExecutionTime>0.1</ExecutionTime>
</ApiResponse>
```

`server/test/registrars/fixtures/namecheap-pricing-site-renew.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <RequestedCommand>namecheap.users.getPricing</RequestedCommand>
  <CommandResponse Type="namecheap.users.getPricing">
    <UserGetPricingResult>
      <ProductType Name="DOMAIN">
        <ProductCategory Name="RENEW">
          <Product Name="site">
            <Price Duration="1" DurationType="YEAR" Price="22.22" RegularPrice="22.22" YourPrice="22.22" CouponPrice="" Currency="USD" />
            <Price Duration="2" DurationType="YEAR" Price="23.33" RegularPrice="44.44" YourPrice="44.44" CouponPrice="" Currency="USD" />
          </Product>
        </ProductCategory>
      </ProductType>
    </UserGetPricingResult>
  </CommandResponse>
  <Server>TEST</Server>
  <GMTTimeDifference>--5:00</GMTTimeDifference>
  <ExecutionTime>0.1</ExecutionTime>
</ApiResponse>
```

`server/test/registrars/fixtures/namecheap-pricing-all.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <RequestedCommand>namecheap.users.getPricing</RequestedCommand>
  <CommandResponse Type="namecheap.users.getPricing">
    <UserGetPricingResult>
      <ProductType Name="DOMAIN">
        <ProductCategory Name="REACTIVATE">
          <Product Name="site">
            <Price Duration="1" DurationType="YEAR" Price="30.00" RegularPrice="30.00" YourPrice="30.00" CouponPrice="" Currency="USD" />
          </Product>
        </ProductCategory>
        <ProductCategory Name="REGISTER">
          <Product Name="site">
            <Price Duration="1" DurationType="YEAR" Price="1.11" RegularPrice="22.22" YourPrice="22.22" CouponPrice="" Currency="USD" />
          </Product>
          <Product Name="notlisted">
            <Price Duration="1" DurationType="YEAR" Price="5.00" RegularPrice="5.00" YourPrice="5.00" CouponPrice="" Currency="USD" />
          </Product>
        </ProductCategory>
        <ProductCategory Name="RENEW">
          <Product Name="site">
            <Price Duration="1" DurationType="YEAR" Price="22.22" RegularPrice="22.22" YourPrice="22.22" CouponPrice="" Currency="USD" />
          </Product>
        </ProductCategory>
        <ProductCategory Name="TRANSFER">
          <Product Name="site">
            <Price Duration="1" DurationType="YEAR" Price="20.20" RegularPrice="20.20" YourPrice="20.20" CouponPrice="" Currency="USD" />
          </Product>
        </ProductCategory>
      </ProductType>
    </UserGetPricingResult>
  </CommandResponse>
  <Server>TEST</Server>
  <GMTTimeDifference>--5:00</GMTTimeDifference>
  <ExecutionTime>0.1</ExecutionTime>
</ApiResponse>
```

`server/test/registrars/fixtures/namecheap-tldlist.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <RequestedCommand>namecheap.domains.gettldlist</RequestedCommand>
  <CommandResponse Type="namecheap.domains.getTldList">
    <Tlds>
      <Tld Name="site" NonRealTimeDomain="false" MinRegisterYears="1" MaxRegisterYears="10" IsApiRegisterable="true" IsApiRenewable="true" IsApiTransferable="true" Type="GTLD">Site</Tld>
    </Tlds>
  </CommandResponse>
  <Server>TEST</Server>
  <GMTTimeDifference>--5:00</GMTTimeDifference>
  <ExecutionTime>0.1</ExecutionTime>
</ApiResponse>
```

`server/test/registrars/fixtures/namecheap-error.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response">
  <Errors>
    <Error Number="1011150">Parameter RequestIP is invalid</Error>
  </Errors>
  <Warnings />
  <RequestedCommand />
  <Server>TEST</Server>
  <GMTTimeDifference>--5:00</GMTTimeDifference>
  <ExecutionTime>0</ExecutionTime>
</ApiResponse>
```

- [ ] **Step 2: Write the failing test**

`server/test/registrars/namecheap.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import {
  createNamecheapClient,
  fetchNamecheapTldPrices,
  NAMECHEAP_API,
  namecheapErrors,
  parseNamecheapCheck,
} from '../../src/registrars/namecheap.js';
import { FIXED_NOW, fakeHttp } from './fake-http.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const CREDS = { apiUser: 'ncuser', apiKey: 'nc-key-abcd', clientIp: '203.0.113.7' };

function xml(name: string) {
  return () => new Response(fixture(name), { headers: { 'content-type': 'text/xml' } });
}

async function setup(routes: Array<[string, () => Response | Error]>) {
  const fake = fakeHttp(routes);
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-nc-')));
  const client = createNamecheapClient(CREDS, { http: fake.http, cache, now: () => FIXED_NOW });
  return { ...fake, client };
}

const CHECK = `${NAMECHEAP_API}?ApiUser=ncuser&ApiKey=nc-key-abcd&UserName=ncuser&ClientIp=203.0.113.7&Command=namecheap.domains.check`;
const PRICING = `${NAMECHEAP_API}?ApiUser=ncuser&ApiKey=nc-key-abcd&UserName=ncuser&ClientIp=203.0.113.7&Command=namecheap.users.getPricing&ProductType=DOMAIN&ProductCategory=DOMAINS`;

const ROUTES: Array<[string, () => Response | Error]> = [
  [CHECK, xml('namecheap-check.xml')],
  [`${PRICING}&ActionName=REGISTER`, xml('namecheap-pricing-site-register.xml')],
  [`${PRICING}&ActionName=RENEW`, xml('namecheap-pricing-site-renew.xml')],
];

describe('Namecheap parsing', () => {
  it('reads availability, premium flags, and per-domain errors', () => {
    const checks = parseNamecheapCheck(fixture('namecheap-check.xml'));
    expect(checks.map((c) => [c.domain, c.available, c.premium, c.error])).toEqual([
      ['zentrova.site', true, false, null],
      ['google.com', false, false, null],
      ['us.xyz', true, true, null],
      ['broken.site', false, false, 'Error response from provider'],
    ]);
    expect(checks[2]).toMatchObject({ premiumRegistration: 13000, premiumRenewal: 13000 });
  });

  it('reads API errors from an ERROR response', () => {
    expect(namecheapErrors(fixture('namecheap-error.xml'))).toEqual([
      '1011150: Parameter RequestIP is invalid',
    ]);
    expect(namecheapErrors(fixture('namecheap-check.xml'))).toEqual([]);
  });
});

describe('Namecheap client', () => {
  it('quotes a standard domain with 1-year register and renew prices', async () => {
    const { client } = await setup(ROUTES);
    const [quote] = await client.quote(['zentrova.site']);
    expect(quote).toEqual({
      registrar: 'namecheap',
      domain: 'zentrova.site',
      availability: 'available',
      premium: false,
      firstYear: 1.11,
      renewal: 22.22,
      currency: 'USD',
      checkedAt: '2026-11-04T10:00:00.000Z',
    });
  });

  it('uses premium prices for a premium name', async () => {
    const { client } = await setup(ROUTES);
    const quotes = await client.quote(['us.xyz']);
    // The fixture has no .xyz price, so the account currency is unknown and stays null.
    expect(quotes[0]).toMatchObject({
      premium: true,
      firstYear: 13000,
      renewal: 13000,
      currency: null,
    });
  });

  it('marks a taken domain unavailable and a per-domain error unknown', async () => {
    const { client } = await setup(ROUTES);
    const quotes = await client.quote(['google.com', 'broken.site']);
    expect(quotes.map((q) => [q.domain, q.availability])).toEqual([
      ['google.com', 'unavailable'],
      ['broken.site', 'unknown'],
    ]);
  });

  it('caches TLD prices so a second quote does not refetch them', async () => {
    const { client, calls } = await setup(ROUTES);
    await client.quote(['zentrova.site']);
    await client.quote(['zentrova.site']);
    expect(calls.filter((c) => c.url.includes('getPricing'))).toHaveLength(2);
  });

  it('throws on an API error without the key in the message', async () => {
    const { client } = await setup([[NAMECHEAP_API, xml('namecheap-error.xml')]]);
    const error = await client.quote(['zentrova.site']).catch((e: Error) => e);
    expect(String(error)).toBe(
      'Error: Namecheap API error: 1011150: Parameter RequestIP is invalid',
    );
  });
});

describe('Namecheap TLD prices', () => {
  it('builds one row per sold TLD from getTldList and getPricing', async () => {
    const { http } = fakeHttp([
      [
        `${NAMECHEAP_API}?ApiUser=ncuser&ApiKey=nc-key-abcd&UserName=ncuser&ClientIp=203.0.113.7&Command=namecheap.domains.gettldlist`,
        xml('namecheap-tldlist.xml'),
      ],
      [
        `${NAMECHEAP_API}?ApiUser=ncuser&ApiKey=nc-key-abcd&UserName=ncuser&ClientIp=203.0.113.7&Command=namecheap.users.getPricing`,
        xml('namecheap-pricing-all.xml'),
      ],
    ]);
    expect(await fetchNamecheapTldPrices(CREDS, http, '2026-11-04')).toEqual([
      {
        registrar: 'namecheap',
        tld: 'site',
        firstYear: 1.11,
        renewal: 22.22,
        transfer: 20.2,
        currency: 'USD',
        source: 'Namecheap API namecheap.users.getPricing',
        checkedAt: '2026-11-04',
      },
    ]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd server && pnpm test test/registrars/namecheap.test.ts`
Expected: FAIL, `../../src/registrars/namecheap.js` does not exist.

- [ ] **Step 4: Write the client**

`server/src/registrars/namecheap.ts`:
```ts
import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import type { HttpFetch } from '../http/http.js';
import type { PriceRow } from '../tld/schema.js';
import type { NamecheapCreds } from './credentials.js';
import {
  type ClientDeps,
  chunk,
  type LiveClient,
  type LiveQuote,
  toPrice,
  unknownQuote,
} from './types.js';

export const NAMECHEAP_API = 'https://api.namecheap.com/xml.response';
export const NAMECHEAP_TLD_SOURCE = 'Namecheap API namecheap.users.getPricing';
const BATCH = 50;

/** Attributes of every <tag ...> element. The Namecheap API puts its data in attributes. */
export function xmlElements(xml: string, tag: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const re = new RegExp(`<${tag}\\s([^>]*?)\\/?>`, 'g');
  for (const match of xml.matchAll(re)) {
    const attrs: Record<string, string> = {};
    for (const a of (match[1] ?? '').matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) {
      attrs[a[1] ?? ''] = a[2] ?? '';
    }
    out.push(attrs);
  }
  return out;
}

/** Error messages when the response status is ERROR, else an empty list. */
export function namecheapErrors(xml: string): string[] {
  if (!/<ApiResponse[^>]*Status="ERROR"/i.test(xml)) return [];
  const errors = [...xml.matchAll(/<Error\b([^>]*)>([\s\S]*?)<\/Error>/g)].map((m) => {
    const number = /Number="(\d+)"/.exec(m[1] ?? '')?.[1];
    return `${number ? `${number}: ` : ''}${(m[2] ?? '').trim()}`;
  });
  return errors.length > 0 ? errors : ['unknown error'];
}

export interface NamecheapCheck {
  domain: string;
  available: boolean;
  premium: boolean;
  premiumRegistration: number | null;
  premiumRenewal: number | null;
  error: string | null;
}

export function parseNamecheapCheck(xml: string): NamecheapCheck[] {
  return xmlElements(xml, 'DomainCheckResult').map((a) => {
    const premium = a.IsPremiumName?.toLowerCase() === 'true';
    return {
      domain: (a.Domain ?? '').toLowerCase(),
      available: a.Available?.toLowerCase() === 'true',
      premium,
      premiumRegistration: premium ? toPrice(a.PremiumRegistrationPrice) : null,
      premiumRenewal: premium ? toPrice(a.PremiumRenewalPrice) : null,
      error: a.ErrorNo && a.ErrorNo !== '0' ? a.Description || `error ${a.ErrorNo}` : null,
    };
  });
}

export interface NamecheapPrice {
  category: string;
  product: string;
  price: number;
  currency: string;
}

/** 1-year prices from a getPricing response, one entry per category × product. */
export function parseNamecheapPricing(xml: string): NamecheapPrice[] {
  const out: NamecheapPrice[] = [];
  const categories = xml.matchAll(
    /<ProductCategory\s+Name="([^"]*)"\s*>([\s\S]*?)<\/ProductCategory>/g,
  );
  for (const [, category = '', categoryBody = ''] of categories) {
    const products = categoryBody.matchAll(/<Product\s+Name="([^"]*)"\s*>([\s\S]*?)<\/Product>/g);
    for (const [, product = '', productBody = ''] of products) {
      const year = xmlElements(productBody, 'Price').find(
        (p) => p.Duration === '1' && p.DurationType?.toUpperCase() === 'YEAR',
      );
      const price = toPrice(year?.Price);
      if (price !== null && year?.Currency) {
        out.push({
          category: category.toLowerCase(),
          product: product.toLowerCase(),
          price,
          currency: year.Currency,
        });
      }
    }
  }
  return out;
}

export function namecheapTldRows(
  prices: NamecheapPrice[],
  soldTlds: Set<string> | null,
  checkedAt: string,
): PriceRow[] {
  const byTld = new Map<string, NamecheapPrice[]>();
  for (const p of prices) {
    if (soldTlds && !soldTlds.has(p.product)) continue;
    byTld.set(p.product, [...(byTld.get(p.product) ?? []), p]);
  }
  return [...byTld].flatMap(([tld, list]) => {
    const pick = (category: string) => list.find((p) => p.category === category) ?? null;
    const register = pick('register');
    const currency = register?.currency ?? list[0]?.currency;
    if (!currency) return [];
    const amount = (p: NamecheapPrice | null) => (p && p.currency === currency ? p.price : null);
    return [
      {
        registrar: 'namecheap' as const,
        tld,
        firstYear: amount(register),
        renewal: amount(pick('renew')),
        transfer: amount(pick('transfer')),
        currency,
        source: NAMECHEAP_TLD_SOURCE,
        checkedAt,
      },
    ];
  });
}

function url(creds: NamecheapCreds, command: string, params: Record<string, string>): string {
  // Namecheap takes credentials as query parameters. This URL must never be logged or returned.
  const query = new URLSearchParams({
    ApiUser: creds.apiUser,
    ApiKey: creds.apiKey,
    UserName: creds.apiUser,
    ClientIp: creds.clientIp,
    Command: command,
    ...params,
  });
  return `${NAMECHEAP_API}?${query}`;
}

async function call(
  http: HttpFetch,
  creds: NamecheapCreds,
  command: string,
  params: Record<string, string>,
): Promise<string> {
  const res = await http(url(creds, command, params));
  if (!res.ok) throw new Error(`Namecheap API returned HTTP ${res.status}`);
  const xml = await res.text();
  const errors = namecheapErrors(xml);
  if (errors.length > 0) throw new Error(`Namecheap API error: ${errors.join('; ')}`);
  return xml;
}

export interface NamecheapDeps extends ClientDeps {
  cache: DiskCache;
}

export function createNamecheapClient(creds: NamecheapCreds, deps: NamecheapDeps): LiveClient {
  const now = deps.now ?? (() => new Date());

  async function tldPrice(
    tld: string,
    action: 'REGISTER' | 'RENEW',
  ): Promise<NamecheapPrice | null> {
    const key = `namecheap-price:${action}:${tld}`;
    const cached = await deps.cache.get<NamecheapPrice | null>(key);
    if (cached !== undefined) return cached;
    const xml = await call(deps.http, creds, 'namecheap.users.getPricing', {
      ProductType: 'DOMAIN',
      ProductCategory: 'DOMAINS',
      ActionName: action,
      ProductName: tld.toUpperCase(),
    });
    const price = parseNamecheapPricing(xml).find((p) => p.product === tld) ?? null;
    await deps.cache.set(key, price, TTL.registrarLive).catch(() => undefined);
    return price;
  }

  return {
    id: 'namecheap',
    async quote(domains) {
      const out: LiveQuote[] = [];
      for (const batch of chunk(domains, BATCH)) {
        const xml = await call(deps.http, creds, 'namecheap.domains.check', {
          DomainList: batch.join(','),
        });
        const checks = parseNamecheapCheck(xml);
        const checkedAt = now().toISOString();
        for (const domain of batch) {
          const check = checks.find((c) => c.domain === domain);
          if (!check) {
            out.push(unknownQuote('namecheap', domain, checkedAt, 'no check result'));
            continue;
          }
          if (check.error) {
            out.push(unknownQuote('namecheap', domain, checkedAt, check.error));
            continue;
          }
          const tld = domain.slice(domain.indexOf('.') + 1);
          const register = await tldPrice(tld, 'REGISTER');
          const renew = check.premium ? null : await tldPrice(tld, 'RENEW');
          // Premium prices carry no currency attribute; they use the account currency,
          // which the TLD price response reports.
          const currency = register?.currency ?? renew?.currency ?? null;
          out.push({
            registrar: 'namecheap',
            domain,
            availability: check.available ? 'available' : 'unavailable',
            premium: check.premium,
            firstYear: check.premium ? check.premiumRegistration : (register?.price ?? null),
            renewal: check.premium ? check.premiumRenewal : (renew?.price ?? null),
            currency,
            checkedAt,
          });
        }
      }
      return out;
    },
  };
}

/** Reads the TLD list and all domain prices. Used by the maintainer refresh script only. */
export async function fetchNamecheapTldPrices(
  creds: NamecheapCreds,
  http: HttpFetch,
  checkedAt: string,
): Promise<PriceRow[]> {
  const list = await call(http, creds, 'namecheap.domains.gettldlist', {});
  const sold = new Set(xmlElements(list, 'Tld').map((t) => (t.Name ?? '').toLowerCase()));
  const pricing = await call(http, creds, 'namecheap.users.getPricing', { ProductType: 'DOMAIN' });
  return namecheapTldRows(parseNamecheapPricing(pricing), sold.size > 0 ? sold : null, checkedAt);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/registrars/namecheap.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Format, check, typecheck, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/registrars/namecheap.ts server/test/registrars/fixtures/namecheap-*.xml server/test/registrars/namecheap.test.ts
git commit -m "feat(registrars): add Namecheap live client and TLD price fetch"
```

---

### Task 6: Cloudflare client and the public price file

**Files:**
- Create: `server/src/registrars/cloudflare.ts`
- Test: `server/test/registrars/fixtures/cloudflare-check.json`, `cloudflare-error.json`, `cfdomainpricing-prices.json` (in `server/test/registrars/fixtures/`), `server/test/registrars/cloudflare.test.ts`

**Interfaces:**
- Consumes: `HttpFetch`; `ClientDeps`, `LiveClient`, `LiveQuote`, `chunk`, `toPrice` from `registrars/types.ts`; `CloudflareCreds`; `PriceRow`; `fakeHttp`, `FIXED_NOW` (Task 4).
- Produces: `CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'`; `CF_PUBLIC_PRICES = 'https://cfdomainpricing.com/prices.json'`; `CF_PUBLIC_SOURCE = 'cfdomainpricing.com/prices.json'`; `parseCloudflareCheck(json: unknown, checkedAt: string): LiveQuote[]`; `createCloudflareClient(creds: CloudflareCreds, deps: ClientDeps): LiveClient`; `parseCloudflarePublicPrices(json: unknown): PriceRow[]`; `fetchCloudflarePublicPrices(http: HttpFetch): Promise<PriceRow[]>`.

Behavior: `registrable: true` is `available`; reason `domain_unavailable` is `unavailable`; any other reason (`extension_not_supported_via_api`, `extension_not_supported`, `extension_disallows_registration`, `domain_premium`) is `unknown` with that reason. `premium` is true for `tier: "premium"` or reason `domain_premium`. `success: false` throws `Cloudflare API error: <message>`. The public file gives registration and renewal in USD only, so `transfer` is `null`; entries without `updatedAt` are skipped because their check date is unknown.

- [ ] **Step 1: Write the fixtures**

`server/test/registrars/fixtures/cloudflare-check.json`:
```json
{
  "errors": [],
  "messages": [],
  "success": true,
  "result": {
    "domains": [
      {
        "name": "zentrova.site",
        "registrable": true,
        "tier": "standard",
        "pricing": { "currency": "USD", "registration_cost": "4.99", "renewal_cost": "27.70" }
      },
      { "name": "google.com", "registrable": false, "reason": "domain_unavailable" },
      {
        "name": "rare.io",
        "registrable": false,
        "reason": "domain_premium",
        "pricing": { "currency": "USD", "registration_cost": "2500.00", "renewal_cost": "50.00" }
      },
      { "name": "zentrova.lol", "registrable": false, "reason": "extension_not_supported_via_api" }
    ]
  }
}
```

`server/test/registrars/fixtures/cloudflare-error.json`:
```json
{
  "errors": [{ "code": 10000, "message": "Authentication error" }],
  "messages": [],
  "success": false,
  "result": null
}
```

`server/test/registrars/fixtures/cfdomainpricing-prices.json`:
```json
{
  "com": { "registration": 10.46, "renewal": 10.46, "updatedAt": "2026-10-13" },
  "site": { "registration": 4.99, "renewal": 27.7, "updatedAt": "2026-10-13" },
  "broken": { "registration": 1 }
}
```

- [ ] **Step 2: Write the failing test**

`server/test/registrars/cloudflare.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  CF_PUBLIC_PRICES,
  CLOUDFLARE_API,
  createCloudflareClient,
  fetchCloudflarePublicPrices,
} from '../../src/registrars/cloudflare.js';
import { FIXED_NOW, fakeHttp } from './fake-http.js';
import publicPrices from './fixtures/cfdomainpricing-prices.json' with { type: 'json' };
import check from './fixtures/cloudflare-check.json' with { type: 'json' };
import checkError from './fixtures/cloudflare-error.json' with { type: 'json' };

const CREDS = { apiToken: 'cf-token-efgh', accountId: 'cf-account-ijkl' };
const ENDPOINT = `${CLOUDFLARE_API}/accounts/cf-account-ijkl/registrar/domain-check`;

function client(body: unknown, status = 200) {
  const fake = fakeHttp([[ENDPOINT, () => Response.json(body, { status })]]);
  return {
    ...fake,
    client: createCloudflareClient(CREDS, { http: fake.http, now: () => FIXED_NOW }),
  };
}

describe('Cloudflare client', () => {
  it('posts the domains with a bearer token', async () => {
    const { client: c, calls } = client(check);
    await c.quote(['zentrova.site']);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer cf-token-efgh');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ domains: ['zentrova.site'] });
  });

  it('maps registrable, unavailable, premium, and unsupported results', async () => {
    const quotes = await client(check).client.quote([
      'zentrova.site',
      'google.com',
      'rare.io',
      'zentrova.lol',
    ]);
    expect(
      quotes.map((q) => [q.domain, q.availability, q.premium, q.firstYear, q.renewal]),
    ).toEqual([
      ['zentrova.site', 'available', false, 4.99, 27.7],
      ['google.com', 'unavailable', false, null, null],
      ['rare.io', 'unknown', true, 2500, 50],
      ['zentrova.lol', 'unknown', false, null, null],
    ]);
    expect(quotes[3]?.reason).toBe('extension_not_supported_via_api');
    expect(quotes[0]).toMatchObject({ currency: 'USD', checkedAt: '2026-11-04T10:00:00.000Z' });
  });

  it('throws the API error message without the token', async () => {
    const error = await client(checkError, 403)
      .client.quote(['zentrova.site'])
      .catch((e: Error) => e);
    expect(String(error)).toBe('Error: Cloudflare API error: Authentication error');
  });
});

describe('Cloudflare public price file', () => {
  it('builds USD rows with the per-TLD update date and skips undated entries', async () => {
    const { http } = fakeHttp([[CF_PUBLIC_PRICES, () => Response.json(publicPrices)]]);
    expect(await fetchCloudflarePublicPrices(http)).toEqual([
      {
        registrar: 'cloudflare',
        tld: 'com',
        firstYear: 10.46,
        renewal: 10.46,
        transfer: null,
        currency: 'USD',
        source: 'cfdomainpricing.com/prices.json',
        checkedAt: '2026-10-13',
      },
      {
        registrar: 'cloudflare',
        tld: 'site',
        firstYear: 4.99,
        renewal: 27.7,
        transfer: null,
        currency: 'USD',
        source: 'cfdomainpricing.com/prices.json',
        checkedAt: '2026-10-13',
      },
    ]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd server && pnpm test test/registrars/cloudflare.test.ts`
Expected: FAIL, `../../src/registrars/cloudflare.js` does not exist.

- [ ] **Step 4: Write the client**

`server/src/registrars/cloudflare.ts`:
```ts
import type { HttpFetch } from '../http/http.js';
import type { PriceRow } from '../tld/schema.js';
import type { CloudflareCreds } from './credentials.js';
import {
  type ClientDeps,
  chunk,
  type LiveClient,
  type LiveQuote,
  toPrice,
  unknownQuote,
} from './types.js';

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
export const CF_PUBLIC_PRICES = 'https://cfdomainpricing.com/prices.json';
export const CF_PUBLIC_SOURCE = 'cfdomainpricing.com/prices.json';
const BATCH = 20;

interface CheckItem {
  name?: string;
  registrable?: boolean;
  tier?: string;
  reason?: string;
  pricing?: { currency?: string; registration_cost?: string; renewal_cost?: string };
}

export function parseCloudflareCheck(json: unknown, checkedAt: string): LiveQuote[] {
  const envelope = json as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { domains?: CheckItem[] } | null;
  };
  if (envelope.success === false || !envelope.result) {
    const message = envelope.errors?.map((e) => e.message).join('; ') || 'request failed';
    throw new Error(`Cloudflare API error: ${message}`);
  }
  return (envelope.result.domains ?? []).map((item): LiveQuote => {
    const domain = (item.name ?? '').toLowerCase();
    const currency = item.pricing?.currency ?? null;
    const base = {
      registrar: 'cloudflare' as const,
      domain,
      premium: item.tier === 'premium' || item.reason === 'domain_premium',
      firstYear: toPrice(item.pricing?.registration_cost),
      renewal: toPrice(item.pricing?.renewal_cost),
      currency,
      checkedAt,
    };
    if (item.registrable === true) return { ...base, availability: 'available' };
    if (item.reason === 'domain_unavailable') {
      return { ...base, availability: 'unavailable', reason: item.reason };
    }
    // Premium names and unsupported extensions are not registrable through the API,
    // which says nothing certain about whether the name is free.
    return { ...base, availability: 'unknown', reason: item.reason ?? 'not registrable' };
  });
}

export function createCloudflareClient(creds: CloudflareCreds, deps: ClientDeps): LiveClient {
  const now = deps.now ?? (() => new Date());
  const endpoint = `${CLOUDFLARE_API}/accounts/${encodeURIComponent(creds.accountId)}/registrar/domain-check`;
  return {
    id: 'cloudflare',
    async quote(domains) {
      const out: LiveQuote[] = [];
      for (const batch of chunk(domains, BATCH)) {
        const res = await deps.http(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${creds.apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ domains: batch }),
        });
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new Error(`Cloudflare API returned HTTP ${res.status}`);
        }
        const quotes = parseCloudflareCheck(json, now().toISOString());
        for (const domain of batch) {
          out.push(
            quotes.find((q) => q.domain === domain) ??
              unknownQuote('cloudflare', domain, now().toISOString(), 'no check result'),
          );
        }
      }
      return out;
    },
  };
}

/** Rows from the free third-party price file. Prices in that file are USD. */
export function parseCloudflarePublicPrices(json: unknown): PriceRow[] {
  const entries = Object.entries(json as Record<string, unknown>);
  return entries.flatMap(([tld, raw]) => {
    const item = raw as { registration?: unknown; renewal?: unknown; updatedAt?: unknown };
    const checkedAt = typeof item.updatedAt === 'string' ? item.updatedAt.slice(0, 10) : null;
    if (!checkedAt || !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) return [];
    return [
      {
        registrar: 'cloudflare' as const,
        tld: tld.toLowerCase().replace(/^\./, ''),
        firstYear: toPrice(item.registration),
        renewal: toPrice(item.renewal),
        transfer: null,
        currency: 'USD',
        source: CF_PUBLIC_SOURCE,
        checkedAt,
      },
    ];
  });
}

/** Reads the public price file. Used by the maintainer refresh script only; no key needed. */
export async function fetchCloudflarePublicPrices(http: HttpFetch): Promise<PriceRow[]> {
  const res = await http(CF_PUBLIC_PRICES, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${CF_PUBLIC_PRICES} returned HTTP ${res.status}`);
  return parseCloudflarePublicPrices(await res.json());
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/registrars/cloudflare.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Format, check, typecheck, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/registrars/cloudflare.ts server/test/registrars/fixtures/cloudflare-*.json server/test/registrars/fixtures/cfdomainpricing-prices.json server/test/registrars/cloudflare.test.ts
git commit -m "feat(registrars): add Cloudflare live client and public price file"
```

---

### Task 7: Quote service and `RegistrarRuntime`

**Files:**
- Create: `server/src/registrars/quote.ts`, `server/src/registrars/runtime-part.ts`
- Test: `server/test/registrars/quote.test.ts`, `server/test/registrars/runtime-part.test.ts`

**Interfaces:**
- Consumes: `DiskCache`; `TTL.registrarLive`; `splitDomain`, `ValidationError` from `domain/name.ts`; `errorMessage` from `util/errors.ts`; `tldInfo`, `TldInfo`, `TldRegistrarEntry` (Task 2); `cheapestThreeYear`, `livePriceLabel`, `TABLE_NOTE`, `threeYearTotal`, `UNKNOWN` (Task 2); `bundledTables`, `TldTables` (Task 1); `readCredentials`, `secretValues`, `redact`, `registrarStatus`, `RegistrarStatusReport` (Task 3); `createSpaceshipClient`, `createNamecheapClient`, `createCloudflareClient` (Tasks 4 to 6); `testTables`, `fakeHttp`, `FIXED_NOW`.
- Produces:
  - `quote.ts`: `MAX_QUOTE_DOMAINS = 20`; `type PriceSource = 'live' | 'table' | 'none'`; `interface RegistrarQuoteEntry` (the `TldRegistrarEntry` fields plus `priceSource`, `availability: LiveAvailability | null`, `premium: boolean | null`, `reason?`); `interface DomainQuote { domain; tld; registrars; cheapestThreeYear; reputation }`; `interface QuoteResult { mode: 'table' | 'live'; liveRegistrars: RegistrarId[]; quotes: DomainQuote[]; notes: string[] }`; `interface QuoteDeps { tables; clients: LiveClient[]; cache: DiskCache; secrets: readonly string[]; now? }`; `NO_KEYS_NOTE`; `LIVE_NOTE`; `quoteDomains(domains: string[], deps: QuoteDeps): Promise<QuoteResult>`.
  - `runtime-part.ts`: `interface RegistrarRuntime { tldInfo(tld: string): TldInfo; registrarQuote(domains: string[]): Promise<QuoteResult>; registrarStatus(): RegistrarStatusReport }`; `interface RegistrarRuntimeDeps { http: HttpFetch; cache: DiskCache; env: NodeJS.ProcessEnv; now?: () => Date; tables?: TldTables }`; `liveClients(creds, deps): LiveClient[]`; `createRegistrarRuntime(deps: RegistrarRuntimeDeps): RegistrarRuntime`.

Merge rules: a live result with a currency and a price replaces that registrar's table price (`priceSource: "live"`, live label). A premium name without a live price gets no price (`priceSource: "none"`, label `unknown — premium name, table price does not apply`). Otherwise the table price stays, or `priceSource: "none"` when the table has no price. Live results are cached under `registrar-live:<registrar>:<domain>` for `TTL.registrarLive`; `unknown` results are not cached. A client that throws turns into `unknown` for each of its domains, with key values redacted from the reason.

- [ ] **Step 1: Write the failing tests**

`server/test/registrars/quote.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { ValidationError } from '../../src/domain/name.js';
import { LIVE_NOTE, NO_KEYS_NOTE, quoteDomains } from '../../src/registrars/quote.js';
import type { LiveClient, LiveQuote } from '../../src/registrars/types.js';
import { TABLE_NOTE } from '../../src/tld/pricing.js';
import { testTables } from '../tld/fixtures.js';
import { FIXED_NOW } from './fake-http.js';

async function cache() {
  return new DiskCache(await mkdtemp(join(tmpdir(), 'dne-quote-')));
}

function liveClient(id: LiveClient['id'], make: (domain: string) => Partial<LiveQuote>) {
  const seen: string[][] = [];
  const client: LiveClient = {
    id,
    quote: async (domains) => {
      seen.push(domains);
      return domains.map((domain) => ({
        registrar: id,
        domain,
        availability: 'available',
        premium: false,
        firstYear: null,
        renewal: null,
        currency: null,
        checkedAt: FIXED_NOW.toISOString(),
        ...make(domain),
      }));
    },
  };
  return { client, seen };
}

describe('quoteDomains without keys', () => {
  it('returns table prices for every registrar, with labels and notes', async () => {
    const result = await quoteDomains(['Zentrova.SITE'], {
      tables: testTables(),
      clients: [],
      cache: await cache(),
      secrets: [],
    });
    expect(result.mode).toBe('table');
    expect(result.notes).toEqual([TABLE_NOTE, NO_KEYS_NOTE]);
    const [quote] = result.quotes;
    expect(quote?.domain).toBe('zentrova.site');
    expect(quote?.registrars.map((r) => [r.registrar, r.priceSource, r.availability])).toEqual([
      ['spaceship', 'table', null],
      ['namecheap', 'none', null],
      ['cloudflare', 'table', null],
    ]);
    expect(quote?.registrars[2]?.priceLabel).toBe(
      'reference price from Cloudflare, checked 2026-10-13 — verify at registrar',
    );
    expect(quote?.cheapestThreeYear).toEqual([
      { currency: 'EUR', registrar: 'spaceship', threeYearTotal: 61.05 },
      { currency: 'USD', registrar: 'cloudflare', threeYearTotal: 60.39 },
    ]);
    expect(quote?.reputation?.reputation).toBe('mixed');
  });

  it('rejects an invalid domain', async () => {
    const deps = { tables: testTables(), clients: [], cache: await cache(), secrets: [] };
    await expect(quoteDomains(['nodot'], deps)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('quoteDomains with live clients', () => {
  it('lets a live price override the table price for that registrar', async () => {
    const { client } = liveClient('cloudflare', () => ({
      firstYear: 5.49,
      renewal: 28.2,
      currency: 'USD',
    }));
    const result = await quoteDomains(['zentrova.site'], {
      tables: testTables(),
      clients: [client],
      cache: await cache(),
      secrets: [],
    });
    expect(result.mode).toBe('live');
    expect(result.notes).toEqual([TABLE_NOTE, LIVE_NOTE]);
    expect(result.quotes[0]?.registrars[2]).toMatchObject({
      priceSource: 'live',
      availability: 'available',
      premium: false,
      firstYear: 5.49,
      renewal: 28.2,
      threeYearTotal: 61.89,
      currency: 'USD',
      priceLabel: 'live price from Cloudflare API, 2026-11-04T10:00:00.000Z',
    });
    expect(result.quotes[0]?.registrars[0]?.priceSource).toBe('table');
  });

  it('drops the table price for a premium name without a live price', async () => {
    const { client } = liveClient('spaceship', () => ({ premium: true }));
    const result = await quoteDomains(['zentrova.site'], {
      tables: testTables(),
      clients: [client],
      cache: await cache(),
      secrets: [],
    });
    expect(result.quotes[0]?.registrars[0]).toMatchObject({
      priceSource: 'none',
      premium: true,
      firstYear: null,
      priceLabel: 'unknown — premium name, table price does not apply',
    });
  });

  it('caches known live results for an hour and skips unknown ones', async () => {
    const shared = await cache();
    const { client, seen } = liveClient('cloudflare', (domain) =>
      domain.startsWith('x') ? { availability: 'unknown' } : {},
    );
    const deps = { tables: testTables(), clients: [client], cache: shared, secrets: [] };
    await quoteDomains(['zentrova.site', 'xeno.site'], deps);
    await quoteDomains(['zentrova.site', 'xeno.site'], deps);
    expect(seen).toEqual([['zentrova.site', 'xeno.site'], ['xeno.site']]);
  });

  it('turns a client failure into unknown results with the keys redacted', async () => {
    const client: LiveClient = {
      id: 'namecheap',
      quote: async () => {
        throw new Error('request to https://api.test/?ApiKey=nc-key-abcd failed');
      },
    };
    const result = await quoteDomains(['zentrova.site'], {
      tables: testTables(),
      clients: [client],
      cache: await cache(),
      secrets: ['nc-key-abcd'],
      now: () => FIXED_NOW,
    });
    const entry = result.quotes[0]?.registrars[1];
    expect(entry).toMatchObject({ availability: 'unknown' });
    expect(entry?.reason).toBe('request to https://api.test/?ApiKey=[redacted] failed');
    expect(JSON.stringify(result)).not.toContain('nc-key-abcd');
  });
});
```

`server/test/registrars/runtime-part.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { createRegistrarRuntime, liveClients } from '../../src/registrars/runtime-part.js';
import { testTables } from '../tld/fixtures.js';
import { fakeHttp } from './fake-http.js';

async function deps(env: NodeJS.ProcessEnv) {
  const { http, calls } = fakeHttp([]);
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rt-')));
  return { http, calls, cache, env, tables: testTables() };
}

describe('createRegistrarRuntime', () => {
  it('creates live clients only for fully configured registrars', async () => {
    const d = await deps({});
    expect(liveClients({}, d)).toEqual([]);
    const clients = liveClients(
      {
        spaceship: { apiKey: 'k', apiSecret: 's' },
        cloudflare: { apiToken: 't', accountId: 'a' },
      },
      d,
    );
    expect(clients.map((c) => c.id)).toEqual(['spaceship', 'cloudflare']);
  });

  it('answers from the table with no network call when no keys are set', async () => {
    const d = await deps({});
    const rt = createRegistrarRuntime(d);
    const result = await rt.registrarQuote(['zentrova.site']);
    expect(result.mode).toBe('table');
    expect(d.calls).toHaveLength(0);
    expect(rt.tldInfo('site').tld).toBe('site');
    expect(rt.registrarStatus().registrars.every((r) => !r.configured)).toBe(true);
  });

  it('never puts key values into a failed live quote', async () => {
    const d = await deps({
      CLOUDFLARE_API_TOKEN: 'cf-token-efgh',
      CLOUDFLARE_ACCOUNT_ID: 'acct-9876',
    });
    const rt = createRegistrarRuntime(d);
    const result = await rt.registrarQuote(['zentrova.site']);
    expect(result.mode).toBe('live');
    const text = JSON.stringify(result);
    expect(text).not.toContain('cf-token-efgh');
    expect(text).not.toContain('acct-9876');
  });

  it('uses the bundled tables when none are injected', async () => {
    const d = await deps({});
    const rt = createRegistrarRuntime({ http: d.http, cache: d.cache, env: {} });
    expect(rt.tldInfo('sbs').registrars.find((r) => r.registrar === 'cloudflare')?.sale).toBe(
      'not_sold',
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && pnpm test test/registrars/quote.test.ts test/registrars/runtime-part.test.ts`
Expected: FAIL, `../../src/registrars/quote.js` and `../../src/registrars/runtime-part.js` do not exist.

- [ ] **Step 3: Write the quote service**

`server/src/registrars/quote.ts`:
```ts
import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import { splitDomain } from '../domain/name.js';
import { type TldInfo, type TldRegistrarEntry, tldInfo } from '../tld/info.js';
import {
  type CheapestOption,
  cheapestThreeYear,
  livePriceLabel,
  TABLE_NOTE,
  threeYearTotal,
  UNKNOWN,
} from '../tld/pricing.js';
import type { RegistrarId } from '../tld/schema.js';
import type { TldTables } from '../tld/table.js';
import { errorMessage } from '../util/errors.js';
import { redact } from './credentials.js';
import { type LiveAvailability, type LiveClient, type LiveQuote, unknownQuote } from './types.js';

export const MAX_QUOTE_DOMAINS = 20;

export type PriceSource = 'live' | 'table' | 'none';

export interface RegistrarQuoteEntry {
  registrar: RegistrarId;
  registrarName: string;
  sale: TldRegistrarEntry['sale'];
  priceSource: PriceSource;
  availability: LiveAvailability | null;
  premium: boolean | null;
  firstYear: number | null;
  renewal: number | null;
  transfer: number | null;
  threeYearTotal: number | null;
  currency: string | null;
  source: string | null;
  checkedAt: string | null;
  priceLabel: string;
  reason?: string;
}

export interface DomainQuote {
  domain: string;
  tld: string;
  registrars: RegistrarQuoteEntry[];
  cheapestThreeYear: CheapestOption[];
  reputation: TldInfo['reputation'];
}

export interface QuoteResult {
  mode: 'table' | 'live';
  liveRegistrars: RegistrarId[];
  quotes: DomainQuote[];
  notes: string[];
}

export interface QuoteDeps {
  tables: TldTables;
  clients: LiveClient[];
  cache: DiskCache;
  secrets: readonly string[];
  now?: () => Date;
}

export const NO_KEYS_NOTE =
  'No registrar API keys are set, so these are bundled table prices only. Availability comes from check_domains; premium status is unknown.';
export const LIVE_NOTE =
  'Live results come from registrar APIs and are cached for 1 hour. Live prices override table prices for the same registrar.';

const cacheKey = (registrar: RegistrarId, domain: string) =>
  `registrar-live:${registrar}:${domain}`;

async function liveQuotes(
  client: LiveClient,
  domains: string[],
  deps: QuoteDeps,
): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>();
  const missing: string[] = [];
  for (const domain of domains) {
    const cached = await deps.cache.get<LiveQuote>(cacheKey(client.id, domain));
    if (cached) out.set(domain, cached);
    else missing.push(domain);
  }
  if (missing.length === 0) return out;

  let fresh: LiveQuote[];
  try {
    fresh = await client.quote(missing);
  } catch (error) {
    const checkedAt = (deps.now?.() ?? new Date()).toISOString();
    const reason = redact(errorMessage(error), deps.secrets);
    fresh = missing.map((domain) => unknownQuote(client.id, domain, checkedAt, reason));
  }
  for (const quote of fresh) {
    const safe = quote.reason ? { ...quote, reason: redact(quote.reason, deps.secrets) } : quote;
    out.set(safe.domain, safe);
    if (safe.availability !== 'unknown') {
      await deps.cache
        .set(cacheKey(client.id, safe.domain), safe, TTL.registrarLive)
        .catch(() => undefined);
    }
  }
  return out;
}

function merge(table: TldRegistrarEntry, live: LiveQuote | undefined): RegistrarQuoteEntry {
  const base: RegistrarQuoteEntry = {
    ...table,
    priceSource: 'table',
    availability: null,
    premium: null,
  };
  if (table.firstYear === null && table.renewal === null && table.transfer === null) {
    base.priceSource = 'none';
  }
  if (!live) return base;

  const withLive: RegistrarQuoteEntry = {
    ...base,
    availability: live.availability,
    premium: live.premium,
    ...(live.reason ? { reason: live.reason } : {}),
  };
  const livePriced = live.currency !== null && (live.firstYear !== null || live.renewal !== null);
  if (livePriced) {
    return {
      ...withLive,
      priceSource: 'live',
      firstYear: live.firstYear,
      renewal: live.renewal,
      transfer: null,
      threeYearTotal: threeYearTotal(live.firstYear, live.renewal),
      currency: live.currency,
      source: `${table.registrarName} API`,
      checkedAt: live.checkedAt,
      priceLabel: livePriceLabel(table.registrar, live.checkedAt),
    };
  }
  if (live.premium) {
    // A premium name never sells at the standard table price.
    return {
      ...withLive,
      priceSource: 'none',
      firstYear: null,
      renewal: null,
      transfer: null,
      threeYearTotal: null,
      currency: null,
      priceLabel: `${UNKNOWN} — premium name, table price does not apply`,
    };
  }
  return withLive;
}

export async function quoteDomains(domains: string[], deps: QuoteDeps): Promise<QuoteResult> {
  const parsed = [...new Set(domains.map((d) => d.trim().toLowerCase().replace(/\.$/, '')))].map(
    (domain) => {
      const { label, tld } = splitDomain(domain);
      return { domain: `${label}.${tld}`, tld };
    },
  );
  const names = parsed.map((p) => p.domain);
  const live = new Map<RegistrarId, Map<string, LiveQuote>>();
  await Promise.all(
    deps.clients.map(async (client) => {
      live.set(client.id, await liveQuotes(client, names, deps));
    }),
  );

  const quotes = parsed.map(({ domain, tld }): DomainQuote => {
    const info = tldInfo(tld, deps.tables);
    const registrars = info.registrars.map((entry) =>
      merge(entry, live.get(entry.registrar)?.get(domain)),
    );
    return {
      domain,
      tld,
      registrars,
      cheapestThreeYear: cheapestThreeYear(registrars),
      reputation: info.reputation,
    };
  });

  const liveRegistrars = deps.clients.map((c) => c.id);
  return {
    mode: liveRegistrars.length > 0 ? 'live' : 'table',
    liveRegistrars,
    quotes,
    notes: [TABLE_NOTE, liveRegistrars.length > 0 ? LIVE_NOTE : NO_KEYS_NOTE],
  };
}
```

- [ ] **Step 4: Write the runtime part**

`server/src/registrars/runtime-part.ts`:
```ts
import type { DiskCache } from '../cache/cache.js';
import type { HttpFetch } from '../http/http.js';
import { type TldInfo, tldInfo } from '../tld/info.js';
import { bundledTables, type TldTables } from '../tld/table.js';
import { createCloudflareClient } from './cloudflare.js';
import {
  type Credentials,
  type RegistrarStatusReport,
  readCredentials,
  registrarStatus,
  secretValues,
} from './credentials.js';
import { createNamecheapClient } from './namecheap.js';
import { type QuoteResult, quoteDomains } from './quote.js';
import { createSpaceshipClient } from './spaceship.js';
import type { LiveClient } from './types.js';

export interface RegistrarRuntime {
  tldInfo(tld: string): TldInfo;
  registrarQuote(domains: string[]): Promise<QuoteResult>;
  registrarStatus(): RegistrarStatusReport;
}

export interface RegistrarRuntimeDeps {
  http: HttpFetch;
  cache: DiskCache;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
  tables?: TldTables;
}

/** One live client per registrar whose keys are all set, in the fixed registrar order. */
export function liveClients(
  creds: Credentials,
  deps: Pick<RegistrarRuntimeDeps, 'http' | 'cache' | 'now'>,
): LiveClient[] {
  const clients: LiveClient[] = [];
  if (creds.spaceship) clients.push(createSpaceshipClient(creds.spaceship, deps));
  if (creds.namecheap) clients.push(createNamecheapClient(creds.namecheap, deps));
  if (creds.cloudflare) clients.push(createCloudflareClient(creds.cloudflare, deps));
  return clients;
}

export function createRegistrarRuntime(deps: RegistrarRuntimeDeps): RegistrarRuntime {
  const creds = readCredentials(deps.env);
  const secrets = secretValues(creds);
  const clients = liveClients(creds, deps);
  const tables = () => deps.tables ?? bundledTables();
  return {
    tldInfo: (tld) => tldInfo(tld, tables()),
    registrarQuote: (domains) =>
      quoteDomains(domains, {
        tables: tables(),
        clients,
        cache: deps.cache,
        secrets,
        now: deps.now,
      }),
    registrarStatus: () => registrarStatus(deps.env),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test test/registrars/quote.test.ts test/registrars/runtime-part.test.ts`
Expected: PASS (6 and 4 tests).

- [ ] **Step 6: Format, check, typecheck, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/registrars/quote.ts server/src/registrars/runtime-part.ts server/test/registrars/quote.test.ts server/test/registrars/runtime-part.test.ts
git commit -m "feat(registrars): merge table and live quotes behind RegistrarRuntime"
```

---

### Task 8: Tools, wiring, and MCP annotations

**Files:**
- Create: `server/src/tools/tld-info.ts`, `server/src/tools/registrar-quote.ts`, `server/src/tools/registrar-status.ts`, `server/src/tools/register-plan4.ts`
- Modify: `server/src/server.ts`, `server/src/runtime.ts`, `server/src/tools/check-domains.ts`, `server/test/tools/check-domains.test.ts`
- Test: `server/test/tools/tld-info.test.ts`, `server/test/tools/registrar-quote.test.ts`, `server/test/tools/registrar-status.test.ts`

**Interfaces:**
- Consumes: `RegistrarRuntime`, `createRegistrarRuntime` (Task 7); `MAX_QUOTE_DOMAINS`, `quoteDomains` (Task 7); `tldInfo` (Task 2); `registrarStatus` (Task 3); `normalizeTld`, `ValidationError` from `domain/name.ts`; `toolJson`, `toolError` from `tools/result.ts`; `connectClient`, `callJson` from `test/helpers/mcp.ts`.
- Produces: MCP tools `tld_info({ tld })`, `registrar_quote({ domains })` (1 to 20 domains), `registrar_status({})`; `registerPlan4Tools(server: McpServer, rt: RegistrarRuntime): void`; `Runtime extends RegistrarRuntime`. Annotations: `check_domains` and `registrar_quote` `{ readOnlyHint: true, openWorldHint: true }`; `tld_info` and `registrar_status` `{ readOnlyHint: true, openWorldHint: false }`.

- [ ] **Step 1: Write the failing tool tests**

`server/test/tools/tld-info.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Runtime } from '../../src/runtime.js';
import { tldInfo } from '../../src/tld/info.js';
import { callJson, connectClient } from '../helpers/mcp.js';
import { testTables } from '../tld/fixtures.js';

function fakeRuntime(seen: string[] = []): Runtime {
  return {
    tldInfo: (tld: string) => {
      seen.push(tld);
      return tldInfo(tld, testTables());
    },
  } as Runtime;
}

describe('tld_info tool', () => {
  it('is listed with read-only, closed-world annotations', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'tld_info');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('normalizes the TLD and returns registrars, prices, and reputation', async () => {
    const seen: string[] = [];
    const client = await connectClient(fakeRuntime(seen));
    const res = await callJson(client, 'tld_info', { tld: '.SITE' });
    expect(res.isError).toBe(false);
    expect(seen).toEqual(['site']);
    expect(res.data).toMatchObject({
      tld: 'site',
      reputation: { reputation: 'mixed' },
      cheapestThreeYear: [
        { currency: 'EUR', registrar: 'spaceship' },
        { currency: 'USD', registrar: 'cloudflare' },
      ],
    });
  });

  it('returns a tool error for an invalid TLD', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'tld_info', { tld: 'not a tld' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('is not a valid TLD');
  });
});
```

`server/test/tools/registrar-quote.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { quoteDomains } from '../../src/registrars/quote.js';
import type { Runtime } from '../../src/runtime.js';
import { callJson, connectClient } from '../helpers/mcp.js';
import { testTables } from '../tld/fixtures.js';

async function fakeRuntime(): Promise<Runtime> {
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rq-')));
  return {
    registrarQuote: (domains: string[]) =>
      quoteDomains(domains, { tables: testTables(), clients: [], cache, secrets: [] }),
  } as Runtime;
}

describe('registrar_quote tool', () => {
  it('is listed with read-only, open-world annotations', async () => {
    const client = await connectClient(await fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'registrar_quote');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('returns table quotes when no keys are set', async () => {
    const client = await connectClient(await fakeRuntime());
    const res = await callJson(client, 'registrar_quote', { domains: ['zentrova.site'] });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      mode: 'table',
      liveRegistrars: [],
      quotes: [{ domain: 'zentrova.site', tld: 'site' }],
    });
  });

  it('returns a tool error for a domain without a TLD', async () => {
    const client = await connectClient(await fakeRuntime());
    const res = await callJson(client, 'registrar_quote', { domains: ['zentrova'] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('has no TLD');
  });

  it('rejects more than 20 domains', async () => {
    const client = await connectClient(await fakeRuntime());
    const domains = Array.from({ length: 21 }, (_, i) => `name${i}.site`);
    const res = await callJson(client, 'registrar_quote', { domains });
    expect(res.isError).toBe(true);
  });
});
```

`server/test/tools/registrar-status.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { registrarStatus } from '../../src/registrars/credentials.js';
import type { Runtime } from '../../src/runtime.js';
import { callJson, connectClient } from '../helpers/mcp.js';

const ENV = {
  SPACESHIP_API_KEY: 'ss-key-1234',
  SPACESHIP_API_SECRET: 'ss-secret-5678',
  CLOUDFLARE_API_TOKEN: 'cf-token-efgh',
};

function fakeRuntime(): Runtime {
  return { registrarStatus: () => registrarStatus(ENV) } as Runtime;
}

describe('registrar_status tool', () => {
  it('is listed with read-only, closed-world annotations', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'registrar_status');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('reports which registrars are configured and never returns key values', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'registrar_status', {});
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      registrars: [
        { registrar: 'spaceship', configured: true, missing: [] },
        { registrar: 'namecheap', configured: false },
        { registrar: 'cloudflare', configured: false, missing: ['CLOUDFLARE_ACCOUNT_ID'] },
      ],
    });
    for (const value of Object.values(ENV)) expect(res.text).not.toContain(value);
  });
});
```

- [ ] **Step 2: Add the `check_domains` annotation test and the fake runtime fix**

`Runtime` gains fields in Step 8, so the Plan 1 fake stops typechecking. In `server/test/tools/check-domains.test.ts`, change the start of the object that `fakeRuntime()` returns from:
```ts
  return {
    seen,
    checkDomains: async (domains) => {
```
to (the same edit Plans 2 and 3 make, byte for byte):
```ts
  return {
    ...({} as Runtime),
    seen,
    checkDomains: async (domains) => {
```

Then add this test right after the `'is listed by the server'` test:
```ts
  it('is annotated as read-only and open-world', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'check_domains');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && pnpm test test/tools`
Expected: FAIL. `tld_info`, `registrar_quote` and `registrar_status` are not registered yet, and the `check_domains` annotation test finds `annotations` undefined.

- [ ] **Step 4: Write the tools**

`server/src/tools/tld-info.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { normalizeTld, ValidationError } from '../domain/name.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { toolError, toolJson } from './result.js';

export function registerTldInfo(server: McpServer, rt: Pick<RegistrarRuntime, 'tldInfo'>): void {
  server.registerTool(
    'tld_info',
    {
      title: 'TLD registrars, prices, and reputation',
      description:
        'For one TLD: which registrars sell it, first-year, renewal, and transfer reference prices per registrar from the bundled dated table, the cheapest 3-year option per currency, and the TLD reputation note. Every price carries its source and check date.',
      inputSchema: {
        tld: z.string().describe('TLD with or without a leading dot, e.g. "site" or ".co.uk"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tld }) => {
      let normalized: string;
      try {
        normalized = normalizeTld(tld);
      } catch (error) {
        if (error instanceof ValidationError) return toolError(error.message);
        throw error;
      }
      return toolJson(rt.tldInfo(normalized));
    },
  );
}
```

`server/src/tools/registrar-quote.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ValidationError } from '../domain/name.js';
import { MAX_QUOTE_DOMAINS } from '../registrars/quote.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { toolError, toolJson } from './result.js';

export function registerRegistrarQuote(
  server: McpServer,
  rt: Pick<RegistrarRuntime, 'registrarQuote'>,
): void {
  server.registerTool(
    'registrar_quote',
    {
      title: 'Registrar quote for exact domains',
      description:
        'For exact domains: per-registrar first-year, renewal, and 3-year prices. Without registrar API keys it returns bundled table prices only. With keys it adds live availability, the premium flag, and live prices from that registrar API (cached 1 hour). Every price has a label naming its origin and time.',
      inputSchema: {
        domains: z
          .array(z.string())
          .min(1)
          .max(MAX_QUOTE_DOMAINS)
          .describe('Fully qualified domains, e.g. "zentrova.site"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ domains }) => {
      try {
        return toolJson(await rt.registrarQuote(domains));
      } catch (error) {
        if (error instanceof ValidationError) return toolError(error.message);
        throw error;
      }
    },
  );
}
```

`server/src/tools/registrar-status.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { toolJson } from './result.js';

export function registerRegistrarStatus(
  server: McpServer,
  rt: Pick<RegistrarRuntime, 'registrarStatus'>,
): void {
  server.registerTool(
    'registrar_status',
    {
      title: 'Registrar API key status',
      description:
        'Which registrars (Spaceship, Namecheap, Cloudflare) have API keys configured through environment variables, and which variable names are missing. Also lists the optional research key names and whether each is set. Never returns key values.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolJson(rt.registrarStatus()),
  );
}
```

`server/src/tools/register-plan4.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { registerRegistrarQuote } from './registrar-quote.js';
import { registerRegistrarStatus } from './registrar-status.js';
import { registerTldInfo } from './tld-info.js';

export function registerPlan4Tools(server: McpServer, rt: RegistrarRuntime): void {
  registerTldInfo(server, rt);
  registerRegistrarQuote(server, rt);
  registerRegistrarStatus(server, rt);
}
```

- [ ] **Step 5: Annotate `check_domains`**

In `server/src/tools/check-domains.ts`, inside the `registerTool` config object, add one line after the closing `},` of `inputSchema`:
```ts
      annotations: { readOnlyHint: true, openWorldHint: true },
```
The config then ends:
```ts
            'TLDs with or without a leading dot, e.g. "com", ".io"; multi-label values must be registry suffixes such as "co.uk"',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ names, tlds }) => {
```

- [ ] **Step 6: Register the tools in `server.ts`**

Add one import line after the `registerCheckDomains` import, and one call as the last line before `return server;` (after any lines Plans 2 and 3 add):
```ts
import { registerPlan4Tools } from './tools/register-plan4.js';
```
```ts
  registerPlan4Tools(server, rt);
```
On a branch without Plans 2 and 3, `createServer` reads:
```ts
export function createServer(rt: Runtime): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerCheckDomains(server, rt);
  registerPlan4Tools(server, rt);
  return server;
}
```

- [ ] **Step 7: Extend `Runtime` in `runtime.ts`**

Three edits, nothing else:

1. Import, after the `HostLimiter` import:
```ts
import { createRegistrarRuntime, type RegistrarRuntime } from './registrars/runtime-part.js';
```
2. The interface line becomes (Plans 2 and 3 add their own entries; the merged line is `extends StoreRuntime, ResearchRuntime, RegistrarRuntime`):
```ts
export interface Runtime extends RegistrarRuntime {
```
3. One spread line as the last property of the returned object, reusing the existing `http`, `cache` and `env`:
```ts
  return {
    checkDomains: (domains) => checkDomains(domains, deps),
    ...createRegistrarRuntime({ http, cache, env }),
  };
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd server && pnpm test test/tools && pnpm typecheck`
Expected: PASS: `check-domains` 6 tests, `tld-info` 3, `registrar-quote` 4, `registrar-status` 2. Typecheck has no errors.

- [ ] **Step 9: Format, check, full suite, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/tools/tld-info.ts server/src/tools/registrar-quote.ts server/src/tools/registrar-status.ts server/src/tools/register-plan4.ts server/src/server.ts server/src/runtime.ts server/src/tools/check-domains.ts server/test/tools/tld-info.test.ts server/test/tools/registrar-quote.test.ts server/test/tools/registrar-status.test.ts server/test/tools/check-domains.test.ts
git commit -m "feat(tools): add tld_info, registrar_quote, registrar_status and MCP annotations"
```

---

### Task 9: Startup error handling

**Files:**
- Create: `server/src/startup.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/startup.test.ts`

**Interfaces:**
- Consumes: `readCredentials`, `secretValues`, `redact` (Task 3); `errorMessage` from `util/errors.ts`; `createRuntime`, `createServer`.
- Produces: `interface StartupIo { stderr(text: string): void; exit(code: number): void; env: NodeJS.ProcessEnv }`; `runStartup(start: () => Promise<void>, io?: StartupIo): Promise<void>`. On failure it writes exactly one line, `domain-name-engine: failed to start: <message>`, to stderr (stdout belongs to the MCP protocol) and calls `exit(1)`.

- [ ] **Step 1: Write the failing test**

`server/test/startup.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { runStartup, type StartupIo } from '../src/startup.js';

function io(env: NodeJS.ProcessEnv = {}): StartupIo & { out: string[]; codes: number[] } {
  const out: string[] = [];
  const codes: number[] = [];
  return { out, codes, env, stderr: (t) => out.push(t), exit: (c) => codes.push(c) };
}

describe('runStartup', () => {
  it('does nothing extra when start succeeds', async () => {
    const fake = io();
    await runStartup(async () => undefined, fake);
    expect(fake.out).toEqual([]);
    expect(fake.codes).toEqual([]);
  });

  it('writes one stderr line and exits 1 when start fails', async () => {
    const fake = io();
    await runStartup(async () => {
      throw new Error('EACCES: permission denied, mkdir /root/.domain-engine');
    }, fake);
    expect(fake.out).toEqual([
      'domain-name-engine: failed to start: EACCES: permission denied, mkdir /root/.domain-engine\n',
    ]);
    expect(fake.codes).toEqual([1]);
  });

  it('redacts registrar keys from the message', async () => {
    const fake = io({ CLOUDFLARE_API_TOKEN: 'cf-token-efgh', CLOUDFLARE_ACCOUNT_ID: 'acct-9876' });
    await runStartup(async () => {
      throw new Error('bad token cf-token-efgh');
    }, fake);
    expect(fake.out[0]).toBe('domain-name-engine: failed to start: bad token [redacted]\n');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && pnpm test test/startup.test.ts`
Expected: FAIL, `../src/startup.js` does not exist.

- [ ] **Step 3: Write `startup.ts`**

`server/src/startup.ts`:
```ts
import { readCredentials, redact, secretValues } from './registrars/credentials.js';
import { errorMessage } from './util/errors.js';

export interface StartupIo {
  stderr: (text: string) => void;
  exit: (code: number) => void;
  env: NodeJS.ProcessEnv;
}

const processIo: StartupIo = {
  stderr: (text) => process.stderr.write(text),
  exit: (code) => process.exit(code),
  env: process.env,
};

/**
 * Runs the server start function. On failure it writes one clean line to stderr
 * (stdout belongs to the MCP protocol) and exits with code 1. Key values are redacted.
 */
export async function runStartup(
  start: () => Promise<void>,
  io: StartupIo = processIo,
): Promise<void> {
  try {
    await start();
  } catch (error) {
    const message = redact(errorMessage(error), secretValues(readCredentials(io.env)));
    io.stderr(`domain-name-engine: failed to start: ${message}\n`);
    io.exit(1);
  }
}
```

- [ ] **Step 4: Use it in `index.ts`**

Replace the whole of `server/src/index.ts` with:
```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRuntime } from './runtime.js';
import { createServer } from './server.js';
import { runStartup } from './startup.js';

await runStartup(async () => {
  const server = createServer(createRuntime());
  await server.connect(new StdioServerTransport());
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/startup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Smoke-test the failure path without rebuilding dist**

Run: `cd server && npx -y tsx@4.23.15 src/index.ts < /dev/null; echo "exit $?"`
Expected: `exit 0` and nothing on stderr: the server starts and stops when stdin closes. The failure path is covered by the unit test. Do not run `pnpm build`.

- [ ] **Step 7: Format, check, typecheck, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/startup.ts server/src/index.ts server/test/startup.test.ts
git commit -m "fix(server): print a clean startup error and exit 1"
```

---

### Task 10: Refresh helpers and the maintainer script

**Files:**
- Create: `server/src/tld/refresh.ts`, `server/scripts/refresh-registrar-tlds.ts`
- Modify: `server/package.json`, `server/tsconfig.json`, `server/pnpm-lock.yaml` (by `pnpm add`)
- Test: `server/test/tld/refresh.test.ts`

**Interfaces:**
- Consumes: `PriceRow`, `RegistrarId`, `RegistrarTable`, `RegistrarTableSchema`, `REGISTRAR_NAMES` (Task 1); `fetchSpaceshipTldPrices` (Task 4); `fetchNamecheapTldPrices` (Task 5); `fetchCloudflarePublicPrices` (Task 6); `readCredentials`, `secretValues`, `redact` (Task 3); `createHttp`, `HostLimiter`; `errorMessage`.
- Produces: `interface FetchedRegistrar { registrar: RegistrarId; rows: PriceRow[] }`; `mergeTable(current: RegistrarTable, fetched: FetchedRegistrar[]): RegistrarTable` (replaces the fetched registrars' rows, sets them to `coverage: "full"`, `notSold: []`, keeps the others, sorts rows); `diffTables(before, after): string[]` (lines starting `+`, `-`, or `~`); `serializeTable(table): string` (2-space JSON plus newline); the `pnpm refresh:tlds` script.

The script always loads the Cloudflare public file. It loads Spaceship and Namecheap only when their keys are set and otherwise prints `keys not set, keeping current rows`. Every error message is redacted. It validates the merged table before writing, prints the diff and the count of changed rows, then writes the file; the package script formats it with Biome. It never prints a key. CI never runs it.

- [ ] **Step 1: Write the failing test**

`server/test/tld/refresh.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { diffTables, mergeTable, serializeTable } from '../../src/tld/refresh.js';
import { type PriceRow, RegistrarTableSchema } from '../../src/tld/schema.js';
import { testTables } from './fixtures.js';

const fresh: PriceRow = {
  registrar: 'spaceship',
  tld: 'site',
  firstYear: 1.05,
  renewal: 11.11,
  transfer: 10.1,
  currency: 'EUR',
  source: 'Spaceship API /v1/tlds/pricing',
  checkedAt: '2026-11-05',
};

describe('mergeTable', () => {
  it('replaces the fetched registrar rows and marks it full coverage', () => {
    const current = testTables().registrars;
    const next = mergeTable(current, [{ registrar: 'spaceship', rows: [fresh] }]);
    expect(next.rows.filter((r) => r.registrar === 'spaceship')).toEqual([fresh]);
    expect(next.registrars.spaceship.coverage).toBe('full');
    expect(next.registrars.namecheap).toEqual(current.registrars.namecheap);
    expect(next.rows.filter((r) => r.registrar === 'cloudflare')).toHaveLength(2);
    expect(() => RegistrarTableSchema.parse(next)).not.toThrow();
  });

  it('keeps everything when nothing was fetched', () => {
    const current = testTables().registrars;
    expect(mergeTable(current, []).rows).toHaveLength(current.rows.length);
  });
});

describe('diffTables', () => {
  it('lists changed, added, and removed rows', () => {
    const current = testTables().registrars;
    const next = mergeTable(current, [
      { registrar: 'spaceship', rows: [fresh, { ...fresh, tld: 'xyz', firstYear: 1.83 }] },
      { registrar: 'cloudflare', rows: [] },
    ]);
    expect(diffTables(current, next)).toEqual([
      '+ spaceship .xyz: first 1.83, renew 11.11, transfer 10.1 EUR',
      '- cloudflare .com: first 10.46, renew 10.46, transfer unknown USD',
      '- cloudflare .site: first 4.99, renew 27.7, transfer unknown USD',
      '~ spaceship .site: first 1.05, renew 30, transfer unknown EUR -> first 1.05, renew 11.11, transfer 10.1 EUR',
    ]);
  });
});

describe('serializeTable', () => {
  it('writes pretty JSON with a trailing newline that parses back', () => {
    const text = serializeTable(testTables().registrars);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(testTables().registrars);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && pnpm test test/tld/refresh.test.ts`
Expected: FAIL, `../../src/tld/refresh.js` does not exist.

- [ ] **Step 3: Write the refresh helpers**

`server/src/tld/refresh.ts`:
```ts
import type { PriceRow, RegistrarId, RegistrarTable } from './schema.js';

export interface FetchedRegistrar {
  registrar: RegistrarId;
  rows: PriceRow[];
}

const byKey = (a: PriceRow, b: PriceRow) =>
  a.registrar.localeCompare(b.registrar) || a.tld.localeCompare(b.tld);

/**
 * Replaces all rows of each fetched registrar and marks its coverage full.
 * Registrars that were not fetched keep their current rows and coverage.
 */
export function mergeTable(current: RegistrarTable, fetched: FetchedRegistrar[]): RegistrarTable {
  const replaced = new Set(fetched.map((f) => f.registrar));
  const registrars = { ...current.registrars };
  for (const f of fetched) {
    registrars[f.registrar] = {
      coverage: 'full',
      notSold: [],
      note: `Full list from ${f.rows[0]?.source ?? 'the registrar'}, refreshed by refresh:tlds.`,
    };
  }
  const rows = [
    ...current.rows.filter((r) => !replaced.has(r.registrar)),
    ...fetched.flatMap((f) => f.rows),
  ].sort(byKey);
  return { schemaVersion: 1, registrars, rows };
}

function fmt(row: PriceRow): string {
  const p = (v: number | null) => (v === null ? 'unknown' : String(v));
  return `first ${p(row.firstYear)}, renew ${p(row.renewal)}, transfer ${p(row.transfer)} ${row.currency ?? ''}`.trim();
}

/** Human-readable changes between two tables, one line per added, removed, or changed row. */
export function diffTables(before: RegistrarTable, after: RegistrarTable): string[] {
  const key = (r: PriceRow) => `${r.registrar} .${r.tld}`;
  const old = new Map(before.rows.map((r) => [key(r), r]));
  const next = new Map(after.rows.map((r) => [key(r), r]));
  const lines: string[] = [];
  for (const [k, row] of next) {
    const prev = old.get(k);
    if (!prev) lines.push(`+ ${k}: ${fmt(row)}`);
    else if (fmt(prev) !== fmt(row)) lines.push(`~ ${k}: ${fmt(prev)} -> ${fmt(row)}`);
  }
  for (const [k, row] of old) if (!next.has(k)) lines.push(`- ${k}: ${fmt(row)}`);
  return lines.sort();
}

export function serializeTable(table: RegistrarTable): string {
  return `${JSON.stringify(table, null, 2)}\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm test test/tld/refresh.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the script**

`server/scripts/refresh-registrar-tlds.ts`:
```ts
// Maintainer script: rebuilds server/data/registrar-tlds.json from official APIs and the
// public Cloudflare price file. Run with `pnpm refresh:tlds`. Needs network; CI never runs it.
// Key values are read from env only and are never printed.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHttp } from '../src/http/http.js';
import { HostLimiter } from '../src/limiter/limiter.js';
import { fetchCloudflarePublicPrices } from '../src/registrars/cloudflare.js';
import { readCredentials, redact, secretValues } from '../src/registrars/credentials.js';
import { fetchNamecheapTldPrices } from '../src/registrars/namecheap.js';
import { fetchSpaceshipTldPrices } from '../src/registrars/spaceship.js';
import {
  diffTables,
  type FetchedRegistrar,
  mergeTable,
  serializeTable,
} from '../src/tld/refresh.js';
import { type PriceRow, type RegistrarId, RegistrarTableSchema } from '../src/tld/schema.js';
import { errorMessage } from '../src/util/errors.js';

const TABLE_PATH = fileURLToPath(new URL('../data/registrar-tlds.json', import.meta.url));

async function main(): Promise<void> {
  const creds = readCredentials(process.env);
  const secrets = secretValues(creds);
  // Large price lists need more than the default 8 second timeout.
  const http = createHttp({ limiter: new HostLimiter(), timeoutMs: 60_000 });
  const today = new Date().toISOString().slice(0, 10);

  const { spaceship, namecheap } = creds;
  const jobs: Array<[RegistrarId, (() => Promise<PriceRow[]>) | null]> = [
    ['cloudflare', () => fetchCloudflarePublicPrices(http)],
    ['spaceship', spaceship ? () => fetchSpaceshipTldPrices(spaceship, http, today) : null],
    ['namecheap', namecheap ? () => fetchNamecheapTldPrices(namecheap, http, today) : null],
  ];

  const fetched: FetchedRegistrar[] = [];
  for (const [registrar, job] of jobs) {
    if (!job) {
      console.log(`${registrar}: keys not set, keeping current rows`);
      continue;
    }
    try {
      const rows = await job();
      if (rows.length === 0) throw new Error('no rows returned');
      fetched.push({ registrar, rows });
      console.log(`${registrar}: ${rows.length} TLDs`);
    } catch (error) {
      console.log(
        `${registrar}: failed, keeping current rows (${redact(errorMessage(error), secrets)})`,
      );
    }
  }

  const current = RegistrarTableSchema.parse(JSON.parse(await readFile(TABLE_PATH, 'utf8')));
  const next = RegistrarTableSchema.parse(mergeTable(current, fetched));
  const changes = diffTables(current, next);
  for (const line of changes) console.log(line);
  console.log(`${changes.length} changed rows`);
  await writeFile(TABLE_PATH, serializeTable(next), 'utf8');
}

main().catch((error: unknown) => {
  const secrets = secretValues(readCredentials(process.env));
  console.error(`refresh failed: ${redact(errorMessage(error), secrets)}`);
  process.exit(1);
});
```

- [ ] **Step 6: Add `tsx`, the script entry, and the tsconfig include**

Run: `cd server && pnpm add -D tsx@4.23.15`
This adds `"tsx": "4.23.15"` to `devDependencies` and updates `pnpm-lock.yaml`. tsx 4.23.15 was released 2026-09-20.

In `server/package.json`, add one line to `scripts` after `"format"` (add a comma to the `format` line):
```json
    "format": "biome check --write .",
    "refresh:tlds": "tsx scripts/refresh-registrar-tlds.ts && biome format --write data/registrar-tlds.json"
```

In `server/tsconfig.json`, change the `include` line so the script is typechecked:
```json
  "include": ["src", "test", "scripts", "*.config.ts"]
```

- [ ] **Step 7: Typecheck and check the script without touching the table**

Run: `cd server && pnpm typecheck && pnpm check`
Expected: no errors. Do not run `pnpm refresh:tlds` in this task; it rewrites the table with live data (Task 13 has the optional maintainer step).

- [ ] **Step 8: Commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/src/tld/refresh.ts server/scripts/refresh-registrar-tlds.ts server/test/tld/refresh.test.ts server/package.json server/pnpm-lock.yaml server/tsconfig.json
git commit -m "feat(tld): add refresh:tlds maintainer script"
```

---

### Task 11: Live registrar tests

**Files:**
- Test: `server/test/live/registrars.test.ts`

**Interfaces:**
- Consumes: `createHttp`, `HostLimiter`, `DiskCache`; `fetchCloudflarePublicPrices` (Task 6); `readCredentials` (Task 3); `liveClients` (Task 7); `RegistrarId`.
- Produces: `pnpm test:live` cases: the Cloudflare public file (needs `LIVE=1` only), and per registrar (needs `LIVE=1` and that registrar's keys) `google.com` is `unavailable` and a random 30-letter `.com` is `available` with a price.

- [ ] **Step 1: Write the live test**

`server/test/live/registrars.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { createHttp } from '../../src/http/http.js';
import { HostLimiter } from '../../src/limiter/limiter.js';
import { fetchCloudflarePublicPrices } from '../../src/registrars/cloudflare.js';
import { readCredentials } from '../../src/registrars/credentials.js';
import { liveClients } from '../../src/registrars/runtime-part.js';
import type { RegistrarId } from '../../src/tld/schema.js';

// Runs only through `pnpm test:live`. Registrar cases also need that registrar's keys.
const LIVE = Boolean(process.env.LIVE);
const creds = readCredentials(process.env);

function randomLabel(): string {
  return Array.from({ length: 30 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('');
}

async function client(id: RegistrarId) {
  const http = createHttp({ limiter: new HostLimiter() });
  const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-live-reg-')));
  const found = liveClients(creds, { http, cache }).find((c) => c.id === id);
  if (!found) throw new Error(`${id} keys are not set`);
  return found;
}

describe.skipIf(!LIVE)('live Cloudflare public price file', () => {
  it('lists hundreds of TLDs including .com in USD', async () => {
    const rows = await fetchCloudflarePublicPrices(createHttp({ limiter: new HostLimiter() }));
    expect(rows.length).toBeGreaterThan(300);
    expect(rows.find((r) => r.tld === 'com')).toMatchObject({ currency: 'USD' });
  }, 30_000);
});

for (const id of ['spaceship', 'namecheap', 'cloudflare'] as const) {
  describe.skipIf(!LIVE || !creds[id])(`live ${id} quotes`, () => {
    it('reports google.com as unavailable', async () => {
      const [quote] = await (await client(id)).quote(['google.com']);
      expect(quote?.availability).toBe('unavailable');
    }, 30_000);

    it('reports a random 30-letter .com as available with a price', async () => {
      const [quote] = await (await client(id)).quote([`${randomLabel()}.com`]);
      expect(quote?.availability).toBe('available');
      expect(quote?.firstYear).not.toBeNull();
      expect(quote?.currency).toMatch(/^[A-Z]{3}$/);
    }, 30_000);
  });
}
```

- [ ] **Step 2: Verify it skips without LIVE**

Run: `cd server && pnpm test test/live/registrars.test.ts`
Expected: all 7 tests skipped, exit 0, no network access.

- [ ] **Step 3: Run it live**

Run: `cd server && pnpm test:live`
Expected: the Cloudflare public file case passes. Keyed cases pass when that registrar's keys are set, and skip otherwise.

- [ ] **Step 4: Commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add server/test/live/registrars.test.ts
git commit -m "test(registrars): add LIVE-gated registrar smoke tests"
```

---

### Task 12: The `report` skill

**Files:**
- Create: `skills/report/SKILL.md`, `skills/report/references/report-template.md`
- Test: `server/test/tld/report-skill.test.ts`

**Interfaces:**
- Consumes (by MCP tool name only, no code import): `project_get` (Plan 2) returns `{ project, paths: { dir, projectFile, reportFile }, recoveredFromBackup, warning? }`; `project.names[]` has `name`, `label`, `rulesetId`, `strategy?`, `rationale?`, `score`, `notes[]` (`kind`, `language`, `severity` `low | medium | high`, `text`); `project.checks[label]` has `domains[]` (raw `check_domains` results), `profiles[]`, `handles[]`, `trademarks[]`, `competitors[]` (source `websearch`, with `url`); `project.shortlist` (labels). `tld_info`, `registrar_quote`, `registrar_status` (Task 8).
- Produces: the `report` skill, which `find-domain` (Plan 2) invokes by name, writing `report.md` to `paths.reportFile`.

- [ ] **Step 1: Write the failing test**

`server/test/tld/report-skill.test.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Runtime } from '../../src/runtime.js';
import { connectClient } from '../helpers/mcp.js';

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

async function read(path: string): Promise<string> {
  return readFile(new URL(`../../../skills/report/${path}`, import.meta.url), 'utf8');
}

describe('report skill', () => {
  it('has frontmatter with its name and a trigger description', async () => {
    const match = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(await read('SKILL.md'));
    expect(match?.[1]).toBe('report');
    expect(match?.[2]).toMatch(/^Use when /);
  });

  it.each(['SKILL.md', 'references/report-template.md'])(
    '%s names only known tools',
    async (path) => {
      const tokens = (await read(path)).match(TOOL_TOKEN) ?? [];
      expect(tokens.filter((token) => !KNOWN_TOOLS.includes(token))).toEqual([]);
    },
  );

  it.each(['SKILL.md', 'references/report-template.md'])('%s has no emoji', async (path) => {
    expect(await read(path)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('states the honesty rules', async () => {
    const text = (await read('SKILL.md')).toLowerCase();
    for (const phrase of [
      'say "likely available" only',
      'reference price from <registrar>, checked <date> — verify at registrar',
      'live price from <registrar> api, <time>',
      'side by side',
      'written as "unknown"',
      'never convert a currency',
      'no urgency copy',
      'paths.reportfile',
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it('every Plan 4 tool it names is registered', async () => {
    const client = await connectClient({} as Runtime);
    const registered = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const token of (await read('SKILL.md')).match(TOOL_TOKEN) ?? []) {
      if (/^(?:tld|registrar)_/.test(token)) expect(registered.has(token), token).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && pnpm test test/tld/report-skill.test.ts`
Expected: FAIL with `ENOENT: no such file or directory` for `skills/report/SKILL.md`.

- [ ] **Step 3: Write the skill**

`skills/report/SKILL.md`:
```markdown
---
name: report
description: Use when a naming project needs its final report - the user asks for the report, a ranking of the shortlist, a price comparison across registrars, or which domain to buy, or find-domain reaches its last step. Ranks the shortlisted names and writes report.md with registrar prices, 3-year totals, and TLD reputation, citing the source and check time of every claim.
---

# Report

Ranks the shortlisted names of one project and writes `report.md` into the project folder. The report is the user's buying guide, so every claim in it cites the tool result it came from.

## Tools

- `project_get({ slug })`: the project (brief, names, checks, notes, shortlist) and `paths.reportFile`.
- `tld_info({ tld })`: which registrars sell a TLD, table prices per registrar, and the reputation note.
- `registrar_quote({ domains })`: per-registrar prices for exact domains, at most 20 per call. With registrar keys set it also returns live availability and the premium flag.
- `registrar_status({})`: optional, to tell the user which registrar keys are set.

## Steps

1. **Find the project.** Use the slug the user or `find-domain` gave. If there is none, ask which project to report on. Call `project_get`. If it returns `recoveredFromBackup: true`, say so at the top of the report.
2. **Check the inputs.** The shortlist must not be empty. If it is, stop and tell the user to pick a shortlist first (the `generate` skill does this). If a shortlisted name has no domain checks, say that `research` has not run for it, and keep going with the names that have checks.
3. **Rank the shortlist.** Order the names by these keys, in order:
   1. Has at least one domain whose `check_domains` status is `likely_available`.
   2. Fewest risks: a trademark result with possible conflicts, a language note with severity `high` or `medium`, or a taken-domain profile that shows an active business in the same niche.
   3. Higher `score` from the project.
   Give each name a one-sentence reason for its place, built only from the project data.
4. **Collect the domains to price.** For each shortlisted name, take every domain whose stored `check_domains` status is `likely_available`. Price only those. Domains with any other status go in the "Not available or unknown" list with their status, source, and `checkedAt`.
5. **Get TLD facts.** Call `tld_info` once per distinct TLD in that list.
6. **Get quotes.** Call `registrar_quote` with the domains from step 4, in batches of at most 20. If the result has `mode: "live"`, a live `availability` of `unavailable` overrides the stored check: move that domain to "Not available or unknown" and cite the registrar API and its `checkedAt`. If a registrar entry has a `reason`, show it.
7. **Write the report.** Follow `references/report-template.md`. Write the file to `paths.reportFile` from `project_get`, replacing any earlier report. Do not write it anywhere else.
8. **Tell the user** where the file is, the top three names with their best domain, and the cheapest 3-year option for each. Repeat the price label with every price you mention.

## What the report shows

- **Ruleset behind each name**: the name's `rulesetId`, plus its `strategy` and `rationale` when present.
- **Per likely-available domain**: one row per registrar from `registrar_quote`: whether the registrar sells the TLD, first-year price, renewal price, and 3-year total, side by side, with the currency and the price label.
- **Cheapest 3-year option**: from `cheapestThreeYear`, one line per currency. Never pick a single winner across currencies.
- **TLD reputation**: the `reputation` level and `reputationNote` from `tld_info`, with its source. For a TLD with reputation `mixed` or `poor`, add that it can hurt email delivery and visitor trust.
- **Language risks**: notes with `kind: "language"`, grouped by severity, `high` first, then `medium`, then `low`, with the language code.
- **Other checks**: handle and trademark results as stored, with their source and `checkedAt`. Competitor findings with their URL.

## Honesty rules

- Say "likely available" only for a domain whose `check_domains` status is `likely_available`. Never call a domain available without a tool result. Never write "available" without "likely".
- Label every price with its origin, using the `priceLabel` from the tool result word for word:
  - table price: "reference price from <registrar>, checked <date> — verify at registrar"
  - live price: "live price from <registrar> API, <time>"
- Always show the first-year price and the renewal price side by side. A low first-year price often renews much higher, so never show the first-year price alone.
- A missing value is written as "unknown". Never estimate or fill in a price. A registrar entry with `priceSource: "none"` has no price: write "unknown" and keep its label.
- A registrar with `sale: "not_sold"` does not sell the TLD: write "not sold". With `sale: "not_in_table"`, write "unknown — not in the bundled table".
- Never add up or compare prices in different currencies, and never convert a currency.
- A premium name (`premium: true`) never gets the standard table price. Show the live premium price if there is one, otherwise "unknown".
- No emoji. No urgency copy ("act now", "before it's gone", "only today"). No claims about popularity or demand.
- Copy the `notes` from `registrar_quote` into the report's "Sources and limits" section.
- End the report with the limits of the free sources (see the template).
```

- [ ] **Step 4: Write the report template**

`skills/report/references/report-template.md`:
````markdown
# Report template

Fill this structure. Replace every `<...>` with data from the tool results. Leave out a section only when the template marks it optional. Write "unknown" for any missing value.

```markdown
# Naming report: <project title>

Project: <slug> · Brief version <brief.version> · Written <ISO date and time>
Price mode: <"bundled table only" when registrar_quote mode is "table"; otherwise "live from <registrar names> plus bundled table">

## Ranking

| Rank | Name | Ruleset | Best likely-available domain | Cheapest 3-year option | Main risk |
|---|---|---|---|---|---|
| 1 | <name> | <rulesetId> | <domain, or "none"> | <amount currency at registrar, or "unknown"> | <one short phrase, or "none found"> |

<One sentence per name explaining its rank, from project data only.>

## <Name> (rank <n>)

Ruleset: <rulesetId>. <strategy, when present>. <rationale, when present>

### <domain>: likely available (check_domains, <source>, checked <checkedAt>)

| Registrar | Sells TLD | First year | Renewal | 3-year total | Currency | Price label |
|---|---|---|---|---|---|---|
| Spaceship | <listed / not sold / unknown> | <amount or unknown> | <amount or unknown> | <amount or unknown> | <code or unknown> | <priceLabel> |
| Namecheap | ... | ... | ... | ... | ... | ... |
| Cloudflare | ... | ... | ... | ... | ... | ... |

<One line per registrar entry with a premium flag or a reason: "<Registrar>: premium name" or "<Registrar>: <reason>".>

Cheapest 3-year option: <one line per currency: "<amount> <currency> at <registrar>">. Prices in different currencies are not compared.

TLD .<tld>: reputation <good / mixed / poor>. <reputationNote> (source: <source>, checked <checkedAt>)

### Not available or unknown

| Domain | Status | Source | Checked |
|---|---|---|---|
| <domain> | <registered / unknown / unavailable at registrar> | <source> | <checkedAt> |

### Language risks (optional: only when the name has language notes)

- high: <language code>: <note text>
- medium: <language code>: <note text>
- low: <language code>: <note text>

### Handles, trademarks, and competitors (optional: only when checks exist)

- Handles: <platform: status (source, checkedAt)>. Manual platforms show their profile link.
- Trademarks: <summary of stored results with source and checkedAt>. No matches is not a legal clearance.
- Competitors: <finding with its URL>

## Sources and limits

- <each note from registrar_quote, one bullet each>
- Availability comes from public RDAP, WHOIS, and DNS data. "Likely available" means no registration was found at check time; only a registrar can confirm that a domain is free.
- Table prices are reference prices from the bundled table. They can be out of date and do not include taxes, fees, or promotions. Verify at the registrar before buying.
- Without registrar API keys, premium names cannot be detected and their price is unknown.
- Prices are never converted between currencies.
- Handle checks for X, Instagram, TikTok, and LinkedIn are manual: the report gives a profile link, not a result.
- Trademark results are not legal advice. USPTO and WIPO searches are links for a manual search.
```
````

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/tld/report-skill.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add skills/report/SKILL.md skills/report/references/report-template.md server/test/tld/report-skill.test.ts
git commit -m "feat(skills): add report skill with price honesty rules"
```

---

### Task 13: Plugin icon, manifests, env passing, README, and release checks

**Files:**
- Create: `.claude-plugin/icon.png`
- Modify: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, `README.md`

**Interfaces:**
- Consumes: every env var name from Task 3 (`ENV_VARS`, `OTHER_ENV_VARS`) plus `DOMAIN_ENGINE_HOME`; the tool and skill names of all plans.
- Produces: a plugin that passes `claude plugin validate .` with an icon, a server that receives the optional keys, and the full README.

Env passing: a plugin's `.mcp.json` expands `${VAR}` and `${VAR:-default}`. An unset variable without a default stays as the literal text `${VAR}`, and the docs do not promise that the server inherits the parent environment. So each variable is mapped explicitly with an empty default. `readCredentials` treats empty and `${...}` values as unset, and `engineHome` already treats an empty `DOMAIN_ENGINE_HOME` as unset (`env.DOMAIN_ENGINE_HOME || ...`).

- [ ] **Step 1: Generate the icon**

`claude plugin validate` accepts `"icon": "./path.png"` in `plugin.json` and reports `ICON_INVALID` when the file is missing. Save this generator outside the repository as `/tmp/make-icon.mjs` (it has no dependencies):
```js
// Draws a 256x256 icon (dark rounded square, light ring with a dot) and writes it as PNG.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 256;
const BG = [17, 24, 39];
const FG = [94, 234, 212];
const px = Buffer.alloc(SIZE * (SIZE * 4 + 1));

function inRoundedSquare(x, y) {
  const r = 48;
  const cx = Math.min(Math.max(x, r), SIZE - 1 - r);
  const cy = Math.min(Math.max(y, r), SIZE - 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  px[row] = 0;
  for (let x = 0; x < SIZE; x++) {
    const i = row + 1 + x * 4;
    if (!inRoundedSquare(x, y)) continue;
    const d = Math.hypot(x - 128, y - 128);
    const dot = Math.hypot(x - 184, y - 184) <= 18;
    const ring = d >= 62 && d <= 84;
    const color = ring || dot ? FG : BG;
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = 255;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(px)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2], png);
```

Run: `node /tmp/make-icon.mjs .claude-plugin/icon.png && file .claude-plugin/icon.png`
Expected: `PNG image data, 256 x 256, 8-bit/color RGBA, non-interlaced`. Do not commit the generator.

- [ ] **Step 2: Update the plugin manifest**

Replace `.claude-plugin/plugin.json` with:
```json
{
  "name": "domain-name-engine",
  "displayName": "Domain Name Engine",
  "version": "0.1.0",
  "description": "Find a strong brand name and domain: LLM-driven naming with RDAP/WHOIS/DNS availability checks, brand research tools, and dated registrar prices for Spaceship, Namecheap, and Cloudflare.",
  "author": { "name": "Magnifito" },
  "homepage": "https://github.com/magnifito/domain-name-engine#readme",
  "repository": "https://github.com/magnifito/domain-name-engine",
  "license": "MIT",
  "keywords": ["domain", "naming", "branding", "rdap", "whois", "registrar", "mcp"],
  "icon": "./.claude-plugin/icon.png"
}
```

- [ ] **Step 3: Update the marketplace description**

Replace `.claude-plugin/marketplace.json` with:
```json
{
  "name": "magnifito",
  "owner": { "name": "Magnifito" },
  "plugins": [
    {
      "name": "domain-name-engine",
      "source": "./",
      "description": "Find a strong brand name and domain with real availability checks, brand research tools, and dated registrar prices."
    }
  ]
}
```

- [ ] **Step 4: Pass the optional env vars to the server**

Replace `.mcp.json` with (the research keys belong to Plan 3; listing them here means Plan 3 does not need to touch this file):
```json
{
  "mcpServers": {
    "domain-engine": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/dist/index.js"],
      "env": {
        "DOMAIN_ENGINE_HOME": "${DOMAIN_ENGINE_HOME:-}",
        "SPACESHIP_API_KEY": "${SPACESHIP_API_KEY:-}",
        "SPACESHIP_API_SECRET": "${SPACESHIP_API_SECRET:-}",
        "NAMECHEAP_API_USER": "${NAMECHEAP_API_USER:-}",
        "NAMECHEAP_API_KEY": "${NAMECHEAP_API_KEY:-}",
        "NAMECHEAP_CLIENT_IP": "${NAMECHEAP_CLIENT_IP:-}",
        "CLOUDFLARE_API_TOKEN": "${CLOUDFLARE_API_TOKEN:-}",
        "CLOUDFLARE_ACCOUNT_ID": "${CLOUDFLARE_ACCOUNT_ID:-}",
        "GITHUB_TOKEN": "${GITHUB_TOKEN:-}",
        "REDDIT_CLIENT_ID": "${REDDIT_CLIENT_ID:-}",
        "REDDIT_CLIENT_SECRET": "${REDDIT_CLIENT_SECRET:-}",
        "YOUTUBE_API_KEY": "${YOUTUBE_API_KEY:-}",
        "EUIPO_CLIENT_ID": "${EUIPO_CLIENT_ID:-}",
        "EUIPO_CLIENT_SECRET": "${EUIPO_CLIENT_SECRET:-}",
        "EUIPO_ENV": "${EUIPO_ENV:-}"
      }
    }
  }
}
```

- [ ] **Step 5: Rewrite the README**

Replace `README.md` with:
````markdown
# Domain Name Engine

A Claude Code plugin that helps you find a brand name and a domain for it. Claude writes and judges the names. A bundled MCP server checks availability with RDAP, WHOIS, and DNS, researches taken domains, social handles, and trademarks, and compares registrar prices for Spaceship, Namecheap, and Cloudflare.

Everything runs on your machine. No account is needed. Registrar and research API keys are optional.

## Install

```
/plugin marketplace add magnifito/domain-name-engine
/plugin install domain-name-engine@magnifito
```

Requires Node.js 20 or later. The server ships as one bundled file, so there is no `npm install` step.

## Skills

Start with `find-domain`. It runs the other skills in order on one saved project and resumes where you left off. Each skill also runs alone against an existing project.

| Skill | What it does | Ask it like this |
|---|---|---|
| `find-domain` | Runs the full flow: brief, generate, research, language check, report. | "Help me name my startup." |
| `brief` | Fills the brief questionnaire, picks 1 to 3 naming rulesets, and saves the project after you confirm. | "Start a naming brief for a meal-planning app." |
| `generate` | Writes 30 to 60 names across the chosen rulesets and runs a quick availability filter. You pick the shortlist. | "Generate names for project fridgely." |
| `research` | Checks each shortlisted name: domains across your TLDs, taken-domain profiles, social handles, trademarks, and a competitor scan. | "Research my shortlist." |
| `language-check` | Reviews meaning and pronunciation in the brief's target languages. | "Check the shortlist in German and Spanish." |
| `report` | Ranks the shortlist and writes `report.md` with registrar prices, 3-year totals, and TLD reputation. | "Write the report." |

## MCP tools

The skills call these tools. You can also call them directly.

| Tool | Purpose |
|---|---|
| `check_domains` | Availability for a list of label and TLD pairs |
| `profile_domain` | Profile of a registered domain |
| `check_handles` | Handle availability across platforms |
| `search_trademarks` | Similar marks in EUIPO, plus manual search links |
| `project_create`, `project_list`, `project_get`, `project_update_brief` | Create, list, read, and update naming projects |
| `project_add_names`, `project_add_checks`, `project_add_notes`, `project_shortlist` | Add names, check results, notes, and the shortlist |
| `ruleset_list`, `ruleset_get`, `ruleset_save`, `ruleset_delete` | Built-in and custom naming rulesets |
| `tld_info` | For one TLD: registrars that sell it, table prices per registrar, reputation |
| `registrar_quote` | For exact domains: per-registrar prices, plus live availability and the premium flag when keys are set |
| `registrar_status` | Which registrar and research keys are set. Never returns key values. |

## Optional API keys

All keys are optional and read from environment variables only. Set them in the shell that starts Claude Code, for example in `~/.zshrc`. The plugin passes them to its server. Keys never appear in tool output, logs, the cache, or project files. Ask Claude to run `registrar_status` to see which keys the server found.

### Registrars

Without registrar keys, `registrar_quote` returns prices from the bundled table only, and premium names cannot be detected.

| Registrar | Variables | Where to get them | Notes |
|---|---|---|---|
| Spaceship | `SPACESHIP_API_KEY`, `SPACESHIP_API_SECRET` | Spaceship account, API Manager. Grant the `domains:read` scope only. | Main registrar. Pricing calls are limited to 25 requests per 5 seconds. |
| Namecheap | `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_CLIENT_IP` | Namecheap account, Profile, Tools, API Access. | Namecheap enables API access only for accounts that meet its requirements. Add your public IP address to the allow list and set it as `NAMECHEAP_CLIENT_IP`. |
| Cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard, API Tokens. | The Registrar API is in beta. Some TLDs, such as .lol, .sh, and .cc, are not supported through the API. |

### Research

| Variables | Used by | Effect |
|---|---|---|
| `GITHUB_TOKEN` | `check_handles` | Raises the GitHub rate limit from 60 to 5000 requests per hour. |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | `check_handles` | Enables the Reddit username check. New Reddit apps need approval. |
| `YOUTUBE_API_KEY` | `check_handles` | Enables the YouTube handle check. A free Google Cloud key works. |
| `EUIPO_CLIENT_ID`, `EUIPO_CLIENT_SECRET` | `search_trademarks` | Enables the EUIPO trademark search. Register at dev.euipo.europa.eu. |
| `EUIPO_ENV` | `search_trademarks` | Set to `sandbox` to use the EUIPO test environment. Sandbox results are test data. |

## Limits of the free sources

- "Likely available" means RDAP, WHOIS, and DNS found no registration at check time. Premium and registry-reserved names are invisible to these sources. Only a registrar can confirm that a domain is free.
- Some registries have no RDAP service and limit WHOIS. Those checks return `unknown` with a reason.
- These checks are manual only and never queried: X, Instagram, TikTok, and LinkedIn handles always return `unknown` with a profile link to open yourself. USPTO and WIPO trademark searches return search links only. Reddit and YouTube handles and the EUIPO search need the keys above.
- A trademark search with no matches is not a legal clearance.
- The language check is an AI review, not a native-speaker review.

## How prices are labeled

- Every price carries its source and date. Table prices read "reference price from Spaceship, checked 2026-11-04 — verify at registrar". Live prices read "live price from Spaceship API, <time>".
- First-year and renewal prices are always shown side by side, with a 3-year total. Low first-year prices often renew much higher, for example .store at Cloudflare: USD 4.99 first year, 42.20 renewal.
- A missing value is shown as "unknown". Prices are never estimated, and currencies are never mixed or converted. The cheapest 3-year option is given once per currency.
- Live results override table prices and are cached for 1 hour.
- Each TLD has a reputation note. Several low-cost TLDs are scored lower by spam filters and security tools, which can hurt email delivery and trust.

## Bundled price table

`server/data/registrar-tlds.json` holds one row per registrar and TLD with first-year, renewal, and transfer prices, the currency, the source, and the check date. `server/data/tld-reputation.json` holds the reputation notes.

The seed table from 2026-11-04 covers a small set of TLDs:

- Spaceship: first-year prices for 8 low-cost TLDs, recorded from spaceship.com. Renewal prices are unknown until the first refresh with API keys.
- Namecheap: rows without prices, marked "unverified", until the first refresh with API keys.
- Cloudflare: 18 TLDs from cfdomainpricing.com/prices.json, a free third-party list of Cloudflare Registrar prices in USD.

The engine never scrapes registrar web pages. Spaceship and Namecheap price pages block automated clients, so the table is filled only from official APIs and documented public files.

## Data and privacy

- Projects, custom rulesets, and the cache live in `~/.domain-engine/`. Set `DOMAIN_ENGINE_HOME` to use another folder.
- Reports are written to `~/.domain-engine/projects/<slug>/report.md`.
- The server sends requests to RDAP and WHOIS servers, DNS resolvers, the research APIs, and the registrar APIs whose keys you set. Requests carry a generic `User-Agent` with the plugin name and repository URL, and no personal data.
- Requests are rate limited per host, 1 request per second by default, with retries on HTTP 429 and 5xx.

## Development

```
cd server
pnpm install
pnpm format      # Biome format and fix
pnpm check       # Biome CI check
pnpm typecheck   # tsc --noEmit
pnpm test        # unit tests, no network
pnpm test:live   # live smoke tests, uses the network; keyed tests skip without keys
pnpm build       # rebuilds server/dist/index.js
```

The repository uses Biome for lint and format. Code comments are in English.

### Refreshing the price table

```
cd server
pnpm refresh:tlds
```

The script always loads the Cloudflare public file. It loads Spaceship and Namecheap only when their keys are set, and keeps the current rows otherwise. It prints a diff, writes `data/registrar-tlds.json`, and formats it. Review the diff, run `pnpm test`, and commit the table. CI never runs this script, because it needs keys and network.

## Release checklist

1. `cd server && pnpm check && pnpm typecheck && pnpm test`.
2. `pnpm test:live` on a machine with network access.
3. Optional: `pnpm refresh:tlds` with registrar keys, then review and commit the table.
4. `pnpm build`, then commit `server/dist/index.js`. CI fails when the committed bundle differs from a fresh build.
5. Run the eval prompt for each skill by hand.
6. Run `claude plugin validate .` from the repository root.
7. Bump `version` in `.claude-plugin/plugin.json`, tag the release, and push.

## License

MIT. See [LICENSE](LICENSE).
````

- [ ] **Step 6: Validate the plugin**

Run: `claude plugin validate .`
Expected: `✔ Validation passed`, and no `ICON_INVALID` or `README_MISSING` finding.

- [ ] **Step 7: Run the full checks**

Run: `cd server && pnpm check && pnpm typecheck && pnpm test`
Expected: all pass. Do not run `pnpm build`, and leave `server/dist/` untouched; the controller rebuilds it after all merges.

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin/icon.png .claude-plugin/plugin.json .claude-plugin/marketplace.json .mcp.json README.md
git commit -m "docs: rewrite README; add plugin icon and pass optional keys to the server"
```

- [ ] **Step 9 (optional, maintainer with keys and network): refresh the table**

Run: `cd server && pnpm refresh:tlds`
Expected: lines like `cloudflare: 430 TLDs`, `spaceship: keys not set, keeping current rows` when keys are missing (or `<registrar>: failed, keeping current rows (<redacted reason>)`), the diff, and `<N> changed rows`. Review the diff: no row may lose its `source` or `checkedAt`. Then run `pnpm test` (the data test must pass, including the low-cost TLD coverage check) and commit only `server/data/registrar-tlds.json` with `chore(data): refresh registrar TLD table`. Skip this step when no maintainer keys are available; the seed table is valid on its own.

- [ ] **Step 10: Run the report eval by hand (after Plans 2 and 3 merge)**

The spec asks for one eval prompt per skill before each release. Prompt: "Write the report for project `<slug>`." Pass if: the file is written to `paths.reportFile`; only `likely_available` domains are priced; every price carries its exact label; first-year and renewal sit side by side with a 3-year total; missing values read `unknown`; no total mixes currencies; each TLD shows its reputation note; language notes are grouped by severity; there is no emoji or urgency copy; the "Sources and limits" section is present.

---

## Done criteria for Plan 4

- `cd server && pnpm check && pnpm typecheck && pnpm test` all exit 0. `server/dist/` is unchanged.
- `pnpm test:live` passes the Cloudflare public file case on a machine with network access; keyed cases skip without keys.
- `claude plugin validate .` passes with the icon.
- `git diff main --stat` shows changes only in Plan 4's owned paths, plus the allowed edits to `server/src/server.ts`, `server/src/runtime.ts`, `server/src/index.ts`, `server/src/tools/check-domains.ts`, `server/test/tools/check-domains.test.ts`, `server/package.json`, `server/pnpm-lock.yaml`, `server/tsconfig.json`, and `.mcp.json`.
- No key value appears in any test output, fixture, or committed file. `grep -rn "spaceship.com/\|namecheap.com/domains" server/src` finds no price-page URL.

## Self-review

- Spec coverage: registrars and env vars (Tasks 3 to 6); bundled table with per-row `source` and `checkedAt` and `null` plus `unverified` where unverified (Task 1); reputation table (Task 1); refresh script that prints a diff and is not run by CI (Task 10); live mode with 1 hour cache and live-over-table override (Task 7); `tld_info`, `registrar_quote`, `registrar_status` (Task 8); low-cost TLD first-year, renewal, 3-year total and reputation note (Tasks 2, 7, 12); report skill and honesty rules (Task 12); keys never in output, logs, cache or files (Tasks 3, 7, 9, with tests); registrar fixture tests and a no-keys-in-errors test (Tasks 4 to 7); schema tests for every table row (Task 1); Release: README, install steps, skill guide, free-source limits, MIT (Task 13); CI already runs `biome ci`, `tsc --noEmit`, `vitest run`, build and the dist drift check, so `.github/` is unchanged.
- Plan 1 leftovers: annotations (Task 8), icon (Task 13), startup handling (Task 9), README (Task 13).
- Placeholders: none; every code step has the full file or the exact lines.
- Type consistency: `RegistrarRuntime` method names (`tldInfo`, `registrarQuote`, `registrarStatus`) match in Tasks 7, 8 and the tool tests; `TldRegistrarEntry` fields flow unchanged into `RegistrarQuoteEntry`; `priceLabel` strings match the spec and the skill test.

## Cross-plan risks

- `server/test/tools/check-domains.test.ts`: all three plans add `...({} as Runtime),`; the edits are byte-identical, and only Plan 4 adds the annotation test, so the merge is clean or trivial.
- `server/src/runtime.ts` `extends` line: each plan adds its own entry on the same line; resolve to `extends StoreRuntime, ResearchRuntime, RegistrarRuntime`.
- `server/package.json`, `pnpm-lock.yaml`, `tsconfig.json`: only Plan 4 adds `tsx` and `scripts`; if another plan adds a dependency, regenerate the lockfile with `pnpm install` after the merge.
- `.mcp.json` lists Plan 3's research keys with empty defaults; Plan 3's key reader must treat an empty value as unset.
- CI's dist drift check fails on this branch until the controller rebuilds `server/dist/index.js` after all merges.
