import { writeFileAtomic } from '../fs/atomic.js';
import type { HttpFetch } from '../http/http.js';
import { fetchCloudflarePublicPrices } from '../registrars/cloudflare.js';
import { type Credentials, redact } from '../registrars/credentials.js';
import { fetchNamecheapTldPrices } from '../registrars/namecheap.js';
import { fetchSpaceshipTldPrices } from '../registrars/spaceship.js';
import { errorMessage } from '../util/errors.js';
import type { PriceRow, RegistrarId, RegistrarTable } from './schema.js';

export interface FetchedRegistrar {
  registrar: RegistrarId;
  rows: PriceRow[];
}

const byKey = (a: PriceRow, b: PriceRow) =>
  a.registrar.localeCompare(b.registrar) || a.tld.localeCompare(b.tld);

/**
 * Replaces all rows of each fetched registrar and marks its coverage full.
 * Registrars that were not fetched keep their current rows and coverage.
 */
export function mergeTable(current: RegistrarTable, fetched: FetchedRegistrar[]): RegistrarTable {
  const replaced = new Set(fetched.map((f) => f.registrar));
  const registrars = { ...current.registrars };
  for (const f of fetched) {
    registrars[f.registrar] = {
      coverage: 'full',
      notSold: [],
      notListed: [],
      fullList: {
        source: f.rows[0]?.source ?? 'the registrar',
        checkedAt: f.rows[0]?.checkedAt ?? '1970-01-01',
      },
      note: `Full list from ${f.rows[0]?.source ?? 'the registrar'}, refreshed by refresh:tlds.`,
    };
  }
  const rows = [
    ...current.rows.filter((r) => !replaced.has(r.registrar)),
    ...fetched.flatMap((f) => f.rows),
  ].sort(byKey);
  return { schemaVersion: 1, registrars, rows };
}

function fmt(row: PriceRow): string {
  const p = (v: number | null) => (v === null ? 'unknown' : String(v));
  return `first ${p(row.firstYear)}, renew ${p(row.renewal)}, transfer ${p(row.transfer)} ${row.currency ?? ''}`.trim();
}

/** Human-readable changes between two tables, one line per added, removed, or changed row. */
export function diffTables(before: RegistrarTable, after: RegistrarTable): string[] {
  const key = (r: PriceRow) => `${r.registrar} .${r.tld}`;
  const old = new Map(before.rows.map((r) => [key(r), r]));
  const next = new Map(after.rows.map((r) => [key(r), r]));
  const lines: string[] = [];
  for (const [k, row] of next) {
    const prev = old.get(k);
    if (!prev) lines.push(`+ ${k}: ${fmt(row)}`);
    else if (fmt(prev) !== fmt(row)) lines.push(`~ ${k}: ${fmt(prev)} -> ${fmt(row)}`);
  }
  for (const [k, row] of old) if (!next.has(k)) lines.push(`- ${k}: ${fmt(row)}`);
  return lines.sort();
}

export function serializeTable(table: RegistrarTable): string {
  return `${JSON.stringify(table, null, 2)}\n`;
}

/** Writes the table atomically so an interrupted refresh never leaves a half-written file. */
export async function saveTable(path: string, table: RegistrarTable): Promise<void> {
  await writeFileAtomic(path, serializeTable(table));
}

export interface RefreshJob {
  registrar: RegistrarId;
  /** null when the registrar has no keys. */
  run: (() => Promise<PriceRow[]>) | null;
}

/** Cloudflare's public file needs no key; the other two need their keys. */
export function buildJobs(creds: Credentials, http: HttpFetch, today: string): RefreshJob[] {
  const { spaceship, namecheap } = creds;
  return [
    { registrar: 'cloudflare', run: () => fetchCloudflarePublicPrices(http) },
    {
      registrar: 'spaceship',
      run: spaceship ? () => fetchSpaceshipTldPrices(spaceship, http, today) : null,
    },
    {
      registrar: 'namecheap',
      run: namecheap ? () => fetchNamecheapTldPrices(namecheap, http, today) : null,
    },
  ];
}

/** A fetch smaller than this share of the current rows of a full-coverage registrar is rejected. */
export const MIN_REFRESH_RATIO = 0.5;

/** A registrar that is not yet marked full needs at least this many rows to be promoted to full. */
export const MIN_FULL_ROWS = 100;

/**
 * Runs every job. A failed, empty, or suspiciously small result keeps that registrar's current
 * rows and logs the reason; error text is redacted with `secrets` before it is logged.
 */
export async function runRefresh(
  current: RegistrarTable,
  jobs: RefreshJob[],
  secrets: readonly string[],
  log: (line: string) => void,
  minFullRows = MIN_FULL_ROWS,
): Promise<RegistrarTable> {
  const fetched: FetchedRegistrar[] = [];
  for (const { registrar, run } of jobs) {
    if (!run) {
      log(`${registrar}: keys not set, keeping current rows`);
      continue;
    }
    try {
      const rows = await run();
      if (rows.length === 0) throw new Error('no rows returned');
      const before = current.rows.filter((r) => r.registrar === registrar).length;
      if (current.registrars[registrar].coverage !== 'full' && rows.length < minFullRows) {
        throw new Error(
          `only ${rows.length} rows returned, below the minimum of ${minFullRows} for a first full refresh`,
        );
      }
      if (
        current.registrars[registrar].coverage === 'full' &&
        rows.length < before * MIN_REFRESH_RATIO
      ) {
        throw new Error(
          `only ${rows.length} of ${before} current rows returned, below ${MIN_REFRESH_RATIO * 100}%`,
        );
      }
      fetched.push({ registrar, rows });
      log(`${registrar}: ${rows.length} TLDs`);
    } catch (error) {
      log(`${registrar}: failed, keeping current rows (${redact(errorMessage(error), secrets)})`);
    }
  }
  return mergeTable(current, fetched);
}
