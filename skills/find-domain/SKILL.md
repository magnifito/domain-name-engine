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
| 3 | `research` | every shortlisted name has domain checks and trademark results; profile results only for its domains with status `registered`; handle results only when `nameRules.handles` in the brief is not empty |
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
