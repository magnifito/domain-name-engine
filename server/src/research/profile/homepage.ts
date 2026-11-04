import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';

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

/** One GET of the homepage: https first, http only when https fails at the network level. */
export async function fetchHomepage(domain: string, http: HttpFetch): Promise<HomepageResult> {
  let reason = 'no response';
  for (const url of [`https://${domain}/`, `http://${domain}/`]) {
    try {
      const res = await http(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
      const finalUrl = res.url || url;
      const isHtml = (res.headers.get('content-type') ?? '').toLowerCase().includes('html');
      let html = '';
      if (isHtml) html = await readCapped(res);
      else void res.body?.cancel().catch(() => undefined);
      return { kind: 'ok', url, finalUrl, httpStatus: res.status, ...analyzePage(html, finalUrl) };
    } catch (error) {
      reason = errorMessage(error);
    }
  }
  return { kind: 'error', reason };
}
