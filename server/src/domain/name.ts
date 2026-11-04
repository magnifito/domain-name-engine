export class ValidationError extends Error {
  override name = 'ValidationError';
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_PART = LABEL;
// toLowerCase() folds some non-ASCII characters (such as the Kelvin sign) into ASCII letters.
const isAscii = (text: string): boolean => [...text].every((ch) => (ch.codePointAt(0) ?? 0) < 128);

// Public second-level registry suffixes accepted as multi-label TLDs.
export const MULTI_LABEL_TLDS: ReadonlySet<string> = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'net.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'net.br',
  'com.mx',
  'co.za',
  'co.in',
  'net.in',
  'org.in',
  'com.cn',
  'com.tw',
  'com.hk',
  'com.sg',
  'com.tr',
  'co.il',
  'com.ar',
  'com.co',
  'co.kr',
  'com.my',
  'com.ph',
  'com.pl',
  'com.ua',
  'co.id',
]);

export function normalizeLabel(input: string): string {
  const label = input.trim().toLowerCase();
  if (!isAscii(input) || !LABEL.test(label)) {
    throw new ValidationError(
      `"${input}" is not a valid domain label: use 1-63 ASCII letters, digits, or inner hyphens (punycode for non-ASCII).`,
    );
  }
  return label;
}

export function normalizeTld(input: string): string {
  const tld = input.trim().toLowerCase().replace(/^\./, '');
  const parts = tld.split('.');
  if (!isAscii(input) || parts.length > 3 || !parts.every((part) => TLD_PART.test(part))) {
    throw new ValidationError(`"${input}" is not a valid TLD.`);
  }
  if (parts.length > 1 && !MULTI_LABEL_TLDS.has(tld)) {
    throw new ValidationError(
      `"${input}" is not a known registry suffix; use a single-label TLD like "com" or a registry suffix like "co.uk".`,
    );
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
  if (clean[dot + 1] === '.') throw new ValidationError(`"${domain}" has an empty label.`);
  return { label: normalizeLabel(clean.slice(0, dot)), tld: normalizeTld(clean.slice(dot + 1)) };
}
