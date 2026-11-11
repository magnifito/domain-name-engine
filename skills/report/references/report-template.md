# Report template

Use this structure only for a file export requested by the user. It is not the default chat answer. Include only editorial survivors and policy-compliant domains; never add rejected or registered names merely to fill the report. Replace placeholders with actual evidence and write "unknown" for missing values. Omit irrelevant optional detail.

```markdown
# Naming report: <project title>

Project: <slug> · Brief version <brief.version> · Written <ISO date and time>
Price mode: <"bundled table only" when registrar_quote mode is "table"; otherwise "live from <registrar names> plus bundled table">

## Ranking

| Rank | Name | Ruleset | Best eligible domain | Cheapest 3-year option | Main risk |
|---|---|---|---|---|---|
| 1 | <name> | <rulesetId> | <domain, or "none"> | <amount currency at registrar, or "unknown"> | <one short phrase, or "none found"> |

<One sentence per name explaining its rank, from project data only.>

## <Name> (rank <n>)

Ruleset: <rulesetId>. <strategy, when present>. <rationale, when present>

### <domain>: <evidence level, source, original checkedAt>

| Registrar | Sells TLD | First year | Renewal | 3-year total | Currency | Price label |
|---|---|---|---|---|---|---|
| Spaceship | <listed / unverified / not sold / not listed by <source> on <date> / unknown> | <amount or unknown> | <amount or unknown> | <amount or unknown> | <code or unknown> | <priceLabel> |
| Namecheap | ... | ... | ... | ... | ... | ... |
| Cloudflare | ... | ... | ... | ... | ... | ... |

<One line per registrar entry with a premium flag or a reason: "<Registrar>: premium name" or "<Registrar>: <reason>".>

Cheapest 3-year option: <one line per currency: "<amount> <currency> at <registrar>">. Prices in different currencies are not compared.

TLD .<tld>: reputation <good / mixed / poor>. <reputationNote> (source: <source>, checked <checkedAt>)

### Registered-domain investigation (optional: only when explicitly requested)

<Relevant offer or profile evidence, with source and date. Do not list failed checks by default.>

### Language risks (optional: only when the name has language notes)

- high: <language code>: <note text>
- medium: <language code>: <note text>
- low: <language code>: <note text>

### Handles, trademarks, and competitors (optional: only when checks exist)

- Handles: <platform: status (source, checkedAt)>. Manual platforms show their profile link.
- Trademarks: <summary of stored results with source and checkedAt>. No matches is not a legal clearance.
- Competitors: <finding with its URL>

## Sources and limits

- <each note from registrar_quote, one bullet each>
- Domain evidence distinguishes a registry no-record signal, preliminary likely availability, and live registrar-confirmed purchase availability. DNS absence alone proves none of these. Cite the original check time; only checkout secures a domain.
- Table prices are reference prices from the bundled table. They can be out of date and do not include taxes, fees, or promotions. Verify at the registrar before buying.
- Without registrar API keys, premium names cannot be detected and their price is unknown.
- Prices are never converted between currencies.
- Handle checks for X, Instagram, TikTok, and LinkedIn are manual: the report gives a profile link, not a result.
- Trademark results are not legal advice. USPTO and WIPO searches are links for a manual search.
```
