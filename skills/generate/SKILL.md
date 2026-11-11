---
name: generate
description: Use when a saved naming project needs new or better candidates. Explores distinct creative territories, judges names before checking domains, expands promising directions, and presents a small varied shortlist directly in chat.
---

# Generate

The agent creates and judges names; the server stores them and checks domains. A computed score is an agent rating, not independent evidence of brand quality. The goal is a brand worth choosing, not a quota of unregistered domains.

## Load and calibrate

1. Use the project slug from the conversation; otherwise call `project_list` and resolve the intended project. Call `project_get` and `ruleset_get` for the brief's rulesets.
2. Read the current brief, existing labels, notes, and shortlist. In particular retain `positioning.emotionalPromise`, `nameRules.creativeGuidance`, `nameRules.references`, and `nameRules.domainPolicy`. Apply newer user feedback. Do not repeat rejected names or the pattern the user rejected under new spellings. Benchmarks illustrate qualities, not names to imitate.
3. Save feedback on existing names with `project_add_notes`, kind `feedback`, including the user's reason. Use the `brief` skill when feedback changes the enduring direction or domain policy; merge the current brief so unrelated preferences survive. Do not silently rewrite the brief.
4. Synthesize a short creative brief: audience, product truth, emotional benefit, personality, and exclusions. Distinguish shipped features from ambitions. Do not translate an emotion mechanically into mandatory name words.

Use actual selections and rejection reasons to refine broad adjectives such as "warm" or "serious"; do not silently override explicit constraints. When earlier examples already reveal taste, continue without another interview. When taste is still unclear after an unsuccessful round, ask the user to contrast two genuinely different directions. Do not require a separate batch of unchecked names: use already-checked options, or discuss associations without implying domain availability. Unchecked naming examples are appropriate only if the user requests a creative-only exercise, and must be labeled unchecked.

## Explore different ideas

When the user rejects a round without a clear reason, pause expansion for one short contrast question: which of two approaches is closer, and what makes it closer? Offer "neither" and accept a free-text correction. Do not turn one selection into a permanent preference for every feature of that name. Save the stated reason through the feedback/brief flow above. Resume directly when the rejection already identifies what must change.

Plan about 4-6 distinct territories when the brief allows breadth. Each needs a different association and a reason a customer would identify with it. A territory is an idea, not a ruleset or a bag of interchangeable words.

Give each territory an internal exploration card: customer benefit or emotion, metaphor/source vocabulary, naming structure, reason it fits this product, and the cliche it must avoid. Separate **semantic territory** (what the name suggests) from **construction** (how the words or sounds form it). Four compound lists with different headings are not four creative approaches. Assess each construction afresh for the product; neither a famous brand example nor success in a previous project proves it fits this brief. Prefer a natural connection over filling slots in a formula.

Across the territories, explore several suitable structures: a familiar word used evocatively, a metaphor, a natural two-word expression, a meaningful compound, restrained wordplay, or an intelligible coinage. These are options, not mandatory quotas; respect requests excluding any of them. Do not invent arbitrary syllables just because short words are taken.

Rulesets supply constraints and score weights. Their style weights are starting preferences, not mechanical allocations that override the brief. If the selected rulesets cannot accommodate the requested breadth, adjust them through `brief`; never mislabel a candidate's style to force it through. Seed from situations, benefits, images, relationships, and language outside the product's literal feature list. Do not generate a Cartesian product of generic prefixes and suffixes.

Draft roughly 30-60 candidates across the territories, fewer for a genuinely narrow brief. Keep the exploration internal. Cluster names sharing the same root, sound, or construction and keep only the best expression of each idea for checking. Relabeling near-duplicates as different territories does not create variety.

## Judge before domain checks

For each candidate ask: **Would I still recommend considering this name if its domain status were unknown?** Reject it if the answer depends on availability or a strained explanation.

- Enforce label validity (lowercase ASCII letters, digits, inner hyphens; 1-63 characters), ruleset length and filters, and project overrides. Ban words from `filters.bannedWords`, `overrides.ban`, and `personality.avoid`, including compounds. Respect `filters.bannedPairs`, `filters.hyphens`, and `filters.numbers`.
- Reject unnatural word pairings, interchangeable corporate filler, obvious brand imitations, unwanted cuteness, and unmotivated invented words. Apply the user's reasons, not a universal ban on particular styles.
- Check naturalness, sound, spelling from hearing, memorability, distinctiveness in the category, credibility, and fit with the emotional promise. Check likely pronunciation issues in the target languages early; the later `language-check` is deeper.
- Give each survivor a specific association, a credible reason someone would want the brand, and its main weakness. If many names have interchangeable rationales, revisit the territory.
- A serious weakness cannot be averaged away by short length or a high total. A familiar dictionary word is not automatically less distinctive than a coinage; judge the association in its category.

