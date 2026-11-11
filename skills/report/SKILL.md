---
name: report
description: Use when a naming project needs a final recommendation, shortlist ranking, or registrar comparison. Compares worthy names and dated domain evidence directly in chat; writes a report file only when requested.
---

# Report

Compare the project's worthy finalists directly in chat. The agent judges brand fit; the tools establish domain evidence. A report file is an optional export, not a completion requirement.

## Tools

- `project_get({ slug })`: the project (brief, names, checks, notes, shortlist) and `paths.reportFile`.
- `tld_info({ tld })`: which registrars sell a TLD, table prices per registrar, and the reputation note.
- `registrar_quote({ domains })`: per-registrar prices for exact domains, at most 20 per call. With registrar keys set it also returns live availability and the premium flag.
- `registrar_status({})`: optional, to tell the user which registrar keys are set.

## Steps

1. **Find the project.** Use the slug the user or `find-domain` gave. If there is none, ask which project to report on. Call `project_get`. If it returns `recoveredFromBackup: true`, say so at the top of the report.
2. **Check the inputs.** The shortlist must not be empty. If it is, stop and tell the user to pick a shortlist first (the `generate` skill does this). If a shortlisted name has no domain checks, say that `research` has not run for it, and keep going with the names that have checks.
3. **Apply the editorial and domain gates.** Read the current brief, feedback, editorial notes, and `nameRules.domainPolicy`. Exclude rejected or weak names even if their domains pass. Apply the allowed TLDs and affix policy from `../generate/references/tlds.md` to existing checks, including old projects. Registered-domain options require `includeRegistered: true`; otherwise keep them out of the answer. Unknown domains do not pass. If nothing worthwhile survives, say so and ask one useful calibration question instead of manufacturing a ranking.
   Compare eligible names by natural association, sound/spelling, memorability, category distinctiveness, credibility, emotional fit, and research risks. Explain head-to-head tradeoffs and preserve variety among similarly good names. Scores use different ruleset weights and are not directly comparable across rulesets. A name with a null or missing `score` sorts last only as a tie-break within the same ruleset; it is not automatically a worse brand. Availability is an eligibility filter, never a quality bonus.
4. **Collect the domains to price.** Take only policy-compliant domains of editorial survivors with stored `likely_available` evidence. Keep registered and unknown domains out of the recommendation and price tables. If the user explicitly wants aftermarket options, present them separately only with concrete offer evidence; a parked site or generic registrar quote is not an aftermarket offer.
5. **Get TLD facts.** Call `tld_info` once per distinct TLD in that list.
6. **Get quotes before final ranking.** Call `registrar_quote` in batches of at most 20. A live `availability` of `unavailable` disqualifies that registrar offer and must be disclosed for an otherwise recommended domain. Conflicting live results require resolution before calling a domain purchase-confirmed; if none confirms availability and any live result rejects it, omit the domain from recommendations. A live `availability` of `unknown` never changes the stored check: it also never confirms purchase availability. Table-only quotes do not confirm availability. Only a live `available` result supports "registrar-confirmed purchase availability", with the registrar and original `checkedAt`. Preserve premium flags and reasons. Save quote evidence with `project_add_notes`, kind `registrar`, including domain, registrar, mode, availability, source/price label, and `checkedAt`; do not put registrar responses into domain-check records. Re-rank after exclusions; if none survive, return the no-fit outcome.
7. **Present in chat.** Lead with up to six worthy names and exact domains. For each give the territory/association, why someone would want the brand, main weakness, and dated domain evidence. Compare the meaningful tradeoffs; do not inflate a weak survivor. Show a compact price comparison only when useful or requested, following the honesty rules below. State any incomplete trademark, language, or competitor checks.
8. **Optional file export.** Only if the user requested a file, follow `references/report-template.md` and write to `paths.reportFile`, replacing the earlier export. Still give the substantive recommendation in chat, not just a link. No automatic HTML or visual review surface.

## Evidence to use (expand only when useful or requested)

When finalists are otherwise similarly strong, prefer the one with evidenced lower search confusion: fewer relevant brand collisions, less autocorrection friction, and clearer separation from adjacent products. Explain that specific tie-break. Unknown search evidence earns no advantage; common-word results alone earn no penalty. Serious confusion can disqualify a name, but keyword volume, category demand, and speculative SEO traffic do not add brand-quality points. Do not introduce numerical SEO weights or claim the name will rank.

- **Ruleset behind each name**: the name's `rulesetId`, plus its `strategy` and `rationale` when present.
- **Per likely-available domain**: one row per registrar from `registrar_quote`: whether the registrar sells the TLD, first-year price, renewal price, and 3-year total, side by side, with the currency and the price label.
- **Cheapest 3-year option**: from `cheapestThreeYear`, one line per currency. Never pick a single winner across currencies.
- **TLD reputation**: the `reputation` level and `reputationNote` from `tld_info`, with its source. For a TLD with reputation `mixed` or `poor`, add that it can hurt email delivery and visitor trust.
- **Language risks**: notes with `kind: "language"`, grouped by severity, `high` first, then `medium`, then `low`, with the language code.
- **Other checks**: handle and trademark results as stored, with their source and `checkedAt`. Competitor findings with their URL.
- **Search uncertainty**: read `search-evidence` notes as well as competitor results. An empty result set, autocorrected query, or missing search source is not evidence that the name is unused. Distinguish brand confusion from ordinary dictionary meanings; do not turn category demand or a lack of search hits into a brand-quality score.

## Honesty rules

- Say "likely available" only for a domain whose `check_domains` status is `likely_available`. A registry no-record signal is preliminary; a live registrar `available` result supports registrar-confirmed purchase availability at that timestamp. Never conflate these evidence levels or use a table price as availability evidence.
- Label every price with its origin, using the `priceLabel` from the tool result word for word:
  - table price: "reference price from <registrar>, checked <date> — verify at registrar"
  - live price: "live price from <registrar> API, <time>"
- Always show the first-year price and the renewal price side by side. A low first-year price often renews much higher, so never show the first-year price alone.
- A missing value is written as "unknown". Never estimate or fill in a price. A registrar entry with `priceSource: "none"` has no price: write "unknown" and keep its label.
- A registrar with `sale: "unverified"` has a table row without a verified price: write "unverified" and keep its label.
- A registrar with `sale: "not_sold"` does not sell the TLD: write "not sold". With `sale: "not_listed"`, write "not listed by <source> on <date>" using the entry's `source` and `checkedAt`; this is not proof that the registrar does not sell it. With `sale: "not_in_table"`, write "unknown — not in the bundled table".
- An entry with `priceSource: "live"` always has `sale: "listed"`: the registrar API returned a price, so show the live price and ignore any table sale status.
- Never add up or compare prices in different currencies, and never convert a currency.
- A premium name (`premium: true`) never gets the standard table price. Show the live premium price if there is one, otherwise "unknown".
- No emoji. No urgency copy ("act now", "before it's gone", "only today"). No claims about popularity or demand.
- Include material `notes` from `registrar_quote` in the answer; copy all into an optional file export.
- Briefly state the remaining uncertainty: registrar responses may be cached (retain `checkedAt`), purchase is not guaranteed until checkout, and domain availability is not trademark clearance. Use the fuller template limits only for requested exports.
