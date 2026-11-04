import type { DiskCache } from '../../cache/cache.js';
import { TTL } from '../../cache/ttl.js';
import { splitDomain } from '../../domain/name.js';
import type { Confidence } from '../../domain/types.js';
import type { RdapResult } from '../../sources/rdap.js';
import type { WhoisResult } from '../../sources/whois.js';
import type { HomepageResult } from './homepage.js';
import { parkingProvider } from './parking.js';
import { fromRdap, fromWhois, type RegistrationFields } from './registration.js';

// The spec gives no profile TTL; a day matches how slowly site state changes.
export const PROFILE_TTL_MS = 24 * 3_600_000;

export type ProfileStatus =
  | 'live_site'
  | 'parked'
  | 'for_sale'
  | 'no_site'
  | 'not_registered'
  | 'unknown';

export interface Registration extends RegistrationFields {
  status: 'registered' | 'not_found' | 'unknown';
  source: 'rdap' | 'whois' | 'none';
  nameserverSource: 'rdap' | 'whois' | 'dns' | 'none';
  reason?: string;
}

export interface DomainProfile {
  domain: string;
  status: ProfileStatus;
  confidence: Confidence;
  source: string;
  checkedAt: string;
  reason: string;
  registration: Registration;
  parkingProvider?: string;
  homepage?: HomepageResult;
}

export interface ProfileDeps {
  rdap(domain: string, tld: string): Promise<RdapResult>;
  whois(domain: string, tld: string): Promise<WhoisResult>;
  nameservers(domain: string): Promise<string[] | null>;
  homepage(domain: string): Promise<HomepageResult>;
  cache: DiskCache;
  now?: () => Date;
}

function failReason(prefix: string, result: RdapResult | WhoisResult): string {
  if (result.kind === 'no_server') return `${prefix}: no server for this TLD`;
  if (result.kind === 'error') return `${prefix}: ${result.reason}`;
  return `${prefix}: response not understood`;
}

async function lookupRegistration(
  domain: string,
  tld: string,
  deps: ProfileDeps,
): Promise<Registration> {
  const rdap = await deps.rdap(domain, tld);
  if (rdap.kind === 'registered') {
    return {
      status: 'registered',
      source: 'rdap',
      nameserverSource: 'rdap',
      ...fromRdap(rdap.record),
    };
  }
  if (rdap.kind === 'not_found') {
    return { status: 'not_found', source: 'rdap', nameserverSource: 'none', nameservers: [] };
  }
  const whois = await deps.whois(domain, tld);
  if (whois.kind === 'registered') {
    return {
      status: 'registered',
      source: 'whois',
      nameserverSource: 'whois',
      ...fromWhois(whois.raw),
    };
  }
  if (whois.kind === 'not_found') {
    return { status: 'not_found', source: 'whois', nameserverSource: 'none', nameservers: [] };
  }
  return {
    status: 'unknown',
    source: 'none',
    nameserverSource: 'none',
    nameservers: [],
    reason: `${failReason('RDAP', rdap)}; ${failReason('WHOIS', whois)}`,
  };
}

type Verdict = Pick<DomainProfile, 'status' | 'confidence' | 'reason'>;

function classify(
  registration: Registration,
  provider: string | undefined,
  homepage: HomepageResult,
): Verdict {
  if (homepage.kind === 'ok' && homepage.forSale) {
    return {
      status: 'for_sale',
      confidence: 'medium',
      reason: 'The homepage has for-sale wording or redirects to a domain marketplace.',
    };
  }
  if (provider) {
    return { status: 'parked', confidence: 'high', reason: `Nameservers belong to ${provider}.` };
  }
  if (homepage.kind === 'ok' && homepage.parkedPage) {
    return {
      status: 'parked',
      confidence: 'medium',
      reason: 'The homepage looks like a parking page.',
    };
  }
  if (homepage.kind === 'ok') {
    if (homepage.httpStatus < 400) {
      return {
        status: 'live_site',
        confidence: 'medium',
        reason: `Homepage answered HTTP ${homepage.httpStatus}.`,
      };
    }
    if ([401, 403, 429].includes(homepage.httpStatus)) {
      return {
        status: 'live_site',
        confidence: 'low',
        reason: `A web server answered but refused automated access (HTTP ${homepage.httpStatus}); not retried or bypassed.`,
      };
    }
    return {
      status: 'no_site',
      confidence: 'low',
      reason: `Homepage returned HTTP ${homepage.httpStatus}.`,
    };
  }
  // A failed fetch says nothing about whether a site exists (DNS, TLS, timeout, or a blocked
  // target), so it is never reported as no_site and the result is not cached.
  const unreachable = `Homepage unreachable: ${homepage.reason}`;
  return {
    status: 'unknown',
    confidence: 'low',
    reason:
      registration.status === 'unknown'
        ? `${registration.reason ?? 'Registration lookup failed'}; homepage: ${homepage.reason}`
        : unreachable,
  };
}

function ttlFor(profile: DomainProfile): number {
  if (profile.status === 'unknown') return 0;
  if (profile.status === 'not_registered') return TTL.likelyAvailable;
  return PROFILE_TTL_MS;
}

async function buildProfile(
  domain: string,
  tld: string,
  deps: ProfileDeps,
): Promise<DomainProfile> {
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();
  const registration = await lookupRegistration(domain, tld, deps);

  if (registration.status === 'not_found') {
    return {
      domain,
      status: 'not_registered',
      confidence: registration.source === 'rdap' ? 'high' : 'medium',
      source: registration.source,
      checkedAt,
      reason: 'No registration found. Use check_domains for availability.',
      registration,
    };
  }

  if (registration.nameservers.length === 0) {
    const ns = await deps.nameservers(domain);
    if (ns && ns.length > 0) {
      registration.nameservers = ns;
      registration.nameserverSource = 'dns';
    }
  }

  const provider = parkingProvider(registration.nameservers);
  const homepage = await deps.homepage(domain);
  const sources = [registration.source, registration.nameserverSource, 'http'].filter(
    (s, i, all) => s !== 'none' && all.indexOf(s) === i,
  );
  return {
    domain,
    ...classify(registration, provider, homepage),
    source: sources.join('+'),
    checkedAt,
    registration,
    parkingProvider: provider,
    homepage,
  };
}

/** Profiles one domain. Throws ValidationError for malformed input. */
export async function profileDomain(input: string, deps: ProfileDeps): Promise<DomainProfile> {
  const { label, tld } = splitDomain(input);
  const domain = `${label}.${tld}`;
  const key = `profile:${domain}`;
  const cached = await deps.cache.get<DomainProfile>(key);
  if (cached) return cached;
  const profile = await buildProfile(domain, tld, deps);
  try {
    await deps.cache.set(key, profile, ttlFor(profile));
  } catch {
    // The cache is only an optimisation; a write failure must not fail the profile.
  }
  return profile;
}
