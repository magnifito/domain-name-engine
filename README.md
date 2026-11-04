# Domain Name Engine

A Claude Code plugin that helps you find a brand name and a domain for it. Claude generates and judges names; a bundled MCP server checks real availability with RDAP, WHOIS, and DNS.

> Status: early development. Plan 1 of 4 ships the `check_domains` tool. Skills, brand research tools, and registrar prices follow.

## Install

```
/plugin marketplace add magnifito/domain-name-engine
/plugin install domain-name-engine@magnifito
```

Requires Node.js 20 or later.

## What "likely available" means

The engine uses free public sources only by default. `likely_available` means no registration was found. Premium and registry-reserved names are not visible to these sources, so confirm at a registrar before you rely on a result.

## Data

Cache and projects live in `~/.domain-engine/`. Set `DOMAIN_ENGINE_HOME` to use another folder.

## Development

```
cd server
pnpm install
pnpm test        # unit tests, no network
pnpm test:live   # live smoke test, uses the network
pnpm build       # rebuilds server/dist/index.js (commit the result)
```
