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
