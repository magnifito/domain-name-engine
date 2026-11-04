# Domain Name Engine — Design

Date: 2026-11-04
Status: approved design, pending implementation plan

## Purpose

A public Claude Code plugin that helps a user find a strong brand name and domain. Claude is the LLM: it runs the brief, generates names, and judges language fit. A bundled MCP server does the data work: domain availability, taken-domain profiles, social handle checks, and trademark searches. Results persist in a local project store so a domain hunt can run over many rounds.

## Decisions

| Topic | Decision |
|---|---|
| Form | Claude Code plugin: skills plus a bundled MCP server |
| Server language | TypeScript, Node 20+ |
| Availability source | Free by default: RDAP, WHOIS port 43 fallback, DNS. No API keys needed |
| Registrars | Spaceship (main), Namecheap, Cloudflare. Optional API keys enable live prices and premium flags |
| Research tools in v1 | Taken-domain profile, social handles, trademarks, competitor scan, language check |
| Persistence | Local JSON project store with on-disk cache |
| Audience | Public, distributed as a GitHub plugin marketplace |
| Architecture | MCP server owns data, cache, rate limits, and store; skills own reasoning and flow |
| Brief | Fixed questionnaire with a validated schema; three input paths (interview, template file, free text) |
| Name rules | Reusable rulesets: 9 built-in presets plus user-defined custom rulesets |
| Prices | Bundled, dated registrar TLD table (first-year and renewal per registrar); live prices only when the user sets registrar API keys |

## Architecture and layout

```
domain-name-engine/
  .claude-plugin/
    plugin.json          # plugin manifest
    marketplace.json     # enables `/plugin marketplace add magnifito/domain-name-engine`
  .mcp.json              # starts server: node ${CLAUDE_PLUGIN_ROOT}/server/dist/index.js
  skills/
    find-domain/         # entry skill, runs the full flow
    brief/
      templates/brief.md # fill-in brief template
    generate/
      references/tlds.md # TLD guide
    research/
    language-check/
    report/
  server/
    src/
      index.ts           # MCP server entry, registers tools
      tools/             # one file per MCP tool
      sources/           # rdap.ts, whois.ts, dns.ts, http-profile.ts, handles.ts, uspto.ts, euipo.ts
      registrars/        # spaceship.ts, namecheap.ts, cloudflare.ts (optional live APIs)
      store/             # JSON project store
      cache/             # TTL cache on disk
      limiter/           # per-host rate limit and retry
    scripts/
      refresh-registrar-tlds.ts # maintainer script that rebuilds registrar-tlds.json
    test/
    data/
      rulesets/          # built-in rulesets, one JSON file each
      registrar-tlds.json # per-registrar TLD support and reference prices
      tld-reputation.json # TLD reputation notes
    dist/index.js        # single bundled file, committed to git
  docs/
  README.md
  LICENSE                # MIT
```

- The server ships as one bundled JS file committed to git. Users need Node 20+ and nothing else; no `npm install` at install time.
- Stack: TypeScript, `@modelcontextprotocol/sdk`, `zod`, Biome (lint and format), Vitest, tsdown for bundling, pnpm.
- Data lives in `~/.domain-engine/` (`projects/`, `rulesets/`, and `cache/`). The env var `DOMAIN_ENGINE_HOME` overrides the location.
- Dependency rule: skills call tools; tools use sources, store, and cache; sources use only the limiter. Each source has one job and one typed interface: input name, output typed result.

## Skills and flow

| Skill | Input | Behavior | Tools used |
|---|---|---|---|
| `find-domain` | user idea | Entry point. Runs `brief`, `generate`, `research`, `language-check`, `report` in order. | all |
| `brief` | user idea, template file, or free text | Fills the brief questionnaire (see Brief). Picks 1–3 rulesets. Shows a summary for confirmation, then saves. | `ruleset_list`, `project_create` |
| `generate` | brief + rulesets | Produces 30–60 names, split across the chosen rulesets. Applies each ruleset's filters and score weights. Runs a quick availability filter on each ruleset's first TLDs. | `ruleset_get`, `project_add_names`, `check_domains` |
| `research` | shortlist | Full checks per shortlisted name: domains across chosen TLDs, taken-domain profile, handles, trademarks. Competitor scan uses Claude's built-in WebSearch, including domain patterns used by competitors in the niche. | `check_domains`, `profile_domain`, `check_handles`, `search_trademarks`, `project_add_checks` |
| `language-check` | shortlist | LLM-only review of meaning and pronunciation in the brief's target languages. Saves notes. | `project_add_notes` |
| `report` | project | Ranks names and writes `report.md` into the project folder. Shows the ruleset behind each name; for each likely-available domain, which registrars sell the TLD, first-year and renewal price per registrar, the cheapest 3-year option, and TLD reputation notes. Every claim cites its source and check time. | `project_get`, `tld_info`, `registrar_quote` |

