import type { HttpFetch } from '../../src/http/http.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

/** A fake HttpFetch that answers by URL prefix and records every call. No network. */
export function fakeHttp(routes: Array<[prefix: string, reply: () => Response | Error]>): {
  http: HttpFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const http: HttpFetch = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    if (!route) return new Response('no route', { status: 500 });
    const reply = route[1]();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { http, calls };
}

export const FIXED_NOW = new Date('2026-11-04T10:00:00.000Z');