Rate survivors 0-10 for `length`, `say`, `spell`, `meaning`, and `uniqueness`; leave out `price`. `project_add_names` computes the weighted score. Use it as a secondary aid within a ruleset, not a cross-ruleset leaderboard. Never raise ratings after discovering an unregistered domain.

## Save and check

1. Save editorial survivors with `project_add_names` (at most 100 per call): `name`, `rulesetId`, `strategy` (a supported style), `rationale`, and `scoreParts`. The rationale records territory and association. For user-supplied names use `rulesetId: "user"`. Send `label` only when it differs from the display name without spaces and the user accepts that spelling.
2. Use `project_add_notes`, kind `editorial`, to save the main weakness and why the name passed. This keeps judgment available when resuming, even when a domain fails.
   Include the territory and construction so later rounds can see which approaches were actually tried. Keep rejection reasons attached to the idea, not just its exact spelling. These notes are internal; do not turn them into an unsolicited report.
3. Start with a small availability sample of editorial survivors across several territories, usually 2-3 per promising territory. These are part of the normal batch, not additional checks: reuse their results. Then check further strong survivors, usually 15-25 in total. This discovers crowded directions before spending the whole search there. Build coverage using **TLD coverage for a name** in [references/tlds.md](references/tlds.md). For the quick pass, use the first two allowed TLDs, plus `com` only when permitted and required. Exact `.com` means only `<label>.com`; no alternative extensions or affix rescues. Affixes are checked only when `domainPolicy.allowAffixes` is explicitly true, using the ruleset's permitted variants.
4. Call `check_domains` with at most 100 names, 30 TLDs, and 200 domains per call. Save the exact results through `project_add_checks`, kind `domain`, including failed candidates for deduplication and traceability.
5. Keep registered domains out of the recommendations unless `domainPolicy.includeRegistered` is explicitly true. An `unknown` result does not pass the availability filter. If live checking fails altogether, say so; only show unchecked ideas when the user asks for them.
6. For the strongest eligible finalists, call `registrar_quote` (at most 20 domains) before recommending them. `availability: unavailable` from a live registrar excludes that offer; conflicting registrar results need resolution before a confident recommendation. An unknown or table-only result never confirms purchase availability. Record exact quote evidence as `project_add_notes`, kind `registrar`, with domain, registrar, mode, availability, premium flag, source/price label, and `checkedAt`. The final `report` refreshes quotes.

## Expand, compare, stop

When too few worthwhile names survive, expand into an underexplored territory or structure rather than append generic words to failed names. Use what was learned about quality and availability without lowering the editorial standard. Normally allow up to three batches in one invocation, or the user's stated budget; never loop indefinitely.

Let the early sample guide effort, not taste: repeated registered results justify trying less obvious vocabulary or another construction, while unknown/error responses reveal nothing about a territory's availability. A small sample cannot prove a whole direction is exhausted. Keep some exploration in underrepresented directions rather than spend every remaining check where the first free domain appeared. Do not increase a name's score or relax spelling, meaning, or exact-domain requirements to improve the pass rate.

Compare finalists head to head: which has the stronger natural association, which sounds and spells better, and what tradeoff distinguishes them? Prefer variety when quality is comparable, but do not keep a weak name to fill a territory. If all finalists are near-identical, revisit the exploration before presenting them.

Stress-test each finalist in ordinary use: a spoken introduction, a product-navigation label, and an email address using its exact domain. Look for awkward grammar, ambiguous word boundaries, embarrassing readings, or a need to spell it out every time. This is an editorial simulation, not a claim that customers tested or preferred the name. Do not replace semantic judgment with character counts or consonant/vowel scores; mechanically pronounceable nonsense is still nonsense.

Stop with up to six worthwhile recommendations, fewer when appropriate. If none is compelling, say so and ask one high-value calibration question grounded in what failed. Do not dump registered names or label weak survivors "strong candidates". A broader round requires a changed direction or a user request, not another automatic batch of the same construction.

## Present directly in chat

Lead with the names, not a file link, the full candidate inventory, or a score table. For each include:

- Name and exact domain.
- Creative territory and natural association.
- Why someone would want this as their brand.
- Main weakness or ambiguity.
- Domain evidence: source, original check date/time, and remaining uncertainty.

Distinguish "no registry registration record found" (the RDAP/WHOIS signal), "likely available" (the preliminary `check_domains` verdict), and "registrar-confirmed purchase availability" (only a live registrar's `available` result). DNS absence alone proves none of these. Do not replace a cached result's timestamp with today's date. Premium/reserved names can evade registry checks. Domain evidence is separate from trademark and existing-brand research.

If mentioning a price, use `registrar_quote`'s exact price label and show first-year and renewal together; unknown stays unknown. Otherwise leave detailed price comparisons for `report`.

Ask which names or directions resonate; save the user's choice with `project_shortlist`, mode `set` or `add`. Explain the strongest tradeoffs without pretending there is an objectively best brand. No report file, HTML page, or visual review surface unless the user requests one. No emoji or urgency copy.
