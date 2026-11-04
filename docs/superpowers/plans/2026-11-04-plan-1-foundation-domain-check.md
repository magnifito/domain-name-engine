# Plan 1 — Foundation and Domain Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable Claude Code plugin whose bundled MCP server exposes a working `check_domains` tool (RDAP, WHOIS fallback, DNS signal) with per-host rate limiting and an on-disk cache.

**Architecture:** A TypeScript MCP server lives in `server/`. Small single-purpose modules (`limiter`, `http`, `cache`, `domain`, `sources`) are composed in `runtime.ts` and exposed through `tools/`. tsdown bundles everything into `server/dist/index.js`, which is committed so plugin users need only Node 20+. Plugin manifests at the repo root point Claude Code at that file.

**Tech Stack:** Node 20+, TypeScript 7.0.2, `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7, tsdown 0.23.5, Vitest 5.1.0, Biome 2.6.4, pnpm 11.27.0.

**Spec:** `docs/superpowers/specs/2026-11-04-domain-name-engine-design.md`

**Plan series:** This is plan 1 of 4. Later plans: 2 — brief, rulesets, project store, skills `brief`/`generate`/`find-domain`; 3 — `profile_domain`, `check_handles`, `search_trademarks`, skills `research`/`language-check`; 4 — registrars, TLD table, `report` skill, README, release.

## Global Constraints

- Node floor: `>=20`. Build target `node20`.
- Linter and formatter: Biome only. Never add ESLint or Prettier. Run `pnpm format` (`biome check --write .`) before each commit; CI runs `biome ci .`.
- All code comments in English.
- Data home: `~/.domain-engine/`, overridden by env `DOMAIN_ENGINE_HOME`. Subfolders `cache/`, `projects/`, `rulesets/`.
- Availability statuses are exactly `registered`, `likely_available`, `unknown`. Never emit plain "available".
- Every check result carries `source`, `checkedAt` (ISO 8601), `confidence` (`high` | `medium` | `low`).
- HTTP: 8 second timeout per request; retry on HTTP 429 and 5xx, max 3 tries, exponential backoff, honor `Retry-After`.
- Per-host rate limit default: 1 request per second.
- Cache TTLs: `registered` 7 days, `likely_available` 1 hour, `unknown` not cached, RDAP bootstrap 1 day.
- User-Agent: `domain-name-engine/0.1.0 (+https://github.com/magnifito/domain-name-engine)`. No personal contact data.
- Unit tests never touch the network. Live tests run only with `pnpm test:live`.
- `server/dist/index.js` is committed and must equal a fresh `pnpm build`.
- Relative imports in `src/` and `test/` use the `.js` extension.

## File Structure

```
.claude-plugin/plugin.json           # plugin manifest
.claude-plugin/marketplace.json      # marketplace entry for this repo
.mcp.json                            # starts the bundled server
.github/workflows/ci.yml             # lint, typecheck, test, build, dist drift check
.gitignore
LICENSE
README.md                            # short stub; full README in plan 4
server/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  biome.json
  vitest.config.ts
  tsdown.config.ts
  src/
    index.ts                         # stdio entry point
    server.ts                        # createServer(runtime) registers tools
    runtime.ts                       # wires real dependencies
    config.ts                        # engine home, paths, user agent
    util/errors.ts                   # errorMessage()
    fs/atomic.ts                     # writeFileAtomic()
    limiter/limiter.ts               # HostLimiter
    http/http.ts                     # createHttp(): timeout, retry, UA
    cache/cache.ts                   # DiskCache
    cache/ttl.ts                     # TTL constants
    domain/name.ts                   # normalizeLabel/normalizeTld/joinDomain/splitDomain
    domain/types.ts                  # DomainCheck and friends
    domain/check.ts                  # checkDomain/checkDomains
    sources/rdap.ts                  # IANA bootstrap + RDAP lookup
    sources/whois.ts                 # port 43 WHOIS + parsing
    sources/dns.ts                   # NS lookup
    tools/result.ts                  # toolJson/toolError
    tools/check-domains.ts           # check_domains tool
  test/
    config.test.ts
    limiter.test.ts
    http.test.ts
    cache.test.ts
    name.test.ts
    rdap.test.ts
    whois.test.ts
    dns.test.ts
    check.test.ts
    tools/check-domains.test.ts
    helpers/mcp.ts                   # in-memory MCP client helper
    fixtures/rdap-bootstrap.json
    fixtures/rdap-domain-google.json
    live/domains.test.ts             # skipped unless LIVE=1
  dist/index.js                      # committed bundle
```

---

### Task 1: Scaffold the server package

**Files:**
- Create: `.gitignore`, `server/package.json`, `server/tsconfig.json`, `server/biome.json`, `server/vitest.config.ts`, `server/tsdown.config.ts`, `server/src/config.ts`, `server/src/util/errors.ts`
- Test: `server/test/config.test.ts`

**Interfaces:**
- Produces: `engineHome(env?: NodeJS.ProcessEnv): string`, `enginePaths(home: string): { home: string; cache: string; projects: string; rulesets: string }`, `USER_AGENT: string`, `VERSION: string`, `errorMessage(error: unknown): string`.

- [ ] **Step 1: Create tooling files**

`.gitignore`:
```gitignore
node_modules/
coverage/
.DS_Store
*.tmp
```

`server/package.json`:
```json
{
  "name": "domain-name-engine-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.27.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsdown",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:live": "LIVE=1 vitest run test/live",
    "check": "biome ci .",
    "format": "biome check --write ."
  }
}
```

Install dependencies (exact versions):
```bash
cd server
pnpm add --save-exact @modelcontextprotocol/sdk@1.32.2 zod@4.6.7
pnpm add --save-exact -D typescript@7.0.2 tsdown@0.23.5 vitest@5.1.0 @biomejs/biome@2.6.4
pnpm add -D @types/node@^20
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "test", "*.config.ts"]
}
```

`server/biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.6.4/schema.json",
  "files": { "includes": ["**", "!**/dist", "!**/node_modules"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "single" } },
  "linter": { "rules": { "recommended": true } }
}
```

`server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

`server/tsdown.config.ts`:
```ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  dts: false,
  clean: true,
  // Bundle every dependency so plugin users need no npm install.
  deps: { alwaysBundle: [/.*/] },
  outExtensions: () => ({ js: '.js' }),
});
```

- [ ] **Step 2: Write the failing test**

`server/test/config.test.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { engineHome, enginePaths, USER_AGENT } from '../src/config.js';
import { errorMessage } from '../src/util/errors.js';

