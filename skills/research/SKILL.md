---
name: research
description: Use when a domain-name-engine project has a shortlist and needs full checks per name - domains across the chosen TLDs, profiles of taken domains, social handles, trademarks, and a competitor scan. Runs inside find-domain or alone against an existing project.
---

# Research a shortlist

Run full checks for every shortlisted name in one project and save the results. The domain-engine MCP server does the data work; you plan the calls, run the competitor scan, and summarize.

## Inputs

1. If the user did not name a project, call `project_list` and ask which one.
2. Call `project_get` with the project's `slug`. Read from `project`:
   - `shortlist` (labels). If it is empty, stop and ask the user to shortlist names first. Find each label's entry in `names[]` for its `name` and `rulesetId`.
   - from `brief.data`: `subject.category`, `audience.countries`, `audience.languages`, `positioning.competitors`, `nameRules.handles`, and `nameRules.overrides.extraTlds`.
3. Call `ruleset_get` once for each distinct `rulesetId`, and read its `tlds` (`com` and `order`).

## Steps

Run the steps in this order. If a tool returns an error, report it in one line, skip that step for that name, and continue with the next step. Never retry a tool more than once.

1. **Domains.** Call `check_domains` with each shortlisted name on `.com` (unless the ruleset's `com` is `none`), every TLD in its ruleset's `tlds.order`, and every TLD in `extraTlds`. Keep each call at 200 domains or fewer; split the call if needed.
2. **Taken-domain profiles.** For each shortlisted name, take the `.com` result and the result for the first TLD in its ruleset's `tlds.order`. For each of those that is `registered`, call `profile_domain`. The verdict tells you whether the owner uses it (`live_site`), parks it (`parked`), sells it (`for_sale`), or has no site (`no_site`).
3. **Handles.** Call `check_handles` with all shortlisted names. The `platforms` ids are lowercase and are the same ids as `nameRules.handles`: `github`, `npm`, `pypi`, `reddit`, `youtube`, `x`, `instagram`, `tiktok`, `linkedin`. Pass the brief's `nameRules.handles`, lowercased. If an entry is not one of these ids, leave it out of the call and tell the user it cannot be checked. If the brief lists no handles, omit `platforms` to check all of them.
4. **Trademarks.** Call `search_trademarks` once per name. Pass `niceClasses` only when you are confident which Nice classes cover `subject.category` (for example 9 and 42 for software); otherwise omit it.
5. **Competitor scan.** Use your built-in WebSearch, not the MCP server. For each name run:
   - `"<name>" <category>` and `"<name>" company`, to find businesses already using the name;
   - one search for the category in each target country, to find the main competitors and the domain patterns they use (for example `get<name>.com`, `<name>app.com`, `.io` instead of `.com`). Start from `positioning.competitors` when the brief lists any.
   Record each finding as one object: `{ "source": "websearch", "checkedAt": "<ISO 8601 time of the search>", "url": "<page URL>", "title": "<page or business name>", "finding": "<one line: same-name business, competitor, or domain pattern>" }`. Do not open pages that block automated clients.
6. **Save.** Call `project_add_checks` with the project `slug` and one `checks` entry per name and kind. Each entry is `{ "name": "<shortlisted name>", "kind": "<kind>", "results": [ ... ] }`:
   - kind `domain`: the `results` array of `check_domains` for that name's domains, exactly as returned;
   - kind `profile`: the `profile` object of each `profile_domain` call for that name, exactly as returned;
   - kind `handle`: the `results` items of `check_handles` whose `handle` is that name, exactly as returned;
   - kind `trademark`: the complete set of `search_trademarks` results for that name, exactly as returned;
   - kind `competitor`: the complete set of competitor findings for that name from step 5.

   The store replaces the whole earlier `trademark` batch and the whole earlier `competitor` batch of a name with each new batch. So always send every trademark result and every competitor finding for that name in one entry, never only the new ones. If a step found nothing for a name, send an empty `results` array only when you mean to clear the earlier batch.

## Summary for the user

Write one section per name:

- Domains: a table of TLD, status, and confidence. Say "likely available" only for `likely_available` results, and add once: "Premium and registry-reserved names are invisible to free sources; confirm at a registrar."
- Taken domains: the profile verdict, registrar, creation and expiry dates, and the title of the live site if there is one. A `for_sale` or `parked` domain may be buyable; say so without promising it.
- Handles: taken, likely available, and unknown platforms. For every `unknown` with method `manual`, give the profile URL so the user can check it by hand.
- Trademarks: the EUIPO status and the top matches with their status and Nice classes. Repeat the tool's note that `no_matches` is not a clearance. Give the search links for USPTO, EUIPO, TMview, and WIPO.
- Competitors: same-name businesses and competitor domain patterns, each with its URL.

## Honesty rules

- Never claim a domain or handle is available without a tool result. Use the tool's words: `likely_available`, `taken`, `registered`, `unknown`.
- Show `source`, `checkedAt`, and `confidence` for each check, or say where they are stored.
- An `unknown` stays unknown. Do not guess from other signals.
- No emoji and no urgency copy.
