import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { pipeline, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { USER_AGENT } from '../../config.js';
import type { HttpFetch } from '../../http/http.js';
import type { HostLimiter } from '../../limiter/limiter.js';

/** Thrown when a URL must not be requested: it targets a private network or an odd port or scheme. */
export class BlockedError extends Error {
  override name = 'BlockedError';
  constructor(
    readonly host: string,
    readonly detail: string,
  ) {
    super(`blocked: ${host} ${detail}`);
  }
}

export const PRIVATE_ADDRESS_DETAIL = 'resolves to a private or reserved address';

function ipv4Bytes(ip: string): number[] | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : undefined;
}

function blockedIpv4(b: readonly number[]): boolean {
  const [a = 0, b1 = 0, b2 = 0] = b;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b1 >= 64 && b1 <= 127) ||
    (a === 169 && b1 === 254) ||
    (a === 172 && b1 >= 16 && b1 <= 31) ||
    (a === 192 && b1 === 168) ||
    (a === 192 && b1 === 0 && (b2 === 0 || b2 === 2)) ||
    (a === 198 && (b1 === 18 || b1 === 19)) ||
    (a === 198 && b1 === 51 && b2 === 100) ||
    (a === 203 && b1 === 0 && b2 === 113) ||
    a >= 224
  );
}

