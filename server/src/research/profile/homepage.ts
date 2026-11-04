import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';
import { BlockedError } from './safe-fetch.js';

export interface PageSignals {
  title?: string;
  forSale: boolean;
  parkedPage: boolean;
}

export type HomepageResult =
  | ({ kind: 'ok'; url: string; finalUrl: string; httpStatus: number } & PageSignals)
  | { kind: 'error'; reason: string };

export const MAX_BODY_BYTES = 262_144;

const FOR_SALE_PATTERNS = [
  /\bthis domain (?:name )?(?:is|may be) for sale\b/i,
  /\bdomain (?:name )?(?:is )?for sale\b/i,
  /\bbuy this domain\b/i,
  /\bmake (?:an|us an) offer\b/i,
  /\binquire about this domain\b/i,
  /\bget this domain\b/i,
];

const PARKED_PATTERNS = [
  /\bthis domain (?:name )?(?:is|has been) parked\b/i,
  /\bparked free\b/i,
  /\bdomain parking\b/i,
  /\brelated searches\b/i,
];

// A redirect to one of these hosts means the domain is listed for sale.
const MARKETPLACE_HOSTS = [
  'afternic.com',
  'dan.com',
  'sedo.com',
  'hugedomains.com',
  'godaddy.com',
  'atom.com',
  'squadhelp.com',
  'brandbucket.com',
  'buydomains.com',
  'undeveloped.com',
];

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function extractTitle(html: string): string | undefined {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (raw === undefined) return undefined;
  const title = decodeEntities(raw).replace(/\s+/g, ' ').trim().slice(0, 200);
  return title || undefined;
}

export function analyzePage(html: string, finalUrl: string): PageSignals {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const host = hostOf(finalUrl);
  const onMarketplace =
    host !== undefined && MARKETPLACE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  return {
    title: extractTitle(html),
    forSale: onMarketplace || FOR_SALE_PATTERNS.some((pattern) => pattern.test(text)),
    parkedPage: PARKED_PATTERNS.some((pattern) => pattern.test(text)),
  };
}

/** Reads at most `limit` bytes of the body, then cancels the rest of the stream. */
export async function readCapped(res: Response, limit = MAX_BODY_BYTES): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  // Do not await: a cancel can wait on a tee'd branch that nobody reads.
  void reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit));
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const MAX_REDIRECTS = 5;

class TooManyRedirects extends Error {}

/** Follows redirects by hand so the fetcher can vet every hop. */
async function getFollowing(
  start: string,
  http: HttpFetch,
): Promise<{ res: Response; finalUrl: string }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await http(url, {
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml' },
      });
    } catch (error) {
      if (error instanceof BlockedError && hop > 0) {
        throw new BlockedError(`redirect to ${error.host}`, error.detail);
      }
      throw error;
    }
    const location = res.headers.get('location');
    if (!REDIRECT_STATUSES.has(res.status) || !location) return { res, finalUrl: url };
    void res.body?.cancel().catch(() => undefined);
    if (hop >= MAX_REDIRECTS) throw new TooManyRedirects(`more than ${MAX_REDIRECTS} redirects`);
    url = new URL(location, url).href;
  }
}

/**
 * One homepage request per scheme: https first, http only when https fails at the network level.
 * `http` must refuse private targets (see createGuardedHttp) and must not follow redirects itself.
 */
export async function fetchHomepage(domain: string, http: HttpFetch): Promise<HomepageResult> {
  let reason = 'no response';
  for (const url of [`https://${domain}/`, `http://${domain}/`]) {
    try {
      const { res, finalUrl } = await getFollowing(url, http);
      const isHtml = (res.headers.get('content-type') ?? '').toLowerCase().includes('html');
      let html = '';
      if (isHtml) html = await readCapped(res);
      else void res.body?.cancel().catch(() => undefined);
      return { kind: 'ok', url, finalUrl, httpStatus: res.status, ...analyzePage(html, finalUrl) };
    } catch (error) {
      if (error instanceof BlockedError || error instanceof TooManyRedirects) {
        return {
          kind: 'error',
          reason: error instanceof BlockedError ? error.message : `redirect loop: ${error.message}`,
        };
      }
      reason = errorMessage(error);
    }
  }
  return { kind: 'error', reason };
}