Each skill also runs alone against an existing project.

### Honesty rules for all skills

- Say "likely available" only after `check_domains` returns `likely_available`. Never claim availability without a tool result.
- Label every price with its origin. Table prices: "reference price from <registrar>, checked <date> — verify at registrar". Live prices: "live price from <registrar> API, <time>". Always show first-year and renewal side by side. A missing value shows as "unknown". Never mix currencies in one total; convert nothing.
- No emoji, no urgency copy.

## Brief

The brief is the subject matter of the brand. It is the main input for every later step, so it has a fixed questionnaire and a `zod` schema. `project_create` rejects a brief with missing required fields.

### Input paths

All three fill the same schema.

1. Interview: `brief` asks one question at a time, with multiple-choice options where possible.
2. Template file: the user fills `skills/brief/templates/brief.md` and passes its path.
3. Free text: the user pastes a description; the skill extracts fields and asks only for missing required fields.

The skill ends with a summary of the brief; the user confirms before save.

### Questionnaire

R = required, O = optional.

1. Subject
   - R: What it is, in one sentence.
   - R: Category or industry.
   - R: Problem it solves, and for whom.
   - O: Key features or offer; descriptive keywords.
2. Audience and markets
   - R: Who buys or uses it; B2B, B2C, or both.
   - R: Target countries and target languages.
3. Positioning
   - O: 3–5 competitors (name or URL).
   - O: What makes it different.
   - R: Price tier: budget, mid, or premium.
4. Personality
   - R: Three words for the tone.
   - O: Brand archetype from a fixed list (Sage, Hero, Creator, Explorer, Outlaw, Magician, Lover, Jester, Everyman, Caregiver, Ruler, Innocent).
   - O: Words or feelings to avoid.
5. Name rules
   - R: Pick 1–3 rulesets (see Rulesets).
   - O: Per-project overrides, for example max length, words to include, words to ban, extra TLDs.
   - O: Which social handles matter.
6. Future
   - O: Will the brand grow past this product (broad name vs narrow name).
7. Mode
   - R: Startup, personal brand, or product.
   - Personal brand adds: full name, profession, and accepted name forms.

### How `generate` uses the brief

- Keywords, category, and competitors seed the word lists.
- Tone and archetype steer word choice and sound.
- Rulesets set the style mix, filters, TLD order, and scoring.
- Overrides apply on top of the rulesets for this project only.
- The brief is versioned. Each name records the brief version and ruleset it came from. Editing the brief creates a new version.

## Rulesets

A ruleset is a named, reusable set of name rules. Any project can use any ruleset.

### Ruleset schema

- `id`, `name`, `description`, 3–5 example names.
- `styles`: name styles with weights (descriptive, compound, invented, metaphor, misspelling, prefix/suffix, person name, place + service).
- `length`: min and max characters.
- `filters`: hyphens allowed, numbers allowed, banned letter pairs, banned words.
- `tlds`: ordered TLD list; `.com` policy `must`, `nice`, or `none`; allowed `.com` fallback affixes (for example `get-`, `try-`, `-hq`, `-app`).
- `weights`: score weights for length, ease of saying, ease of spelling, meaning fit, uniqueness, and price (renewal).

### Built-in rulesets

Shipped in `server/data/rulesets/`, read-only.

| Id | Summary |
|---|---|
| `coined` | Invented word, 4–8 letters, alternative TLDs fine |
| `descriptive` | Says what it does, 8–15 letters, `.com` with affix fallback |
| `compound` | Two real words joined, 6–12 letters |
| `evocative` | One real word with meaning by association; `.com` nice |
| `premium` | Short, Latin/Greek roots, easy to say; `.com` must |
| `dev-tool` | Lowercase, easy to type; `.dev`, `.sh`, `.io` first |
| `personal` | Forms of the person's name (first, first+last, initials+role) |
| `local-business` | Place + service; country TLD first |
| `budget` | Any style, 4–15 letters; TLDs `.sbs`, `.site`, `.online`, `.store`, `.space`, `.lol`, `.bond`, `.xyz`; strong weight on low renewal price |

