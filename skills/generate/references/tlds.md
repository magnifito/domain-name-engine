# TLD guide

Use this when choosing TLDs and explaining them to the user. It has no prices: prices come from `tld_info` and `registrar_quote` in the `report` step, with their source and date.

## .com

- Still the TLD people type by default and trust most, especially for B2C and outside tech.
- A short exact `.com` is often registered. Broaden the creative search before changing the domain requirement. Affix fallbacks are permitted only when the user opts in through `nameRules.domainPolicy.allowAffixes`.

## Generic alternatives

- `.co`, `.io`, `.ai`, `.app`, `.dev`, `.sh`, and `.xyz` are common for startups and tech products.
- `.app` and `.dev` are on the HSTS preload list, so sites on them must use HTTPS.
- `.io` (British Indian Ocean Territory), `.ai` (Anguilla), and `.sh` (Saint Helena) are country codes used as generic TLDs. Their registry rules follow those territories.

## Country TLDs

- A country TLD signals a local business and can build local trust: `.de`, `.fr`, `.nl`, `.uk`, `.ca`, `.com.au`.
- Some need a local presence or a registered business, for example `.ca`, `.com.au`, and `.fr` for holders outside the EU. Check the registry rules before recommending one.
- Map ISO country codes to ccTLDs in lowercase. The exception is `GB`, which uses `.uk`.

## Low-cost TLDs

- `.sbs`, `.site`, `.online`, `.store`, `.space`, `.lol`, `.bond`, and `.xyz` often have a very low first-year price and a much higher renewal price. Compare renewal prices, not first-year prices.
- Spam filters and security tools flag several low-cost TLDs more often. That can hurt email delivery and trust. The `report` step shows each TLD's reputation note.
- Not every registrar sells every TLD.

## Status words

- `likely_available` from `check_domains` is preliminary: RDAP or WHOIS reported no registration, with no contradictory DNS nameserver result. DNS may be unavailable; absence of DNS alone never establishes availability. Cite the actual source, confidence, and `checkedAt`. These sources cannot see every premium or reserved name; only a live registrar result can confirm purchase availability at check time.

## TLD coverage for a name

First apply `brief.nameRules.domainPolicy`: if `tlds` is set, use only that list, deduplicated in order. Do not append `.com`, country TLDs, ruleset TLDs, or `extraTlds`. `["com"]` means exact `.com` only. Without an exclusive list, use the fallback below. For `rulesetId: "user"`, use the brief's selected rulesets to build a deduplicated list; do not call `ruleset_get` with reserved id `user`.


Both `generate` and `research` build the TLD list for a name this way. Build the ordered list for the name's ruleset and brief:

1. If the ruleset's `tlds.countryFirst` is true and the brief's `audience.countries` is not empty, start with the ccTLD of the first country (lowercase country code; `GB` uses `uk`).
2. Add `com` if it is not in the list yet.
3. Add every TLD of the ruleset's `tlds.order`.
4. Add every TLD of the brief's `nameRules.overrides.extraTlds`.
5. Remove duplicates, keeping the first position.

The primary TLDs are the first entry and `com` only when `com` is in the allowed list. Affixed variants require `domainPolicy.allowAffixes: true`. Registered-domain profiles require `domainPolicy.includeRegistered: true`. Both default to false, including for older briefs. A direct user request to investigate a specific registered domain remains supported.
