# TLD guide

Use this when choosing TLDs and explaining them to the user. It has no prices: prices come from `tld_info` and `registrar_quote` in the `report` step, with their source and date.

## .com

- Still the TLD people type by default and trust most, especially for B2C and outside tech.
- A short exact `.com` is often registered. Affix fallbacks (`get`, `try`, `use`, `hq`, `app`) keep the brand on `.com` at the cost of length.

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

- `likely_available` from `check_domains` means RDAP, WHOIS, and DNS found no registration. These free sources cannot see premium or registry-reserved names, so the user must confirm at a registrar.
