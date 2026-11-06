# Domain Name Engine

A plugin for Claude Code and OpenAI Codex that helps you find a brand name and a domain for it. The agent writes and judges the names. A bundled MCP server checks availability with RDAP, WHOIS, and DNS, researches taken domains, social handles, and trademarks, and compares registrar prices for Spaceship, Namecheap, and Cloudflare.

Everything runs on your machine. No account is needed. Registrar and research API keys are optional.

## Install

### Claude Code

```
/plugin marketplace add magnifito/domain-name-engine
/plugin install domain-name-engine@domain-name-engine
```

### OpenAI Codex

```sh
codex plugin marketplace add magnifito/domain-name-engine
codex plugin add domain-name-engine@domain-name-engine
```

Start a new Codex session after you install. Codex loads the six skills and the `domain-engine` MCP server. Run a skill by name, for example `$find-domain`, or just ask "help me name my startup". To update, run `codex plugin marketplace upgrade domain-name-engine`.

Both hosts need Node.js 20 or later. The server ships as one bundled file, so there is no `npm install` step.

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
| `registrar_status` | Which registrar and research keys are set, and where the key file is. Never returns key values. |
| `keys_setup` | Creates the private key file from a template and returns its path. Never reads or returns key values. |

## Optional API keys

All keys are optional. Pick one place for them:

- **Claude Code:** paste them into the plugin settings form that appears when you enable the plugin, or later under `/plugin`. Claude Code keeps secret fields in the system credential store. This is the most secure option.
- **Codex, or any host, on macOS, Linux, or Windows:** ask the agent to "set up my API keys". The `keys_setup` tool creates `~/.domain-engine/keys.env` (readable by you only) and lists every key name. Open it in a text editor, paste your keys after the `=` signs, and save. No restart needed.
- **Environment variables** with the names below also work.

Keys never appear in tool output, logs, the cache, or project files. Never paste a key into the chat. Ask the agent to run `registrar_status` to see which keys the server found.

For step-by-step instructions on getting each key, see [docs/api-keys.md](docs/api-keys.md).

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

Without keys, Spaceship and Namecheap have no bundled price for common TLDs such as .com, .de, and .uk. Run `pnpm refresh:tlds` with keys set, or set the registrar keys for live quotes.

The engine never scrapes registrar web pages. Spaceship and Namecheap price pages block automated clients, so the table is filled only from official APIs and documented public files.

## Data and privacy

- Projects, custom rulesets, the cache, and the optional `keys.env` key file live in `~/.domain-engine/`. Set `DOMAIN_ENGINE_HOME` to use another folder.
- Reports are written to `~/.domain-engine/projects/<slug>/report.md`.
- The server sends requests to RDAP and WHOIS servers, DNS resolvers, the research APIs, and the registrar APIs whose keys you set. Requests carry a generic `User-Agent` with the plugin name and repository URL, and no personal data.
- Requests are rate limited per host, 1 request per second by default, with retries on HTTP 429 and 5xx for RDAP and registrar HTTP requests only. The homepage fetch and WHOIS make one try.

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
7. Bump `version` in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` (keep them equal), tag the release, and push.

## License

MIT. See [LICENSE](LICENSE).
