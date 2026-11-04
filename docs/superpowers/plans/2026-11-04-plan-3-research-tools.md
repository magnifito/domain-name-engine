# Plan 3 — Research Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the MCP tools `profile_domain`, `check_handles` and `search_trademarks`, plus the `research` and `language-check` skills, so a shortlist can be checked fully: taken-domain profiles, handles, trademarks, a competitor scan and a language review.

**Architecture:** All new server code lives in `server/src/research/` (three areas: `profile/`, `handles/`, `trademarks/`) and is exposed through `server/src/research/runtime-part.ts` (`ResearchRuntime`, `createResearchRuntime`). `runtime.ts` gains one `extends` entry and one spread line, and `server.ts` gains one `registerPlan3Tools(server, rt)` call. Sources reuse Plan 1's shared `HttpFetch` (timeout, retry, User-Agent, per-host `HostLimiter`), `DiskCache`, `TTL`, `rdapLookup` and `whoisLookup`. Each check is a pure orchestrator with injected dependencies, so unit tests use fakes and fixtures only.

**Tech Stack:** Node 20+, TypeScript 7.0.2 (strict, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7, Vitest 5.1.0, Biome 2.6.4, pnpm 11.27.0. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-domain-name-engine-design.md`
**Coordination rules (binding):** `docs/superpowers/plans/2026-11-04-plans-2-4-coordination.md`

**Branch and worktree:** work on `feat/plan-3-research` in its own git worktree off `main`:
```bash
git worktree add ../domain-name-engine-plan-3 -b feat/plan-3-research main
cd ../domain-name-engine-plan-3/server && pnpm install --frozen-lockfile
```
All commands below run from the worktree root unless a step says `cd server`.

## Global Constraints

Copied from the coordination doc's "Global constraints (all plans)":

- Node 20+, TypeScript strict, ESM with `.js` relative imports.
- Biome for lint and format (`pnpm check`, `pnpm format` in `server/`). Never use ESLint or Prettier, and never run bare `pnpm lint`.
- Write all code comments in English.
- Vitest. Unit tests use fakes, with no network access. Live tests go under `server/test/live/` and are gated by `LIVE=1`.
- Honesty rules from the spec: never claim "available" without a tool result; label every price with its source and date; never mix currencies.
- API keys come from env vars only. Never print, log or store them.
- Never scrape pages that block bots. Use only official APIs or documented open endpoints.
- Per-host rate limit through the shared `HostLimiter`. Cache through the shared `DiskCache`, with the TTLs the spec gives.

Plan 3 specifics (from the spec and the coordination doc):

- Every check result carries `source`, `checkedAt` (ISO 8601) and `confidence` (`high` | `medium` | `low`).
- Cache TTLs: handles 1 day (`TTL.handles`), trademarks 7 days (`TTL.trademarks`), `unknown` results never cached. Profiles: 1 day (`PROFILE_TTL_MS`, see Spec gaps), `not_registered` profiles 1 hour (`TTL.likelyAvailable`).
- HTTP goes only through the shared `http` from `createHttp` (8 second timeout, retry on 429/5xx, max 3 tries, `Retry-After`, generic User-Agent). Never create a second `http`, `limiter` or `cache`.
- A failing source returns `unknown` with a reason; the run continues. Invalid input is rejected by `zod` or `ValidationError` with a plain message.
- File ownership: create or modify only `server/src/research/**`, `server/src/tools/{profile-domain,check-handles,search-trademarks,register-plan3}.ts`, `server/test/research/**`, `server/test/tools/{profile-domain,check-handles,search-trademarks}.test.ts`, `server/test/live/research.test.ts`, `skills/research/**`, `skills/language-check/**`.
- Shared-file edits allowed, and nothing more: `server/src/server.ts` (one import, one call), `server/src/runtime.ts` (one import, one `extends`, one spread). One fix in `server/test/tools/check-domains.test.ts` (Task 10) is required by the coordination rule "fake runtime is `{} as Runtime` plus fields"; see Cross-plan risks.
- Do not edit `server/src/config.ts`, `server/src/cache/ttl.ts`, `server/package.json` or anything under `server/src/{cache,http,limiter,fs,util,domain,sources}/`.
- Do NOT run `pnpm build` and do not commit `server/dist/`. The controller rebuilds dist after all merges.
- Add MCP `annotations: { readOnlyHint: true, openWorldHint: true }` to all three Plan 3 tools.

## Endpoint research (checked 2026-11-04)

Every endpoint below was probed on 2026-11-04 with the engine's User-Agent, or read from official or client documentation. Live tests in Task 12 re-check the open ones.

| Use | Endpoint | Auth | Result on 2026-11-04 | Used as |
|---|---|---|---|---|
| GitHub user/org | `HEAD https://api.github.com/users/{name}` | none; optional `GITHUB_TOKEN` (60 to 5000 req/h) | 200 for `octocat`, 404 for a random name | high-confidence `taken`; 404 gives medium `likely_available` |
| npm package | `HEAD https://registry.npmjs.org/{name}` | none | 200 `react`, 404 random | same as GitHub. HEAD avoids the 3 MB package document |
| PyPI project | `HEAD https://pypi.org/simple/{pep503-name}/` with `Accept: application/vnd.pypi.simple.v1+json` (PEP 691) | none | 200 `requests`, 404 random, 301 for non-normalized names | same as GitHub |
| Reddit user | `GET https://www.reddit.com/user/{name}/about.json` | none | **403** for all names (logged-out JSON blocked) | not used |
| Reddit user (OAuth) | `POST https://www.reddit.com/api/v1/access_token` (`grant_type=client_credentials`, HTTP Basic), then `GET https://oauth.reddit.com/user/{name}/about` | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`. Since Nov 2025, new apps need approval under the Responsible Builder Policy | not verifiable without keys | used only with keys; otherwise `unknown` + manual URL |
| YouTube handle | `GET https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=@{h}&key=…` (1 quota unit) | `YOUTUBE_API_KEY` (free Google Cloud key) | documented at developers.google.com/youtube/v3/docs/channels/list | used only with key; empty `items` gives `likely_available` |
| X, Instagram, TikTok, LinkedIn | profile pages | none | 200 HTML app shells for any path (status carries no signal); pages block automated clients; X API is paid; others have no open lookup | never requested; always `unknown` with method `manual` and the profile URL |
| EUIPO Trademark Search (production) | token `POST https://euipo.europa.eu/cas-server-webapp/oidc/accessToken` (`grant_type=client_credentials`, `scope=uid`); search `GET https://api.euipo.europa.eu/trademark-search/trademarks?query=<RSQL>&page=0&size=25` with `Authorization: Bearer` and `X-IBM-Client-Id` | `EUIPO_CLIENT_ID`, `EUIPO_CLIENT_SECRET` (free registration at https://dev.euipo.europa.eu; production access may need EUIPO review) | token URL answers 401 to bad credentials; API answers 401 `"Invalid client id or secret."` | used only with keys |
| EUIPO (sandbox) | token `https://auth-sandbox.euipo.europa.eu/oidc/accessToken`; API `https://api-sandbox.euipo.europa.eu/trademark-search` | same vars plus `EUIPO_ENV=sandbox` | both answer 401 without credentials | test data only; results labeled `low` confidence |
| USPTO | `tmsearch.uspto.gov` (web app), TSDR API `tsdrapi.uspto.gov` (status by serial number only, key needed: 401), ODP `api.uspto.gov` (patents; key and ID.me needed: 403) | — | no official keyless word-mark search exists; the tmsearch backend is unofficial and behind AWS WAF | not queried; `unknown` + search link |
| WIPO Global Brand Database | `https://branddb.wipo.int/` | — | web app, no public API | not queried; `unknown` + link |
| TMview | `https://www.tmdn.org/tmview/` | — | web app, no public API | link only |

Sources for the table: GitHub REST docs (docs.github.com/rest/users), PEP 691, Reddit API notes in the n8n docs and GitHub issue karanb192/reddit-mcp-buddy#39, YouTube Data API `channels.list` reference, the EUIPO client source `euipo-tm-client` 0.1.1 on PyPI (base URLs, `scope=uid`, `X-IBM-Client-Id`, `page`/`size`/`query`, response keys `trademarks`/`totalElements`), and the EUIPO problem response above.

## File Structure

```
server/src/research/
  keys.ts                    # readResearchKeys(env): optional API keys, never logged
  runtime-part.ts            # ResearchRuntime + createResearchRuntime(deps)
  profile/
    parking.ts               # parking nameserver list + parkingProvider()
    registration.ts          # fromRdap(), fromWhois(): dates, registrar, nameservers
    homepage.ts              # fetchHomepage(): one GET, title, for-sale and parking signals
    profile.ts               # profileDomain(): registration + DNS + homepage -> verdict, cached
  handles/
    platforms.ts             # PLATFORMS, per-platform name rules, profile URLs
    checkers.ts              # Probe/Checker types, statusProbe, GitHub/npm/PyPI, manualChecker
    keyed-checkers.ts        # Reddit (app-only OAuth) and YouTube (Data API) checkers
    check.ts                 # createCheckers(), checkHandles(): validation, cache, concurrency
  trademarks/
    links.ts                 # manual search links: USPTO, EUIPO, TMview, WIPO
    euipo.ts                 # EUIPO token + search client, RSQL builder, response parser
    search.ts                # searchTrademarks(): EUIPO when keyed, honest unknowns, cached
server/src/tools/
  profile-domain.ts          # profile_domain tool
  check-handles.ts           # check_handles tool
  search-trademarks.ts       # search_trademarks tool
  register-plan3.ts          # registerPlan3Tools(server, rt)
server/src/runtime.ts        # MODIFY: +1 import, +1 extends, +1 spread
server/src/server.ts         # MODIFY: +1 import, +1 call
server/test/research/
  fixtures/rdap-domain-parked.json
  fixtures/euipo-search-acme.json
  registration.test.ts  homepage.test.ts  profile.test.ts
  platforms.test.ts  keys.test.ts  checkers.test.ts  keyed-checkers.test.ts  handles.test.ts
  euipo.test.ts  trademarks.test.ts  runtime-part.test.ts
server/test/tools/
  profile-domain.test.ts  check-handles.test.ts  search-trademarks.test.ts
  check-domains.test.ts      # MODIFY: fake runtime spreads `{} as Runtime`
server/test/live/research.test.ts
skills/research/SKILL.md
skills/language-check/SKILL.md
```

---

### Task 1: Registration fields and parking detection

**Files:**
- Create: `server/src/research/profile/parking.ts`, `server/src/research/profile/registration.ts`, `server/test/research/fixtures/rdap-domain-parked.json`
- Test: `server/test/research/registration.test.ts`

**Interfaces:**
- Consumes: `RdapDomain` from `server/src/sources/rdap.ts` (Plan 1). Fixture `server/test/fixtures/rdap-domain-google.json` (Plan 1).
- Produces: `PARKING_NS_SUFFIXES: readonly string[]`; `parkingProvider(nameservers: readonly string[]): string | undefined`; `interface RegistrationFields { createdAt?: string; expiresAt?: string; registrar?: string; nameservers: string[] }`; `fromRdap(record: RdapDomain): RegistrationFields`; `fromWhois(raw: string): RegistrationFields`.

- [ ] **Step 1: Add the fixture**

`server/test/research/fixtures/rdap-domain-parked.json`:
```json
{
  "objectClassName": "domain",
  "ldhName": "PARKEDEXAMPLE.COM",
  "status": ["client transfer prohibited"],
  "events": [
    { "eventAction": "registration", "eventDate": "2014-03-02T10:11:12Z" },
    { "eventAction": "expiration", "eventDate": "2027-03-02T10:11:12Z" },
    { "eventAction": "last update of RDAP database", "eventDate": "2026-11-04T08:00:00Z" }
  ],
  "entities": [
    {
      "objectClassName": "entity",
      "handle": "1234",
      "roles": ["registrar"],
      "vcardArray": [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "Example Registrar, LLC"]
        ]
      ]
    }
  ],
  "nameservers": [{ "ldhName": "NS1.SEDOPARKING.COM" }, { "ldhName": "NS2.SEDOPARKING.COM" }]
}
```

- [ ] **Step 2: Write the failing test**

`server/test/research/registration.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parkingProvider } from '../../src/research/profile/parking.js';
import { fromRdap, fromWhois } from '../../src/research/profile/registration.js';
import type { RdapDomain } from '../../src/sources/rdap.js';
import googleRecord from '../fixtures/rdap-domain-google.json' with { type: 'json' };
import parkedRecord from './fixtures/rdap-domain-parked.json' with { type: 'json' };

const VERISIGN_WHOIS = `   Domain Name: EXAMPLE.NET
   Registry Domain ID: 1234_DOMAIN_NET-VRSN
   Registrar WHOIS Server: whois.example-registrar.com
   Updated Date: 2026-08-14T07:01:31Z
   Creation Date: 1995-08-14T04:00:00Z
   Registry Expiry Date: 2027-08-13T04:00:00Z
   Registrar: Example Registrar, Inc.
   Name Server: A.IANA-SERVERS.NET
   Name Server: B.IANA-SERVERS.NET
`;

const RU_STYLE_WHOIS = `domain:        EXAMPLE.RU
nserver:       ns1.example.ru.
nserver:       ns2.example.ru.
registrar:     RU-CENTER-RU
created:       2005-01-01T00:00:00Z
paid-till:     2027-01-01T00:00:00Z
`;

describe('parkingProvider', () => {
  it('matches a parking nameserver by domain suffix, ignoring case and a trailing dot', () => {
    expect(parkingProvider(['NS1.SEDOPARKING.COM.'])).toBe('sedoparking.com');
    expect(parkingProvider(['ns1.example.com', 'ns2.bodis.com'])).toBe('bodis.com');
  });

  it('does not match look-alike hosts', () => {
    expect(parkingProvider(['ns1.notbodis.com', 'ns1.google.com'])).toBeUndefined();
  });
});

describe('fromRdap', () => {
  it('reads dates, registrar name, and lower-case nameservers', () => {
    expect(fromRdap(parkedRecord as RdapDomain)).toEqual({
      createdAt: '2014-03-02T10:11:12Z',
      expiresAt: '2027-03-02T10:11:12Z',
      registrar: 'Example Registrar, LLC',
      nameservers: ['ns1.sedoparking.com', 'ns2.sedoparking.com'],
    });
  });

  it('leaves the registrar undefined when no registrar entity exists', () => {
    const fields = fromRdap(googleRecord as RdapDomain);
    expect(fields.registrar).toBeUndefined();
    expect(fields.createdAt).toBe('1997-09-15T04:00:00Z');
    expect(fields.nameservers).toEqual(['ns1.google.com', 'ns2.google.com']);
  });
});

describe('fromWhois', () => {
  it('parses a Verisign-style record', () => {
    expect(fromWhois(VERISIGN_WHOIS)).toEqual({
      createdAt: '1995-08-14T04:00:00Z',
      expiresAt: '2027-08-13T04:00:00Z',
      registrar: 'Example Registrar, Inc.',
      nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
    });
  });

  it('parses a RIPN-style record', () => {
    expect(fromWhois(RU_STYLE_WHOIS)).toEqual({
      createdAt: '2005-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
      registrar: 'RU-CENTER-RU',
      nameservers: ['ns1.example.ru', 'ns2.example.ru'],
    });
  });

  it('returns empty fields for text it does not understand', () => {
    expect(fromWhois('% rate limit exceeded')).toEqual({
      createdAt: undefined,
      expiresAt: undefined,
      registrar: undefined,
      nameservers: [],
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/registration.test.ts`
Expected: FAIL, because `../../src/research/profile/parking.js` cannot be resolved.

- [ ] **Step 4: Write the implementation**

`server/src/research/profile/parking.ts`:
```ts
// Nameserver domains of parking and domain-sale services. A heuristic list, not exhaustive.
export const PARKING_NS_SUFFIXES: readonly string[] = [
  'sedoparking.com',
  'bodis.com',
  'parkingcrew.net',
  'above.com',
  'afternic.com',
  'dan.com',
  'undeveloped.com',
  'parklogic.com',
  'hugedomains.com',
  'uniregistrymarket.link',
  'namebrightdns.com',
  'fabulous.com',
  'voodoo.com',
  'cashparking.com',
  'parked.com',
  'smartname.com',
  'dsredirection.com',
  'ztomy.com',
];

function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/** Returns the matched parking service domain, or undefined when no nameserver matches. */
export function parkingProvider(nameservers: readonly string[]): string | undefined {
  for (const ns of nameservers) {
    const host = cleanHost(ns);
    const match = PARKING_NS_SUFFIXES.find(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
    if (match) return match;
  }
  return undefined;
}
```

`server/src/research/profile/registration.ts`:
```ts
import type { RdapDomain } from '../../sources/rdap.js';

export interface RegistrationFields {
  createdAt?: string;
  expiresAt?: string;
  registrar?: string;
  nameservers: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeNs(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function rdapRegistrar(entities: unknown[] | undefined): string | undefined {
  for (const entity of entities ?? []) {
    if (!isRecord(entity)) continue;
    const roles = entity.roles;
    if (!Array.isArray(roles) || !roles.includes('registrar')) continue;
    const vcard = entity.vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const prop of vcard[1]) {
        if (Array.isArray(prop) && prop[0] === 'fn' && typeof prop[3] === 'string' && prop[3]) {
          return prop[3];
        }
      }
    }
    if (typeof entity.handle === 'string') return entity.handle;
  }
  return undefined;
}

export function fromRdap(record: RdapDomain): RegistrationFields {
  const event = (action: string): string | undefined =>
    record.events?.find((e) => e.eventAction === action)?.eventDate;
  return {
    createdAt: event('registration'),
    expiresAt: event('expiration'),
    registrar: rdapRegistrar(record.entities),
    nameservers: (record.nameservers ?? []).flatMap((ns) =>
      ns.ldhName ? [normalizeNs(ns.ldhName)] : [],
    ),
  };
}

const CREATED = [
  /^[ \t]*creation date:[ \t]*(\S.*)$/im,
  /^[ \t]*created(?: on)?:[ \t]*(\S.*)$/im,
  /^[ \t]*registered(?: on)?:[ \t]*(\S.*)$/im,
  /^[ \t]*registration time:[ \t]*(\S.*)$/im,
];
const EXPIRES = [
  /^[ \t]*registry expiry date:[ \t]*(\S.*)$/im,
  /^[ \t]*registrar registration expiration date:[ \t]*(\S.*)$/im,
  /^[ \t]*expir(?:y|ation) date:[ \t]*(\S.*)$/im,
  /^[ \t]*expires(?: on)?:[ \t]*(\S.*)$/im,
  /^[ \t]*paid-till:[ \t]*(\S.*)$/im,
];
const REGISTRAR = [/^[ \t]*registrar:[ \t]*(\S.*)$/im, /^[ \t]*registrar name:[ \t]*(\S.*)$/im];
const NAMESERVER = /^[ \t]*(?:name server|nserver):[ \t]*(\S+)/gim;

function firstMatch(raw: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const value = raw.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function fromWhois(raw: string): RegistrationFields {
  const nameservers = [...raw.matchAll(NAMESERVER)].map((m) => normalizeNs(m[1] ?? ''));
  return {
    createdAt: firstMatch(raw, CREATED),
    expiresAt: firstMatch(raw, EXPIRES),
    registrar: firstMatch(raw, REGISTRAR),
    nameservers: [...new Set(nameservers.filter(Boolean))],
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/research/registration.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/profile/parking.ts server/src/research/profile/registration.ts server/test/research
git commit -m "feat(research): parse registration fields and detect parking nameservers"
```

---

### Task 2: Homepage probe

**Files:**
- Create: `server/src/research/profile/homepage.ts`
- Test: `server/test/research/homepage.test.ts`

**Interfaces:**
- Consumes: `HttpFetch` from `server/src/http/http.ts`; `errorMessage` from `server/src/util/errors.ts`.
- Produces: `interface PageSignals { title?: string; forSale: boolean; parkedPage: boolean }`; `type HomepageResult = ({ kind: 'ok'; url: string; finalUrl: string; httpStatus: number } & PageSignals) | { kind: 'error'; reason: string }`; `MAX_BODY_BYTES = 262_144`; `extractTitle(html: string): string | undefined`; `analyzePage(html: string, finalUrl: string): PageSignals`; `readCapped(res: Response, limit?: number): Promise<string>`; `fetchHomepage(domain: string, http: HttpFetch): Promise<HomepageResult>`.

Design notes for the implementer:
- Exactly one GET per scheme through the shared `http`. A 401/403/429 is returned as-is (`kind: 'ok'`) and is never retried with other headers. That is the "never bypass a bot challenge" rule.
- `http://` is tried only when `https://` fails at the network level (DNS, TLS, timeout), never after an HTTP status.
- The body is read only for HTML and capped at 256 KiB. Stream cancels are not awaited, because a cancel on a tee'd stream can wait forever.

- [ ] **Step 1: Write the failing test**

`server/test/research/homepage.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  analyzePage,
  extractTitle,
  fetchHomepage,
  readCapped,
} from '../../src/research/profile/homepage.js';

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function routeHttp(routes: Record<string, Response | Error>): { http: HttpFetch; urls: string[] } {
  const urls: string[] = [];
  const http: HttpFetch = async (url) => {
    urls.push(url);
    const route = routes[url];
    if (route === undefined) throw new Error(`no route for ${url}`);
    if (route instanceof Error) throw route;
    return route.clone();
  };
  return { http, urls };
}

describe('extractTitle', () => {
  it('decodes entities and collapses whitespace', () => {
    expect(extractTitle('<head><title>\n Acme &amp; Co\n</title></head>')).toBe('Acme & Co');
  });

  it('returns undefined without a title', () => {
    expect(extractTitle('<p>hi</p>')).toBeUndefined();
  });
});

describe('analyzePage', () => {
  it('flags for-sale wording in visible text', () => {
    const signals = analyzePage('<h1>This domain is for sale!</h1>', 'https://acme.com/');
    expect(signals.forSale).toBe(true);
  });

  it('ignores for-sale wording inside scripts', () => {
    const signals = analyzePage('<script>var t="buy this domain"</script><p>Hello</p>', 'x');
    expect(signals.forSale).toBe(false);
  });

  it('flags a redirect to a domain marketplace as for sale', () => {
    expect(analyzePage('', 'https://www.afternic.com/forsale/acme.com').forSale).toBe(true);
  });

  it('flags parking wording', () => {
    expect(analyzePage('<div>Related Searches</div>', 'https://acme.com/').parkedPage).toBe(true);
  });

  it('reports a normal page as neither parked nor for sale', () => {
    expect(analyzePage('<title>Acme</title><p>We build rockets</p>', 'https://acme.com/')).toEqual(
      { title: 'Acme', forSale: false, parkedPage: false },
    );
  });
});

describe('readCapped', () => {
  it('stops reading at the byte limit', async () => {
    const text = await readCapped(new Response('a'.repeat(5000)), 1000);
    expect(text).toHaveLength(1000);
  });
});

describe('fetchHomepage', () => {
  it('returns status, title, and signals from https', async () => {
    const { http, urls } = routeHttp({ 'https://acme.com/': html('<title>Acme</title>') });
    const result = await fetchHomepage('acme.com', http);
    expect(result).toEqual({
      kind: 'ok',
      url: 'https://acme.com/',
      finalUrl: 'https://acme.com/',
      httpStatus: 200,
      title: 'Acme',
      forSale: false,
      parkedPage: false,
    });
    expect(urls).toEqual(['https://acme.com/']);
  });

  it('keeps an https error status instead of trying http', async () => {
    const { http, urls } = routeHttp({ 'https://acme.com/': html('Forbidden', 403) });
    const result = await fetchHomepage('acme.com', http);
    expect(result).toMatchObject({ kind: 'ok', httpStatus: 403 });
    expect(urls).toEqual(['https://acme.com/']);
  });

  it('falls back to http when https fails at the network level', async () => {
    const { http, urls } = routeHttp({
      'https://acme.com/': new Error('certificate expired'),
      'http://acme.com/': html('<p>Buy this domain</p>'),
    });
    const result = await fetchHomepage('acme.com', http);
    expect(result).toMatchObject({ kind: 'ok', url: 'http://acme.com/', forSale: true });
    expect(urls).toEqual(['https://acme.com/', 'http://acme.com/']);
  });

  it('skips the body of non-HTML responses', async () => {
    const { http } = routeHttp({
      'https://acme.com/': new Response('{"for sale": "buy this domain"}', {
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(await fetchHomepage('acme.com', http)).toMatchObject({ kind: 'ok', forSale: false });
  });

  it('returns an error when both schemes fail', async () => {
    const { http } = routeHttp({
      'https://acme.com/': new Error('ENOTFOUND'),
      'http://acme.com/': new Error('ENOTFOUND'),
    });
    expect(await fetchHomepage('acme.com', http)).toEqual({ kind: 'error', reason: 'ENOTFOUND' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/homepage.test.ts`
Expected: FAIL, because `../../src/research/profile/homepage.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`server/src/research/profile/homepage.ts`:
```ts
import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';

export interface PageSignals {
  title?: string;
  forSale: boolean;
  parkedPage: boolean;
}

export type HomepageResult =
  | ({ kind: 'ok'; url: string; finalUrl: string; httpStatus: number } & PageSignals)
  | { kind: 'error'; reason: string };

export const MAX_BODY_BYTES = 262_144;

const FOR_SALE_PATTERNS = [
  /\bthis domain (?:name )?(?:is|may be) for sale\b/i,
  /\bdomain (?:name )?(?:is )?for sale\b/i,
  /\bbuy this domain\b/i,
  /\bmake (?:an|us an) offer\b/i,
  /\binquire about this domain\b/i,
  /\bget this domain\b/i,
];

const PARKED_PATTERNS = [
  /\bthis domain (?:name )?(?:is|has been) parked\b/i,
  /\bparked free\b/i,
  /\bdomain parking\b/i,
  /\brelated searches\b/i,
];

// A redirect to one of these hosts means the domain is listed for sale.
const MARKETPLACE_HOSTS = [
  'afternic.com',
  'dan.com',
  'sedo.com',
  'hugedomains.com',
  'godaddy.com',
  'atom.com',
  'squadhelp.com',
  'brandbucket.com',
  'buydomains.com',
  'undeveloped.com',
];

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function extractTitle(html: string): string | undefined {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (raw === undefined) return undefined;
  const title = decodeEntities(raw).replace(/\s+/g, ' ').trim().slice(0, 200);
  return title || undefined;
}

export function analyzePage(html: string, finalUrl: string): PageSignals {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const host = hostOf(finalUrl);
  const onMarketplace =
    host !== undefined && MARKETPLACE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  return {
    title: extractTitle(html),
    forSale: onMarketplace || FOR_SALE_PATTERNS.some((pattern) => pattern.test(text)),
    parkedPage: PARKED_PATTERNS.some((pattern) => pattern.test(text)),
  };
}

/** Reads at most `limit` bytes of the body, then cancels the rest of the stream. */
export async function readCapped(res: Response, limit = MAX_BODY_BYTES): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  // Do not await: a cancel can wait on a tee'd branch that nobody reads.
  void reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit));
}

/** One GET of the homepage: https first, http only when https fails at the network level. */
export async function fetchHomepage(domain: string, http: HttpFetch): Promise<HomepageResult> {
  let reason = 'no response';
  for (const url of [`https://${domain}/`, `http://${domain}/`]) {
    try {
      const res = await http(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
      const finalUrl = res.url || url;
      const isHtml = (res.headers.get('content-type') ?? '').toLowerCase().includes('html');
      let html = '';
      if (isHtml) html = await readCapped(res);
      else void res.body?.cancel().catch(() => undefined);
      return { kind: 'ok', url, finalUrl, httpStatus: res.status, ...analyzePage(html, finalUrl) };
    } catch (error) {
      reason = errorMessage(error);
    }
  }
  return { kind: 'error', reason };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm test test/research/homepage.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/profile/homepage.ts server/test/research/homepage.test.ts
git commit -m "feat(research): add homepage probe with for-sale and parking signals"
```

---

### Task 3: `profileDomain` orchestrator

**Files:**
- Create: `server/src/research/profile/profile.ts`
- Test: `server/test/research/profile.test.ts`

**Interfaces:**
- Consumes: `DiskCache` (`server/src/cache/cache.ts`), `TTL` (`server/src/cache/ttl.ts`), `splitDomain` and `ValidationError` (`server/src/domain/name.ts`), `Confidence` (`server/src/domain/types.ts`), `RdapResult` (`server/src/sources/rdap.ts`), `WhoisResult` (`server/src/sources/whois.ts`); `HomepageResult` (Task 2); `parkingProvider` (Task 1); `fromRdap`, `fromWhois`, `RegistrationFields` (Task 1).
- Produces: `PROFILE_TTL_MS = 86_400_000`; `type ProfileStatus = 'live_site' | 'parked' | 'for_sale' | 'no_site' | 'not_registered' | 'unknown'`; `interface Registration extends RegistrationFields { status: 'registered' | 'not_found' | 'unknown'; source: 'rdap' | 'whois' | 'none'; nameserverSource: 'rdap' | 'whois' | 'dns' | 'none'; reason?: string }`; `interface DomainProfile { domain: string; status: ProfileStatus; confidence: Confidence; source: string; checkedAt: string; reason: string; registration: Registration; parkingProvider?: string; homepage?: HomepageResult }`; `interface ProfileDeps { rdap(domain: string, tld: string): Promise<RdapResult>; whois(domain: string, tld: string): Promise<WhoisResult>; nameservers(domain: string): Promise<string[] | null>; homepage(domain: string): Promise<HomepageResult>; cache: DiskCache; now?: () => Date }`; `profileDomain(input: string, deps: ProfileDeps): Promise<DomainProfile>` (throws `ValidationError` for malformed input).

Verdict precedence (first match wins): homepage for-sale signal → `for_sale` (medium); parking nameserver → `parked` (high); parking page text → `parked` (medium); homepage HTTP < 400 → `live_site` (medium); HTTP 401/403/429 → `live_site` (low, "not retried or bypassed"); other HTTP status → `no_site` (low); homepage unreachable → `no_site` (medium), or `unknown` (low) when the registration lookup also failed. An RDAP or WHOIS "not found" returns `not_registered` and skips the homepage.

- [ ] **Step 1: Write the failing test**

`server/test/research/profile.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { ValidationError } from '../../src/domain/name.js';
import type { HomepageResult } from '../../src/research/profile/homepage.js';
import { type ProfileDeps, profileDomain } from '../../src/research/profile/profile.js';
import type { RdapDomain, RdapResult } from '../../src/sources/rdap.js';
import type { WhoisResult } from '../../src/sources/whois.js';
import googleRecord from '../fixtures/rdap-domain-google.json' with { type: 'json' };
import parkedRecord from './fixtures/rdap-domain-parked.json' with { type: 'json' };

const NOW = new Date('2026-11-04T10:00:00.000Z');

const okPage = (overrides: Partial<Extract<HomepageResult, { kind: 'ok' }>> = {}): HomepageResult => ({
  kind: 'ok',
  url: 'https://acme.com/',
  finalUrl: 'https://acme.com/',
  httpStatus: 200,
  title: 'Acme',
  forSale: false,
  parkedPage: false,
  ...overrides,
});

async function makeDeps(parts: {
  rdap?: RdapResult;
  whois?: WhoisResult;
  ns?: string[] | null;
  homepage?: HomepageResult;
}): Promise<ProfileDeps & { calls: string[] }> {
  const calls: string[] = [];
  return {
    calls,
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-profile-'))),
    now: () => NOW,
    rdap: async () => {
      calls.push('rdap');
      return parts.rdap ?? { kind: 'registered', record: googleRecord as RdapDomain };
    },
    whois: async () => {
      calls.push('whois');
      return parts.whois ?? { kind: 'error', reason: 'not used' };
    },
    nameservers: async () => {
      calls.push('dns');
      return parts.ns ?? null;
    },
    homepage: async () => {
      calls.push('http');
      return parts.homepage ?? okPage();
    },
  };
}

describe('profileDomain', () => {
  it('reports a live site with RDAP registration fields', async () => {
    const deps = await makeDeps({});
    const profile = await profileDomain('Google.com', deps);
    expect(profile).toMatchObject({
      domain: 'google.com',
      status: 'live_site',
      confidence: 'medium',
      source: 'rdap+http',
      checkedAt: NOW.toISOString(),
      registration: {
        status: 'registered',
        source: 'rdap',
        createdAt: '1997-09-15T04:00:00Z',
        nameservers: ['ns1.google.com', 'ns2.google.com'],
      },
    });
    expect(deps.calls).toEqual(['rdap', 'http']);
  });

  it('marks parking nameservers as parked with high confidence', async () => {
    const deps = await makeDeps({ rdap: { kind: 'registered', record: parkedRecord as RdapDomain } });
    const profile = await profileDomain('parkedexample.com', deps);
    expect(profile).toMatchObject({
      status: 'parked',
      confidence: 'high',
      parkingProvider: 'sedoparking.com',
      registration: { registrar: 'Example Registrar, LLC' },
    });
  });

  it('prefers for_sale over parked when the page offers the domain', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'registered', record: parkedRecord as RdapDomain },
      homepage: okPage({ forSale: true }),
    });
    expect((await profileDomain('parkedexample.com', deps)).status).toBe('for_sale');
  });

  it('treats a bot wall as a live site with low confidence', async () => {
    const deps = await makeDeps({ homepage: okPage({ httpStatus: 403 }) });
    const profile = await profileDomain('acme.com', deps);
    expect(profile).toMatchObject({ status: 'live_site', confidence: 'low' });
    expect(profile.reason).toContain('not retried or bypassed');
  });

  it('reports no_site when the homepage is unreachable', async () => {
    const deps = await makeDeps({ homepage: { kind: 'error', reason: 'ENOTFOUND' } });
    expect(await profileDomain('acme.com', deps)).toMatchObject({
      status: 'no_site',
      confidence: 'medium',
      reason: 'Homepage unreachable: ENOTFOUND',
    });
  });

  it('falls back to WHOIS and fills nameservers from DNS when WHOIS has none', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'no_server' },
      whois: {
        kind: 'registered',
        server: 'whois.nic.example',
        raw: 'Domain Name: ACME.XYZ\nCreation Date: 2020-01-01T00:00:00Z\n',
      },
      ns: ['ns1.bodis.com'],
    });
    const profile = await profileDomain('acme.xyz', deps);
    expect(profile).toMatchObject({
      status: 'parked',
      source: 'whois+dns+http',
      registration: { source: 'whois', nameserverSource: 'dns', createdAt: '2020-01-01T00:00:00Z' },
    });
    expect(deps.calls).toEqual(['rdap', 'whois', 'dns', 'http']);
  });

  it('returns not_registered without fetching the homepage', async () => {
    const deps = await makeDeps({ rdap: { kind: 'not_found' } });
    const profile = await profileDomain('zzqx.com', deps);
    expect(profile).toMatchObject({ status: 'not_registered', confidence: 'high' });
    expect(profile.homepage).toBeUndefined();
    expect(deps.calls).toEqual(['rdap']);
  });

  it('returns unknown when registration and homepage both fail, and does not cache it', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'error', reason: 'RDAP HTTP 500' },
      whois: { kind: 'error', reason: 'timeout' },
      homepage: { kind: 'error', reason: 'ENOTFOUND' },
    });
    const first = await profileDomain('acme.com', deps);
    expect(first).toMatchObject({ status: 'unknown', confidence: 'low' });
    expect(first.reason).toContain('RDAP: RDAP HTTP 500; WHOIS: timeout');
    await profileDomain('acme.com', deps);
    expect(deps.calls.filter((c) => c === 'rdap')).toHaveLength(2);
  });

  it('serves a second call from the cache', async () => {
    const deps = await makeDeps({});
    await profileDomain('acme.com', deps);
    await profileDomain('acme.com', deps);
    expect(deps.calls).toEqual(['rdap', 'http']);
  });

  it('rejects malformed input', async () => {
    const deps = await makeDeps({});
    await expect(profileDomain('not a domain', deps)).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/profile.test.ts`
Expected: FAIL, because `../../src/research/profile/profile.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`server/src/research/profile/profile.ts`:
```ts
import type { DiskCache } from '../../cache/cache.js';
import { TTL } from '../../cache/ttl.js';
import { splitDomain } from '../../domain/name.js';
import type { Confidence } from '../../domain/types.js';
import type { RdapResult } from '../../sources/rdap.js';
import type { WhoisResult } from '../../sources/whois.js';
import type { HomepageResult } from './homepage.js';
import { parkingProvider } from './parking.js';
import { fromRdap, fromWhois, type RegistrationFields } from './registration.js';

// The spec gives no profile TTL; a day matches how slowly site state changes.
export const PROFILE_TTL_MS = 24 * 3_600_000;

export type ProfileStatus =
  | 'live_site'
  | 'parked'
  | 'for_sale'
  | 'no_site'
  | 'not_registered'
  | 'unknown';

export interface Registration extends RegistrationFields {
  status: 'registered' | 'not_found' | 'unknown';
  source: 'rdap' | 'whois' | 'none';
  nameserverSource: 'rdap' | 'whois' | 'dns' | 'none';
  reason?: string;
}

export interface DomainProfile {
  domain: string;
  status: ProfileStatus;
  confidence: Confidence;
  source: string;
  checkedAt: string;
  reason: string;
  registration: Registration;
  parkingProvider?: string;
  homepage?: HomepageResult;
}

export interface ProfileDeps {
  rdap(domain: string, tld: string): Promise<RdapResult>;
  whois(domain: string, tld: string): Promise<WhoisResult>;
  nameservers(domain: string): Promise<string[] | null>;
  homepage(domain: string): Promise<HomepageResult>;
  cache: DiskCache;
  now?: () => Date;
}

function failReason(prefix: string, result: RdapResult | WhoisResult): string {
  if (result.kind === 'no_server') return `${prefix}: no server for this TLD`;
  if (result.kind === 'error') return `${prefix}: ${result.reason}`;
  return `${prefix}: response not understood`;
}

async function lookupRegistration(
  domain: string,
  tld: string,
  deps: ProfileDeps,
): Promise<Registration> {
  const rdap = await deps.rdap(domain, tld);
  if (rdap.kind === 'registered') {
    return { status: 'registered', source: 'rdap', nameserverSource: 'rdap', ...fromRdap(rdap.record) };
  }
  if (rdap.kind === 'not_found') {
    return { status: 'not_found', source: 'rdap', nameserverSource: 'none', nameservers: [] };
  }
  const whois = await deps.whois(domain, tld);
  if (whois.kind === 'registered') {
    return { status: 'registered', source: 'whois', nameserverSource: 'whois', ...fromWhois(whois.raw) };
  }
  if (whois.kind === 'not_found') {
    return { status: 'not_found', source: 'whois', nameserverSource: 'none', nameservers: [] };
  }
  return {
    status: 'unknown',
    source: 'none',
    nameserverSource: 'none',
    nameservers: [],
    reason: `${failReason('RDAP', rdap)}; ${failReason('WHOIS', whois)}`,
  };
}

type Verdict = Pick<DomainProfile, 'status' | 'confidence' | 'reason'>;

function classify(
  registration: Registration,
  provider: string | undefined,
  homepage: HomepageResult,
): Verdict {
  if (homepage.kind === 'ok' && homepage.forSale) {
    return {
      status: 'for_sale',
      confidence: 'medium',
      reason: 'The homepage has for-sale wording or redirects to a domain marketplace.',
    };
  }
  if (provider) {
    return { status: 'parked', confidence: 'high', reason: `Nameservers belong to ${provider}.` };
  }
  if (homepage.kind === 'ok' && homepage.parkedPage) {
    return { status: 'parked', confidence: 'medium', reason: 'The homepage looks like a parking page.' };
  }
  if (homepage.kind === 'ok') {
    if (homepage.httpStatus < 400) {
      return { status: 'live_site', confidence: 'medium', reason: `Homepage answered HTTP ${homepage.httpStatus}.` };
    }
    if ([401, 403, 429].includes(homepage.httpStatus)) {
      return {
        status: 'live_site',
        confidence: 'low',
        reason: `A web server answered but refused automated access (HTTP ${homepage.httpStatus}); not retried or bypassed.`,
      };
    }
    return { status: 'no_site', confidence: 'low', reason: `Homepage returned HTTP ${homepage.httpStatus}.` };
  }
  if (registration.status === 'unknown') {
    return {
      status: 'unknown',
      confidence: 'low',
      reason: `${registration.reason ?? 'Registration lookup failed'}; homepage: ${homepage.reason}`,
    };
  }
  return { status: 'no_site', confidence: 'medium', reason: `Homepage unreachable: ${homepage.reason}` };
}

function ttlFor(profile: DomainProfile): number {
  if (profile.status === 'unknown') return 0;
  if (profile.status === 'not_registered') return TTL.likelyAvailable;
  return PROFILE_TTL_MS;
}

async function buildProfile(domain: string, tld: string, deps: ProfileDeps): Promise<DomainProfile> {
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();
  const registration = await lookupRegistration(domain, tld, deps);

  if (registration.status === 'not_found') {
    return {
      domain,
      status: 'not_registered',
      confidence: registration.source === 'rdap' ? 'high' : 'medium',
      source: registration.source,
      checkedAt,
      reason: 'No registration found. Use check_domains for availability.',
      registration,
    };
  }

  if (registration.nameservers.length === 0) {
    const ns = await deps.nameservers(domain);
    if (ns && ns.length > 0) {
      registration.nameservers = ns;
      registration.nameserverSource = 'dns';
    }
  }

  const provider = parkingProvider(registration.nameservers);
  const homepage = await deps.homepage(domain);
  const sources = [registration.source, registration.nameserverSource, 'http'].filter(
    (s, i, all) => s !== 'none' && all.indexOf(s) === i,
  );
  return {
    domain,
    ...classify(registration, provider, homepage),
    source: sources.join('+'),
    checkedAt,
    registration,
    parkingProvider: provider,
    homepage,
  };
}

/** Profiles one domain. Throws ValidationError for malformed input. */
export async function profileDomain(input: string, deps: ProfileDeps): Promise<DomainProfile> {
  const { label, tld } = splitDomain(input);
  const domain = `${label}.${tld}`;
  const key = `profile:${domain}`;
  const cached = await deps.cache.get<DomainProfile>(key);
  if (cached) return cached;
  const profile = await buildProfile(domain, tld, deps);
  try {
    await deps.cache.set(key, profile, ttlFor(profile));
  } catch {
    // The cache is only an optimisation; a write failure must not fail the profile.
  }
  return profile;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm test test/research/profile.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/profile/profile.ts server/test/research/profile.test.ts
git commit -m "feat(research): add profileDomain with registration, parking, and homepage verdict"
```

---

### Task 4: Handle platform rules

**Files:**
- Create: `server/src/research/handles/platforms.ts`
- Test: `server/test/research/platforms.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PLATFORMS = ['github', 'npm', 'pypi', 'reddit', 'youtube', 'x', 'instagram', 'tiktok', 'linkedin'] as const`; `type Platform`; `PLATFORM_RULES: Record<Platform, { pattern: RegExp; rule: string; normalize(h: string): string; profileUrl(h: string): string }>`; `type NormalizedHandle = { ok: true; handle: string } | { ok: false; reason: string }`; `normalizeHandle(platform: Platform, raw: string): NormalizedHandle`; `profileUrl(platform: Platform, handle: string): string`.

- [ ] **Step 1: Write the failing test**

`server/test/research/platforms.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  normalizeHandle,
  PLATFORMS,
  profileUrl,
} from '../../src/research/handles/platforms.js';

describe('normalizeHandle', () => {
  it('strips a leading @ and lower-cases', () => {
    expect(normalizeHandle('github', ' @Acme-HQ ')).toEqual({ ok: true, handle: 'acme-hq' });
  });

  it('applies PEP 503 normalization for PyPI', () => {
    expect(normalizeHandle('pypi', 'Acme__Tools.Py')).toEqual({ ok: true, handle: 'acme-tools-py' });
  });

  it('rejects names that break a platform rule, with the rule in the message', () => {
    const result = normalizeHandle('github', 'acme--hq');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('single inner hyphens');
    expect(normalizeHandle('reddit', 'ab').ok).toBe(false);
    expect(normalizeHandle('x', 'acme-hq').ok).toBe(false);
    expect(normalizeHandle('npm', '_acme').ok).toBe(false);
  });

  it('accepts a plain name on every platform', () => {
    for (const platform of PLATFORMS) {
      expect(normalizeHandle(platform, 'acmehq')).toEqual({ ok: true, handle: 'acmehq' });
    }
  });
});

describe('profileUrl', () => {
  it('builds the public profile URL', () => {
    expect(profileUrl('github', 'acme')).toBe('https://github.com/acme');
    expect(profileUrl('youtube', 'acme')).toBe('https://www.youtube.com/@acme');
    expect(profileUrl('pypi', 'acme')).toBe('https://pypi.org/project/acme/');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/platforms.test.ts`
Expected: FAIL, because `../../src/research/handles/platforms.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`server/src/research/handles/platforms.ts`:
```ts
export const PLATFORMS = [
  'github',
  'npm',
  'pypi',
  'reddit',
  'youtube',
  'x',
  'instagram',
  'tiktok',
  'linkedin',
] as const;

export type Platform = (typeof PLATFORMS)[number];

interface PlatformRule {
  pattern: RegExp;
  rule: string;
  normalize(handle: string): string;
  profileUrl(handle: string): string;
}

const lower = (handle: string): string => handle.toLowerCase();

export const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  github: {
    pattern: /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/,
    rule: '1-39 letters, digits, or single inner hyphens',
    normalize: lower,
    profileUrl: (h) => `https://github.com/${h}`,
  },
  npm: {
    pattern: /^[a-z0-9][a-z0-9._~-]{0,213}$/,
    rule: 'up to 214 lower-case URL-safe characters, not starting with "." or "_"',
    normalize: lower,
    profileUrl: (h) => `https://www.npmjs.com/package/${h}`,
  },
  pypi: {
    pattern: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    rule: 'letters, digits, ".", "_", or "-", starting and ending with a letter or digit',
    // PEP 503 normalization: runs of "-", "_", "." become one "-".
    normalize: (h) => h.toLowerCase().replace(/[-_.]+/g, '-'),
    profileUrl: (h) => `https://pypi.org/project/${h}/`,
  },
  reddit: {
    pattern: /^[a-z0-9_-]{3,20}$/,
    rule: '3-20 letters, digits, "_" or "-"',
    normalize: lower,
    profileUrl: (h) => `https://www.reddit.com/user/${h}/`,
  },
  youtube: {
    pattern: /^[a-z0-9._-]{3,30}$/,
    rule: '3-30 letters, digits, ".", "_" or "-"',
    normalize: lower,
    profileUrl: (h) => `https://www.youtube.com/@${h}`,
  },
  x: {
    pattern: /^[a-z0-9_]{4,15}$/,
    rule: '4-15 letters, digits, or "_"',
    normalize: lower,
    profileUrl: (h) => `https://x.com/${h}`,
  },
  instagram: {
    pattern: /^[a-z0-9._]{1,30}$/,
    rule: '1-30 letters, digits, "." or "_"',
    normalize: lower,
    profileUrl: (h) => `https://www.instagram.com/${h}/`,
  },
  tiktok: {
    pattern: /^[a-z0-9._]{2,24}$/,
    rule: '2-24 letters, digits, "." or "_"',
    normalize: lower,
    profileUrl: (h) => `https://www.tiktok.com/@${h}`,
  },
  linkedin: {
    pattern: /^[a-z0-9-]{3,100}$/,
    rule: '3-100 letters, digits, or "-" (company page URL)',
    normalize: lower,
    profileUrl: (h) => `https://www.linkedin.com/company/${h}/`,
  },
};

export type NormalizedHandle = { ok: true; handle: string } | { ok: false; reason: string };

export function normalizeHandle(platform: Platform, raw: string): NormalizedHandle {
  const rule = PLATFORM_RULES[platform];
  const handle = rule.normalize(raw.trim().replace(/^@/, ''));
  if (!rule.pattern.test(handle)) {
    return { ok: false, reason: `"${raw}" is not a valid ${platform} name: ${rule.rule}.` };
  }
  return { ok: true, handle };
}

export function profileUrl(platform: Platform, handle: string): string {
  return PLATFORM_RULES[platform].profileUrl(handle);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm test test/research/platforms.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/handles/platforms.ts server/test/research/platforms.test.ts
git commit -m "feat(research): add handle platform rules and profile URLs"
```

---

### Task 5: Optional research keys and open handle checkers (GitHub, npm, PyPI)

**Files:**
- Create: `server/src/research/keys.ts`, `server/src/research/handles/checkers.ts`
- Test: `server/test/research/keys.test.ts`, `server/test/research/checkers.test.ts`

**Interfaces:**
- Consumes: `HttpFetch`, `errorMessage`, `Confidence`.
- Produces:
  - `type EuipoEnv = 'production' | 'sandbox'`; `interface ResearchKeys { githubToken?: string; reddit?: { clientId: string; clientSecret: string }; youtubeApiKey?: string; euipo?: { clientId: string; clientSecret: string; env: EuipoEnv } }`; `readResearchKeys(env: NodeJS.ProcessEnv): ResearchKeys`. Env vars: `GITHUB_TOKEN`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `EUIPO_CLIENT_ID`, `EUIPO_CLIENT_SECRET`, `EUIPO_ENV`.
  - `type HandleStatus = 'taken' | 'likely_available' | 'unknown' | 'invalid'`; `type HandleMethod = 'api' | 'manual' | 'none'`; `interface Probe { status: Exclude<HandleStatus, 'invalid'>; confidence: Confidence; method: HandleMethod; source: string; reason?: string }`; `type Checker = (handle: string) => Promise<Probe>`; `unknownProbe(source: string, reason: string): Probe`; `manualChecker(reason: string): Checker`; `statusProbe(http, url, init, source, notFoundReason): Promise<Probe>`; `githubChecker(http: HttpFetch, token?: string): Checker`; `npmChecker(http: HttpFetch): Checker`; `pypiChecker(http: HttpFetch): Checker`.

Key safety: reasons are built only from status codes and `errorMessage` of the shared `HttpError`, whose message names only the host. Tokens go only in request headers. The tests assert the token never appears in a result.

- [ ] **Step 1: Write the failing tests**

`server/test/research/keys.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readResearchKeys } from '../../src/research/keys.js';

describe('readResearchKeys', () => {
  it('returns no keys for an empty env', () => {
    expect(readResearchKeys({})).toEqual({});
  });

  it('reads every optional key and trims values', () => {
    expect(
      readResearchKeys({
        GITHUB_TOKEN: ' gh ',
        REDDIT_CLIENT_ID: 'rid',
        REDDIT_CLIENT_SECRET: 'rsecret',
        YOUTUBE_API_KEY: 'yt',
        EUIPO_CLIENT_ID: 'eid',
        EUIPO_CLIENT_SECRET: 'esecret',
        EUIPO_ENV: 'sandbox',
      }),
    ).toEqual({
      githubToken: 'gh',
      reddit: { clientId: 'rid', clientSecret: 'rsecret' },
      youtubeApiKey: 'yt',
      euipo: { clientId: 'eid', clientSecret: 'esecret', env: 'sandbox' },
    });
  });

  it('ignores a pair when one half is missing or blank, and defaults EUIPO to production', () => {
    expect(
      readResearchKeys({
        REDDIT_CLIENT_ID: 'rid',
        REDDIT_CLIENT_SECRET: '  ',
        EUIPO_CLIENT_ID: 'eid',
        EUIPO_CLIENT_SECRET: 'esecret',
        EUIPO_ENV: 'prod',
      }),
    ).toEqual({ euipo: { clientId: 'eid', clientSecret: 'esecret', env: 'production' } });
  });
});
```

`server/test/research/checkers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  githubChecker,
  manualChecker,
  npmChecker,
  pypiChecker,
} from '../../src/research/handles/checkers.js';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function fakeHttp(respond: (url: string) => Response | Error): { http: HttpFetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const http: HttpFetch = async (url, init) => {
    seen.push({ url, init });
    const out = respond(url);
    if (out instanceof Error) throw out;
    return out;
  };
  return { http, seen };
}

