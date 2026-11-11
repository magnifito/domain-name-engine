# Choice-first intake

Use at the start of `brief`, after reading the conversation and any saved brief. The goal is a few selections, not a questionnaire the user must write. Ask only about gaps that materially change the naming search. Never run this survey when the user is asking to edit the engine or discuss its workflow rather than name a product.

## Interaction

- Prefer the host's native choice/question interface. In Codex, use `request_user_input_async` when available; use `request_user_input` only in a mode where it is permitted. In Claude Code, use `AskUserQuestion` when available. These are host capabilities, not domain-engine MCP tools. Never call a missing tool.
- Ask up to three concise questions together per batch, respecting the host's limits. Aim for one batch when product context exists. Do not convert the whole seven-section schema into seven interview screens.
- Use multi-select only if the host supports it. Otherwise offer useful bundles as single-choice options; allow a typed combination without requiring one. Do not tell the user to select multiple options in a single-select control.
- Offer 2-4 materially different options per question, subject to the host's limit. Recommend one only when the brief supports it. Always permit custom input; rely on the host's built-in custom answer when it has one. Never infer consent from a preselected option or elapsed time.
- If native controls are unavailable, print compact numbered questions with lettered answers in chat, and accept a single reply such as `1B, 2C, 3A`. State what each code means; accept natural-language answers too. Do not open a form, HTML page, or report file.
- Read existing facts first. Summarize known constraints in one line and omit their questions. For example, an exact-.com requirement is a prefilled constraint, not another choice to make. A complete brief skips the survey entirely.
- The only normal free-text question is a missing product description: "What are we naming, who is it for, and what does it help them do? One sentence is enough." Optional examples and exclusions can be supplied but must not block progress.

## Choice bank

Choose questions dynamically; this is not a script to ask in full. Tailor options to the product without silently narrowing its possibilities.

### Name construction

- Familiar words and natural compounds.
- Evocative words and metaphors.
- Meaningful new words or blends.
- Explore a balanced mix.

Record the choice in `nameRules.creativeGuidance`. It guides breadth, not a fixed allocation. A mixed choice must leave room for more than one construction. Use it to recommend rulesets after inspecting their actual styles; the user need not learn ruleset IDs.

### Brand personality

Offer three context-appropriate bundles, each with exactly three tone words. For business software, possible bundles are:

- Calm, clear, confident.
- Warm, capable, approachable.
- Bold, energetic, distinctive.

Map the submitted bundle to `personality.tone`. Existing tone words take precedence. A personality choice does not establish an emotional promise or a preference for mascots, animals, or invented names. Only save an emotional promise if the user's input supports it; otherwise leave it optional.

### Domain policy

When the user has not specified it, offer:

- Exact .com, new registrations only.
- Exact name across a few suitable extensions, new registrations only.
- Include registered domains offered for sale.

For exact .com save `domainPolicy: { "tlds": ["com"], "allowAffixes": false, "includeRegistered": false }`. For other extensions, propose a short exclusive TLD list based on the audience and let the user select or approve it. If aftermarket is chosen, ask separately for a spending range and allowed TLDs; do not assume unlimited budget or broaden extensions. These options never enable affix rescues. Offer affixes only if the user asks for them.

### Markets and pronunciation

If country/language facts are missing, offer explicit bundles supported by the context, naming both countries and languages. For example, "Bulgaria / Bulgarian + English" maps to `countries: ["BG"]`, `languages: ["bg", "en"]`; "US + UK / English" maps to `countries: ["US", "GB"]`, `languages: ["en"]`. Include an option to specify different countries/languages. Do not infer a target market from the user's location, or store "global" as a country code. A global answer needs actual priority markets before saving.

### Remaining required facts

Use choices only for fields still unsupported after reading the product description:

- `audience.segment`: businesses / consumers / both.
- `positioning.priceTier`: budget / mid-market / premium. Label this the **product's positioning**, not the domain budget.
- `mode.type`: product / company or startup / personal brand.

Bundle these into the remaining intake only when necessary. If the user does not know, offer a clearly labeled proposal to confirm; do not store an unanswered choice as fact. Personal brands still need the person's actual name, profession, and accepted name forms; ask for them in one concise text request rather than guessing.

## Apply and confirm

Keep submitted answers together with the existing context. Store named likes/dislikes as `nameRules.references` only with a user-supplied reason; use `creativeGuidance` for general preferences. Do not manufacture a reason for a benchmark the user merely selected.

Map only supported answers to the brief and validate its required fields. User corrections override earlier suggestions. For a resumed project, merge changes into the current brief rather than rebuilding it from survey answers.

Finish with one concise summary and two choices: **Start the search** or **Adjust the brief**. Include any proposed interpretations and the recommended rulesets in plain language. If an earlier explicit approval already covered this exact summary, do not ask again. Save only after confirmation; never start a second interview after confirmation unless a required ambiguity remains. No reply means the question is pending, not accepted.

## Walkthrough checks

- Complete product brief with exact .com and rejection examples: no survey repetition; preserve constraints and proceed through existing confirmation.
- One-sentence product idea: offer a small batch of taste/policy choices, then only genuinely missing required facts.
- Single-select host: show bundles, not unusable multi-select instructions.
- No native question tool: lettered options in chat, one reply; no generated form.
- Existing project: ask only about changes, retain references, exclusions, and domain policy.
- Skipped optional preference: omit it; skipped required fact: resolve it before saving.
