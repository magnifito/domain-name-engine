---
name: language-check
description: Use when shortlisted brand names in a domain-name-engine project need a review of meaning and pronunciation in the brief's target languages, before a name is chosen. Runs inside find-domain or alone against an existing project.
---

# Language check

Review each shortlisted name in each target language of the brief and save the notes. This is your own language judgment. No MCP tool checks language, and you do not search the web for it.

## Inputs

1. If the user did not name a project, call `project_list` and ask which one.
2. Call `project_get` with the project's `slug`. Read `project.shortlist` (labels) and find each label's `name` in `project.names[]`. Read the target languages from `project.brief.data.audience.languages` (BCP 47 codes such as `en`, `de`, `pt-BR`) and the target countries from `audience.countries`. Always include English (`en`) as well, because domains and app stores are read in English.

## For each name and each language

Check these points and write one short line each:

1. **Meaning.** Is the name, or a clear part of it, a word in this language? What does it mean?
2. **Bad associations.** Is it close to a vulgar, offensive, slang, medical, political, or religious word? Is it close to a well-known brand?
3. **Pronunciation.** How would a native speaker read it aloud on first sight? Give a simple respelling, for example "ZEN-tee". Note if stress or vowels are unclear.
4. **Spelling from hearing.** If a native speaker hears it, would they spell it the same way? Note letters that sound alike in this language (for example c/k, ph/f, i/y).
5. **Script and characters.** Does it work in the market's script? Note letters that do not exist in the language or need accents.

Then give a risk level for the name in that language. The level is one of exactly three values, the same values the store accepts as `severity`:

- `low`: no issues found, or only a minor pronunciation or spelling issue;
- `medium`: an unclear meaning or a weak bad association;
- `high`: a clear offensive or negative meaning, or a strong clash with a known brand.

## Limits to state

- Say once, at the top of the summary: "This is an AI language review, not a native-speaker check. Ask a native speaker before you commit to a name in a high-stakes market."
- If you are not sure about a language, write "not sure" for that point. Do not invent meanings. Low-resource languages and regional slang are where you are most likely to miss something.

## Save and summarize

1. Call `project_add_notes` with the project `slug` and one note per name and language: `{ "name": "<shortlisted name>", "kind": "language", "language": "<BCP 47 code>", "severity": "<low|medium|high>", "text": "<the five lines above>" }`. Always pass `kind: "language"` and set `severity` to the risk level; never leave it out. Keep `text` under 2000 characters.
2. Show the user a table with one row per name and one column per language, where each cell is the risk level plus a few words. Below the table, list every `medium` and `high` finding in full.
3. No emoji and no urgency copy.
