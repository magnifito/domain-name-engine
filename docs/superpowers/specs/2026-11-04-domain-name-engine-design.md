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
| Availability source | Free only: RDAP, WHOIS port 43 fallback, DNS. No API keys |
| Research tools in v1 | Taken-domain profile, social handles, trademarks, competitor scan, language check |
| Persistence | Local JSON project store with on-disk cache |
| Audience | Public, distributed as a GitHub plugin marketplace |
| Architecture | MCP server owns data, cache, rate limits, and store; skills own reasoning and flow |

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
      store/             # JSON project store
      cache/             # TTL cache on disk
      limiter/           # per-host rate limit and retry
    test/
    dist/index.js        # single bundled file, committed to git
  docs/
  README.md
  LICENSE                # MIT
```

- The server ships as one bundled JS file committed to git. Users need Node 20+ and nothing else; no `npm install` at install time.
- Stack: TypeScript, `@modelcontextprotocol/sdk`, `zod`, Biome (lint and format), Vitest, tsdown for bundling, pnpm.
- Data lives in `~/.domain-engine/` (`projects/` and `cache/`). The env var `DOMAIN_ENGINE_HOME` overrides the location.
- Dependency rule: skills call tools; tools use sources, store, and cache; sources use only the limiter. Each source has one job and one typed interface: input name, output typed result.

## Skills and flow

| Skill | Input | Behavior | Tools used |
|---|---|---|---|
| `find-domain` | user idea | Entry point. Runs `brief`, `generate`, `research`, `language-check`, `report` in order. | all |
| `brief` | user idea | Asks about product, audience, tone, target markets, languages, preferred TLDs, and mode (startup, personal brand, product). Saves the brief. | `project_create` |
| `generate` | brief | Produces 30–60 names across strategies: descriptive, compound, invented, metaphor, misspelling, prefix/suffix. Scores each name on naming rules. Runs a quick `.com` and preferred-TLD filter. | `project_add_names`, `check_domains` |
| `research` | shortlist | Full checks per shortlisted name: domains across chosen TLDs, taken-domain profile, handles, trademarks. Competitor scan uses Claude's built-in WebSearch, including domain patterns used by competitors in the niche. | `check_domains`, `profile_domain`, `check_handles`, `search_trademarks`, `project_add_checks` |
| `language-check` | shortlist | LLM-only review of meaning and pronunciation in the brief's target languages. Saves notes. | `project_add_notes` |
| `report` | project | Ranks names and writes `report.md` into the project folder. Every claim cites its source and check time. | `project_get` |

Each skill also runs alone against an existing project.

### Naming rules (used by `generate` for scoring)

- Short: under 15 characters, shorter scores higher.
- Easy to say and easy to spell when heard.
- No hyphens, no numbers.
- Distinct from competitors found in research.
- Still makes sense if the product grows.

### Honesty rules for all skills

- Say "likely available" only after `check_domains` returns `likely_available`. Never claim availability without a tool result.
- Never state prices. v1 has no price data. The report shows "price unknown — check registrar" with registrar search links.
- No emoji, no urgency copy.

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
- Tool tests through the MCP SDK in-memory transport.
- Manual live smoke test, `pnpm test:live`: checks `google.com` (expects `registered`) and a random 30-letter `.com` (expects `likely_available`).
- One eval prompt per skill, run by hand before each release.

## Release

- GitHub Actions on push and PR: `biome ci .`, `tsc --noEmit`, `vitest run`, build, then fail if the committed `server/dist/index.js` differs from the fresh build.
- Install: `/plugin marketplace add magnifito/domain-name-engine`, then `/plugin install domain-name-engine`.
- README: install steps, skill guide, and the limits of free sources.
- License: MIT.

## Out of scope for v1

- Prices and premium flags (needs a registrar API key).
- Domain purchase.
- Logo and visual identity work.