const status = (code: number) => () => new Response(null, { status: code });

describe('githubChecker', () => {
  it('reports taken on 200 with a HEAD to the users API', async () => {
    const { http, seen } = fakeHttp(status(200));
    expect(await githubChecker(http)('acme')).toEqual({
      status: 'taken',
      confidence: 'high',
      method: 'api',
      source: 'github-api',
    });
    expect(seen[0]?.url).toBe('https://api.github.com/users/acme');
    expect(seen[0]?.init?.method).toBe('HEAD');
  });

  it('reports likely_available with medium confidence on 404', async () => {
    const { http } = fakeHttp(status(404));
    expect(await githubChecker(http)('acme')).toMatchObject({
      status: 'likely_available',
      confidence: 'medium',
    });
  });

  it('sends the optional token as a bearer header', async () => {
    const { http, seen } = fakeHttp(status(200));
    await githubChecker(http, 'tok-123')('acme');
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-123');
  });

  it('reports unknown on a rate-limit status, without the token in the reason', async () => {
    const { http } = fakeHttp(status(403));
    const probe = await githubChecker(http, 'tok-123')('acme');
    expect(probe).toMatchObject({ status: 'unknown', confidence: 'low' });
    expect(probe.reason).toBe('github-api returned HTTP 403');
    expect(JSON.stringify(probe)).not.toContain('tok-123');
  });

  it('reports unknown on a network failure', async () => {
    const { http } = fakeHttp(() => new Error('Request to api.github.com failed after 3 tries'));
    expect(await githubChecker(http)('acme')).toMatchObject({
      status: 'unknown',
      reason: 'Request to api.github.com failed after 3 tries',
    });
  });
});

