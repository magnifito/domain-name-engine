import { connect } from 'node:net';
import type { DiskCache } from '../cache/cache.js';
import { TTL } from '../cache/ttl.js';
import type { HostLimiter } from '../limiter/limiter.js';
import { errorMessage } from '../util/errors.js';

export type WhoisQuery = (server: string, query: string) => Promise<string>;

export type WhoisResult =
  | { kind: 'registered' | 'not_found' | 'unknown'; server: string; raw: string }
  | { kind: 'no_server' }
  | { kind: 'error'; reason: string };

const IANA_WHOIS = 'whois.iana.org';

const NOT_FOUND_PATTERNS = [
  /no match for/i,
  /^\s*not found/im,
  /^%+\s*not found/im,
  /no data found/i,
  /no entries found/i,
  /domain not found/i,
  /no object found/i,
  /the queried object does not exist/i,
  /is available for registration/i,
  /^\s*status:\s*(free|available)\s*$/im,
];

const REGISTERED_PATTERNS = [
  /^\s*domain name:/im,
  /^\s*registrar:/im,
  /creation date:/i,
  /^\s*created:/im,
  /^\s*registered:/im,
];

export function tcpWhoisQuery(timeoutMs = 8000): WhoisQuery {
  return (server, query) =>
    new Promise((resolve, reject) => {
      const socket = connect({ host: server, port: 43 });
      const chunks: Buffer[] = [];
      socket.setTimeout(timeoutMs, () => {
        socket.destroy(new Error(`WHOIS ${server} timed out after ${timeoutMs} ms`));
      });
      socket.on('connect', () => socket.write(`${query}\r\n`));
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('error', reject);
      socket.on('close', (hadError) => {
        if (!hadError) resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
}

export function parseReferral(text: string): string | null {
  const match = text.match(/^whois:\s*(\S+)/im);
  return match?.[1]?.toLowerCase() ?? null;
}

export function parseAvailability(text: string): 'registered' | 'not_found' | 'unknown' {
  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(text))) return 'not_found';
  if (REGISTERED_PATTERNS.some((pattern) => pattern.test(text))) return 'registered';
  return 'unknown';
}

export async function whoisLookup(
  domain: string,
  tld: string,
  deps: { query: WhoisQuery; limiter: HostLimiter; cache: DiskCache },
): Promise<WhoisResult> {
  const rootLabel = tld.split('.').at(-1) ?? tld;
  try {
    const cacheKey = `whois:server:${rootLabel}`;
    let server = await deps.cache.get<string | null>(cacheKey);
    if (server === undefined) {
      const iana = await deps.limiter.schedule(IANA_WHOIS, () => deps.query(IANA_WHOIS, rootLabel));
      server = parseReferral(iana);
      try {
        await deps.cache.set(cacheKey, server, TTL.rdapBootstrap);
      } catch {
        // The cache is only an optimisation; a write failure must not fail the lookup.
      }
    }
    if (!server) return { kind: 'no_server' };
    const target = server;
    const raw = await deps.limiter.schedule(target, () => deps.query(target, domain));
    return { kind: parseAvailability(raw), server: target, raw };
  } catch (error) {
    return { kind: 'error', reason: errorMessage(error) };
  }
}
