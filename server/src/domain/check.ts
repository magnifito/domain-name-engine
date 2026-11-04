import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import type { RdapResult } from '../sources/rdap.js';
import type { WhoisResult } from '../sources/whois.js';
import { errorMessage } from '../util/errors.js';
import { splitDomain } from './name.js';
import type { CheckSource, Confidence, DomainCheck } from './types.js';

export interface CheckDeps {
  rdap(domain: string, tld: string): Promise<RdapResult>;
  whois(domain: string, tld: string): Promise<WhoisResult>;
  dns(domain: string): Promise<boolean | null>;
  cache: DiskCache;
  now?: () => Date;
}

type Base = Pick<DomainCheck, 'domain' | 'checkedAt'>;

function ttlFor(check: DomainCheck): number {
  if (check.status === 'registered') return TTL.registered;
  if (check.status === 'likely_available') return TTL.likelyAvailable;
  return 0;
}

function notFound(
  base: Base,
  source: CheckSource,
  confidence: Confidence,
  hasNs: boolean | null,
): DomainCheck {
  if (hasNs === true) {
    return {
      ...base,
      status: 'unknown',
      source,
      confidence: 'low',
      reason: `${source.toUpperCase()} reports no registration, but DNS has nameservers.`,
    };
  }
  return {
    ...base,
    status: 'likely_available',
    source,
    confidence: hasNs === null ? 'medium' : confidence,
  };
}

function rdapReason(result: RdapResult): string {
  if (result.kind === 'no_server') return 'RDAP: no server for this TLD';
  if (result.kind === 'error') return `RDAP: ${result.reason}`;
  return `RDAP: ${result.kind}`;
}

function whoisReason(result: WhoisResult): string {
  if (result.kind === 'no_server') return 'WHOIS: no server for this TLD';
  if (result.kind === 'error') return `WHOIS: ${result.reason}`;
  return `WHOIS: response from ${result.server} not understood`;
}

// A rejecting source must degrade to "no answer" instead of failing the whole batch.
async function safeRdap(domain: string, tld: string, deps: CheckDeps): Promise<RdapResult> {
  try {
    return await deps.rdap(domain, tld);
  } catch (error) {
    return { kind: 'error', reason: errorMessage(error) };
  }
}

async function safeWhois(domain: string, tld: string, deps: CheckDeps): Promise<WhoisResult> {
  try {
    return await deps.whois(domain, tld);
  } catch (error) {
    return { kind: 'error', reason: errorMessage(error) };
  }
}

async function safeDns(domain: string, deps: CheckDeps): Promise<boolean | null> {
  try {
    return await deps.dns(domain);
  } catch {
    return null;
  }
}

async function resolveStatus(domain: string, tld: string, deps: CheckDeps): Promise<DomainCheck> {
  const base: Base = { domain, checkedAt: (deps.now?.() ?? new Date()).toISOString() };

  const rdap = await safeRdap(domain, tld, deps);
  if (rdap.kind === 'registered') {
    return { ...base, status: 'registered', source: 'rdap', confidence: 'high' };
  }
  if (rdap.kind === 'not_found') return notFound(base, 'rdap', 'high', await safeDns(domain, deps));

  const whois = await safeWhois(domain, tld, deps);
  if (whois.kind === 'registered') {
    return { ...base, status: 'registered', source: 'whois', confidence: 'high' };
  }
  if (whois.kind === 'not_found') {
    return notFound(base, 'whois', 'medium', await safeDns(domain, deps));
  }

  if ((await safeDns(domain, deps)) === true) {
    return {
      ...base,
      status: 'registered',
      source: 'dns',
      confidence: 'medium',
      reason: 'Domain has nameservers; RDAP and WHOIS gave no usable answer.',
    };
  }
  return {
    ...base,
    status: 'unknown',
    source: 'none',
    confidence: 'low',
    reason: `${rdapReason(rdap)}; ${whoisReason(whois)}`,
  };
}

export async function checkDomain(domain: string, deps: CheckDeps): Promise<DomainCheck> {
  const { tld } = splitDomain(domain);
  const key = `domain:${domain}`;
  let cached: DomainCheck | undefined;
  try {
    cached = await deps.cache.get<DomainCheck>(key);
  } catch {
    // A broken cache is treated as a miss.
  }
  if (cached) return cached;
  const result = await resolveStatus(domain, tld, deps);
  try {
    await deps.cache.set(key, result, ttlFor(result));
  } catch {
    // The cache is only an optimisation; a write failure must not fail the check.
  }
  return result;
}

export async function checkDomains(
  domains: string[],
  deps: CheckDeps,
  concurrency = 4,
): Promise<DomainCheck[]> {
  const workers = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  const results: DomainCheck[] = new Array(domains.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < domains.length) {
      const index = next++;
      results[index] = await checkDomain(domains[index] as string, deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, domains.length) }, worker));
  return results;
}