describe('npmChecker and pypiChecker', () => {
  it('query the npm registry document', async () => {
    const { http, seen } = fakeHttp(status(404));
    expect((await npmChecker(http)('acme')).status).toBe('likely_available');
    expect(seen[0]?.url).toBe('https://registry.npmjs.org/acme');
  });

  it('query the PyPI simple API with the JSON media type', async () => {
    const { http, seen } = fakeHttp(status(200));
    expect((await pypiChecker(http)('acme-tools')).status).toBe('taken');
    expect(seen[0]?.url).toBe('https://pypi.org/simple/acme-tools/');
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.accept).toBe('application/vnd.pypi.simple.v1+json');
  });
});

describe('manualChecker', () => {
  it('returns unknown with method manual and makes no request', async () => {
    expect(await manualChecker('check by hand')('acme')).toEqual({
      status: 'unknown',
      confidence: 'low',
      method: 'manual',
      source: 'none',
      reason: 'check by hand',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test test/research/keys.test.ts test/research/checkers.test.ts`
Expected: FAIL, because `../../src/research/keys.js` and `../../src/research/handles/checkers.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`server/src/research/keys.ts`:
```ts
export type EuipoEnv = 'production' | 'sandbox';

/** Optional API keys for research sources. Read from env only; never logged or returned. */
export interface ResearchKeys {
  githubToken?: string;
  reddit?: { clientId: string; clientSecret: string };
  youtubeApiKey?: string;
  euipo?: { clientId: string; clientSecret: string; env: EuipoEnv };
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function readResearchKeys(env: NodeJS.ProcessEnv): ResearchKeys {
  const keys: ResearchKeys = {};
  const githubToken = read(env, 'GITHUB_TOKEN');
  if (githubToken) keys.githubToken = githubToken;

  const redditId = read(env, 'REDDIT_CLIENT_ID');
  const redditSecret = read(env, 'REDDIT_CLIENT_SECRET');
  if (redditId && redditSecret) keys.reddit = { clientId: redditId, clientSecret: redditSecret };

  const youtubeApiKey = read(env, 'YOUTUBE_API_KEY');
  if (youtubeApiKey) keys.youtubeApiKey = youtubeApiKey;

  const euipoId = read(env, 'EUIPO_CLIENT_ID');
  const euipoSecret = read(env, 'EUIPO_CLIENT_SECRET');
  if (euipoId && euipoSecret) {
    keys.euipo = {
      clientId: euipoId,
      clientSecret: euipoSecret,
      env: read(env, 'EUIPO_ENV') === 'sandbox' ? 'sandbox' : 'production',
    };
  }
  return keys;
}
```

`server/src/research/handles/checkers.ts`:
```ts
import type { Confidence } from '../../domain/types.js';
import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';

export type HandleStatus = 'taken' | 'likely_available' | 'unknown' | 'invalid';
export type HandleMethod = 'api' | 'manual' | 'none';

/** What one platform check found, before the handle and profile URL are attached. */
export interface Probe {
  status: Exclude<HandleStatus, 'invalid'>;
  confidence: Confidence;
  method: HandleMethod;
  source: string;
  reason?: string;
}

export type Checker = (handle: string) => Promise<Probe>;

export function unknownProbe(source: string, reason: string): Probe {
  return { status: 'unknown', confidence: 'low', method: 'api', source, reason };
}

/** A platform without a reliable open method: no request, always unknown. */
export function manualChecker(reason: string): Checker {
  return async () => ({ status: 'unknown', confidence: 'low', method: 'manual', source: 'none', reason });
}

/** 2xx means taken, 404 means likely available, anything else is unknown. */
export async function statusProbe(
  http: HttpFetch,
  url: string,
  init: RequestInit,
  source: string,
  notFoundReason: string,
): Promise<Probe> {
  try {
    const res = await http(url, init);
    void res.body?.cancel().catch(() => undefined);
    if (res.ok) return { status: 'taken', confidence: 'high', method: 'api', source };
    if (res.status === 404) {
      return { status: 'likely_available', confidence: 'medium', method: 'api', source, reason: notFoundReason };
    }
    return unknownProbe(source, `${source} returned HTTP ${res.status}`);
  } catch (error) {
    return unknownProbe(source, errorMessage(error));
  }
}

export function githubChecker(http: HttpFetch, token?: string): Checker {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return (handle) =>
    statusProbe(
      http,
      `https://api.github.com/users/${encodeURIComponent(handle)}`,
      { method: 'HEAD', headers },
      'github-api',
      'No GitHub user or organization has this name. GitHub may still reserve some names.',
    );
}

export function npmChecker(http: HttpFetch): Checker {
  return (handle) =>
    statusProbe(
      http,
      `https://registry.npmjs.org/${encodeURIComponent(handle)}`,
      { method: 'HEAD' },
      'npm-registry',
      'No npm package has this name. npm may still reject names too similar to existing packages.',
    );
}

export function pypiChecker(http: HttpFetch): Checker {
  return (handle) =>
    statusProbe(
      http,
      `https://pypi.org/simple/${encodeURIComponent(handle)}/`,
      { method: 'HEAD', headers: { accept: 'application/vnd.pypi.simple.v1+json' } },
      'pypi-simple-api',
      'No PyPI project has this normalized name. PyPI may still block prohibited or previously used names.',
    );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && pnpm test test/research/keys.test.ts test/research/checkers.test.ts`
Expected: PASS (3 + 8 tests).

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/keys.ts server/src/research/handles/checkers.ts server/test/research/keys.test.ts server/test/research/checkers.test.ts
git commit -m "feat(research): add optional research keys and GitHub, npm, PyPI checkers"
```

---

### Task 6: Keyed handle checkers (Reddit, YouTube)

**Files:**
- Create: `server/src/research/handles/keyed-checkers.ts`
- Test: `server/test/research/keyed-checkers.test.ts`

**Interfaces:**
- Consumes: `REPO_URL`, `VERSION` (`server/src/config.ts`, read only); `HttpFetch`; `errorMessage`; `Checker`, `statusProbe`, `unknownProbe` (Task 5).
- Produces: `REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'`; `REDDIT_USER_AGENT: string`; `redditChecker(http: HttpFetch, creds: { clientId: string; clientSecret: string }, now?: () => number): Checker`; `youtubeChecker(http: HttpFetch, apiKey: string): Checker`.

Notes: the Reddit token is kept in memory only, never in `DiskCache`. The YouTube key travels in the query string as Google requires; the shared `HttpError` message names only the host, so the key cannot leak through a reason.

- [ ] **Step 1: Write the failing test**

`server/test/research/keyed-checkers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  REDDIT_TOKEN_URL,
  redditChecker,
  youtubeChecker,
} from '../../src/research/handles/keyed-checkers.js';

const SECRET = 'SECRET-VALUE-42';

function fakeHttp(respond: (url: string, init?: RequestInit) => Response | Error): {
  http: HttpFetch;
  urls: string[];
} {
  const urls: string[] = [];
  const http: HttpFetch = async (url, init) => {
    urls.push(url);
    const out = respond(url, init);
    if (out instanceof Error) throw out;
    return out;
  };
  return { http, urls };
}

const tokenResponse = () => Response.json({ access_token: 'bearer-1', expires_in: 3600 });

describe('redditChecker', () => {
  const creds = { clientId: 'id-1', clientSecret: SECRET };

  it('gets an app-only token once and reports taken on 200', async () => {
    const { http, urls } = fakeHttp((url) =>
      url === REDDIT_TOKEN_URL ? tokenResponse() : Response.json({ name: 'acme' }),
    );
    const check = redditChecker(http, creds, () => 0);
    expect(await check('acme')).toMatchObject({ status: 'taken', source: 'reddit-api' });
    await check('other');
    expect(urls).toEqual([
      REDDIT_TOKEN_URL,
      'https://oauth.reddit.com/user/acme/about',
      'https://oauth.reddit.com/user/other/about',
    ]);
  });

  it('reports likely_available on 404', async () => {
    const { http } = fakeHttp((url) =>
      url === REDDIT_TOKEN_URL ? tokenResponse() : new Response(null, { status: 404 }),
    );
    expect(await redditChecker(http, creds)('acme')).toMatchObject({
      status: 'likely_available',
      confidence: 'medium',
    });
  });

  it('reports unknown when the token request fails, without leaking the secret', async () => {
    const { http } = fakeHttp(() => new Response('denied', { status: 401 }));
    const probe = await redditChecker(http, creds)('acme');
    expect(probe).toMatchObject({
      status: 'unknown',
      reason: 'Reddit token request returned HTTP 401',
    });
    expect(JSON.stringify(probe)).not.toContain(SECRET);
  });
});

describe('youtubeChecker', () => {
  it('reports taken when the channel list has items', async () => {
    const { http, urls } = fakeHttp(() => Response.json({ items: [{ id: 'UC1' }] }));
    expect(await youtubeChecker(http, SECRET)('acme')).toMatchObject({ status: 'taken' });
    expect(urls[0]).toContain('forHandle=%40acme');
  });

  it('reports likely_available when items is empty or missing', async () => {
    const { http } = fakeHttp(() => Response.json({ kind: 'youtube#channelListResponse' }));
    expect(await youtubeChecker(http, SECRET)('acme')).toMatchObject({
      status: 'likely_available',
      confidence: 'medium',
    });
  });

  it('reports unknown on quota errors, without the key in the result', async () => {
    const { http } = fakeHttp(() => new Response('{}', { status: 403 }));
    const probe = await youtubeChecker(http, SECRET)('acme');
    expect(probe).toMatchObject({
      status: 'unknown',
      reason: 'youtube-data-api returned HTTP 403',
    });
    expect(JSON.stringify(probe)).not.toContain(SECRET);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/keyed-checkers.test.ts`
Expected: FAIL, because `../../src/research/handles/keyed-checkers.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`server/src/research/handles/keyed-checkers.ts`:
```ts
import { REPO_URL, VERSION } from '../../config.js';
import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';
import { type Checker, statusProbe, unknownProbe } from './checkers.js';

export const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
// Reddit asks API clients for a "<platform>:<app id>:<version>" User-Agent.
export const REDDIT_USER_AGENT = `nodejs:domain-name-engine:${VERSION} (+${REPO_URL})`;

export function redditChecker(
  http: HttpFetch,
  creds: { clientId: string; clientSecret: string },
  now: () => number = Date.now,
): Checker {
  let token: { value: string; expiresAt: number } | undefined;

  const getToken = async (): Promise<string> => {
    if (token && token.expiresAt > now()) return token.value;
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const res = await http(REDDIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': REDDIT_USER_AGENT,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Reddit token request returned HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') {
      throw new Error('Reddit token response had no access_token');
    }
    const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    token = { value: body.access_token, expiresAt: now() + Math.max(lifetime - 60, 0) * 1000 };
    return token.value;
  };

  return async (handle) => {
    let bearer: string;
    try {
      bearer = await getToken();
    } catch (error) {
      return unknownProbe('reddit-api', errorMessage(error));
    }
    return statusProbe(
      http,
      `https://oauth.reddit.com/user/${encodeURIComponent(handle)}/about`,
      { headers: { authorization: `Bearer ${bearer}`, 'user-agent': REDDIT_USER_AGENT } },
      'reddit-api',
      'No Reddit account has this name. Deleted accounts also return 404 and their names cannot be reused.',
    );
  };
}

export function youtubeChecker(http: HttpFetch, apiKey: string): Checker {
  return async (handle) => {
    const url =
      'https://www.googleapis.com/youtube/v3/channels?part=id' +
      `&forHandle=${encodeURIComponent(`@${handle}`)}&key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await http(url);
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        return unknownProbe('youtube-data-api', `youtube-data-api returned HTTP ${res.status}`);
      }
      const body = (await res.json()) as { items?: unknown };
      if (Array.isArray(body.items) && body.items.length > 0) {
        return { status: 'taken', confidence: 'high', method: 'api', source: 'youtube-data-api' };
      }
      return {
        status: 'likely_available',
        confidence: 'medium',
        method: 'api',
        source: 'youtube-data-api',
        reason: 'No YouTube channel uses this handle. YouTube may still reserve or block it.',
      };
    } catch (error) {
      return unknownProbe('youtube-data-api', errorMessage(error));
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm test test/research/keyed-checkers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/handles/keyed-checkers.ts server/test/research/keyed-checkers.test.ts
git commit -m "feat(research): add keyed Reddit and YouTube handle checkers"
```

---

### Task 7: `checkHandles` orchestrator

**Files:**
- Create: `server/src/research/handles/check.ts`
- Test: `server/test/research/handles.test.ts`

**Interfaces:**
- Consumes: `DiskCache`, `TTL.handles`, `Confidence`, `HttpFetch`; `ResearchKeys` (Task 5); `Checker`, `HandleMethod`, `HandleStatus`, `Probe`, `githubChecker`, `npmChecker`, `pypiChecker`, `manualChecker` (Task 5); `redditChecker`, `youtubeChecker` (Task 6); `normalizeHandle`, `Platform`, `PLATFORMS`, `profileUrl` (Task 4).
- Produces: `interface HandleCheck { platform: Platform; handle: string; status: HandleStatus; confidence: Confidence; method: HandleMethod; source: string; checkedAt: string; profileUrl?: string; reason?: string }`; `interface HandleDeps { checkers: Record<Platform, Checker>; cache: DiskCache; now?: () => Date }`; `MANUAL_REASONS: { reddit; youtube; x; instagram; tiktok; linkedin }` (strings); `createCheckers(http: HttpFetch, keys: ResearchKeys): Record<Platform, Checker>`; `checkHandles(handles: readonly string[], platforms: readonly Platform[], deps: HandleDeps, concurrency?: number): Promise<HandleCheck[]>`.

Per-platform method and reliability (this is what the tool reports):

| Platform | Method | Reliability |
|---|---|---|
| github | REST API, `HEAD /users/{name}` | `taken` high; `likely_available` medium (reserved names) |
| npm | registry `HEAD /{name}` | `taken` high; `likely_available` medium (npm similarity rules) |
| pypi | Simple API `HEAD /simple/{name}/` | `taken` high; `likely_available` medium (prohibited or reused names) |
| reddit | OAuth API with keys, else manual | with keys: `taken` high, `likely_available` medium; without: `unknown` |
| youtube | Data API with key, else manual | with key: `taken` high, `likely_available` medium; without: `unknown` |
| x, instagram, tiktok, linkedin | manual only | always `unknown`, method `manual`, with profile URL |

- [ ] **Step 1: Write the failing test**

`server/test/research/handles.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import type { HttpFetch } from '../../src/http/http.js';
import {
  checkHandles,
  createCheckers,
  type HandleDeps,
  MANUAL_REASONS,
} from '../../src/research/handles/check.js';
import type { Checker, Probe } from '../../src/research/handles/checkers.js';
import { PLATFORMS, type Platform } from '../../src/research/handles/platforms.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');

async function makeDeps(probe: Probe): Promise<HandleDeps & { calls: string[] }> {
  const calls: string[] = [];
  const checker =
    (platform: Platform): Checker =>
    async (handle) => {
      calls.push(`${platform}:${handle}`);
      return probe;
    };
  const checkers = Object.fromEntries(PLATFORMS.map((p) => [p, checker(p)])) as Record<
    Platform,
    Checker
  >;
  return {
    calls,
    checkers,
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-handles-'))),
    now: () => NOW,
  };
}

const taken: Probe = { status: 'taken', confidence: 'high', method: 'api', source: 'github-api' };

describe('checkHandles', () => {
  it('checks every handle × platform pair in order, with profile URLs', async () => {
    const deps = await makeDeps(taken);
    const results = await checkHandles(['Acme', 'zent'], ['github', 'npm'], deps);
    expect(results.map((r) => `${r.platform}:${r.handle}`)).toEqual([
      'github:acme',
      'npm:acme',
      'github:zent',
      'npm:zent',
    ]);
    expect(results[0]).toEqual({
      platform: 'github',
      handle: 'acme',
      status: 'taken',
      confidence: 'high',
      method: 'api',
      source: 'github-api',
      checkedAt: NOW.toISOString(),
      profileUrl: 'https://github.com/acme',
    });
  });

  it('returns invalid without calling the checker when the name breaks a platform rule', async () => {
    const deps = await makeDeps(taken);
    const [result] = await checkHandles(['ab'], ['reddit'], deps);
    expect(result).toMatchObject({ status: 'invalid', confidence: 'high', method: 'none' });
    expect(deps.calls).toEqual([]);
  });

  it('caches taken results but not unknown ones', async () => {
    const deps = await makeDeps(taken);
    await checkHandles(['acme'], ['github'], deps);
    await checkHandles(['acme'], ['github'], deps);
    expect(deps.calls).toEqual(['github:acme']);

    const unknownDeps = await makeDeps({
      status: 'unknown',
      confidence: 'low',
      method: 'api',
      source: 'github-api',
      reason: 'HTTP 403',
    });
    await checkHandles(['acme'], ['github'], unknownDeps);
    await checkHandles(['acme'], ['github'], unknownDeps);
    expect(unknownDeps.calls).toEqual(['github:acme', 'github:acme']);
  });
});

describe('createCheckers', () => {
  const noNetwork: HttpFetch = async () => {
    throw new Error('network must not be used');
  };

  it('uses manual checkers for platforms without keys or open APIs', async () => {
    const checkers = createCheckers(noNetwork, {});
    for (const platform of ['reddit', 'youtube', 'x', 'instagram', 'tiktok', 'linkedin'] as const) {
      const probe = await checkers[platform]('acme');
      expect(probe).toMatchObject({ status: 'unknown', method: 'manual' });
      expect(probe.reason).toBe(MANUAL_REASONS[platform]);
    }
  });

  it('switches Reddit and YouTube to API checkers when keys are set', async () => {
    const checkers = createCheckers(noNetwork, {
      reddit: { clientId: 'a', clientSecret: 'b' },
      youtubeApiKey: 'k',
    });
    expect(await checkers.reddit('acme')).toMatchObject({ status: 'unknown', method: 'api' });
    expect(await checkers.youtube('acme')).toMatchObject({ status: 'unknown', method: 'api' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/handles.test.ts`
Expected: FAIL, because `../../src/research/handles/check.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`server/src/research/handles/check.ts`:
```ts
import type { DiskCache } from '../../cache/cache.js';
import { TTL } from '../../cache/ttl.js';
import type { Confidence } from '../../domain/types.js';
import type { HttpFetch } from '../../http/http.js';
import type { ResearchKeys } from '../keys.js';
import {
  type Checker,
  githubChecker,
  type HandleMethod,
  type HandleStatus,
  manualChecker,
  npmChecker,
  pypiChecker,
} from './checkers.js';
import { redditChecker, youtubeChecker } from './keyed-checkers.js';
import { normalizeHandle, type Platform, profileUrl } from './platforms.js';

export interface HandleCheck {
  platform: Platform;
  handle: string;
  status: HandleStatus;
  confidence: Confidence;
  method: HandleMethod;
  source: string;
  checkedAt: string;
  profileUrl?: string;
  reason?: string;
}

export interface HandleDeps {
  checkers: Record<Platform, Checker>;
  cache: DiskCache;
  now?: () => Date;
}

// Reasons are dated so a reader knows when the platform behaviour was last confirmed.
export const MANUAL_REASONS = {
  reddit:
    'Reddit refuses logged-out API requests (HTTP 403, checked 2026-11-04). Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for an approved Reddit app, or open the profile URL.',
  youtube:
    'YouTube handle lookup needs the YouTube Data API. Set YOUTUBE_API_KEY, or open the profile URL.',
  x: 'X has no free lookup API and its pages block automated clients (checked 2026-11-04). Open the profile URL.',
  instagram:
    'Instagram has no open lookup API and its pages block automated clients (checked 2026-11-04). Open the profile URL.',
  tiktok:
    'TikTok has no open lookup API and its pages block automated clients (checked 2026-11-04). Open the profile URL.',
  linkedin:
    'LinkedIn has no open lookup API and its pages block automated clients (checked 2026-11-04). Open the company URL.',
} as const;

export function createCheckers(http: HttpFetch, keys: ResearchKeys): Record<Platform, Checker> {
  return {
    github: githubChecker(http, keys.githubToken),
    npm: npmChecker(http),
    pypi: pypiChecker(http),
    reddit: keys.reddit ? redditChecker(http, keys.reddit) : manualChecker(MANUAL_REASONS.reddit),
    youtube: keys.youtubeApiKey
      ? youtubeChecker(http, keys.youtubeApiKey)
      : manualChecker(MANUAL_REASONS.youtube),
    x: manualChecker(MANUAL_REASONS.x),
    instagram: manualChecker(MANUAL_REASONS.instagram),
    tiktok: manualChecker(MANUAL_REASONS.tiktok),
    linkedin: manualChecker(MANUAL_REASONS.linkedin),
  };
}

async function checkOne(
  platform: Platform,
  raw: string,
  deps: HandleDeps,
): Promise<HandleCheck> {
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();
  const normalized = normalizeHandle(platform, raw);
  if (!normalized.ok) {
    return {
      platform,
      handle: raw.trim(),
      status: 'invalid',
      confidence: 'high',
      method: 'none',
      source: 'none',
      checkedAt,
      reason: normalized.reason,
    };
  }
  const { handle } = normalized;
  const key = `handle:${platform}:${handle}`;
  const cached = await deps.cache.get<HandleCheck>(key);
  if (cached) return cached;

  const probe = await deps.checkers[platform](handle);
  const result: HandleCheck = {
    platform,
    handle,
    ...probe,
    checkedAt,
    profileUrl: profileUrl(platform, handle),
  };
  if (result.status === 'taken' || result.status === 'likely_available') {
    try {
      await deps.cache.set(key, result, TTL.handles);
    } catch {
      // The cache is only an optimisation; a write failure must not fail the check.
    }
  }
  return result;
}

export async function checkHandles(
  handles: readonly string[],
  platforms: readonly Platform[],
  deps: HandleDeps,
  concurrency = 4,
): Promise<HandleCheck[]> {
  const jobs = handles.flatMap((handle) => platforms.map((platform) => ({ handle, platform })));
  const results: HandleCheck[] = new Array(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index] as { handle: string; platform: Platform };
      results[index] = await checkOne(job.platform, job.handle, deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm test test/research/handles.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/handles/check.ts server/test/research/handles.test.ts
git commit -m "feat(research): add checkHandles with validation, cache, and manual platforms"
```

---

### Task 8: Trademark search links and EUIPO client

**Files:**
- Create: `server/src/research/trademarks/links.ts`, `server/src/research/trademarks/euipo.ts`, `server/test/research/fixtures/euipo-search-acme.json`
- Test: `server/test/research/euipo.test.ts`

**Interfaces:**
- Consumes: `HttpFetch`, `errorMessage`; `EuipoEnv` (Task 5).
- Produces:
  - `type TrademarkOffice = 'uspto' | 'euipo' | 'tmview' | 'wipo'`; `interface SearchLink { office: TrademarkOffice; url: string; note: string }`; `trademarkSearchLinks(mark: string): SearchLink[]`.
  - `EUIPO_ENDPOINTS: Record<EuipoEnv, { token: string; api: string }>`; `EUIPO_PAGE_SIZE = 25`; `interface TrademarkMatch { office: 'euipo'; mark: string; applicationNumber: string; status?: string; niceClasses: number[]; applicationDate?: string; applicants: string[]; url: string }`; `type EuipoResult = { kind: 'ok'; total: number; matches: TrademarkMatch[] } | { kind: 'error'; reason: string }`; `interface EuipoClient { env: EuipoEnv; search(mark: string, niceClasses: readonly number[]): Promise<EuipoResult> }`; `buildEuipoQuery(mark: string, niceClasses: readonly number[]): string`; `parseEuipoSearch(body: unknown): EuipoResult`; `createEuipoClient(http: HttpFetch, creds: { clientId: string; clientSecret: string; env: EuipoEnv }, now?: () => number): EuipoClient`.

The fixture follows the response keys used by the `euipo-tm-client` tests (`trademarks`, `totalElements`, `size`, `page`) and the RSQL field names from EUIPO's examples (`wordMarkSpecification.verbalElement`, `niceClasses`, `applicants.name`, `applicationDate`). The parser treats every field as optional and turns an unknown shape into an error, which becomes `unknown`. That is the spec's "on failure or schema change, return unknown" rule. Task 12's keyed live test confirms the real shape.

- [ ] **Step 1: Add the fixture**

`server/test/research/fixtures/euipo-search-acme.json`:
```json
{
  "trademarks": [
    {
      "applicationNumber": "018000001",
      "wordMarkSpecification": { "verbalElement": "ACME" },
      "markFeature": "WORD",
      "status": "REGISTERED",
      "niceClasses": [9, 42],
      "applicationDate": "2019-01-15",
      "applicants": [{ "name": "Acme Holdings GmbH" }]
    },
    {
      "applicationNumber": "018000002",
      "markFeature": "FIGURATIVE",
      "status": "EXPIRED",
      "niceClasses": ["35"],
      "applicants": []
    },
    { "markFeature": "WORD" }
  ],
  "size": 25,
  "totalElements": 2,
  "totalPages": 1,
  "page": 0
}
```

- [ ] **Step 2: Write the failing test**

`server/test/research/euipo.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  buildEuipoQuery,
  createEuipoClient,
  EUIPO_ENDPOINTS,
  parseEuipoSearch,
} from '../../src/research/trademarks/euipo.js';
import { trademarkSearchLinks } from '../../src/research/trademarks/links.js';
import searchFixture from './fixtures/euipo-search-acme.json' with { type: 'json' };

const SECRET = 'EUIPO-SECRET-99';
const creds = { clientId: 'client-1', clientSecret: SECRET, env: 'production' as const };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeHttp(responses: Array<Response | Error>): { http: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const http: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  };
  return { http, calls };
}

const token = (value = 'tok-1') => Response.json({ access_token: value, expires_in: 7200 });

describe('buildEuipoQuery', () => {
  it('builds a contains query on the word element', () => {
    expect(buildEuipoQuery('acme', [])).toBe('wordMarkSpecification.verbalElement==*acme*');
  });

  it('quotes values with spaces and strips quotes', () => {
    expect(buildEuipoQuery('acme "co"', [])).toBe(
      'wordMarkSpecification.verbalElement=="*acme co*"',
    );
  });

  it('adds a Nice class filter', () => {
    expect(buildEuipoQuery('acme', [9, 42])).toBe(
      'wordMarkSpecification.verbalElement==*acme* and niceClasses=in=(9,42)',
    );
  });
});

describe('parseEuipoSearch', () => {
  it('maps records and skips items without an application number', () => {
    const result = parseEuipoSearch(searchFixture);
    expect(result).toEqual({
      kind: 'ok',
      total: 2,
      matches: [
        {
          office: 'euipo',
          mark: 'ACME',
          applicationNumber: '018000001',
          status: 'REGISTERED',
          niceClasses: [9, 42],
          applicationDate: '2019-01-15',
          applicants: ['Acme Holdings GmbH'],
          url: 'https://euipo.europa.eu/eSearch/#details/trademarks/018000001',
        },
        {
          office: 'euipo',
          mark: '(no word element)',
          applicationNumber: '018000002',
          status: 'EXPIRED',
          niceClasses: [35],
          applicationDate: undefined,
          applicants: [],
          url: 'https://euipo.europa.eu/eSearch/#details/trademarks/018000002',
        },
      ],
    });
  });

  it('reports an error for an unknown shape', () => {
    expect(parseEuipoSearch({ results: [] })).toEqual({
      kind: 'error',
      reason: 'EUIPO response shape not recognized',
    });
  });
});

describe('createEuipoClient', () => {
  it('gets a client-credentials token, then searches with bearer and client id headers', async () => {
    const { http, calls } = fakeHttp([token(), Response.json(searchFixture)]);
    const result = await createEuipoClient(http, creds).search('acme', [9]);
    expect(result.kind).toBe('ok');

    expect(calls[0]?.url).toBe(EUIPO_ENDPOINTS.production.token);
    expect(calls[0]?.init?.method).toBe('POST');
    const form = new URLSearchParams(String(calls[0]?.init?.body));
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('uid');

    const search = new URL(calls[1]?.url ?? '');
    expect(`${search.origin}${search.pathname}`).toBe(
      'https://api.euipo.europa.eu/trademark-search/trademarks',
    );
    expect(search.searchParams.get('query')).toBe(
      'wordMarkSpecification.verbalElement==*acme* and niceClasses=in=(9)',
    );
    expect(search.searchParams.get('size')).toBe('25');
    const headers = calls[1]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-1');
    expect(headers['x-ibm-client-id']).toBe('client-1');
  });

  it('reuses the token across searches', async () => {
    const { http, calls } = fakeHttp([token(), Response.json(searchFixture), Response.json(searchFixture)]);
    const client = createEuipoClient(http, creds, () => 0);
    await client.search('acme', []);
    await client.search('zent', []);
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([
      EUIPO_ENDPOINTS.production.token,
      'https://api.euipo.europa.eu/trademark-search/trademarks',
      'https://api.euipo.europa.eu/trademark-search/trademarks',
    ]);
  });

  it('refreshes the token once on 401', async () => {
    const { http, calls } = fakeHttp([
      token('old'),
      new Response(null, { status: 401 }),
      token('new'),
      Response.json(searchFixture),
    ]);
    const result = await createEuipoClient(http, creds).search('acme', []);
    expect(result.kind).toBe('ok');
    expect((calls[3]?.init?.headers as Record<string, string>).authorization).toBe('Bearer new');
  });

  it('returns an error without the secret when the token request fails', async () => {
    const { http } = fakeHttp([new Response(`bad secret ${SECRET}`, { status: 401 })]);
    const result = await createEuipoClient(http, creds).search('acme', []);
    expect(result).toEqual({ kind: 'error', reason: 'EUIPO token request returned HTTP 401' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('uses the sandbox endpoints when asked', async () => {
    const { http, calls } = fakeHttp([token(), Response.json(searchFixture)]);
    await createEuipoClient(http, { ...creds, env: 'sandbox' }).search('acme', []);
    expect(calls[0]?.url).toBe(EUIPO_ENDPOINTS.sandbox.token);
    expect(calls[1]?.url).toContain('https://api-sandbox.euipo.europa.eu/trademark-search/');
  });
});

describe('trademarkSearchLinks', () => {
  it('returns one encoded link per office', () => {
    const links = trademarkSearchLinks('acme co');
    expect(links.map((l) => l.office)).toEqual(['uspto', 'euipo', 'tmview', 'wipo']);
    expect(links[0]?.url).toBe(
      'https://tmsearch.uspto.gov/search/search-results?query=acme%20co&section=default',
    );
    expect(links[3]?.note).toContain('"acme co"');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/euipo.test.ts`
Expected: FAIL, because `../../src/research/trademarks/euipo.js` cannot be resolved.

- [ ] **Step 4: Write the implementation**

`server/src/research/trademarks/links.ts`:
```ts
export type TrademarkOffice = 'uspto' | 'euipo' | 'tmview' | 'wipo';

export interface SearchLink {
  office: TrademarkOffice;
  url: string;
  note: string;
}

/** Direct search links for a manual check. These are web pages for people, never fetched. */
export function trademarkSearchLinks(mark: string): SearchLink[] {
  const q = encodeURIComponent(mark.trim());
  return [
    {
      office: 'uspto',
      url: `https://tmsearch.uspto.gov/search/search-results?query=${q}&section=default`,
      note: 'USPTO Trademark Search (United States)',
    },
    {
      office: 'euipo',
      url: `https://euipo.europa.eu/eSearch/#basic/1+1+1+1/100+100+100+100/${q}`,
      note: 'EUIPO eSearch plus (EU trade marks)',
    },
    {
      office: 'tmview',
      url: `https://www.tmdn.org/tmview/#/tmview/results?page=1&pageSize=30&criteria=C&basicSearch=${q}`,
      note: 'TMview (EU national offices and partner offices)',
    },
    {
      office: 'wipo',
      url: 'https://branddb.wipo.int/en/quicksearch',
      note: `WIPO Global Brand Database: search the brand name "${mark.trim()}"`,
    },
  ];
}
```

`server/src/research/trademarks/euipo.ts`:
```ts
import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';
import type { EuipoEnv } from '../keys.js';

// Checked 2026-11-04: both token URLs answer 401 to bad credentials; both API bases answer 401 without a token.
export const EUIPO_ENDPOINTS: Record<EuipoEnv, { token: string; api: string }> = {
  production: {
    token: 'https://euipo.europa.eu/cas-server-webapp/oidc/accessToken',
    api: 'https://api.euipo.europa.eu/trademark-search',
  },
  sandbox: {
    token: 'https://auth-sandbox.euipo.europa.eu/oidc/accessToken',
    api: 'https://api-sandbox.euipo.europa.eu/trademark-search',
  },
};

export const EUIPO_PAGE_SIZE = 25;

export interface TrademarkMatch {
  office: 'euipo';
  mark: string;
  applicationNumber: string;
  status?: string;
  niceClasses: number[];
  applicationDate?: string;
  applicants: string[];
  url: string;
}

export type EuipoResult =
  | { kind: 'ok'; total: number; matches: TrademarkMatch[] }
  | { kind: 'error'; reason: string };

export interface EuipoClient {
  env: EuipoEnv;
  search(mark: string, niceClasses: readonly number[]): Promise<EuipoResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** RSQL "contains" query on the word element, optionally limited to Nice classes. */
export function buildEuipoQuery(mark: string, niceClasses: readonly number[]): string {
  const term = mark.trim().replace(/["\\]/g, '');
  const value = /[\s'();,=!~<>]/.test(term) ? `"*${term}*"` : `*${term}*`;
  const parts = [`wordMarkSpecification.verbalElement==${value}`];
  if (niceClasses.length > 0) parts.push(`niceClasses=in=(${niceClasses.join(',')})`);
  return parts.join(' and ');
}

function parseMatch(item: unknown): TrademarkMatch | undefined {
  if (!isRecord(item) || typeof item.applicationNumber !== 'string') return undefined;
  const spec = isRecord(item.wordMarkSpecification) ? item.wordMarkSpecification : {};
  const classes = Array.isArray(item.niceClasses) ? item.niceClasses : [];
  const applicants = Array.isArray(item.applicants) ? item.applicants : [];
  return {
    office: 'euipo',
    mark: typeof spec.verbalElement === 'string' ? spec.verbalElement : '(no word element)',
    applicationNumber: item.applicationNumber,
    status: typeof item.status === 'string' ? item.status : undefined,
    niceClasses: classes.map(Number).filter((n) => Number.isInteger(n)),
    applicationDate: typeof item.applicationDate === 'string' ? item.applicationDate : undefined,
    applicants: applicants.flatMap((a) =>
      isRecord(a) && typeof a.name === 'string' ? [a.name] : [],
    ),
    url: `https://euipo.europa.eu/eSearch/#details/trademarks/${item.applicationNumber}`,
  };
}

/** Parses a search page. Any shape change yields an error, never a guess. */
export function parseEuipoSearch(body: unknown): EuipoResult {
  if (!isRecord(body) || !Array.isArray(body.trademarks)) {
    return { kind: 'error', reason: 'EUIPO response shape not recognized' };
  }
  const matches = body.trademarks.flatMap((item) => parseMatch(item) ?? []);
  const total = typeof body.totalElements === 'number' ? body.totalElements : matches.length;
  return { kind: 'ok', total, matches };
}

export function createEuipoClient(
  http: HttpFetch,
  creds: { clientId: string; clientSecret: string; env: EuipoEnv },
  now: () => number = Date.now,
): EuipoClient {
  const endpoints = EUIPO_ENDPOINTS[creds.env];
  let token: { value: string; expiresAt: number } | undefined;

  const getToken = async (force: boolean): Promise<string> => {
    if (!force && token && token.expiresAt > now()) return token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: 'uid',
    });
    const res = await http(endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`EUIPO token request returned HTTP ${res.status}`);
    const payload = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string') {
      throw new Error('EUIPO token response had no access_token');
    }
    const lifetime = typeof payload.expires_in === 'number' ? payload.expires_in : 600;
    token = { value: payload.access_token, expiresAt: now() + Math.max(lifetime - 60, 0) * 1000 };
    return token.value;
  };

  const get = async (url: string, force: boolean): Promise<Response> =>
    http(url, {
      headers: {
        authorization: `Bearer ${await getToken(force)}`,
        'x-ibm-client-id': creds.clientId,
        accept: 'application/json',
      },
    });

  return {
    env: creds.env,
    async search(mark, niceClasses) {
      const params = new URLSearchParams({
        query: buildEuipoQuery(mark, niceClasses),
        page: '0',
        size: String(EUIPO_PAGE_SIZE),
      });
      const url = `${endpoints.api}/trademarks?${params.toString()}`;
      try {
        let res = await get(url, false);
        // A 401 can mean the cached token expired early; refresh once.
        if (res.status === 401) res = await get(url, true);
        if (!res.ok) return { kind: 'error', reason: `EUIPO search returned HTTP ${res.status}` };
        return parseEuipoSearch(await res.json());
      } catch (error) {
        return { kind: 'error', reason: errorMessage(error) };
      }
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && pnpm test test/research/euipo.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/trademarks/links.ts server/src/research/trademarks/euipo.ts server/test/research/euipo.test.ts server/test/research/fixtures/euipo-search-acme.json
git commit -m "feat(research): add trademark search links and EUIPO search client"
```

---

### Task 9: `searchTrademarks` orchestrator

**Files:**
- Create: `server/src/research/trademarks/search.ts`
- Test: `server/test/research/trademarks.test.ts`

**Interfaces:**
- Consumes: `DiskCache`, `TTL.trademarks`, `Confidence`; `EuipoClient`, `EuipoResult`, `TrademarkMatch` (Task 8); `SearchLink`, `trademarkSearchLinks` (Task 8).
- Produces: `type OfficeStatus = 'matches_found' | 'no_matches' | 'unknown'`; `interface OfficeResult { office: 'euipo' | 'uspto' | 'wipo'; status: OfficeStatus; confidence: Confidence; source: string; checkedAt: string; total?: number; matches: TrademarkMatch[]; reason?: string }`; `interface TrademarkQuery { mark: string; niceClasses?: number[] }`; `interface TrademarkSearch { mark: string; niceClasses: number[]; results: OfficeResult[]; links: SearchLink[]; note: string }`; `interface TrademarkDeps { euipo?: EuipoClient; cache: DiskCache; now?: () => Date }`; constants `TRADEMARK_NOTE`, `USPTO_REASON`, `WIPO_REASON`, `EUIPO_NO_KEY_REASON`, `EUIPO_SANDBOX_REASON`; `searchTrademarks(query: TrademarkQuery, deps: TrademarkDeps): Promise<TrademarkSearch>`.

Confidence: `matches_found` high, `no_matches` medium (word-element contains-search only), sandbox always low, `unknown` low. The function never throws for source failures, so a failing source never blocks the run.

- [ ] **Step 1: Write the failing test**

`server/test/research/trademarks.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import type { EuipoClient, EuipoResult } from '../../src/research/trademarks/euipo.js';
import {
  EUIPO_NO_KEY_REASON,
  searchTrademarks,
  type TrademarkDeps,
  USPTO_REASON,
  WIPO_REASON,
} from '../../src/research/trademarks/search.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');

async function makeDeps(
  euipo?: { env: 'production' | 'sandbox'; result: EuipoResult },
): Promise<TrademarkDeps & { searches: string[] }> {
  const searches: string[] = [];
  const client: EuipoClient | undefined = euipo && {
    env: euipo.env,
    search: async (mark, classes) => {
      searches.push(`${mark}|${classes.join(',')}`);
      return euipo.result;
    },
  };
  return {
    searches,
    euipo: client,
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-tm-'))),
    now: () => NOW,
  };
}

const match = {
  office: 'euipo' as const,
  mark: 'ACME',
  applicationNumber: '018000001',
  status: 'REGISTERED',
  niceClasses: [9],
  applicants: ['Acme Holdings GmbH'],
  url: 'https://euipo.europa.eu/eSearch/#details/trademarks/018000001',
};

describe('searchTrademarks', () => {
  it('returns unknown everywhere plus links when no EUIPO keys are set', async () => {
    const result = await searchTrademarks({ mark: ' Acme ' }, await makeDeps());
    expect(result.mark).toBe('Acme');
    expect(result.results).toEqual([
      expect.objectContaining({ office: 'euipo', status: 'unknown', reason: EUIPO_NO_KEY_REASON }),
      expect.objectContaining({ office: 'uspto', status: 'unknown', reason: USPTO_REASON }),
      expect.objectContaining({ office: 'wipo', status: 'unknown', reason: WIPO_REASON }),
    ]);
    expect(result.links).toHaveLength(4);
    expect(result.note).toContain('not a clearance');
  });

  it('reports EUIPO matches with high confidence', async () => {
    const deps = await makeDeps({
      env: 'production',
      result: { kind: 'ok', total: 1, matches: [match] },
    });
    const result = await searchTrademarks({ mark: 'acme', niceClasses: [42, 9, 9] }, deps);
    expect(result.niceClasses).toEqual([9, 42]);
    expect(result.results[0]).toEqual({
      office: 'euipo',
      status: 'matches_found',
      confidence: 'high',
      source: 'euipo-api',
      checkedAt: NOW.toISOString(),
      total: 1,
      matches: [match],
      reason: undefined,
    });
    expect(deps.searches).toEqual(['acme|9,42']);
  });

  it('reports no_matches with medium confidence', async () => {
    const deps = await makeDeps({ env: 'production', result: { kind: 'ok', total: 0, matches: [] } });
    const [euipo] = (await searchTrademarks({ mark: 'zzqx' }, deps)).results;
    expect(euipo).toMatchObject({ status: 'no_matches', confidence: 'medium' });
  });

  it('labels sandbox results as low confidence', async () => {
    const deps = await makeDeps({ env: 'sandbox', result: { kind: 'ok', total: 1, matches: [match] } });
    const [euipo] = (await searchTrademarks({ mark: 'acme' }, deps)).results;
    expect(euipo).toMatchObject({ confidence: 'low', source: 'euipo-api-sandbox' });
  });

  it('turns an EUIPO failure into unknown and does not cache it', async () => {
    const deps = await makeDeps({
      env: 'production',
      result: { kind: 'error', reason: 'EUIPO search returned HTTP 503' },
    });
    const first = await searchTrademarks({ mark: 'acme' }, deps);
    expect(first.results[0]).toMatchObject({
      status: 'unknown',
      reason: 'EUIPO search returned HTTP 503',
    });
    await searchTrademarks({ mark: 'acme' }, deps);
    expect(deps.searches).toHaveLength(2);
  });

  it('caches a successful EUIPO answer per mark and classes', async () => {
    const deps = await makeDeps({ env: 'production', result: { kind: 'ok', total: 0, matches: [] } });
    await searchTrademarks({ mark: 'Acme' }, deps);
    await searchTrademarks({ mark: 'acme' }, deps);
    await searchTrademarks({ mark: 'acme', niceClasses: [9] }, deps);
    expect(deps.searches).toEqual(['Acme|', 'acme|9']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/trademarks.test.ts`
Expected: FAIL, because `../../src/research/trademarks/search.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`server/src/research/trademarks/search.ts`:
```ts
import type { DiskCache } from '../../cache/cache.js';
import { TTL } from '../../cache/ttl.js';
import type { Confidence } from '../../domain/types.js';
import type { EuipoClient, TrademarkMatch } from './euipo.js';
import { type SearchLink, trademarkSearchLinks } from './links.js';

export type OfficeStatus = 'matches_found' | 'no_matches' | 'unknown';

export interface OfficeResult {
  office: 'euipo' | 'uspto' | 'wipo';
  status: OfficeStatus;
  confidence: Confidence;
  source: string;
  checkedAt: string;
  total?: number;
  matches: TrademarkMatch[];
  reason?: string;
}

export interface TrademarkQuery {
  mark: string;
  niceClasses?: number[];
}

export interface TrademarkSearch {
  mark: string;
  niceClasses: number[];
  results: OfficeResult[];
  links: SearchLink[];
  note: string;
}

export interface TrademarkDeps {
  euipo?: EuipoClient;
  cache: DiskCache;
  now?: () => Date;
}

export const TRADEMARK_NOTE =
  'Automated search covers EUIPO word elements that contain the mark. no_matches is not a clearance: similar-sounding, translated, figurative, and unregistered marks are not covered. Use the links for a manual search and ask a trademark attorney before relying on a name.';

// Reasons carry the date the source situation was last confirmed.
export const USPTO_REASON =
  'USPTO has no official keyless trademark search API (checked 2026-11-04). The tmsearch.uspto.gov backend is unofficial and bot-protected, so it is not queried. Use the USPTO link.';
export const WIPO_REASON =
  'The WIPO Global Brand Database has no public API (checked 2026-11-04). Use the WIPO link.';
export const EUIPO_NO_KEY_REASON =
  'EUIPO search needs free API credentials: set EUIPO_CLIENT_ID and EUIPO_CLIENT_SECRET (register at https://dev.euipo.europa.eu). Use the EUIPO or TMview link meanwhile.';
export const EUIPO_SANDBOX_REASON =
  'EUIPO_ENV=sandbox: results come from test data, not the live register.';

async function searchEuipo(
  mark: string,
  classes: number[],
  checkedAt: string,
  deps: TrademarkDeps,
): Promise<OfficeResult> {
  const client = deps.euipo;
  if (!client) {
    return {
      office: 'euipo',
      status: 'unknown',
      confidence: 'low',
      source: 'none',
      checkedAt,
      matches: [],
      reason: EUIPO_NO_KEY_REASON,
    };
  }
  const key = `trademark:euipo:${client.env}:${mark.toLowerCase()}:${classes.join(',')}`;
  const cached = await deps.cache.get<OfficeResult>(key);
  if (cached) return cached;

  const found = await client.search(mark, classes);
  if (found.kind === 'error') {
    return {
      office: 'euipo',
      status: 'unknown',
      confidence: 'low',
      source: 'euipo-api',
      checkedAt,
      matches: [],
      reason: found.reason,
    };
  }
  const sandbox = client.env === 'sandbox';
  const result: OfficeResult = {
    office: 'euipo',
    status: found.total > 0 ? 'matches_found' : 'no_matches',
    confidence: sandbox ? 'low' : found.total > 0 ? 'high' : 'medium',
    source: sandbox ? 'euipo-api-sandbox' : 'euipo-api',
    checkedAt,
    total: found.total,
    matches: found.matches,
    reason: sandbox ? EUIPO_SANDBOX_REASON : undefined,
  };
  try {
    await deps.cache.set(key, result, TTL.trademarks);
  } catch {
    // The cache is only an optimisation; a write failure must not fail the search.
  }
  return result;
}

function linkOnly(office: 'uspto' | 'wipo', reason: string, checkedAt: string): OfficeResult {
  return { office, status: 'unknown', confidence: 'low', source: 'none', checkedAt, matches: [], reason };
}

export async function searchTrademarks(
  query: TrademarkQuery,
  deps: TrademarkDeps,
): Promise<TrademarkSearch> {
  const mark = query.mark.trim();
  const classes = [...new Set(query.niceClasses ?? [])].sort((a, b) => a - b);
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();
  return {
    mark,
    niceClasses: classes,
    results: [
      await searchEuipo(mark, classes, checkedAt, deps),
      linkOnly('uspto', USPTO_REASON, checkedAt),
      linkOnly('wipo', WIPO_REASON, checkedAt),
    ],
    links: trademarkSearchLinks(mark),
    note: TRADEMARK_NOTE,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm test test/research/trademarks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/research/trademarks/search.ts server/test/research/trademarks.test.ts
git commit -m "feat(research): add searchTrademarks with EUIPO, honest unknowns, and links"
```

---

### Task 10: Research runtime part and `runtime.ts` wiring

**Files:**
- Create: `server/src/research/runtime-part.ts`
- Modify: `server/src/runtime.ts` (one import, one `extends`, one spread line)
- Modify: `server/test/tools/check-domains.test.ts` (fake runtime spreads `{} as Runtime`)
- Test: `server/test/research/runtime-part.test.ts`

**Interfaces:**
- Consumes: `DiskCache`, `HttpFetch`, `HostLimiter`, `RdapServers`, `rdapLookup`, `WhoisQuery`, `whoisLookup` (Plan 1); `checkHandles`, `createCheckers`, `HandleCheck` (Task 7); `Platform` (Task 4); `readResearchKeys` (Task 5); `fetchHomepage` (Task 2); `DomainProfile`, `profileDomain` (Task 3); `createEuipoClient` (Task 8); `searchTrademarks`, `TrademarkQuery`, `TrademarkSearch` (Task 9).
- Produces: `interface ResearchRuntime { profileDomain(domain: string): Promise<DomainProfile>; checkHandles(handles: string[], platforms: readonly Platform[]): Promise<HandleCheck[]>; searchTrademarks(query: TrademarkQuery): Promise<TrademarkSearch> }`; `interface ResearchRuntimeDeps { http: HttpFetch; limiter: HostLimiter; cache: DiskCache; env: NodeJS.ProcessEnv; rdapServers: () => Promise<RdapServers>; whoisQuery: WhoisQuery; resolveNs?: (domain: string) => Promise<string[]> }`; `createResearchRuntime(deps: ResearchRuntimeDeps): ResearchRuntime`. After this task `Runtime extends ResearchRuntime`.

`createResearchRuntime` takes Plan 1's existing `getServers` and `whoisQuery` so the RDAP bootstrap and WHOIS socket factory stay shared. It needs no `paths`, so its only argument is the deps object.

- [ ] **Step 1: Write the failing test**

`server/test/research/runtime-part.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import type { HttpFetch } from '../../src/http/http.js';
import { HostLimiter } from '../../src/limiter/limiter.js';
import { createResearchRuntime } from '../../src/research/runtime-part.js';
import googleRecord from '../fixtures/rdap-domain-google.json' with { type: 'json' };

function routeHttp(routes: Record<string, () => Response>): { http: HttpFetch; urls: string[] } {
  const urls: string[] = [];
  const http: HttpFetch = async (url) => {
    urls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`no route for ${url}`);
    return route();
  };
  return { http, urls };
}

async function runtime(http: HttpFetch, env: NodeJS.ProcessEnv = {}) {
  return createResearchRuntime({
    http,
    limiter: new HostLimiter({ minIntervalMs: 0 }),
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rt-'))),
    env,
    rdapServers: async () => ({ com: ['https://rdap.verisign.com/com/v1/'] }),
    whoisQuery: async () => {
      throw new Error('WHOIS must not be used');
    },
    resolveNs: async () => [],
  });
}

describe('createResearchRuntime', () => {
  it('wires profileDomain to RDAP and the homepage fetch', async () => {
    const { http, urls } = routeHttp({
      'https://rdap.verisign.com/com/v1/domain/google.com': () => Response.json(googleRecord),
      'https://google.com/': () =>
        new Response('<title>Google</title>', { headers: { 'content-type': 'text/html' } }),
    });
    const profile = await (await runtime(http)).profileDomain('google.com');
    expect(profile).toMatchObject({ status: 'live_site', homepage: { title: 'Google' } });
    expect(urls).toHaveLength(2);
  });

  it('wires checkHandles to the GitHub API and manual platforms', async () => {
    const { http } = routeHttp({
      'https://api.github.com/users/acme': () => new Response(null, { status: 200 }),
    });
    const results = await (await runtime(http)).checkHandles(['acme'], ['github', 'x']);
    expect(results.map((r) => [r.platform, r.status, r.method])).toEqual([
      ['github', 'taken', 'api'],
      ['x', 'unknown', 'manual'],
    ]);
  });

  it('runs searchTrademarks without EUIPO keys and without network', async () => {
    const { http, urls } = routeHttp({});
    const result = await (await runtime(http)).searchTrademarks({ mark: 'acme' });
    expect(result.results.every((r) => r.status === 'unknown')).toBe(true);
    expect(urls).toEqual([]);
  });

  it('enables EUIPO when both credentials are in env', async () => {
    const { http, urls } = routeHttp({});
    const rt = await runtime(http, { EUIPO_CLIENT_ID: 'id', EUIPO_CLIENT_SECRET: 'secret' });
    const result = await rt.searchTrademarks({ mark: 'acme' });
    expect(result.results[0]).toMatchObject({ office: 'euipo', source: 'euipo-api' });
    expect(urls[0]).toBe('https://euipo.europa.eu/cas-server-webapp/oidc/accessToken');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test test/research/runtime-part.test.ts`
Expected: FAIL, because `../../src/research/runtime-part.js` cannot be resolved.

- [ ] **Step 3: Write the runtime part**

`server/src/research/runtime-part.ts`:
```ts
import { resolveNs as dnsResolveNs } from 'node:dns/promises';
import type { DiskCache } from '../cache/cache.js';
import type { HttpFetch } from '../http/http.js';
import type { HostLimiter } from '../limiter/limiter.js';
import { type RdapServers, rdapLookup } from '../sources/rdap.js';
import { type WhoisQuery, whoisLookup } from '../sources/whois.js';
import { checkHandles, createCheckers, type HandleCheck } from './handles/check.js';
import type { Platform } from './handles/platforms.js';
import { readResearchKeys } from './keys.js';
import { fetchHomepage } from './profile/homepage.js';
import { type DomainProfile, profileDomain } from './profile/profile.js';
import { createEuipoClient } from './trademarks/euipo.js';
import { searchTrademarks, type TrademarkQuery, type TrademarkSearch } from './trademarks/search.js';

export interface ResearchRuntime {
  profileDomain(domain: string): Promise<DomainProfile>;
  checkHandles(handles: string[], platforms: readonly Platform[]): Promise<HandleCheck[]>;
  searchTrademarks(query: TrademarkQuery): Promise<TrademarkSearch>;
}

export interface ResearchRuntimeDeps {
  http: HttpFetch;
  limiter: HostLimiter;
  cache: DiskCache;
  env: NodeJS.ProcessEnv;
  rdapServers: () => Promise<RdapServers>;
  whoisQuery: WhoisQuery;
  resolveNs?: (domain: string) => Promise<string[]>;
}

export function createResearchRuntime(deps: ResearchRuntimeDeps): ResearchRuntime {
  const { http, limiter, cache } = deps;
  const keys = readResearchKeys(deps.env);
  const resolveNs = deps.resolveNs ?? dnsResolveNs;
  const checkers = createCheckers(http, keys);
  const euipo = keys.euipo ? createEuipoClient(http, keys.euipo) : undefined;

  return {
    profileDomain: (domain) =>
      profileDomain(domain, {
        cache,
        rdap: (d, tld) => rdapLookup(d, tld, { http, servers: deps.rdapServers }),
        whois: (d, tld) => whoisLookup(d, tld, { query: deps.whoisQuery, limiter, cache }),
        nameservers: async (d) => {
          try {
            return (await resolveNs(d)).map((ns) => ns.toLowerCase().replace(/\.$/, ''));
          } catch {
            return null;
          }
        },
        homepage: (d) => fetchHomepage(d, http),
      }),
    checkHandles: (handles, platforms) => checkHandles(handles, platforms, { checkers, cache }),
    searchTrademarks: (query) => searchTrademarks(query, { euipo, cache }),
  };
}
```

- [ ] **Step 4: Wire it into `runtime.ts` (shared file: exactly these three edits)**

In `server/src/runtime.ts`, add the import after the `HostLimiter` import:
```ts
import { createResearchRuntime, type ResearchRuntime } from './research/runtime-part.js';
```
Change the interface line:
```ts
export interface Runtime extends ResearchRuntime {
```
Add one spread line to the returned object, after `checkDomains`:
```ts
  return {
    checkDomains: (domains) => checkDomains(domains, deps),
    ...createResearchRuntime({ http, limiter, cache, env, rdapServers: getServers, whoisQuery }),
  };
```

- [ ] **Step 5: Fix the existing `check_domains` test fake**

`Runtime` now has more fields, so the Plan 1 fake no longer typechecks. Per the coordination rule, the fake becomes `{} as Runtime` plus the fields it needs. In `server/test/tools/check-domains.test.ts`, change the start of the object that `fakeRuntime()` returns from:
```ts
  return {
    seen,
    checkDomains: async (domains) => {
```
to:
```ts
  return {
    ...({} as Runtime),
    seen,
    checkDomains: async (domains) => {
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `cd server && pnpm test test/research/runtime-part.test.ts && pnpm typecheck && pnpm test`
Expected: runtime-part PASS (4 tests); typecheck has no errors; the whole suite passes.

- [ ] **Step 7: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && cd ..
git add server/src/research/runtime-part.ts server/src/runtime.ts server/test/research/runtime-part.test.ts server/test/tools/check-domains.test.ts
git commit -m "feat(research): wire the research runtime into the shared runtime"
```

---

### Task 11: MCP tools `profile_domain`, `check_handles`, `search_trademarks`

**Files:**
- Create: `server/src/tools/profile-domain.ts`, `server/src/tools/check-handles.ts`, `server/src/tools/search-trademarks.ts`, `server/src/tools/register-plan3.ts`
- Modify: `server/src/server.ts` (one import, one call)
- Test: `server/test/tools/profile-domain.test.ts`, `server/test/tools/check-handles.test.ts`, `server/test/tools/search-trademarks.test.ts`

**Interfaces:**
- Consumes: `toolJson`, `toolError` (`server/src/tools/result.ts`); `ValidationError`; `PLATFORMS` (Task 4); `ResearchRuntime` (Task 10); `DomainProfile`, `HandleCheck`, `TrademarkQuery`, `TrademarkSearch` (types, for tests); test helpers `connectClient`, `callJson` (`server/test/helpers/mcp.ts`).
- Produces: `PROFILE_NOTE`, `registerProfileDomain(server: McpServer, rt: Pick<ResearchRuntime, 'profileDomain'>): void`; `HANDLES_NOTE`, `registerCheckHandles(server: McpServer, rt: Pick<ResearchRuntime, 'checkHandles'>): void`; `registerSearchTrademarks(server: McpServer, rt: Pick<ResearchRuntime, 'searchTrademarks'>): void`; `registerPlan3Tools(server: McpServer, rt: ResearchRuntime): void`.

Tool contracts (the skills call these by name):
- `profile_domain { domain: string }` returns `{ profile: DomainProfile, note }`.
- `check_handles { handles: string[1..20], platforms?: Platform[] }` returns `{ results: HandleCheck[], note }`. The default is all platforms.
- `search_trademarks { mark: string(1..100, trimmed), niceClasses?: int[1..45][0..10] }` returns `TrademarkSearch`.

- [ ] **Step 1: Write the failing tests**

`server/test/tools/profile-domain.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/name.js';
import type { DomainProfile } from '../../src/research/profile/profile.js';
import type { Runtime } from '../../src/runtime.js';
import { PROFILE_NOTE } from '../../src/tools/profile-domain.js';
import { callJson, connectClient } from '../helpers/mcp.js';

const profile: DomainProfile = {
  domain: 'acme.com',
  status: 'parked',
  confidence: 'high',
  source: 'rdap+http',
  checkedAt: '2026-11-04T10:00:00.000Z',
  reason: 'Nameservers belong to sedoparking.com.',
  registration: {
    status: 'registered',
    source: 'rdap',
    nameserverSource: 'rdap',
    nameservers: ['ns1.sedoparking.com'],
  },
  parkingProvider: 'sedoparking.com',
};

function fakeRuntime(): Runtime & { seen: string[] } {
  const seen: string[] = [];
  return {
    ...({} as Runtime),
    seen,
    profileDomain: async (domain) => {
      seen.push(domain);
      if (domain === 'bad') throw new ValidationError('"bad" has no TLD.');
      return profile;
    },
  };
}

describe('profile_domain tool', () => {
  it('is listed as read-only and open-world', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'profile_domain');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('returns the profile with the note', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    const res = await callJson(client, 'profile_domain', { domain: 'acme.com' });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ profile, note: PROFILE_NOTE });
    expect(rt.seen).toEqual(['acme.com']);
  });

  it('turns a validation error into a tool error', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'profile_domain', { domain: 'bad' });
    expect(res.isError).toBe(true);
    expect(res.text).toBe('"bad" has no TLD.');
  });
});
```

`server/test/tools/check-handles.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { HandleCheck } from '../../src/research/handles/check.js';
import { PLATFORMS, type Platform } from '../../src/research/handles/platforms.js';
import type { Runtime } from '../../src/runtime.js';
import { HANDLES_NOTE } from '../../src/tools/check-handles.js';
import { callJson, connectClient } from '../helpers/mcp.js';

function fakeRuntime(): Runtime & { seen: Array<{ handles: string[]; platforms: Platform[] }> } {
  const seen: Array<{ handles: string[]; platforms: Platform[] }> = [];
  return {
    ...({} as Runtime),
    seen,
    checkHandles: async (handles, platforms) => {
      seen.push({ handles, platforms: [...platforms] });
      return handles.flatMap((handle) =>
        platforms.map(
          (platform): HandleCheck => ({
            platform,
            handle,
            status: 'unknown',
            confidence: 'low',
            method: 'manual',
            source: 'none',
            checkedAt: '2026-11-04T10:00:00.000Z',
          }),
        ),
      );
    },
  };
}

describe('check_handles tool', () => {
  it('is listed as read-only and open-world', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'check_handles');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('defaults to every platform', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    const res = await callJson(client, 'check_handles', { handles: ['acme'] });
    expect(res.isError).toBe(false);
    expect(rt.seen[0]?.platforms).toEqual([...PLATFORMS]);
    expect(res.data).toMatchObject({ note: HANDLES_NOTE });
    expect((res.data as { results: unknown[] }).results).toHaveLength(PLATFORMS.length);
  });

  it('de-duplicates the requested platforms', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    await callJson(client, 'check_handles', { handles: ['acme'], platforms: ['npm', 'npm', 'x'] });
    expect(rt.seen[0]?.platforms).toEqual(['npm', 'x']);
  });

  it('rejects an unknown platform', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'check_handles', { handles: ['acme'], platforms: ['myspace'] });
    expect(res.isError).toBe(true);
  });
});
```

`server/test/tools/search-trademarks.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { TrademarkQuery, TrademarkSearch } from '../../src/research/trademarks/search.js';
import type { Runtime } from '../../src/runtime.js';
import { callJson, connectClient } from '../helpers/mcp.js';

function fakeRuntime(): Runtime & { seen: TrademarkQuery[] } {
  const seen: TrademarkQuery[] = [];
  return {
    ...({} as Runtime),
    seen,
    searchTrademarks: async (query): Promise<TrademarkSearch> => {
      seen.push(query);
      return { mark: query.mark, niceClasses: [], results: [], links: [], note: 'n' };
    },
  };
}

describe('search_trademarks tool', () => {
  it('is listed as read-only and open-world', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'search_trademarks');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('passes the trimmed mark and classes to the runtime', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    const res = await callJson(client, 'search_trademarks', { mark: ' Acme ', niceClasses: [9] });
    expect(res.isError).toBe(false);
    expect(rt.seen).toEqual([{ mark: 'Acme', niceClasses: [9] }]);
    expect(res.data).toMatchObject({ mark: 'Acme' });
  });

  it('rejects an out-of-range Nice class', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'search_trademarks', { mark: 'acme', niceClasses: [46] });
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test test/tools/profile-domain.test.ts test/tools/check-handles.test.ts test/tools/search-trademarks.test.ts`
Expected: FAIL, because `../../src/tools/profile-domain.js` cannot be resolved (and the tools are not listed).

- [ ] **Step 3: Write the tools**

`server/src/tools/profile-domain.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ValidationError } from '../domain/name.js';
import type { ResearchRuntime } from '../research/runtime-part.js';
import { toolError, toolJson } from './result.js';

export const PROFILE_NOTE =
  'Status comes from RDAP/WHOIS registration data, parking nameservers, and one GET of the homepage. for_sale and parked are heuristics; a site that refuses automated access is reported as live_site with low confidence and is never retried or bypassed.';

export function registerProfileDomain(
  server: McpServer,
  rt: Pick<ResearchRuntime, 'profileDomain'>,
): void {
  server.registerTool(
    'profile_domain',
    {
      title: 'Profile a taken domain',
      description:
        'For one registered domain: creation and expiry dates, registrar, nameservers, parking provider, homepage status and title, and a verdict of live_site, parked, for_sale, no_site, not_registered, or unknown, with source, checkedAt, and confidence.',
      inputSchema: {
        domain: z.string().min(3).max(253).describe('Full domain name, e.g. "acme.com"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ domain }) => {
      try {
        return toolJson({ profile: await rt.profileDomain(domain), note: PROFILE_NOTE });
      } catch (error) {
        if (error instanceof ValidationError) return toolError(error.message);
        throw error;
      }
    },
  );
}
```

`server/src/tools/check-handles.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PLATFORMS } from '../research/handles/platforms.js';
import type { ResearchRuntime } from '../research/runtime-part.js';
import { toolJson } from './result.js';

export const HANDLES_NOTE =
  'taken and likely_available come from official APIs (GitHub, npm, PyPI; Reddit and YouTube only with keys). likely_available means the API found no account or package; the platform may still reserve or block the name. unknown with method "manual" means no reliable open method exists: open profileUrl to check by hand. invalid means the name breaks the platform rules.';

export function registerCheckHandles(
  server: McpServer,
  rt: Pick<ResearchRuntime, 'checkHandles'>,
): void {
  server.registerTool(
    'check_handles',
    {
      title: 'Check social handles and package names',
      description:
        'Check each handle on each platform. Each result is taken, likely_available, unknown, or invalid, with method (api, manual, none), source, checkedAt, confidence, and a profile URL for manual checks.',
      inputSchema: {
        handles: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(20)
          .describe('Handles without platform prefix; a leading "@" is ignored'),
        platforms: z
          .array(z.enum(PLATFORMS))
          .min(1)
          .optional()
          .describe(`Platforms to check; default all: ${PLATFORMS.join(', ')}`),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ handles, platforms }) => {
      const list = [...new Set(platforms ?? PLATFORMS)];
      const results = await rt.checkHandles(handles, list);
      return toolJson({ results, note: HANDLES_NOTE });
    },
  );
}
```

`server/src/tools/search-trademarks.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ResearchRuntime } from '../research/runtime-part.js';
import { toolJson } from './result.js';

export function registerSearchTrademarks(
  server: McpServer,
  rt: Pick<ResearchRuntime, 'searchTrademarks'>,
): void {
  server.registerTool(
    'search_trademarks',
    {
      title: 'Search trademarks',
      description:
        'Search for marks whose word element contains the given mark. EUIPO is queried when EUIPO_CLIENT_ID and EUIPO_CLIENT_SECRET are set; USPTO and WIPO have no usable open API and return unknown. Always returns direct search links for USPTO, EUIPO, TMview, and WIPO.',
      inputSchema: {
        mark: z.string().trim().min(1).max(100).describe('The brand name to search, e.g. "acme"'),
        niceClasses: z
          .array(z.number().int().min(1).max(45))
          .max(10)
          .optional()
          .describe('Optional Nice classes to limit the search, e.g. [9, 42]'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ mark, niceClasses }) => toolJson(await rt.searchTrademarks({ mark, niceClasses })),
  );
}
```

`server/src/tools/register-plan3.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResearchRuntime } from '../research/runtime-part.js';
import { registerCheckHandles } from './check-handles.js';
import { registerProfileDomain } from './profile-domain.js';
import { registerSearchTrademarks } from './search-trademarks.js';

/** Registers the research tools: profile_domain, check_handles, search_trademarks. */
export function registerPlan3Tools(server: McpServer, rt: ResearchRuntime): void {
  registerProfileDomain(server, rt);
  registerCheckHandles(server, rt);
  registerSearchTrademarks(server, rt);
}
```

- [ ] **Step 4: Register them in `server.ts` (shared file: exactly these two edits)**

Add the import after the `registerCheckDomains` import:
```ts
import { registerPlan3Tools } from './tools/register-plan3.js';
```
Add the call after `registerCheckDomains(server, rt);`. When Plan 2 has merged, put it after Plan 2's `registerPlan2Tools(server, rt);` line:
```ts
  registerPlan3Tools(server, rt);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test test/tools && pnpm typecheck`
Expected: PASS (3 + 4 + 3 new tests, plus the 5 `check_domains` tests); no type errors.

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm test && cd ..
git add server/src/tools/profile-domain.ts server/src/tools/check-handles.ts server/src/tools/search-trademarks.ts server/src/tools/register-plan3.ts server/src/server.ts server/test/tools/profile-domain.test.ts server/test/tools/check-handles.test.ts server/test/tools/search-trademarks.test.ts
git commit -m "feat(server): add profile_domain, check_handles, and search_trademarks tools"
```

---

### Task 12: Live smoke tests for the research tools

**Files:**
- Create: `server/test/live/research.test.ts`

**Interfaces:**
- Consumes: `createRuntime` (`server/src/runtime.ts`), which now includes `ResearchRuntime` (Task 10).
- Produces: nothing for later tasks. `pnpm test:live` (existing script `LIVE=1 vitest run test/live`) picks the file up.

Keyed cases skip themselves unless their env vars are set. With no keys, 5 cases run and 3 skip. This file was run against the real network on 2026-11-04: 5 passed, 3 skipped.

- [ ] **Step 1: Write the live test**

`server/test/live/research.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/runtime.js';

const randomLabel = (length: number): string =>
  Array.from({ length }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

async function runtime(extraEnv: NodeJS.ProcessEnv = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dne-live-research-'));
  return createRuntime({ ...process.env, ...extraEnv, DOMAIN_ENGINE_HOME: home });
}

// Runs only through `pnpm test:live`; it uses the real network.
describe.skipIf(!process.env.LIVE)('live research tools', () => {
  it('profiles google.com as a registered live site', async () => {
    const profile = await (await runtime()).profileDomain('google.com');
    expect(profile.registration.status).toBe('registered');
    expect(profile.registration.createdAt).toMatch(/^1997-09-15/);
    expect(['live_site']).toContain(profile.status);
  }, 60_000);

  it('reports known names as taken on GitHub, npm, and PyPI', async () => {
    const rt = await runtime();
    const [github] = await rt.checkHandles(['torvalds'], ['github']);
    const [npm] = await rt.checkHandles(['react'], ['npm']);
    const [pypi] = await rt.checkHandles(['requests'], ['pypi']);
    expect([github?.status, npm?.status, pypi?.status]).toEqual(['taken', 'taken', 'taken']);
  }, 60_000);

  it('reports a random 30-letter name as likely_available on npm and PyPI', async () => {
    const label = randomLabel(30);
    const results = await (await runtime()).checkHandles([label], ['npm', 'pypi']);
    expect(results.map((r) => r.status)).toEqual(['likely_available', 'likely_available']);
  }, 60_000);

  it('reports a random 30-letter name as likely_available on GitHub', async () => {
    const [result] = await (await runtime()).checkHandles([randomLabel(30)], ['github']);
    expect(result?.status).toBe('likely_available');
  }, 60_000);

  it('returns links and honest unknowns for trademarks without EUIPO keys', async () => {
    const rt = await runtime({ EUIPO_CLIENT_ID: '', EUIPO_CLIENT_SECRET: '' });
    const result = await rt.searchTrademarks({ mark: 'acme' });
    expect(result.results.map((r) => r.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(result.links).toHaveLength(4);
  });

  it.skipIf(!process.env.EUIPO_CLIENT_ID)(
    'finds EUIPO marks for "apple" with keys',
    async () => {
      const result = await (await runtime()).searchTrademarks({ mark: 'apple' });
      expect(result.results[0]?.status).toBe('matches_found');
    },
    60_000,
  );

  it.skipIf(!process.env.REDDIT_CLIENT_ID)(
    'finds u/spez on Reddit with keys',
    async () => {
      const [result] = await (await runtime()).checkHandles(['spez'], ['reddit']);
      expect(result?.status).toBe('taken');
    },
    60_000,
  );

  it.skipIf(!process.env.YOUTUBE_API_KEY)(
    'finds @youtube on YouTube with a key',
    async () => {
      const [result] = await (await runtime()).checkHandles(['youtube'], ['youtube']);
      expect(result?.status).toBe('taken');
    },
    60_000,
  );
});
```

- [ ] **Step 2: Confirm that CI skips it**

Run: `cd server && pnpm test test/live/research.test.ts`
Expected: all 8 tests skipped (no `LIVE`).

- [ ] **Step 3: Run it live**

Run: `cd server && pnpm test:live`
Expected: `research.test.ts` has 5 passed and 3 skipped without keys; `domains.test.ts` still passes. If a case fails, read the `reason` in the result before changing code. A changed endpoint must become `unknown`, never a guess.

- [ ] **Step 4: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/test/live/research.test.ts
git commit -m "test(live): add research tool smoke tests"
```

---

### Task 13: Skills `research` and `language-check`

**Files:**
- Create: `skills/research/SKILL.md`, `skills/language-check/SKILL.md`

**Interfaces:**
- Consumes (by MCP tool name, no imports): `check_domains` (Plan 1); `profile_domain`, `check_handles`, `search_trademarks` (Task 11); `project_list`, `project_get`, `project_add_checks`, `project_add_notes` (Plan 2). The competitor scan uses Claude's built-in WebSearch.
- Produces: skills named `research` and `language-check`, which Plan 2's `find-domain` calls by name.

- [ ] **Step 1: Write the research skill**

`skills/research/SKILL.md`:
```markdown
---
name: research
description: Use when a domain-name-engine project has a shortlist and needs full checks per name - domains across the chosen TLDs, profiles of taken domains, social handles, trademarks, and a competitor scan. Runs inside find-domain or alone against an existing project.
---

# Research a shortlist

Run full checks for every shortlisted name in one project and save the results. The domain-engine MCP server does the data work; you plan the calls, run the competitor scan, and summarize.

## Inputs

1. If the user did not name a project, call `project_list` and ask which one.
2. Call `project_get` for that project. Read from it:
   - the shortlist (if it is empty, stop and ask the user to shortlist names first);
   - the brief: category, target countries and languages, competitors, and which social handles matter;
   - the rulesets and per-project overrides, for the TLD list of each name.

## Steps

Run the steps in this order. If a tool returns an error, report it in one line, skip that step for that name, and continue with the next step. Never retry a tool more than once.

1. **Domains.** Call `check_domains` with the shortlisted names and the TLDs from their rulesets plus any extra TLDs in the overrides. Keep each call at 200 domains or fewer; split the call if needed.
2. **Taken-domain profiles.** For each shortlisted name, take the `.com` result and the result for the first TLD of its ruleset. For each of those that is `registered`, call `profile_domain`. The verdict tells you whether the owner uses it (`live_site`), parks it (`parked`), sells it (`for_sale`), or has no site (`no_site`).
3. **Handles.** Call `check_handles` with all shortlisted names. Pass `platforms` from the brief's list of handles that matter; if the brief has none, omit `platforms` to check all of them.
4. **Trademarks.** Call `search_trademarks` once per name. Pass `niceClasses` only when you are confident which Nice classes cover the brief's category (for example 9 and 42 for software); otherwise omit it.
5. **Competitor scan.** Use your built-in WebSearch, not the MCP server. For each name run:
   - `"<name>" <category>` and `"<name>" company`, to find businesses already using the name;
   - one search for the category in each target country, to find the main competitors and the domain patterns they use (for example `get<name>.com`, `<name>app.com`, `.io` instead of `.com`).
   Record each finding with its URL. Do not open pages that block automated clients.
6. **Save.** For each name, call `project_add_checks` with the results of steps 1-4 exactly as the tools returned them, and the competitor findings from step 5 with source `websearch` and the time you searched.

## Summary for the user

Write one section per name:

- Domains: a table of TLD, status, and confidence. Say "likely available" only for `likely_available` results, and add once: "Premium and registry-reserved names are invisible to free sources; confirm at a registrar."
- Taken domains: the profile verdict, registrar, creation and expiry dates, and the title of the live site if there is one. A `for_sale` or `parked` domain may be buyable; say so without promising it.
- Handles: taken, likely available, and unknown platforms. For every `unknown` with method `manual`, give the profile URL so the user can check it by hand.
- Trademarks: the EUIPO status and the top matches with their status and Nice classes. Repeat the tool's note that `no_matches` is not a clearance. Give the search links for USPTO, EUIPO, TMview, and WIPO.
- Competitors: same-name businesses and competitor domain patterns, each with its URL.

## Honesty rules

- Never claim a domain or handle is available without a tool result. Use the tool's words: `likely_available`, `taken`, `registered`, `unknown`.
- Show `source`, `checkedAt`, and `confidence` for each check, or say where they are stored.
- An `unknown` stays unknown. Do not guess from other signals.
- No emoji and no urgency copy.
```

- [ ] **Step 2: Write the language-check skill**

`skills/language-check/SKILL.md`:
```markdown
---
name: language-check
description: Use when shortlisted brand names in a domain-name-engine project need a review of meaning and pronunciation in the brief's target languages, before a name is chosen. Runs inside find-domain or alone against an existing project.
---

# Language check

Review each shortlisted name in each target language of the brief and save the notes. This is your own language judgment. No MCP tool checks language, and you do not search the web for it.

## Inputs

1. If the user did not name a project, call `project_list` and ask which one.
2. Call `project_get`. Read the shortlist and the brief's target countries and target languages. Always include English as well, because domains and app stores are read in English.

## For each name and each language

Check these points and write one short line each:

1. **Meaning.** Is the name, or a clear part of it, a word in this language? What does it mean?
2. **Bad associations.** Is it close to a vulgar, offensive, slang, medical, political, or religious word? Is it close to a well-known brand?
3. **Pronunciation.** How would a native speaker read it aloud on first sight? Give a simple respelling, for example "ZEN-tee". Note if stress or vowels are unclear.
4. **Spelling from hearing.** If a native speaker hears it, would they spell it the same way? Note letters that sound alike in this language (for example c/k, ph/f, i/y).
5. **Script and characters.** Does it work in the market's script? Note letters that do not exist in the language or need accents.

Then give a risk level for the name in that language:

- `none`: no issues found;
- `low`: a minor pronunciation or spelling issue;
- `medium`: an unclear meaning or a weak bad association;
- `high`: a clear offensive or negative meaning, or a strong clash with a known brand.

## Limits to state

- Say once, at the top of the summary: "This is an AI language review, not a native-speaker check. Ask a native speaker before you commit to a name in a high-stakes market."
- If you are not sure about a language, write "not sure" for that point. Do not invent meanings. Low-resource languages and regional slang are where you are most likely to miss something.

## Save and summarize

1. For each name, call `project_add_notes` with one note per language: the language, the risk level, and the five lines above.
2. Show the user a table with one row per name and one column per language, where each cell is the risk level plus a few words. Below the table, list every `medium` and `high` finding in full.
3. No emoji and no urgency copy.
```

- [ ] **Step 3: Validate the plugin**

Run: `claude plugin validate .`
Expected: validation passes and both skills are found. If the validator reports a frontmatter problem, fix only the frontmatter.

- [ ] **Step 4: Run the eval prompt for each skill by hand**

The spec asks for one eval prompt per skill, run by hand before each release. Run these after Plans 2 and 3 have both merged, because the skills need the `project_*` tools.
- research: "Run the research skill on my project `<slug>`." Pass if: every shortlisted name gets a `check_domains` result; registered `.com` domains get a `profile_domain` verdict; manual platforms show a profile URL instead of a guess; the trademark section repeats that `no_matches` is not a clearance and lists all four links; the competitor scan cites URLs; nothing is called available without a tool result.
- language-check: "Run language-check on project `<slug>` for German and Spanish." Pass if: there is one risk level per name and language; the summary starts with the AI-review disclaimer; an unclear language gives "not sure", not an invented meaning; notes are saved with `project_add_notes`.

- [ ] **Step 5: Commit**

```bash
git add skills/research/SKILL.md skills/language-check/SKILL.md
git commit -m "feat(skills): add research and language-check skills"
```

---

## Done criteria for Plan 3

- `cd server && pnpm check && pnpm typecheck && pnpm test` all exit 0. Do not run `pnpm build`, and leave `server/dist/` untouched.
- `pnpm test:live` passes on a machine with network access (keyed cases skip without keys).
- `claude plugin validate .` passes.
- The `git diff main --stat` shows changes only in Plan 3's owned paths, plus the allowed edits to `server/src/server.ts`, `server/src/runtime.ts` and `server/test/tools/check-domains.test.ts`.

## Spec gaps and decisions

- **Profile TTL:** the spec lists no TTL for `profile_domain`. The plan uses 1 day (`PROFILE_TTL_MS`, local to `research/profile/profile.ts`, so `cache/ttl.ts` stays untouched), 1 hour for `not_registered`, and no caching for `unknown`.
- **Profile statuses:** the spec lists `live_site`, `parked`, `for_sale` and `no_site`. The plan adds `not_registered` (the domain has no registration, so a profile verdict would mislead) and `unknown` (both registration and homepage failed, per the error-handling rule).
- **Handle statuses:** the spec gives none. The plan uses `taken`, `likely_available`, `unknown` and `invalid`, mirroring `check_domains` and never a plain "available".
- **Reddit:** the spec lists Reddit as high confidence, but on 2026-11-04 Reddit answers 403 to all logged-out API requests, and new OAuth apps need approval. Reddit is high confidence only with `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`; otherwise it is `unknown` (manual).
- **YouTube:** the spec lists it as low confidence. With the free `YOUTUBE_API_KEY` the official Data API gives a reliable answer; without the key it is `unknown` (manual).
- **Trademarks:** USPTO has no official keyless search API, so it is always `unknown` with a link. EUIPO's official API is free but needs registration, so it is queried only when `EUIPO_CLIENT_ID`/`EUIPO_CLIENT_SECRET` are set. The tool searches EUIPO word elements only (contains match), not phonetic similarity.
- **Optional env vars added:** `GITHUB_TOKEN`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `YOUTUBE_API_KEY`, `EUIPO_CLIENT_ID`, `EUIPO_CLIENT_SECRET`, `EUIPO_ENV`. Plan 4's README rewrite and `registrar_status` should list them; see the next section.
- **Spec layout drift:** the spec's layout shows `sources/http-profile.ts`, `handles.ts`, `uspto.ts` and `euipo.ts`. The coordination doc assigns Plan 3 `server/src/research/**` instead, and that file ownership wins.

## Cross-plan risks

- **`check-domains.test.ts` fake:** once any plan extends `Runtime`, Plan 1's `fakeRuntime()` stops typechecking. Plans 2 and 4 must make the same one-line edit, `...({} as Runtime),` as the first property. If all three edits are byte-identical, git merges them cleanly; otherwise expect a trivial conflict.
- **`runtime.ts` `extends` line:** all three plans edit `export interface Runtime extends …`. That is a guaranteed trivial conflict at merge. Resolve it to `extends StoreRuntime, ResearchRuntime, <Plan 4 part>`.
- **`project_add_checks` and `project_add_notes` input shape (Plan 2):** the research skill saves raw tool results per name, grouped by tool (domains, profiles, handles, trademarks, competitors), and language-check saves one note per language. Plan 2's schemas must accept these payloads, or the skill texts need a small follow-up once Plan 2's schemas are known.
- **README and key status (Plan 4):** Plan 4 owns the README and `registrar_status`. The README should document the optional research env vars above, and the fact that X, Instagram, TikTok, LinkedIn and USPTO are manual-check only.
- **Live-test runtime:** `test/live/research.test.ts` hits GitHub's unauthenticated limit (60 per hour) only if it runs many times in a row; set `GITHUB_TOKEN` when iterating.
