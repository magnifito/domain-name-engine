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

/** listed: the table has a verified row. unverified: a row exists but its price is not verified. not_sold: a source confirms the registrar does not sell it.
 * not_listed: the TLD is missing from a source's list (not proof that it is not sold). */
export type SaleStatus = 'listed' | 'unverified' | 'not_sold' | 'not_listed' | 'not_in_table';

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
    if (meta.notSold.includes(tld)) {
      return emptyEntry(registrar, 'not_sold', `not sold by ${REGISTRAR_NAMES[registrar]}`);
    }
    const listed = meta.notListed.find((n) => n.tld === tld);
    const list = listed ?? (meta.coverage === 'full' ? meta.fullList : undefined);
    if (list) {
      return {
        ...emptyEntry(registrar, 'not_listed', `not listed by ${list.source} on ${list.checkedAt}`),
        source: list.source,
        checkedAt: list.checkedAt,
      };
    }
    return emptyEntry(registrar, 'not_in_table', `${UNKNOWN} — not in the bundled table`);
  }
  const verified = row.source !== UNVERIFIED;
  return {
    registrar,
    registrarName: REGISTRAR_NAMES[registrar],
    sale: verified ? 'listed' : 'unverified',
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