/** Expands an IPv6 text address to 16 bytes, or undefined when it is malformed. */
function ipv6Bytes(input: string): number[] | undefined {
  let text = input.split('%')[0] ?? '';
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (tail) {
    const v4 = ipv4Bytes(tail);
    if (!v4) return undefined;
    const hex = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
    text = `${text.slice(0, -tail.length)}${hex(v4[0] ?? 0, v4[1] ?? 0)}:${hex(v4[2] ?? 0, v4[3] ?? 0)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] | undefined => {
    if (part === '') return [];
    const groups = part.split(':');
    if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return undefined;
    return groups.flatMap((g) => [Number.parseInt(g, 16) >> 8, Number.parseInt(g, 16) & 255]);
  };
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (!head || !rest) return undefined;
  if (halves.length === 1) return head.length === 16 ? head : undefined;
  const fill = 16 - head.length - rest.length;
  if (fill < 0) return undefined;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function blockedIpv6(bytes: readonly number[]): boolean {
  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;
  const zeroPrefix = (n: number) => bytes.slice(0, n).every((b) => b === 0);
  // ::/96 covers "::", "::1" and IPv4-compatible addresses.
  if (zeroPrefix(12)) return true;
  // ::ffff:a.b.c.d is an IPv4 address in IPv6 clothing.
  if (zeroPrefix(10) && bytes[10] === 255 && bytes[11] === 255) return blockedIpv4(bytes.slice(12));
  // 64:ff9b::/96 (NAT64) embeds an IPv4 address in the last 4 bytes.
  if (first === 0x00 && second === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (bytes.slice(4, 12).every((b) => b === 0)) return blockedIpv4(bytes.slice(12));
  }
  // ::ffff:0:0:0/96 (IPv4-translated): no public use, blocked whole.
  if (bytes.slice(0, 8).every((b) => b === 0) && bytes[8] === 255 && bytes[9] === 255) {
    if (bytes[10] === 0 && bytes[11] === 0) return true;
  }
  // 64:ff9b:1::/48 (RFC 8215 local-use NAT64) is blocked whole.
  if (first === 0x00 && second === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (bytes[4] === 0x00 && bytes[5] === 0x01) return true;
  }
  // 2002::/16 (6to4) embeds an IPv4 address in bytes 2 to 5.
  if (first === 0x20 && second === 0x02) return blockedIpv4(bytes.slice(2, 6));
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (first === 0xfe && (second & 0xc0) >= 0x80) return true; // fe80::/10 link-local, fec0::/10 site-local
  if (first === 0xff) return true; // multicast
  return false;
}

/** True when the address is loopback, private, link-local, multicast, reserved, or not an IP at all. */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const kind = isIP(bare);
  if (kind === 4) {
    const bytes = ipv4Bytes(bare);
    return bytes === undefined || blockedIpv4(bytes);
  }
  if (kind === 6) {
    const bytes = ipv6Bytes(bare);
    return bytes === undefined || blockedIpv6(bytes);
  }
  return true;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface TransportRequest {
  url: URL;
  /** The vetted address to connect to. The URL host stays the Host header and TLS name. */
  address: string;
  family: 4 | 6;
  init: RequestInit;
  timeoutMs: number;
}

export type Transport = (request: TransportRequest) => Promise<Response>;

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/** One request pinned to `address`. Redirects are returned, never followed. */
export const nodeTransport: Transport = ({ url, address, family, init, timeoutMs }) =>
  new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    headers['accept-encoding'] = 'identity';
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const req = send(
      {
        hostname,
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: init.method ?? 'GET',
        headers,
        servername: isIP(hostname) === 0 ? hostname : undefined,
        // The only DNS answer this socket may use is the one already vetted.
        lookup: (_host, options, callback) => {
          if (typeof options === 'object' && options.all) {
            callback(null, [{ address, family }]);
          } else {
            (callback as (e: null, a: string, f: number) => void)(null, address, family);
          }
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        // Nothing thrown here may escape: it would crash the process and leave the promise pending.
        try {
          const status = res.statusCode ?? 0;
          if (status < 200 || status > 599) {
            throw new Error(`unusable HTTP status ${status}`);
          }
          const outHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) for (const v of value) outHeaders.append(key, v);
            else if (value !== undefined) outHeaders.set(key, value);
          }
          // Servers sometimes compress despite "identity". Decompress lazily: the caller's body
          // cap then applies to decompressed bytes, and cancelling the body destroys the socket.
          const encoding = String(res.headers['content-encoding'] ?? '')
            .trim()
            .toLowerCase();
          const decoder =
            encoding === 'gzip' || encoding === 'x-gzip'
              ? createGunzip()
              : encoding === 'deflate'
                ? createInflate()
                : encoding === 'br'
                  ? createBrotliDecompress()
                  : undefined;
          let source: Readable = res;
          if (decoder) {
            outHeaders.delete('content-encoding');
            outHeaders.delete('content-length');
            source = pipeline(res, decoder, () => undefined);
          }
          const body = NULL_BODY_STATUS.has(status)
            ? null
            : (Readable.toWeb(source) as ReadableStream);
          if (body === null) res.resume();
          resolve(new Response(body, { status, headers: outHeaders }));
        } catch (error) {
          res.destroy();
          reject(error);
        }
      },
    );
    req.on('error', reject);
    req.end();
  });

async function defaultResolve(host: string): Promise<ResolvedAddress[]> {
  return dnsLookup(host.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
}

export interface GuardOptions {
  limiter: HostLimiter;
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
  transport?: Transport;
  timeoutMs?: number;
}

/**
 * An HttpFetch for untrusted URLs: http(s) on default ports only, every resolved address must be
 * public, the connection is pinned to the vetted address, there are no retries and no automatic
 * redirects. Each request goes through the shared per-host limiter.
 */
export function createGuardedHttp(opts: GuardOptions): HttpFetch {
  const resolve = opts.resolve ?? defaultResolve;
  const transport = opts.transport ?? nodeTransport;
  const timeoutMs = opts.timeoutMs ?? 8000;

  return async (rawUrl, init = {}) => {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BlockedError(host || rawUrl, 'uses an unsupported URL scheme');
    }
    if (url.port !== '') throw new BlockedError(host, 'uses a non-default port');
    if (url.username !== '' || url.password !== '') {
      throw new BlockedError(host, 'has credentials in the URL');
    }

    const addresses = await resolve(host);
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      throw new BlockedError(host, PRIVATE_ADDRESS_DETAIL);
    }
    const [first] = addresses;
    if (!first) throw new BlockedError(host, PRIVATE_ADDRESS_DETAIL);

    const headers = new Headers(init.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
    return opts.limiter.schedule(url.host, () =>
      transport({
        url,
        address: first.address,
        family: first.family === 6 ? 6 : 4,
        init: { ...init, headers, redirect: 'manual' },
        timeoutMs,
      }),
    );
  };
}
