import {
  type CheapestOption,
  cheapestThreeYear,
  TABLE_NOTE,
  tablePriceLabel,
  threeYearTotal,
  UNKNOWN,
} from './pricing.js';
import {
  REGISTRAR_NAMES,
  REGISTRARS,
  type RegistrarId,
  type Reputation,
  UNVERIFIED,
} from './schema.js';
import type { TldTables } from './table.js';

/** listed: the table has a row. not_sold: a source confirms the registrar does not sell it. */
export type SaleStatus = 'listed' | 'not_sold' | 'not_in_table';

export interface TldRegistrarEntry {
  registrar: RegistrarId;
  registrarName: string;
  sale: SaleStatus;
  firstYear: number | null;
  renewal: number | null;
  transfer: number | null;
  threeYearTotal: number | null;
  currency: string | null;
  source: string | null;
  checkedAt: string | null;
  priceLabel: string;
}

export interface TldReputation {
  reputation: Reputation;
  reputationNote: string;
  source: string;
  checkedAt: string;
}

export interface TldInfo {
  tld: string;
  registrars: TldRegistrarEntry[];
  cheapestThreeYear: CheapestOption[];
  reputation: TldReputation | null;
  notes: string[];
}

function emptyEntry(
  registrar: RegistrarId,
  sale: SaleStatus,
  priceLabel: string,
): TldRegistrarEntry {
  return {
    registrar,
    registrarName: REGISTRAR_NAMES[registrar],
    sale,
    firstYear: null,
    renewal: null,
    transfer: null,
    threeYearTotal: null,
    currency: null,
    source: null,
    checkedAt: null,
    priceLabel,
  };
}

function registrarEntry(tld: string, registrar: RegistrarId, tables: TldTables): TldRegistrarEntry {
  const meta = tables.registrars.registrars[registrar];
  const row = tables.registrars.rows.find((r) => r.registrar === registrar && r.tld === tld);
  if (!row) {
    if (meta.coverage === 'full' || meta.notSold.includes(tld)) {
      return emptyEntry(registrar, 'not_sold', `not sold by ${REGISTRAR_NAMES[registrar]}`);
    }
    return emptyEntry(registrar, 'not_in_table', `${UNKNOWN} — not in the bundled table`);
  }
  const verified = row.source !== UNVERIFIED;
  return {
    registrar,
    registrarName: REGISTRAR_NAMES[registrar],
    sale: 'listed',
    firstYear: row.firstYear,
    renewal: row.renewal,
    transfer: row.transfer,
    threeYearTotal: threeYearTotal(row.firstYear, row.renewal),
    currency: row.currency,
    source: row.source,
    checkedAt: row.checkedAt,
    priceLabel: verified
      ? tablePriceLabel(registrar, row.checkedAt)
      : `${UNKNOWN} — price not verified, check at ${REGISTRAR_NAMES[registrar]}`,
  };
}

export function tldInfo(tld: string, tables: TldTables): TldInfo {
  const registrars = REGISTRARS.map((registrar) => registrarEntry(tld, registrar, tables));
  const rep = tables.reputation.rows.find((r) => r.tld === tld);
  return {
    tld,
    registrars,
    cheapestThreeYear: cheapestThreeYear(registrars),
    reputation: rep
      ? {
          reputation: rep.reputation,
          reputationNote: rep.reputationNote,
          source: rep.source,
          checkedAt: rep.checkedAt,
        }
      : null,
    notes: [TABLE_NOTE],
  };
}
