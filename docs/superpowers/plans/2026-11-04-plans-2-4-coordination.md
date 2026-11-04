# Plans 2–4 coordination (parallel build)

Plans 2, 3 and 4 are written and built **in parallel**. Each one runs in its own git worktree and branch off `main` (`7ce75e7`). Every plan must merge into `main` with only trivial conflicts. These rules make that possible.

## Branches
- Plan 2: `feat/plan-2-brief-store` (plan file: `docs/superpowers/plans/2026-11-04-plan-2-brief-rulesets-store.md`)
- Plan 3: `feat/plan-3-research` (plan file: `docs/superpowers/plans/2026-11-04-plan-3-research-tools.md`)
- Plan 4: `feat/plan-4-registrars-release` (plan file: `docs/superpowers/plans/2026-11-04-plan-4-registrars-report-release.md`)

## File ownership (each plan creates only its own files)
| Plan | Owns (create/modify freely) |
|---|---|
| 2 | `server/src/store/**`, `server/src/rulesets/**`, `server/data/rulesets/**`, `server/src/tools/project-*.ts`, `server/src/tools/ruleset-*.ts`, `server/src/tools/register-plan2.ts`, `server/test/store/**`, `server/test/rulesets/**`, `server/test/tools/project-*.test.ts`, `server/test/tools/ruleset-*.test.ts`, `skills/brief/**`, `skills/generate/**`, `skills/find-domain/**` |
| 3 | `server/src/research/**` (profile, handles, trademarks sources), `server/src/tools/profile-domain.ts`, `check-handles.ts`, `search-trademarks.ts`, `server/src/tools/register-plan3.ts`, `server/test/research/**`, `server/test/tools/{profile-domain,check-handles,search-trademarks}.test.ts`, `skills/research/**`, `skills/language-check/**` |
| 4 | `server/src/registrars/**`, `server/src/tld/**`, `server/data/registrar-tlds.json`, `server/data/tld-reputation.json`, `server/scripts/refresh-registrar-tlds.ts`, `server/src/tools/{tld-info,registrar-quote,registrar-status}.ts`, `server/src/tools/register-plan4.ts`, `server/test/registrars/**`, `server/test/tld/**`, `server/test/tools/{tld-info,registrar-quote,registrar-status}.test.ts`, `skills/report/**`, `README.md`, `.claude-plugin/**`, `.github/**` |

## Shared files: the only allowed edits
- `server/src/server.ts`: add exactly ONE import line plus ONE call line, `registerPlanNTools(server, rt)`, inside `createServer`. Plan 2 adds it after `registerCheckDomains`, Plan 3 adds it after Plan 2's line, and Plan 4 adds it last. Plan N's line must not depend on the others being present.
- `server/src/runtime.ts`:
  - Each plan defines its own interface in its own folder, e.g. `server/src/store/runtime-part.ts` exporting `interface StoreRuntime` and `createStoreRuntime(paths, deps)`.
  - In `runtime.ts`, it adds ONE `extends` entry to `Runtime` (`export interface Runtime extends StoreRuntime { ... }`, with the others appended) and ONE spread line in the returned object, `...createStoreRuntime(paths, { http, limiter, cache })`.
  - Keep `http`, `limiter` and `cache` shared. Do not create second instances.
- `server/src/config.ts`: do not edit. If a plan needs a path, derive it from `enginePaths(home)` inside its own module.
- `server/package.json`: add deps only if truly required. Keep the existing script names. Plan 4 may add a `refresh:tlds` script.
- `server/dist/index.js`: do NOT rebuild or commit dist inside plans 2 and 3. Only the final integration step rebuilds dist, after all merges. Plan 4 also does not rebuild; the controller does.
- Tests that call `createServer` must use a fake runtime. Build it as `{} as Runtime` plus only the fields the test needs. Do not depend on other plans' fields.

## Cross-plan interfaces (code against these; do not import across plans)
- Skills are Markdown and call MCP tools by **name**, as listed in the spec's "MCP tools" table. A skill in one plan may refer to a tool from another plan by name, e.g. the `report` skill calls `project_get`, `tld_info` and `registrar_quote`, and `find-domain` calls `research`/`report` skills by name. There is no code import.
- TypeScript code in plan N must not import from another plan's owned folders. Shared code only: `server/src/{config,cache,http,limiter,fs,util,domain,sources}/**` from Plan 1. Read these; do not change their exported signatures.
- The tool result helpers `toolJson` and `toolError` are in `server/src/tools/result.ts`, and the tool registration pattern is in `server/src/tools/check-domains.ts`. Follow both.

## Plan 1 leftovers assigned
- Plan 2: before storing `DomainCheck` in projects, add a cache/store schema version. Plan 1's final review asked for this before `DomainCheck` changes. Version the store files (`schemaVersion: 1`).
- Plan 4:
  - Add MCP `annotations` (`readOnlyHint`, `openWorldHint`) to `check_domains` and to Plan 4's own tools. Plans 2 and 3 add annotations to their own tools.
  - Add a plugin icon if `claude plugin validate` supports one.
  - Add startup error handling in `server/src/index.ts`: a clean stderr message and `process.exit(1)`. Plan 4 owns `index.ts`.
  - Rewrite the README fully.

## Global constraints (all plans)
- Node 20+, TypeScript strict, ESM with `.js` relative imports.
- Biome for lint and format (`pnpm check`, `pnpm format` in `server/`). Never use ESLint or Prettier, and never run bare `pnpm lint`.
- Write all code comments in English.
- Vitest. Unit tests use fakes, with no network access. Live tests go under `server/test/live/` and are gated by `LIVE=1`.
- Honesty rules from the spec: never claim "available" without a tool result; label every price with its source and date; never mix currencies.
- API keys come from env vars only. Never print, log or store them.
- Never scrape pages that block bots. Use only official APIs or documented open endpoints.
- Per-host rate limit through the shared `HostLimiter`. Cache through the shared `DiskCache`, with the TTLs the spec gives.
