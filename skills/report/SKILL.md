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
6. **Get quotes.** Call `registrar_quote` with the domains from step 4, in batches of at most 20. If the result has `mode: "live"`, a live `availability` of `unavailable` overrides the stored check: move that domain to "Not available or unknown" and cite the registrar API and its `checkedAt`. A live `availability` of `unknown` never changes the stored check: keep the domain where it is and show the `reason`. If a registrar entry has a `reason`, show it.
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
- A registrar with `sale: "unverified"` has a table row without a verified price: write "unverified" and keep its label.
- A registrar with `sale: "not_sold"` does not sell the TLD: write "not sold". With `sale: "not_listed"`, write "not listed by <source> on <date>" using the entry's `source` and `checkedAt`; this is not proof that the registrar does not sell it. With `sale: "not_in_table"`, write "unknown — not in the bundled table".
- Never add up or compare prices in different currencies, and never convert a currency.
- A premium name (`premium: true`) never gets the standard table price. Show the live premium price if there is one, otherwise "unknown".
- No emoji. No urgency copy ("act now", "before it's gone", "only today"). No claims about popularity or demand.
- Copy the `notes` from `registrar_quote` into the report's "Sources and limits" section.
- End the report with the limits of the free sources (see the template).
