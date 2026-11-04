import { writeFileAtomic } from '../fs/atomic.js';
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
