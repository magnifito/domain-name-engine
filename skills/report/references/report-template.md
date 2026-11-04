# Report template

Fill this structure. Replace every `<...>` with data from the tool results. Leave out a section only when the template marks it optional. Write "unknown" for any missing value.

```markdown
# Naming report: <project title>

Project: <slug> · Brief version <brief.version> · Written <ISO date and time>
Price mode: <"bundled table only" when registrar_quote mode is "table"; otherwise "live from <registrar names> plus bundled table">

## Ranking

| Rank | Name | Ruleset | Best likely-available domain | Cheapest 3-year option | Main risk |
|---|---|---|---|---|---|
| 1 | <name> | <rulesetId> | <domain, or "none"> | <amount currency at registrar, or "unknown"> | <one short phrase, or "none found"> |

<One sentence per name explaining its rank, from project data only.>

## <Name> (rank <n>)

Ruleset: <rulesetId>. <strategy, when present>. <rationale, when present>

### <domain>: likely available (check_domains, <source>, checked <checkedAt>)

| Registrar | Sells TLD | First year | Renewal | 3-year total | Currency | Price label |
|---|---|---|---|---|---|---|
| Spaceship | <listed / unverified / not sold / not listed by <source> on <date> / unknown> | <amount or unknown> | <amount or unknown> | <amount or unknown> | <code or unknown> | <priceLabel> |
| Namecheap | ... | ... | ... | ... | ... | ... |
| Cloudflare | ... | ... | ... | ... | ... | ... |

<One line per registrar entry with a premium flag or a reason: "<Registrar>: premium name" or "<Registrar>: <reason>".>

Cheapest 3-year option: <one line per currency: "<amount> <currency> at <registrar>">. Prices in different currencies are not compared.

TLD .<tld>: reputation <good / mixed / poor>. <reputationNote> (source: <source>, checked <checkedAt>)

### Not available or unknown

| Domain | Status | Source | Checked |
|---|---|---|---|
| <domain> | <registered / unknown / unavailable at registrar> | <source> | <checkedAt> |

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
- Availability comes from public RDAP, WHOIS, and DNS data. "Likely available" means no registration was found at check time; only a registrar can confirm that a domain is free.
- Table prices are reference prices from the bundled table. They can be out of date and do not include taxes, fees, or promotions. Verify at the registrar before buying.
- Without registrar API keys, premium names cannot be detected and their price is unknown.
- Prices are never converted between currencies.
- Handle checks for X, Instagram, TikTok, and LinkedIn are manual: the report gives a profile link, not a result.
- Trademark results are not legal advice. USPTO and WIPO searches are links for a manual search.
```