### Custom rulesets

- Created by copying a built-in and editing it, or from scratch through an interview in `brief`.
- Stored in `~/.domain-engine/rulesets/<id>.json`. Custom ids cannot shadow built-in ids.
- Validated with the same `zod` schema.

## Registrars and TLD table

### Registrars

| Registrar | Role | TLD list and prices in the bundled table | Live API (optional) |
|---|---|---|---|
| Spaceship | Main registrar | Official API `GET /v1/tlds` and TLD pricing endpoints | Same API; env `SPACESHIP_API_KEY`, `SPACESHIP_API_SECRET` (`domains:read`) |
| Namecheap | Second registrar | Official API `namecheap.domains.getTldList` and `namecheap.users.getPricing` | Same API; env `NAMECHEAP_API_USER`, `NAMECHEAP_API_KEY`, `NAMECHEAP_CLIENT_IP` (IP must be allow-listed) |
| Cloudflare | Third registrar, at-cost pricing | Public third-party file `https://cfdomainpricing.com/prices.json` (430 TLDs, no key) | Cloudflare Registrar API (beta); env `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

Registrar price pages for Spaceship and Namecheap block automated clients (Cloudflare bot check, HTTP 403). The engine never scrapes them or tries to bypass the check. It uses only official APIs and public files.

All keys are optional and read from environment variables only. Keys never appear in tool output, logs, the cache, or project files.

### Bundled table

`server/data/registrar-tlds.json`, one row per `registrar × tld`:

- `registrar`, `tld`, `firstYear`, `renewal`, `transfer`, `currency`, `source`, `checkedAt`.
- A TLD missing for a registrar means that registrar does not sell it.

`server/data/tld-reputation.json`, one row per TLD: `tld`, `reputation` (`good`, `mixed`, `poor`), `reputationNote`.

The maintainer script `server/scripts/refresh-registrar-tlds.ts` rebuilds the table: Cloudflare from the public file, Spaceship and Namecheap from their APIs using the maintainer's keys. It writes `checkedAt` per row and prints a diff. CI does not run it; it needs keys and network.

Seed facts known on 2026-11-04:

- Spaceship first-year prices given by the user from spaceship.com (EUR): `.sbs` 0.86, `.site` 1.05, `.online` 1.05, `.store` 1.05, `.space` 1.05, `.lol` 1.10, `.bond` 1.28, `.xyz` 1.83. The first refresh with API keys replaces these and adds renewal prices.
- Cloudflare public file: `.sbs` and `.bond` are not sold. Low first-year prices often renew far higher, for example `.store` USD 4.99 first year and 42.20 renewal, `.site` and `.online` USD 4.99 and 27.70.

### Live mode

When a registrar's keys are set, `registrar_quote` asks that registrar's API about the exact domain: availability, premium flag, and price. Live results override table prices in the report and are cached for 1 hour. Without keys, `registrar_quote` returns table prices only. Registrar API calls go through the limiter (Spaceship pricing: 25 requests per 5 seconds).

### What the report shows for low-cost TLDs

- First-year price, renewal price, and 3-year total per registrar.
- The TLD reputation note, because several low-cost TLDs are flagged by spam filters and security tools, which hurts email delivery and trust.

## MCP tools

| Tool | Purpose |
|---|---|
| `check_domains` | Availability for a list of `label × TLD` pairs |
| `profile_domain` | Profile of a registered domain |
| `check_handles` | Handle availability across platforms |
| `search_trademarks` | Similar marks in USPTO and EUIPO |
| `project_create` | Create a project from a brief |
| `project_list` | List projects |
| `project_get` | Read a full project |
| `project_add_names` | Add generated names with strategy and score |
| `project_add_checks` | Attach check results to names |
| `project_add_notes` | Attach notes (for example, language check) to names |
| `project_shortlist` | Set or change the shortlist |
| `ruleset_list` | List built-in and custom rulesets |
| `ruleset_get` | Read one ruleset |
| `ruleset_save` | Create or update a custom ruleset |
| `ruleset_delete` | Delete a custom ruleset |
| `tld_info` | For one TLD: registrars that sell it, table prices per registrar, reputation |
| `registrar_quote` | For exact domains: per-registrar price, plus live availability and premium flag when keys are set |
| `registrar_status` | Which registrars have keys configured (never returns key values) |

Check tools read and write the cache. Every result carries `source`, `checkedAt`, and `confidence` (`high`, `medium`, `low`).

## Data sources

### Domain availability (`check_domains`)

1. RDAP. Load the IANA bootstrap file `https://data.iana.org/rdap/dns.json` (cached 1 day) to map the TLD to its RDAP server. HTTP 200 means registered. HTTP 404 means not found.
2. WHOIS fallback. If the TLD has no RDAP server, query `whois.iana.org` on port 43 for the TLD's WHOIS server, then query that server. Parse "no match" patterns per server.
3. DNS NS lookup as a second signal.