describe('config', () => {
  it('defaults the engine home to ~/.domain-engine', () => {
    expect(engineHome({})).toBe(join(homedir(), '.domain-engine'));
  });

  it('honors DOMAIN_ENGINE_HOME', () => {
    expect(engineHome({ DOMAIN_ENGINE_HOME: '/tmp/x' })).toBe('/tmp/x');
  });

  it('derives subfolders from the home', () => {
    expect(enginePaths('/h')).toEqual({
      home: '/h',
      cache: join('/h', 'cache'),
      projects: join('/h', 'projects'),
      rulesets: join('/h', 'rulesets'),
    });
  });

  it('uses a generic user agent with the repo URL', () => {
    expect(USER_AGENT).toBe(
      'domain-name-engine/0.1.0 (+https://github.com/magnifito/domain-name-engine)',
    );
  });

  it('turns any thrown value into a message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('text')).toBe('text');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && pnpm test test/config.test.ts`
Expected: FAIL, cannot resolve `../src/config.js`.

- [ ] **Step 4: Write minimal implementation**

`server/src/config.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export const VERSION = '0.1.0';
export const REPO_URL = 'https://github.com/magnifito/domain-name-engine';
export const USER_AGENT = `domain-name-engine/${VERSION} (+${REPO_URL})`;

export function engineHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.DOMAIN_ENGINE_HOME ?? join(homedir(), '.domain-engine');
}

export function enginePaths(home: string): {
  home: string;
  cache: string;
  projects: string;
  rulesets: string;
} {
  return {
    home,
    cache: join(home, 'cache'),
    projects: join(home, 'projects'),
    rulesets: join(home, 'rulesets'),
  };
}
```

`server/src/util/errors.ts`:
```ts
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 5: Run checks**

Run: `cd server && pnpm test && pnpm typecheck && pnpm format && pnpm check`
Expected: 5 tests PASS; typecheck, format, and `biome ci` exit 0.

- [ ] **Step 6: Commit**

```bash
git add .gitignore server
git commit -m "chore: scaffold MCP server package with config module"
```

---

### Task 2: Per-host rate limiter

**Files:**
- Create: `server/src/limiter/limiter.ts`
- Test: `server/test/limiter.test.ts`

**Interfaces:**
- Produces: `class HostLimiter { constructor(opts?: LimiterOptions); schedule<T>(host: string, task: () => Promise<T>): Promise<T> }`, `interface LimiterOptions { minIntervalMs?: number; intervals?: Record<string, number>; sleep?: (ms: number) => Promise<void>; now?: () => number }`, `sleep(ms: number): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`server/test/limiter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { HostLimiter } from '../src/limiter/limiter.js';

function fakeClock() {
  const state = { now: 0, waits: [] as number[] };
  return {
    state,
    now: () => state.now,
    sleep: async (ms: number) => {
      state.waits.push(ms);
      state.now += ms;
    },
  };
}

describe('HostLimiter', () => {
  it('spaces tasks for the same host by the minimum interval', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    await Promise.all(
      [1, 2, 3].map(() =>
        limiter.schedule('a.test', async () => {
          starts.push(clock.state.now);
        }),
      ),
    );
    expect(starts).toEqual([0, 1000, 2000]);
    expect(clock.state.waits).toEqual([1000, 1000]);
  });

  it('does not delay tasks for different hosts', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
    await Promise.all([
      limiter.schedule('a.test', async () => 1),
      limiter.schedule('b.test', async () => 2),
    ]);
    expect(clock.state.waits).toEqual([]);
  });

  it('uses a per-host interval override', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({
      minIntervalMs: 1000,
      intervals: { 'fast.test': 200 },
      now: clock.now,
      sleep: clock.sleep,
    });
    await limiter.schedule('fast.test', async () => 1);
    await limiter.schedule('fast.test', async () => 2);
    expect(clock.state.waits).toEqual([200]);
  });

  it('keeps the queue moving after a task fails', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    const failed = limiter.schedule('a.test', async () => {
      throw new Error('boom');
    });
    const next = limiter.schedule('a.test', async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test test/limiter.test.ts`
Expected: FAIL, cannot resolve `../src/limiter/limiter.js`.

- [ ] **Step 3: Write minimal implementation**

`server/src/limiter/limiter.ts`:
```ts
export interface LimiterOptions {
  minIntervalMs?: number;
  intervals?: Record<string, number>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes tasks per host and keeps a minimum gap between task starts. */
export class HostLimiter {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly lastStart = new Map<string, number>();
  private readonly minIntervalMs: number;
  private readonly intervals: Record<string, number>;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(opts: LimiterOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.intervals = opts.intervals ?? {};
    this.sleepFn = opts.sleep ?? sleep;
    this.now = opts.now ?? Date.now;
  }

  schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(host) ?? Promise.resolve();
    const run = previous.then(() => this.runAfterInterval(host, task));
    // The chain must never reject, or one failure would block the host forever.
    this.chains.set(
      host,
      run.catch(() => undefined),
    );
    return run;
  }

  private async runAfterInterval<T>(host: string, task: () => Promise<T>): Promise<T> {
    const interval = this.intervals[host] ?? this.minIntervalMs;
    const last = this.lastStart.get(host);
    if (last !== undefined) {
      const wait = last + interval - this.now();
      if (wait > 0) await this.sleepFn(wait);
    }
    this.lastStart.set(host, this.now());
    return task();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test test/limiter.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/limiter server/test/limiter.test.ts
git commit -m "feat(server): add per-host rate limiter"
```

---

### Task 3: HTTP client with timeout, retry, and User-Agent

**Files:**
- Create: `server/src/http/http.ts`
- Test: `server/test/http.test.ts`

**Interfaces:**
- Consumes: `HostLimiter`, `sleep` (Task 2), `USER_AGENT` (Task 1).
- Produces: `type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>`, `createHttp(opts: HttpOptions): HttpFetch`, `interface HttpOptions { limiter: HostLimiter; fetchImpl?: typeof fetch; timeoutMs?: number; maxTries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> }`, `class HttpError extends Error`, `retryDelayMs(res: Response | undefined, attempt: number, baseDelayMs: number): number`.

- [ ] **Step 1: Write the failing test**

`server/test/http.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { USER_AGENT } from '../src/config.js';
import { createHttp, HttpError, retryDelayMs } from '../src/http/http.js';
import { HostLimiter } from '../src/limiter/limiter.js';

function sequenceFetch(steps: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let i = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup(steps: Array<Response | Error>) {
  const waits: number[] = [];
  const { fetchImpl, calls } = sequenceFetch(steps);
  const http = createHttp({
    limiter: new HostLimiter({ minIntervalMs: 0 }),
    fetchImpl,
    baseDelayMs: 100,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { http, calls, waits };
}

describe('createHttp', () => {
  it('sends the engine user agent and returns the response', async () => {
    const { http, calls } = setup([new Response('ok', { status: 200 })]);
    const res = await http('https://a.test/x');
    expect(res.status).toBe(200);
    expect(new Headers(calls[0]?.init?.headers).get('user-agent')).toBe(USER_AGENT);
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries on 429 and honors Retry-After seconds', async () => {
    const { http, calls, waits } = setup([
      new Response('', { status: 429, headers: { 'retry-after': '2' } }),
      new Response('ok', { status: 200 }),
    ]);
    const res = await http('https://a.test/x');
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it('backs off exponentially on 5xx and returns the last response', async () => {
    const { http, calls, waits } = setup([
      new Response('', { status: 503 }),
      new Response('', { status: 503 }),
      new Response('', { status: 503 }),
    ]);
    const res = await http('https://a.test/x');
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([100, 200]);
  });

  it('does not retry on 404', async () => {
    const { http, calls } = setup([new Response('', { status: 404 })]);
    expect((await http('https://a.test/x')).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('throws HttpError after repeated network errors', async () => {
    const { http, calls } = setup([new TypeError('fetch failed')]);
    await expect(http('https://a.test/x')).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(3);
  });

  it('caps Retry-After at 60 seconds', () => {
    const res = new Response('', { status: 429, headers: { 'retry-after': '9999' } });
    expect(retryDelayMs(res, 0, 100)).toBe(60_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test test/http.test.ts`
Expected: FAIL, cannot resolve `../src/http/http.js`.

- [ ] **Step 3: Write minimal implementation**

`server/src/http/http.ts`:
```ts
import { USER_AGENT } from '../config.js';
import { type HostLimiter, sleep as realSleep } from '../limiter/limiter.js';

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  limiter: HostLimiter;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class HttpError extends Error {
  override name = 'HttpError';
}

const MAX_DELAY_MS = 60_000;

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

export function retryDelayMs(
  res: Response | undefined,
  attempt: number,
  baseDelayMs: number,
): number {
  const header = res?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_DELAY_MS);
  }
  return Math.min(baseDelayMs * 2 ** attempt, MAX_DELAY_MS);
}

export function createHttp(opts: HttpOptions): HttpFetch {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxTries = opts.maxTries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleepFn = opts.sleep ?? realSleep;

  return async (url, init = {}) => {
    const host = new URL(url).host;
    const headers = new Headers(init.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
    let lastError: unknown;

    for (let attempt = 0; attempt < maxTries; attempt++) {
      const isLast = attempt === maxTries - 1;
      try {
        const res = await opts.limiter.schedule(host, () =>
          fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) }),
        );
        if (!shouldRetry(res.status) || isLast) return res;
        await sleepFn(retryDelayMs(res, attempt, baseDelayMs));
      } catch (error) {
        lastError = error;
        if (isLast) break;
        await sleepFn(retryDelayMs(undefined, attempt, baseDelayMs));
      }
    }
    throw new HttpError(`Request to ${host} failed after ${maxTries} tries`, {
      cause: lastError,
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test test/http.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/http server/test/http.test.ts
git commit -m "feat(server): add HTTP client with timeout, retry, and user agent"
```

---

### Task 4: Atomic file write and disk cache

**Files:**
- Create: `server/src/fs/atomic.ts`, `server/src/cache/cache.ts`, `server/src/cache/ttl.ts`
- Test: `server/test/cache.test.ts`

**Interfaces:**
- Produces: `writeFileAtomic(path: string, data: string): Promise<void>`; `class DiskCache { constructor(dir: string, now?: () => number); get<T>(key: string): Promise<T | undefined>; set<T>(key: string, value: T, ttlMs: number): Promise<void> }`; `TTL: { registered: number; likelyAvailable: number; rdapBootstrap: number; handles: number; trademarks: number; registrarLive: number }` (milliseconds).

- [ ] **Step 1: Write the failing test**

`server/test/cache.test.ts`:
```ts
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache/cache.js';
import { TTL } from '../src/cache/ttl.js';
import { writeFileAtomic } from '../src/fs/atomic.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dne-cache-'));
}

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temp files', async () => {
    const dir = await tempDir();
    await writeFileAtomic(join(dir, 'a.json'), '{"a":1}');
    expect(await readFile(join(dir, 'a.json'), 'utf8')).toBe('{"a":1}');
    expect(await readdir(dir)).toEqual(['a.json']);
  });
});

describe('DiskCache', () => {
  it('returns undefined on a miss', async () => {
    const cache = new DiskCache(await tempDir());
    expect(await cache.get('nope')).toBeUndefined();
  });

  it('stores and reads a value before expiry', async () => {
    let now = 1000;
    const cache = new DiskCache(await tempDir(), () => now);
    await cache.set('k', { status: 'registered' }, 500);
    now = 1499;
    expect(await cache.get('k')).toEqual({ status: 'registered' });
  });

  it('expires values after the TTL', async () => {
    let now = 1000;
    const cache = new DiskCache(await tempDir(), () => now);
    await cache.set('k', 1, 500);
    now = 1500;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('does not store values with a TTL of zero', async () => {
    const dir = await tempDir();
    const cache = new DiskCache(dir);
    await cache.set('k', 1, 0);
    expect(await cache.get('k')).toBeUndefined();
  });

  it('treats a corrupt entry as a miss', async () => {
    const dir = await tempDir();
    const cache = new DiskCache(dir);
    await cache.set('k', 1, 10_000);
    const [file] = await readdir(dir);
    await writeFile(join(dir, file as string), 'not json');
    expect(await cache.get('k')).toBeUndefined();
  });

  it('defines the spec TTLs', () => {
    const hour = 3_600_000;
    expect(TTL.registered).toBe(7 * 24 * hour);
    expect(TTL.likelyAvailable).toBe(hour);
    expect(TTL.rdapBootstrap).toBe(24 * hour);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test test/cache.test.ts`
Expected: FAIL, cannot resolve `../src/cache/cache.js`.

- [ ] **Step 3: Write minimal implementation**

`server/src/fs/atomic.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Writes via a temp file and rename so readers never see a half-written file. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}
```

`server/src/cache/ttl.ts`:
```ts
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const TTL = {
  registered: 7 * DAY,
  likelyAvailable: HOUR,
  rdapBootstrap: DAY,
  handles: DAY,
  trademarks: 7 * DAY,
  registrarLive: HOUR,
} as const;
```

`server/src/cache/cache.ts`:
```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../fs/atomic.js';

interface Entry<T> {
  expiresAt: number;
  value: T;
}

export class DiskCache {
  private readonly dir: string;
  private readonly now: () => number;

  constructor(dir: string, now: () => number = Date.now) {
    this.dir = dir;
    this.now = now;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.file(key), 'utf8')) as Entry<T>;
      return entry.expiresAt > this.now() ? entry.value : undefined;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return;
    const entry: Entry<T> = { expiresAt: this.now() + ttlMs, value };
    await writeFileAtomic(this.file(key), JSON.stringify(entry));
  }

  private file(key: string): string {
    return join(this.dir, `${createHash('sha256').update(key).digest('hex')}.json`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test test/cache.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/fs server/src/cache server/test/cache.test.ts
git commit -m "feat(server): add atomic file write and TTL disk cache"
```

---

### Task 5: Domain name normalization and result types

**Files:**
- Create: `server/src/domain/name.ts`, `server/src/domain/types.ts`
- Test: `server/test/name.test.ts`

**Interfaces:**
- Produces: `class ValidationError extends Error`; `normalizeLabel(input: string): string`; `normalizeTld(input: string): string`; `joinDomain(label: string, tld: string): string`; `splitDomain(domain: string): { label: string; tld: string }`; types `Confidence = 'high' | 'medium' | 'low'`, `DomainStatus = 'registered' | 'likely_available' | 'unknown'`, `CheckSource = 'rdap' | 'whois' | 'dns' | 'none'`, `interface DomainCheck { domain: string; status: DomainStatus; source: CheckSource; confidence: Confidence; checkedAt: string; reason?: string }`.

- [ ] **Step 1: Write the failing test**

`server/test/name.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  joinDomain,
  normalizeLabel,
  normalizeTld,
  splitDomain,
  ValidationError,
} from '../src/domain/name.js';

describe('normalizeLabel', () => {
  it('lowercases and trims', () => {
    expect(normalizeLabel('  Acme ')).toBe('acme');
  });

  it('accepts inner hyphens and punycode', () => {
    expect(normalizeLabel('get-acme')).toBe('get-acme');
    expect(normalizeLabel('xn--bcher-kva')).toBe('xn--bcher-kva');
  });

  it.each(['', '-acme', 'acme-', 'ac me', 'acme.com', 'a'.repeat(64), 'ácme'])(
    'rejects %j',
    (input) => {
      expect(() => normalizeLabel(input)).toThrow(ValidationError);
    },
  );
});

describe('normalizeTld', () => {
  it('strips a leading dot and lowercases', () => {
    expect(normalizeTld('.IO')).toBe('io');
  });

  it('accepts multi-label TLDs up to three labels', () => {
    expect(normalizeTld('co.uk')).toBe('co.uk');
  });

  it.each(['', '.', 'a.b.c.d', 'c_m', '-io'])('rejects %j', (input) => {
    expect(() => normalizeTld(input)).toThrow(ValidationError);
  });
});

describe('joinDomain and splitDomain', () => {
  it('joins a label and a TLD', () => {
    expect(joinDomain('Acme', '.Dev')).toBe('acme.dev');
  });

  it('splits at the first dot', () => {
    expect(splitDomain('Acme.co.uk.')).toEqual({ label: 'acme', tld: 'co.uk' });
  });

  it('rejects a domain without a TLD', () => {
    expect(() => splitDomain('acme')).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test test/name.test.ts`
Expected: FAIL, cannot resolve `../src/domain/name.js`.

- [ ] **Step 3: Write minimal implementation**

`server/src/domain/types.ts`:
```ts
export type Confidence = 'high' | 'medium' | 'low';
export type DomainStatus = 'registered' | 'likely_available' | 'unknown';
export type CheckSource = 'rdap' | 'whois' | 'dns' | 'none';

export interface DomainCheck {
  domain: string;
  status: DomainStatus;
  source: CheckSource;
  confidence: Confidence;
  checkedAt: string;
  reason?: string;
}
```

`server/src/domain/name.ts`:
```ts
export class ValidationError extends Error {
  override name = 'ValidationError';
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_PART = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeLabel(input: string): string {
  const label = input.trim().toLowerCase();
  if (!LABEL.test(label)) {
    throw new ValidationError(
      `"${input}" is not a valid domain label: use 1-63 ASCII letters, digits, or inner hyphens (punycode for non-ASCII).`,
    );
  }
  return label;
}

export function normalizeTld(input: string): string {
  const tld = input.trim().toLowerCase().replace(/^\./, '');
  const parts = tld.split('.');
  if (parts.length > 3 || !parts.every((part) => TLD_PART.test(part))) {
    throw new ValidationError(`"${input}" is not a valid TLD.`);
  }
  return tld;
}

export function joinDomain(label: string, tld: string): string {
  return `${normalizeLabel(label)}.${normalizeTld(tld)}`;
}

export function splitDomain(domain: string): { label: string; tld: string } {
  const clean = domain.trim().toLowerCase().replace(/\.$/, '');
  const dot = clean.indexOf('.');
  if (dot <= 0) throw new ValidationError(`"${domain}" has no TLD.`);
  return { label: normalizeLabel(clean.slice(0, dot)), tld: normalizeTld(clean.slice(dot + 1)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test test/name.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/domain server/test/name.test.ts
git commit -m "feat(server): add domain name normalization and check types"
```

---

### Task 6: RDAP source

**Files:**
- Create: `server/src/sources/rdap.ts`, `server/test/fixtures/rdap-bootstrap.json`, `server/test/fixtures/rdap-domain-google.json`
- Test: `server/test/rdap.test.ts`

**Interfaces:**
- Consumes: `HttpFetch` (Task 3), `DiskCache`, `TTL` (Task 4), `errorMessage` (Task 1).
- Produces: `IANA_RDAP_BOOTSTRAP: string`; `type RdapServers = Record<string, string[]>`; `parseBootstrap(file: { services: [string[], string[]][] }): RdapServers`; `loadRdapServers(http: HttpFetch, cache: DiskCache): Promise<RdapServers>`; `rdapBaseFor(servers: RdapServers, tld: string): string | undefined`; `interface RdapDomain { ldhName?: string; status?: string[]; events?: Array<{ eventAction: string; eventDate: string }>; nameservers?: Array<{ ldhName?: string }>; entities?: unknown[] }`; `type RdapResult = { kind: 'registered'; record: RdapDomain } | { kind: 'not_found' } | { kind: 'no_server' } | { kind: 'error'; reason: string }`; `rdapLookup(domain: string, tld: string, deps: { http: HttpFetch; servers: () => Promise<RdapServers> }): Promise<RdapResult>`.

- [ ] **Step 1: Add fixtures**

`server/test/fixtures/rdap-bootstrap.json` (trimmed copy of the IANA file shape):
```json
{
  "version": "1.0",
  "publication": "2026-11-01T00:00:00Z",
  "services": [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["dev", "app"], ["https://pubapi.registry.google/rdap/"]],
    [["uk"], ["http://rdap.nominet.uk/uk/", "https://rdap.nominet.uk/uk/"]]
  ]
}
```

`server/test/fixtures/rdap-domain-google.json`:
```json
{
  "objectClassName": "domain",
  "ldhName": "GOOGLE.COM",
  "status": ["client delete prohibited", "server transfer prohibited"],
  "events": [
    { "eventAction": "registration", "eventDate": "1997-09-15T04:00:00Z" },
    { "eventAction": "expiration", "eventDate": "2028-09-14T04:00:00Z" }
  ],
  "nameservers": [{ "ldhName": "NS1.GOOGLE.COM" }, { "ldhName": "NS2.GOOGLE.COM" }]
}
```

- [ ] **Step 2: Write the failing test**

`server/test/rdap.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache/cache.js';
import type { HttpFetch } from '../src/http/http.js';
import {
  IANA_RDAP_BOOTSTRAP,
  loadRdapServers,
  parseBootstrap,
  rdapBaseFor,
  rdapLookup,
} from '../src/sources/rdap.js';
import bootstrap from './fixtures/rdap-bootstrap.json' with { type: 'json' };
import googleRecord from './fixtures/rdap-domain-google.json' with { type: 'json' };

const servers = parseBootstrap(bootstrap as { services: [string[], string[]][] });

function routeHttp(routes: Record<string, Response | Error>): {
  http: HttpFetch;
  urls: string[];
} {
  const urls: string[] = [];
  const http: HttpFetch = async (url) => {
    urls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response('', { status: 500 });
    if (route instanceof Error) throw route;
    return route.clone();
  };
  return { http, urls };
}

describe('parseBootstrap and rdapBaseFor', () => {
  it('maps every TLD to its servers', () => {
    expect(servers.com).toEqual(['https://rdap.verisign.com/com/v1/']);
    expect(servers.app).toEqual(['https://pubapi.registry.google/rdap/']);
  });

  it('prefers an https server', () => {
    expect(rdapBaseFor(servers, 'uk')).toBe('https://rdap.nominet.uk/uk/');
  });

  it('falls back to the last label for multi-label TLDs', () => {
    expect(rdapBaseFor(servers, 'co.uk')).toBe('https://rdap.nominet.uk/uk/');
  });

  it('returns undefined for a TLD without RDAP', () => {
    expect(rdapBaseFor(servers, 'xyz')).toBeUndefined();
  });
});

describe('loadRdapServers', () => {
  it('fetches the IANA file once and then serves it from cache', async () => {
    const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rdap-')));
    const { http, urls } = routeHttp({
      [IANA_RDAP_BOOTSTRAP]: Response.json(bootstrap),
    });
    await loadRdapServers(http, cache);
    const second = await loadRdapServers(http, cache);
    expect(second.com).toEqual(['https://rdap.verisign.com/com/v1/']);
    expect(urls).toEqual([IANA_RDAP_BOOTSTRAP]);
  });

  it('throws when IANA returns an error status', async () => {
    const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'dne-rdap-')));
    const { http } = routeHttp({ [IANA_RDAP_BOOTSTRAP]: new Response('', { status: 503 }) });
    await expect(loadRdapServers(http, cache)).rejects.toThrow('HTTP 503');
  });
});

describe('rdapLookup', () => {
  const deps = (routes: Record<string, Response | Error>) => ({
    http: routeHttp(routes).http,
    servers: async () => servers,
  });

  it('reports registered with the record on HTTP 200', async () => {
    const result = await rdapLookup(
      'google.com',
      'com',
      deps({ 'https://rdap.verisign.com/com/v1/domain/google.com': Response.json(googleRecord) }),
    );
    expect(result.kind).toBe('registered');
    if (result.kind === 'registered') expect(result.record.ldhName).toBe('GOOGLE.COM');
  });

  it('reports not_found on HTTP 404', async () => {
    const result = await rdapLookup(
      'zzqx.com',
      'com',
      deps({ 'https://rdap.verisign.com/com/v1/domain/zzqx.com': new Response('', { status: 404 }) }),
    );
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('reports no_server when the TLD has no RDAP service', async () => {
    expect(await rdapLookup('acme.xyz', 'xyz', deps({}))).toEqual({ kind: 'no_server' });
  });

  it('reports error on other statuses and on network failure', async () => {
    const url = 'https://rdap.verisign.com/com/v1/domain/acme.com';
    expect(await rdapLookup('acme.com', 'com', deps({ [url]: new Response('', { status: 400 }) })))
      .toEqual({ kind: 'error', reason: 'RDAP HTTP 400' });
    expect(await rdapLookup('acme.com', 'com', deps({ [url]: new Error('offline') }))).toEqual({
      kind: 'error',
      reason: 'offline',
    });
  });

  it('reports error when the bootstrap cannot load', async () => {
    const result = await rdapLookup('acme.com', 'com', {
      http: routeHttp({}).http,
      servers: async () => {
        throw new Error('IANA down');
      },
    });
    expect(result).toEqual({ kind: 'error', reason: 'IANA down' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && pnpm test test/rdap.test.ts`
Expected: FAIL, cannot resolve `../src/sources/rdap.js`.

- [ ] **Step 4: Write minimal implementation**

`server/src/sources/rdap.ts`:
```ts
import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import type { HttpFetch } from '../http/http.js';
import { errorMessage } from '../util/errors.js';

export const IANA_RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const BOOTSTRAP_CACHE_KEY = 'rdap:bootstrap';

export type RdapServers = Record<string, string[]>;

export interface RdapDomain {
  ldhName?: string;
  status?: string[];
  events?: Array<{ eventAction: string; eventDate: string }>;
  nameservers?: Array<{ ldhName?: string }>;
  entities?: unknown[];
}

export type RdapResult =
  | { kind: 'registered'; record: RdapDomain }
  | { kind: 'not_found' }
  | { kind: 'no_server' }
  | { kind: 'error'; reason: string };

export function parseBootstrap(file: { services: [string[], string[]][] }): RdapServers {
  const servers: RdapServers = {};
  for (const [tlds, urls] of file.services) {
    for (const tld of tlds) servers[tld.toLowerCase()] = urls;
  }
  return servers;
}

export async function loadRdapServers(http: HttpFetch, cache: DiskCache): Promise<RdapServers> {
  const cached = await cache.get<RdapServers>(BOOTSTRAP_CACHE_KEY);
  if (cached) return cached;
  const res = await http(IANA_RDAP_BOOTSTRAP);
  if (!res.ok) throw new Error(`IANA RDAP bootstrap returned HTTP ${res.status}`);
  const servers = parseBootstrap((await res.json()) as { services: [string[], string[]][] });
  await cache.set(BOOTSTRAP_CACHE_KEY, servers, TTL.rdapBootstrap);
  return servers;
}

export function rdapBaseFor(servers: RdapServers, tld: string): string | undefined {
  const candidates = [tld, tld.split('.').at(-1) ?? tld];
  for (const candidate of candidates) {
    const urls = servers[candidate];
    if (urls && urls.length > 0) return urls.find((u) => u.startsWith('https://')) ?? urls[0];
  }
  return undefined;
}

export async function rdapLookup(
  domain: string,
  tld: string,
  deps: { http: HttpFetch; servers: () => Promise<RdapServers> },
): Promise<RdapResult> {
  let servers: RdapServers;
  try {
    servers = await deps.servers();
  } catch (error) {
    return { kind: 'error', reason: errorMessage(error) };
  }
  const base = rdapBaseFor(servers, tld);
  if (!base) return { kind: 'no_server' };

  const url = new URL(`domain/${domain}`, base.endsWith('/') ? base : `${base}/`).toString();
  try {
    const res = await deps.http(url, { headers: { accept: 'application/rdap+json' } });
    if (res.status === 404) return { kind: 'not_found' };
    if (res.ok) return { kind: 'registered', record: (await res.json()) as RdapDomain };
    return { kind: 'error', reason: `RDAP HTTP ${res.status}` };
  } catch (error) {
    return { kind: 'error', reason: errorMessage(error) };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && pnpm test test/rdap.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/sources/rdap.ts server/test/rdap.test.ts server/test/fixtures
git commit -m "feat(server): add RDAP bootstrap and domain lookup"
```

---

### Task 7: WHOIS fallback source

**Files:**
- Create: `server/src/sources/whois.ts`
- Test: `server/test/whois.test.ts`

**Interfaces:**
- Consumes: `HostLimiter` (Task 2), `DiskCache`, `TTL` (Task 4), `errorMessage` (Task 1).
- Produces: `type WhoisQuery = (server: string, query: string) => Promise<string>`; `tcpWhoisQuery(timeoutMs?: number): WhoisQuery`; `parseReferral(text: string): string | null`; `parseAvailability(text: string): 'registered' | 'not_found' | 'unknown'`; `type WhoisResult = { kind: 'registered' | 'not_found' | 'unknown'; server: string; raw: string } | { kind: 'no_server' } | { kind: 'error'; reason: string }`; `whoisLookup(domain: string, tld: string, deps: { query: WhoisQuery; limiter: HostLimiter; cache: DiskCache }): Promise<WhoisResult>`.

- [ ] **Step 1: Write the failing test**

`server/test/whois.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache/cache.js';
import { HostLimiter } from '../src/limiter/limiter.js';
import {
  parseAvailability,
  parseReferral,
  type WhoisQuery,
  whoisLookup,
} from '../src/sources/whois.js';

const IANA_XYZ = `% IANA WHOIS server
domain:       XYZ
organisation: XYZ.COM LLC
whois:        whois.nic.xyz
status:       ACTIVE
`;

const IANA_NO_WHOIS = `% IANA WHOIS server
domain:       EXAMPLE
status:       ACTIVE
`;

const REGISTERED = `Domain Name: ABC.XYZ
Registry Domain ID: D1234-CNIC
Registrar: Example Registrar, Inc.
Creation Date: 2014-06-02T00:00:00.0Z
`;

const NOT_FOUND = 'The queried object does not exist: DOMAIN NOT FOUND\n';

describe('parseReferral', () => {
  it('reads the whois server from IANA output', () => {
    expect(parseReferral(IANA_XYZ)).toBe('whois.nic.xyz');
  });

  it('returns null when IANA lists no whois server', () => {
    expect(parseReferral(IANA_NO_WHOIS)).toBeNull();
  });
});

describe('parseAvailability', () => {
  it.each([
    ['No match for "ZZQX.COM".', 'not_found'],
    [NOT_FOUND, 'not_found'],
    ['%% NOT FOUND', 'not_found'],
    ['Status: free', 'not_found'],
    ['No Data Found', 'not_found'],
    [REGISTERED, 'registered'],
    ['Rate limit exceeded', 'unknown'],
  ])('classifies %j as %s', (text, expected) => {
    expect(parseAvailability(text)).toBe(expected);
  });
});

describe('whoisLookup', () => {
  async function deps(responses: Record<string, string | Error>) {
    const calls: string[] = [];
    const query: WhoisQuery = async (server, q) => {
      calls.push(`${server} ${q}`);
      const reply = responses[`${server} ${q}`];
      if (reply === undefined) throw new Error(`unexpected query ${server} ${q}`);
      if (reply instanceof Error) throw reply;
      return reply;
    };
    return {
      calls,
      deps: {
        query,
        limiter: new HostLimiter({ minIntervalMs: 0 }),
        cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-whois-'))),
      },
    };
  }

  it('follows the IANA referral and classifies the reply', async () => {
    const { deps: d } = await deps({
      'whois.iana.org xyz': IANA_XYZ,
      'whois.nic.xyz abc.xyz': REGISTERED,
    });
    const result = await whoisLookup('abc.xyz', 'xyz', d);
    expect(result).toMatchObject({ kind: 'registered', server: 'whois.nic.xyz' });
  });

  it('caches the referral server', async () => {
    const { deps: d, calls } = await deps({
      'whois.iana.org xyz': IANA_XYZ,
      'whois.nic.xyz a.xyz': NOT_FOUND,
      'whois.nic.xyz b.xyz': NOT_FOUND,
    });
    await whoisLookup('a.xyz', 'xyz', d);
    await whoisLookup('b.xyz', 'xyz', d);
    expect(calls.filter((c) => c.startsWith('whois.iana.org'))).toHaveLength(1);
  });

  it('reports no_server when IANA lists none', async () => {
    const { deps: d } = await deps({ 'whois.iana.org example': IANA_NO_WHOIS });
    expect(await whoisLookup('a.example', 'example', d)).toEqual({ kind: 'no_server' });
  });

  it('reports error when the query fails', async () => {
    const { deps: d } = await deps({ 'whois.iana.org xyz': new Error('ECONNREFUSED') });
    expect(await whoisLookup('a.xyz', 'xyz', d)).toEqual({
      kind: 'error',
      reason: 'ECONNREFUSED',
    });
  });

  it('uses the last label of a multi-label TLD for the referral', async () => {
    const { deps: d } = await deps({
      'whois.iana.org uk': 'whois:        whois.nic.uk\n',
      'whois.nic.uk acme.co.uk': 'No match for "acme.co.uk".',
    });
    expect(await whoisLookup('acme.co.uk', 'co.uk', d)).toMatchObject({ kind: 'not_found' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test test/whois.test.ts`
Expected: FAIL, cannot resolve `../src/sources/whois.js`.

- [ ] **Step 3: Write minimal implementation**

`server/src/sources/whois.ts`:
```ts
import { connect } from 'node:net';
import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import type { HostLimiter } from '../limiter/limiter.js';
import { errorMessage } from '../util/errors.js';

export type WhoisQuery = (server: string, query: string) => Promise<string>;

export type WhoisResult =
  | { kind: 'registered' | 'not_found' | 'unknown'; server: string; raw: string }
  | { kind: 'no_server' }
  | { kind: 'error'; reason: string };

const IANA_WHOIS = 'whois.iana.org';

const NOT_FOUND_PATTERNS = [
  /no match for/i,
  /^\s*not found/im,
  /^%+\s*not found/im,
  /no data found/i,
  /no entries found/i,
  /domain not found/i,
  /no object found/i,
  /the queried object does not exist/i,
  /is available for registration/i,
  /^\s*status:\s*(free|available)\s*$/im,
];

const REGISTERED_PATTERNS = [
  /^\s*domain name:/im,
  /^\s*registrar:/im,
  /creation date:/i,
  /^\s*created:/im,
  /^\s*registered:/im,
];

export function tcpWhoisQuery(timeoutMs = 8000): WhoisQuery {
  return (server, query) =>
    new Promise((resolve, reject) => {
      const socket = connect({ host: server, port: 43 });
      const chunks: Buffer[] = [];
      socket.setTimeout(timeoutMs, () => {
        socket.destroy(new Error(`WHOIS ${server} timed out after ${timeoutMs} ms`));
      });
      socket.on('connect', () => socket.write(`${query}\r\n`));
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('error', reject);
      socket.on('close', (hadError) => {
        if (!hadError) resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
}

export function parseReferral(text: string): string | null {
  const match = text.match(/^whois:\s*(\S+)/im);
  return match?.[1]?.toLowerCase() ?? null;
}

export function parseAvailability(text: string): 'registered' | 'not_found' | 'unknown' {
  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(text))) return 'not_found';
  if (REGISTERED_PATTERNS.some((pattern) => pattern.test(text))) return 'registered';
  return 'unknown';
}

export async function whoisLookup(
  domain: string,
  tld: string,
  deps: { query: WhoisQuery; limiter: HostLimiter; cache: DiskCache },
): Promise<WhoisResult> {
  const rootLabel = tld.split('.').at(-1) ?? tld;
  try {
    const cacheKey = `whois:server:${rootLabel}`;
    let server = await deps.cache.get<string | null>(cacheKey);
    if (server === undefined) {
      const iana = await deps.limiter.schedule(IANA_WHOIS, () =>
        deps.query(IANA_WHOIS, rootLabel),
      );
      server = parseReferral(iana);
      await deps.cache.set(cacheKey, server, TTL.rdapBootstrap);
    }
    if (!server) return { kind: 'no_server' };
    const target = server;
    const raw = await deps.limiter.schedule(target, () => deps.query(target, domain));
    return { kind: parseAvailability(raw), server: target, raw };
  } catch (error) {
    return { kind: 'error', reason: errorMessage(error) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test test/whois.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/sources/whois.ts server/test/whois.test.ts
git commit -m "feat(server): add WHOIS fallback with IANA referral"
```

---

### Task 8: DNS signal and the combined domain check

**Files:**
- Create: `server/src/sources/dns.ts`, `server/src/domain/check.ts`
- Test: `server/test/dns.test.ts`, `server/test/check.test.ts`

**Interfaces:**
- Consumes: `RdapResult` (Task 6), `WhoisResult` (Task 7), `DiskCache`, `TTL` (Task 4), `splitDomain`, `DomainCheck` (Task 5).
- Produces: `type NsResolver = (domain: string) => Promise<string[]>`; `hasNameservers(domain: string, resolve?: NsResolver): Promise<boolean | null>`; `interface CheckDeps { rdap(domain: string, tld: string): Promise<RdapResult>; whois(domain: string, tld: string): Promise<WhoisResult>; dns(domain: string): Promise<boolean | null>; cache: DiskCache; now?: () => Date }`; `checkDomain(domain: string, deps: CheckDeps): Promise<DomainCheck>`; `checkDomains(domains: string[], deps: CheckDeps, concurrency?: number): Promise<DomainCheck[]>`.

Decision table implemented by `checkDomain`:

| RDAP | WHOIS | DNS has NS | Result |
|---|---|---|---|
| registered | — | — | `registered`, `rdap`, `high` |
| not_found | — | false | `likely_available`, `rdap`, `high` |
| not_found | — | null (lookup failed) | `likely_available`, `rdap`, `medium` |
| not_found | — | true | `unknown`, `rdap`, `low`, reason: conflict |
| no_server / error | registered | — | `registered`, `whois`, `high` |
| no_server / error | not_found | false or null | `likely_available`, `whois`, `medium` |
| no_server / error | not_found | true | `unknown`, `whois`, `low`, reason: conflict |
| no_server / error | unknown / no_server / error | true | `registered`, `dns`, `medium` |
| no_server / error | unknown / no_server / error | false or null | `unknown`, `none`, `low`, reason lists RDAP and WHOIS failures |

- [ ] **Step 1: Write the failing tests**

`server/test/dns.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hasNameservers } from '../src/sources/dns.js';

function failingResolver(code: string) {
  return async () => {
    throw Object.assign(new Error(code), { code });
  };
}

describe('hasNameservers', () => {
  it('returns true when NS records exist', async () => {
    expect(await hasNameservers('a.com', async () => ['ns1.a.com'])).toBe(true);
  });

  it('returns false for NXDOMAIN-style errors', async () => {
    expect(await hasNameservers('a.com', failingResolver('ENOTFOUND'))).toBe(false);
    expect(await hasNameservers('a.com', failingResolver('ENODATA'))).toBe(false);
  });

  it('returns null when the lookup itself fails', async () => {
    expect(await hasNameservers('a.com', failingResolver('ETIMEOUT'))).toBeNull();
  });
});
```

`server/test/check.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache/cache.js';
import { type CheckDeps, checkDomain, checkDomains } from '../src/domain/check.js';
import type { RdapResult } from '../src/sources/rdap.js';
import type { WhoisResult } from '../src/sources/whois.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');

async function makeDeps(opts: {
  rdap: RdapResult;
  whois?: WhoisResult;
  dns?: boolean | null;
}): Promise<CheckDeps & { counts: { rdap: number } }> {
  const counts = { rdap: 0 };
  return {
    counts,
    cache: new DiskCache(await mkdtemp(join(tmpdir(), 'dne-check-'))),
    now: () => NOW,
    rdap: async () => {
      counts.rdap++;
      return opts.rdap;
    },
    whois: async () => opts.whois ?? { kind: 'no_server' },
    dns: async () => opts.dns ?? null,
  };
}

const whoisOf = (kind: 'registered' | 'not_found' | 'unknown'): WhoisResult => ({
  kind,
  server: 'whois.nic.test',
  raw: '',
});

describe('checkDomain', () => {
  it.each([
    [{ rdap: { kind: 'registered', record: {} } }, 'registered', 'rdap', 'high'],
    [{ rdap: { kind: 'not_found' }, dns: false }, 'likely_available', 'rdap', 'high'],
    [{ rdap: { kind: 'not_found' }, dns: null }, 'likely_available', 'rdap', 'medium'],
    [{ rdap: { kind: 'not_found' }, dns: true }, 'unknown', 'rdap', 'low'],
    [{ rdap: { kind: 'no_server' }, whois: whoisOf('registered') }, 'registered', 'whois', 'high'],
    [
      { rdap: { kind: 'error', reason: 'x' }, whois: whoisOf('not_found'), dns: false },
      'likely_available',
      'whois',
      'medium',
    ],
    [
      { rdap: { kind: 'no_server' }, whois: whoisOf('not_found'), dns: true },
      'unknown',
      'whois',
      'low',
    ],
    [{ rdap: { kind: 'no_server' }, whois: whoisOf('unknown'), dns: true }, 'registered', 'dns', 'medium'],
    [{ rdap: { kind: 'no_server' }, whois: { kind: 'no_server' }, dns: false }, 'unknown', 'none', 'low'],
  ] as const)('maps %j to %s/%s/%s', async (input, status, source, confidence) => {
    const deps = await makeDeps(input as Parameters<typeof makeDeps>[0]);
    const result = await checkDomain('acme.test', deps);
    expect(result).toMatchObject({
      domain: 'acme.test',
      status,
      source,
      confidence,
      checkedAt: NOW.toISOString(),
    });
  });

  it('explains why a result is unknown', async () => {
    const deps = await makeDeps({
      rdap: { kind: 'error', reason: 'RDAP HTTP 400' },
      whois: { kind: 'error', reason: 'timed out' },
      dns: false,
    });
    const result = await checkDomain('acme.test', deps);
    expect(result.reason).toBe('RDAP: RDAP HTTP 400; WHOIS: timed out');
  });

  it('serves registered results from cache', async () => {
    const deps = await makeDeps({ rdap: { kind: 'registered', record: {} } });
    await checkDomain('acme.test', deps);
    await checkDomain('acme.test', deps);
    expect(deps.counts.rdap).toBe(1);
  });

  it('does not cache unknown results', async () => {
    const deps = await makeDeps({ rdap: { kind: 'no_server' }, dns: false });
    await checkDomain('acme.test', deps);
    await checkDomain('acme.test', deps);
    expect(deps.counts.rdap).toBe(2);
  });
});

describe('checkDomains', () => {
  it('keeps input order', async () => {
    const deps = await makeDeps({ rdap: { kind: 'not_found' }, dns: false });
    const results = await checkDomains(['a.test', 'b.test', 'c.test'], deps, 2);
    expect(results.map((r) => r.domain)).toEqual(['a.test', 'b.test', 'c.test']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test test/dns.test.ts test/check.test.ts`
Expected: FAIL, cannot resolve `../src/sources/dns.js` and `../src/domain/check.js`.

- [ ] **Step 3: Write minimal implementation**

`server/src/sources/dns.ts`:
```ts
import { resolveNs } from 'node:dns/promises';

export type NsResolver = (domain: string) => Promise<string[]>;

const NO_RECORD_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/** true: NS records exist; false: no NS records; null: the lookup failed. */
export async function hasNameservers(
  domain: string,
  resolve: NsResolver = resolveNs,
): Promise<boolean | null> {
  try {
    return (await resolve(domain)).length > 0;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== undefined && NO_RECORD_CODES.has(code) ? false : null;
  }
}
```

`server/src/domain/check.ts`:
```ts
import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import type { RdapResult } from '../sources/rdap.js';
import type { WhoisResult } from '../sources/whois.js';
import { splitDomain } from './name.js';
import type { CheckSource, Confidence, DomainCheck } from './types.js';

export interface CheckDeps {
  rdap(domain: string, tld: string): Promise<RdapResult>;
  whois(domain: string, tld: string): Promise<WhoisResult>;
  dns(domain: string): Promise<boolean | null>;
  cache: DiskCache;
  now?: () => Date;
}

type Base = Pick<DomainCheck, 'domain' | 'checkedAt'>;

function ttlFor(check: DomainCheck): number {
  if (check.status === 'registered') return TTL.registered;
  if (check.status === 'likely_available') return TTL.likelyAvailable;
  return 0;
}

function notFound(
  base: Base,
  source: CheckSource,
  confidence: Confidence,
  hasNs: boolean | null,
): DomainCheck {
  if (hasNs === true) {
    return {
      ...base,
      status: 'unknown',
      source,
      confidence: 'low',
      reason: `${source.toUpperCase()} reports no registration, but DNS has nameservers.`,
    };
  }
  return {
    ...base,
    status: 'likely_available',
    source,
    confidence: hasNs === null ? 'medium' : confidence,
  };
}

function rdapReason(result: RdapResult): string {
  if (result.kind === 'no_server') return 'RDAP: no server for this TLD';
  if (result.kind === 'error') return `RDAP: ${result.reason}`;
  return `RDAP: ${result.kind}`;
}

function whoisReason(result: WhoisResult): string {
  if (result.kind === 'no_server') return 'WHOIS: no server for this TLD';
  if (result.kind === 'error') return `WHOIS: ${result.reason}`;
  return `WHOIS: response from ${result.server} not understood`;
}

async function resolveStatus(domain: string, tld: string, deps: CheckDeps): Promise<DomainCheck> {
  const base: Base = { domain, checkedAt: (deps.now?.() ?? new Date()).toISOString() };

  const rdap = await deps.rdap(domain, tld);
  if (rdap.kind === 'registered') {
    return { ...base, status: 'registered', source: 'rdap', confidence: 'high' };
  }
  if (rdap.kind === 'not_found') return notFound(base, 'rdap', 'high', await deps.dns(domain));

  const whois = await deps.whois(domain, tld);
  if (whois.kind === 'registered') {
    return { ...base, status: 'registered', source: 'whois', confidence: 'high' };
  }
  if (whois.kind === 'not_found') {
    return notFound(base, 'whois', 'medium', await deps.dns(domain));
  }

  if ((await deps.dns(domain)) === true) {
    return {
      ...base,
      status: 'registered',
      source: 'dns',
      confidence: 'medium',
      reason: 'Domain has nameservers; RDAP and WHOIS gave no usable answer.',
    };
  }
  return {
    ...base,
    status: 'unknown',
    source: 'none',
    confidence: 'low',
    reason: `${rdapReason(rdap)}; ${whoisReason(whois)}`,
  };
}

export async function checkDomain(domain: string, deps: CheckDeps): Promise<DomainCheck> {
  const { tld } = splitDomain(domain);
  const key = `domain:${domain}`;
  const cached = await deps.cache.get<DomainCheck>(key);
  if (cached) return cached;
  const result = await resolveStatus(domain, tld, deps);
  await deps.cache.set(key, result, ttlFor(result));
  return result;
}

export async function checkDomains(
  domains: string[],
  deps: CheckDeps,
  concurrency = 4,
): Promise<DomainCheck[]> {
  const results: DomainCheck[] = new Array(domains.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < domains.length) {
      const index = next++;
      results[index] = await checkDomain(domains[index] as string, deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, domains.length) }, worker));
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test test/dns.test.ts test/check.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src/sources/dns.ts server/src/domain/check.ts server/test/dns.test.ts server/test/check.test.ts
git commit -m "feat(server): combine RDAP, WHOIS, and DNS into one domain check"
```

---

### Task 9: MCP server, runtime wiring, and the `check_domains` tool

**Files:**
- Create: `server/src/tools/result.ts`, `server/src/tools/check-domains.ts`, `server/src/server.ts`, `server/src/runtime.ts`, `server/src/index.ts`, `server/test/helpers/mcp.ts`
- Test: `server/test/tools/check-domains.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: `toolJson(value: unknown): CallToolResult`; `toolError(message: string): CallToolResult`; `AVAILABILITY_NOTE: string`; `MAX_DOMAINS_PER_CALL = 200`; `registerCheckDomains(server: McpServer, rt: Pick<Runtime, 'checkDomains'>): void`; `interface Runtime { checkDomains(domains: string[]): Promise<DomainCheck[]> }`; `createRuntime(env?: NodeJS.ProcessEnv): Runtime`; `SERVER_INFO: { name: string; version: string }`; `createServer(rt: Runtime): McpServer`; test helper `connectClient(rt: Runtime): Promise<Client>` and `callJson(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: unknown; text: string }>`. Later plans add fields to `Runtime` and a `register*` call per tool in `createServer`.

- [ ] **Step 1: Write the test helper and failing test**

`server/test/helpers/mcp.ts`:
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Runtime } from '../../src/runtime.js';
import { createServer } from '../../src/server.js';

export async function connectClient(rt: Runtime): Promise<Client> {
  const server = createServer(rt);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; data: unknown; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const first = (result.content as Array<{ type: string; text?: string }>)[0];
  const text = first?.text ?? '';
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { isError: result.isError === true, data, text };
}
```

`server/test/tools/check-domains.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { DomainCheck } from '../../src/domain/types.js';
import type { Runtime } from '../../src/runtime.js';
import { AVAILABILITY_NOTE } from '../../src/tools/check-domains.js';
import { callJson, connectClient } from '../helpers/mcp.js';

function fakeRuntime(): Runtime & { seen: string[][] } {
  const seen: string[][] = [];
  return {
    seen,
    checkDomains: async (domains) => {
      seen.push(domains);
      return domains.map(
        (domain): DomainCheck => ({
          domain,
          status: 'likely_available',
          source: 'rdap',
          confidence: 'high',
          checkedAt: '2026-11-04T10:00:00.000Z',
        }),
      );
    },
  };
}

describe('check_domains tool', () => {
  it('is listed by the server', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('check_domains');
  });

  it('checks every name × TLD pair, normalized and de-duplicated', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    const res = await callJson(client, 'check_domains', {
      names: ['Acme', 'acme', 'zent'],
      tlds: ['com', '.IO'],
    });
    expect(res.isError).toBe(false);
    expect(rt.seen[0]).toEqual(['acme.com', 'acme.io', 'zent.com', 'zent.io']);
    expect(res.data).toMatchObject({ note: AVAILABILITY_NOTE });
    expect((res.data as { results: unknown[] }).results).toHaveLength(4);
  });

  it('returns a tool error for an invalid label', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'check_domains', { names: ['-bad'], tlds: ['com'] });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('"-bad" is not a valid domain label');
  });

  it('rejects more than 200 domains in one call', async () => {
    const client = await connectClient(fakeRuntime());
    const names = Array.from({ length: 60 }, (_, i) => `name${i}`);
    const res = await callJson(client, 'check_domains', {
      names,
      tlds: ['com', 'io', 'dev', 'app'],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('limit is 200');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test test/tools/check-domains.test.ts`
Expected: FAIL, cannot resolve `../../src/runtime.js` / `../../src/server.js`.

- [ ] **Step 3: Write minimal implementation**

`server/src/tools/result.ts`:
```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function toolJson(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
```

`server/src/tools/check-domains.ts`:
```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { joinDomain, ValidationError } from '../domain/name.js';
import type { Runtime } from '../runtime.js';
import { toolError, toolJson } from './result.js';

export const MAX_DOMAINS_PER_CALL = 200;

export const AVAILABILITY_NOTE =
  'likely_available means RDAP, WHOIS, and DNS found no registration. Premium and registry-reserved names are not visible to these free sources; confirm at a registrar before relying on it.';

export function registerCheckDomains(
  server: McpServer,
  rt: Pick<Runtime, 'checkDomains'>,
): void {
  server.registerTool(
    'check_domains',
    {
      title: 'Check domain availability',
      description:
        'Check every name × TLD pair with RDAP, a WHOIS fallback, and DNS. Each result is registered, likely_available, or unknown, with source, checkedAt, and confidence.',
      inputSchema: {
        names: z
          .array(z.string())
          .min(1)
          .max(100)
          .describe('Second-level labels without TLD, e.g. "acme"'),
        tlds: z
          .array(z.string())
          .min(1)
          .max(30)
          .describe('TLDs with or without a leading dot, e.g. "com", ".io", "co.uk"'),
      },
    },
    async ({ names, tlds }) => {
      let domains: string[];
      try {
        domains = [...new Set(names.flatMap((name) => tlds.map((tld) => joinDomain(name, tld))))];
      } catch (error) {
        if (error instanceof ValidationError) return toolError(error.message);
        throw error;
      }
      if (domains.length > MAX_DOMAINS_PER_CALL) {
        return toolError(
          `Too many domains (${domains.length}); the limit is ${MAX_DOMAINS_PER_CALL} per call.`,
        );
      }
      const results = await rt.checkDomains(domains);
      return toolJson({ results, note: AVAILABILITY_NOTE });
    },
  );
}
```

`server/src/runtime.ts`:
```ts
import { DiskCache } from './cache/cache.js';
import { engineHome, enginePaths } from './config.js';
import { type CheckDeps, checkDomains } from './domain/check.js';
import type { DomainCheck } from './domain/types.js';
import { createHttp } from './http/http.js';
import { HostLimiter } from './limiter/limiter.js';
import { hasNameservers } from './sources/dns.js';
import { loadRdapServers, type RdapServers, rdapLookup } from './sources/rdap.js';
import { tcpWhoisQuery, whoisLookup } from './sources/whois.js';

export interface Runtime {
  checkDomains(domains: string[]): Promise<DomainCheck[]>;
}

export function createRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const paths = enginePaths(engineHome(env));
  const cache = new DiskCache(paths.cache);
  const limiter = new HostLimiter();
  const http = createHttp({ limiter });
  const whoisQuery = tcpWhoisQuery();

  let servers: Promise<RdapServers> | undefined;
  const getServers = (): Promise<RdapServers> => {
    servers ??= loadRdapServers(http, cache).catch((error: unknown) => {
      // Allow a retry on the next call instead of caching the failure.
      servers = undefined;
      throw error;
    });
    return servers;
  };

  const deps: CheckDeps = {
    cache,
    rdap: (domain, tld) => rdapLookup(domain, tld, { http, servers: getServers }),
    whois: (domain, tld) => whoisLookup(domain, tld, { query: whoisQuery, limiter, cache }),
    dns: (domain) => hasNameservers(domain),
  };

  return {
    checkDomains: (domains) => checkDomains(domains, deps),
  };
}
```

`server/src/server.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VERSION } from './config.js';
import type { Runtime } from './runtime.js';
import { registerCheckDomains } from './tools/check-domains.js';

export const SERVER_INFO = { name: 'domain-name-engine', version: VERSION };

export function createServer(rt: Runtime): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerCheckDomains(server, rt);
  return server;
}
```

`server/src/index.ts`:
```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRuntime } from './runtime.js';
import { createServer } from './server.js';

const server = createServer(createRuntime());
await server.connect(new StdioServerTransport());
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test`
Expected: all test files PASS (live tests are not created yet).

- [ ] **Step 5: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && cd ..
git add server/src server/test
git commit -m "feat(server): expose check_domains through the MCP server"
```

---

### Task 10: Plugin wiring, bundle, live smoke test, and CI

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, `.github/workflows/ci.yml`, `LICENSE`, `README.md`, `server/test/live/domains.test.ts`, `server/dist/index.js` (generated)

**Interfaces:**
- Consumes: `createRuntime` (Task 9), `server/dist/index.js` built by tsdown (Task 1 config).
- Produces: an installable plugin with MCP server name `domain-engine`. Later plans add `skills/` folders to this plugin; plan 2 records the exact tool ids Claude Code assigns after install.

- [ ] **Step 1: Write the live smoke test**

`server/test/live/domains.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntime } from '../../src/runtime.js';

// Runs only through `pnpm test:live`; it uses the real network.
describe.skipIf(!process.env.LIVE)('live domain checks', () => {
  async function runtime() {
    const home = await mkdtemp(join(tmpdir(), 'dne-live-'));
    return createRuntime({ ...process.env, DOMAIN_ENGINE_HOME: home });
  }

  it('reports google.com as registered', async () => {
    const [result] = await (await runtime()).checkDomains(['google.com']);
    expect(result?.status).toBe('registered');
  }, 30_000);

  it('reports a random 30-letter .com as likely_available', async () => {
    const label = Array.from({ length: 30 }, () =>
      String.fromCharCode(97 + Math.floor(Math.random() * 26)),
    ).join('');
    const [result] = await (await runtime()).checkDomains([`${label}.com`]);
    expect(result?.status).toBe('likely_available');
  }, 30_000);
});
```

- [ ] **Step 2: Run unit tests and live tests**

Run: `cd server && pnpm test`
Expected: PASS; `test/live/domains.test.ts` shows 2 skipped.

Run: `cd server && pnpm test:live`
Expected: 2 live tests PASS. If the network is not reachable, record the exact error and continue; the live test is manual and does not gate CI.

- [ ] **Step 3: Add plugin manifests**

`.claude-plugin/plugin.json`:
```json
{
  "name": "domain-name-engine",
  "version": "0.1.0",
  "description": "Find a strong brand name and domain: LLM-driven naming with real RDAP/WHOIS/DNS availability checks and brand research tools.",
  "author": { "name": "Magnifito" },
  "repository": "https://github.com/magnifito/domain-name-engine",
  "license": "MIT",
  "keywords": ["domain", "naming", "branding", "rdap", "whois", "mcp"]
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "magnifito",
  "owner": { "name": "Magnifito" },
  "plugins": [
    {
      "name": "domain-name-engine",
      "source": "./",
      "description": "Find a strong brand name and domain with real availability checks and brand research tools."
    }
  ]
}
```

`.mcp.json`:
```json
{
  "mcpServers": {
    "domain-engine": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server/dist/index.js"]
    }
  }
}
```

- [ ] **Step 4: Add LICENSE and README stub**

`LICENSE`: the standard MIT license text, first line `MIT License`, copyright line `Copyright (c) 2026 Magnifito`.

`README.md`:
```markdown
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
```

- [ ] **Step 5: Build the bundle and smoke-test the stdio server**

Run: `cd server && pnpm build && ls -la dist`
Expected: `dist/index.js` exists; no other `.js` files.

Run (from repo root), sends `initialize` then `tools/list` over stdio:
```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | DOMAIN_ENGINE_HOME="$(mktemp -d)" node server/dist/index.js | grep -o '"name":"check_domains"'
```
Expected output: `"name":"check_domains"`.

- [ ] **Step 6: Add CI**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  server:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          package_json_file: server/package.json
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: server/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - name: Fail if the committed bundle is stale
        run: git diff --exit-code -- dist
```

- [ ] **Step 7: Validate the plugin manifest**

Run: `claude plugin validate .`
Expected: validation passes. If the command reports an unknown field, remove that field and rerun.

- [ ] **Step 8: Format, check, commit**

```bash
cd server && pnpm format && pnpm check && pnpm typecheck && pnpm test && cd ..
git add .claude-plugin .mcp.json .github LICENSE README.md server/test/live server/dist
git commit -m "feat: wire plugin manifests, bundle, live smoke test, and CI"
```

---

## Done criteria for Plan 1

- `cd server && pnpm check && pnpm typecheck && pnpm test && pnpm build` all exit 0, and `git status` is clean after the build.
- The stdio smoke command in Task 10 Step 5 prints `"name":"check_domains"`.
- `pnpm test:live` passes on a machine with network access.
- `claude plugin validate .` passes.
