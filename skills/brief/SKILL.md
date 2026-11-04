---
name: brief
description: Use when the user wants to start, fill in, or edit the naming brief of a brand project, hands over a filled brief template, wants to change a brief or its rulesets, wants a custom naming ruleset, or asks to run only the brief step on its own. For a general request to find a name or domain, use find-domain instead. Fills the fixed 7-section questionnaire, picks 1-3 naming rulesets, confirms with the user, and saves the project.
---

# Brief

The brief is the subject matter of the brand. Every later step (`generate`, `research`, `language-check`, `report`) reads it, so it comes from a fixed questionnaire and is saved only after the user confirms it.

## Tools

- `ruleset_list`, `ruleset_get`, `ruleset_save`: rulesets to pick from, and custom rulesets.
- `project_create`: save a new project from a confirmed brief.
- `project_list`, `project_get`, `project_update_brief`: find an existing project and save a new version of its brief.

## Rules

- Ask one question at a time. Offer multiple-choice options when the field has fixed values.
- Never invent answers to required questions. Take them from what the user gave you, or ask.
- Do not save before the user confirms the summary.
- No emoji and no urgency copy.

## Step 1: Pick the input path

- The user gave a file path (usually a filled copy of `templates/brief.md` from this skill's folder): read it and go to Step 3.
- The user pasted a description of the product: go to Step 3.
- Otherwise run the interview in Step 2. If the user would rather fill a file, give them the path of `templates/brief.md` in this skill's folder and wait for it.
- The user wants to change an existing project's brief: call `project_list`, let them pick, call `project_get`, and use `project.brief.data` as the starting answers. Ask what to change, then go to Step 5.

## Step 2: Interview

Ask in this order. R = required, O = optional. Tell the user they can skip optional questions.

### 1. Subject
1. R `subject.what`: What is it, in one sentence?
2. R `subject.category`: What category or industry is it in?
3. R `subject.problem`: What problem does it solve, and for whom?
4. O `subject.features`: Key features or offer?
5. O `subject.keywords`: Descriptive keywords? Offer 5-8 keywords from the earlier answers to accept or edit.

### 2. Audience and markets
6. R `audience.who`: Who buys or uses it?
7. R `audience.segment`: Options: B2B (`b2b`), B2C (`b2c`), both (`both`).
8. R `audience.countries`: Which countries? Store ISO 3166-1 alpha-2 codes in uppercase (`DE`, `US`, `GB`).
9. R `audience.languages`: Which languages? Store BCP 47 codes (`en`, `de`, `pt-BR`). Suggest the main languages of the chosen countries.

### 3. Positioning
10. O `positioning.competitors`: 3-5 competitors, by name or URL (store at most 5).
11. O `positioning.difference`: What makes it different?
12. R `positioning.priceTier`: Options: budget, mid, premium.

### 4. Personality
13. R `personality.tone`: Three words for the tone, exactly three. Offer two or three sets that fit the earlier answers.
14. O `personality.archetype`: Options: Sage, Hero, Creator, Explorer, Outlaw, Magician, Lover, Jester, Everyman, Caregiver, Ruler, Innocent. Store it in lowercase.
15. O `personality.avoid`: Words or feelings to avoid.

### 5. Name rules
16. R `nameRules.rulesets`: Pick 1-3 rulesets. See Step 4.
17. O `nameRules.overrides`: For this project only: `minLength`, `maxLength`, words to `include`, words to `ban`, `extraTlds` (lowercase, no dot: `app`, `co.uk`).
18. O `nameRules.handles`: Which social handles matter? Options: github, npm, pypi, reddit, x, instagram, tiktok, youtube, linkedin.

### 6. Future
19. O `future.scope`: Will the brand grow past this product? Options: broad name (`broad`), narrow name (`narrow`).

### 7. Mode
20. R `mode.type`: Options: startup (`startup`), personal brand (`personal`), product (`product`).
21. Personal brand only, all required: `mode.fullName` (full name), `mode.profession` (profession), `mode.nameForms` (accepted name forms, for example "Jane Doe", "J. Doe", "Jane Doe Design").

If the first message already suggests a personal brand, ask question 20 right after question 1 so the later questions fit.

## Step 3: Template or free text

- Template: each question in the file has a `<!-- field.path -->` marker and an `Answer:` line. Map every non-empty answer to its field. Convert country names to ISO codes and language names to BCP 47 codes. Split comma-separated lists.
- Free text: fill every field the text supports. Leave out fields the text does not support; do not guess them.
- Then ask only for the required fields that are still missing, one at a time, as in Step 2. Offer the remaining optional questions in one message the user can skip.

## Step 4: Pick rulesets

Call `ruleset_list`. Suggest 1-3 rulesets with one line each on why. Starting points:

| Brief signal | Suggest |
|---|---|
| `mode.type` is `personal` | `personal` |
| Developer audience: CLI, API, library, open-source tool | `dev-tool` |
| Local service in one place | `local-business` |
| `priceTier` premium, or a short exact `.com` is the goal | `premium` |
| `priceTier` budget, or the lowest renewal cost matters most | `budget` |
| Plain names that say what it does | `descriptive` |
| A distinctive brand, open to new words | `coined`, `evocative`, `compound` |

Custom rulesets are in the same list with `builtin: false`. Suggest them when they fit.

If the user wants a custom ruleset:
1. Copy: call `ruleset_get` on a built-in, change what the user asks (length, styles, TLD order, `.com` policy, affixes, weights), give it a new lowercase id that is not a built-in id, and save it with `ruleset_save`.
2. From scratch: ask for `name`, `description`, 3-5 `examples`, `styles` with weights (descriptive, compound, invented, metaphor, misspelling, affix, person-name, place-service), `length` min and max, `filters` (hyphens, numbers, banned letter pairs, banned words), `tlds` (`order`, `countryFirst`, `com` as must, nice, or none, and `affixes` such as `get-` or `-hq`), and `weights` from 0 to 1 for length, say, spell, meaning, uniqueness, and price. Save it with `ruleset_save`.
3. If `ruleset_save` returns an error, explain it in plain words, fix the field with the user, and save again.

## Step 5: Confirm and save

1. Show the brief as a short summary grouped by the 7 sections, with the chosen rulesets. Show skipped optional fields as "not given".
2. Ask the user to confirm or correct it. If anything changes, show the summary again.
3. On confirmation:
   - New project: call `project_create` with the brief and a short `title` (the working name, or the product in 2-4 words).
   - Existing project: call `project_update_brief`. Tell the user this saves brief version N and that existing names keep the version they were made with.
4. If the tool returns an error, explain it in plain words, ask for the missing or wrong field, and call the tool again.
5. Tell the user the project slug and the next step, `generate`. When `find-domain` invoked this skill, it continues on its own.

## Brief shape

`project_create` and `project_update_brief` take this shape. Optional fields may be left out.

```json
{
  "subject": { "what": "...", "category": "...", "problem": "...", "features": ["..."], "keywords": ["..."] },
  "audience": { "who": "...", "segment": "b2c", "countries": ["DE"], "languages": ["de", "en"] },
  "positioning": { "competitors": ["..."], "difference": "...", "priceTier": "mid" },
  "personality": { "tone": ["warm", "practical", "playful"], "archetype": "caregiver", "avoid": ["..."] },
  "nameRules": {
    "rulesets": ["coined", "compound"],
    "overrides": { "minLength": 4, "maxLength": 10, "include": ["..."], "ban": ["..."], "extraTlds": ["app"] },
    "handles": ["instagram"]
  },
  "future": { "scope": "broad" },
  "mode": { "type": "startup" }
}
```

For a personal brand, `mode` is `{ "type": "personal", "fullName": "...", "profession": "...", "nameForms": ["..."] }`.