Result status: `registered`, `likely_available`, or `unknown`. Never a plain "available": free sources cannot see premium or registry-reserved names. The report states this limit.

### Taken-domain profile (`profile_domain`)

- From RDAP or WHOIS: creation date, expiry date, registrar, nameservers.
- Nameservers matched against a parking provider list (Sedo, Bodis, Afternic, Dan, and others) mark the domain as parked.
- HTTP GET of the homepage: status code, `<title>`, "for sale" keywords.
- Result: `live_site`, `parked`, `for_sale`, or `no_site`, plus the raw fields.

### Social handles (`check_handles`)

- High-confidence: GitHub (REST API), npm, PyPI, Reddit.
- Low-confidence: X, Instagram, TikTok, YouTube, LinkedIn. These block automated clients. Result is often `unknown` with a profile URL for a manual check.

### Trademarks (`search_trademarks`)

- USPTO and EUIPO public search endpoints. These are not stable public APIs.
- On failure or schema change, return `unknown` with direct search links for USPTO, EUIPO, and the WIPO Global Brand Database. Never block the run.

### Competitor scan

- Performed by the `research` skill with Claude's built-in WebSearch, not by the server. Free search APIs need keys.

## Store and cache

- Project file: `~/.domain-engine/projects/<slug>/project.json` with `brief`, `names[]` (name, strategy, score, notes), `checks` keyed by name, and `shortlist`.
- Report file: `~/.domain-engine/projects/<slug>/report.md`.
- Writes are atomic (write temp file, rename) and keep `project.json.bak` from the previous write. On a parse failure the store reads the backup and reports it.
- Cache TTLs: `registered` 7 days, `likely_available` 1 hour, `unknown` not cached, handles 1 day, trademarks 7 days, RDAP bootstrap 1 day.

## Rate limits

- Per-host limiter, default 1 request per second, configurable.
- Retry with exponential backoff on HTTP 429 and 5xx, max 3 tries, honoring `Retry-After`.
- Requests send a generic `User-Agent` naming the plugin and its repo URL. No personal contact data.

## Error handling

- A failing source returns `unknown` with a reason. The run continues.
- Network failure returns a clear tool error. Skills report it and stop only the check step.
- Invalid input (bad label, unknown TLD) is rejected by `zod` with a plain message.
- Each HTTP request has an 8 second timeout.

## Testing

- Vitest unit tests per source using recorded HTTP fixtures. No live network in CI.
- Tests for store (atomic write, backup recovery), cache TTL, limiter, and RDAP/WHOIS parsing.
- Registrar client tests with recorded API fixtures; a test that keys never appear in errors or output.
- Schema tests: every built-in ruleset, every `registrar-tlds.json` row, and every `tld-reputation.json` row validate; brief schema accepts the filled template and rejects missing required fields.
- Tool tests through the MCP SDK in-memory transport.
- Manual live smoke test, `pnpm test:live`: checks `google.com` (expects `registered`) and a random 30-letter `.com` (expects `likely_available`).
- One eval prompt per skill, run by hand before each release.

## Release

- GitHub Actions on push and PR: `biome ci .`, `tsc --noEmit`, `vitest run`, build, then fail if the committed `server/dist/index.js` differs from the fresh build.
- Install: `/plugin marketplace add magnifito/domain-name-engine`, then `/plugin install domain-name-engine`.
- README: install steps, skill guide, and the limits of free sources.
- License: MIT.

## Out of scope for v1

- Live prices and premium flags for users without registrar keys.
- Registering domains through registrar APIs.
- Logo and visual identity work.
