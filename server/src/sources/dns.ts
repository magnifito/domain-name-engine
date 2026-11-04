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
