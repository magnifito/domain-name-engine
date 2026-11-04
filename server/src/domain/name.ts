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
