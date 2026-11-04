import { REGISTRAR_NAMES, type RegistrarId } from './schema.js';

export const UNKNOWN = 'unknown';

export const TABLE_NOTE =
  'Table prices are reference prices from the bundled table and can be out of date; verify at the registrar. Prices are never converted between currencies.';

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** First year plus two renewals; null when either price is unknown. */
export function threeYearTotal(firstYear: number | null, renewal: number | null): number | null {
  if (firstYear === null || renewal === null) return null;
  return roundMoney(firstYear + 2 * renewal);
}

export function tablePriceLabel(registrar: RegistrarId, checkedAt: string): string {
  return `reference price from ${REGISTRAR_NAMES[registrar]}, checked ${checkedAt} — verify at registrar`;
}

export function livePriceLabel(registrar: RegistrarId, checkedAt: string): string {
  return `live price from ${REGISTRAR_NAMES[registrar]} API, ${checkedAt}`;
}

export interface PricedOption {
  registrar: RegistrarId;
  currency: string | null;
  threeYearTotal: number | null;
}

export interface CheapestOption {
  currency: string;
  registrar: RegistrarId;
  threeYearTotal: number;
}

/** The cheapest 3-year option per currency. Totals in different currencies are never compared. */
export function cheapestThreeYear(options: PricedOption[]): CheapestOption[] {
  const best = new Map<string, CheapestOption>();
  for (const option of options) {
    if (option.currency === null || option.threeYearTotal === null) continue;
    const current = best.get(option.currency);
    if (!current || option.threeYearTotal < current.threeYearTotal) {
      best.set(option.currency, {
        currency: option.currency,
        registrar: option.registrar,
        threeYearTotal: option.threeYearTotal,
      });
    }
  }
  return [...best.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
