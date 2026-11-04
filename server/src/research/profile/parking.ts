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
