import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  analyzePage,
  extractTitle,
  fetchHomepage,
  readCapped,
} from '../../src/research/profile/homepage.js';

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function routeHttp(routes: Record<string, Response | Error>): { http: HttpFetch; urls: string[] } {
  const urls: string[] = [];
  const http: HttpFetch = async (url) => {
    urls.push(url);
    const route = routes[url];
    if (route === undefined) throw new Error(`no route for ${url}`);
    if (route instanceof Error) throw route;
    return route.clone();
  };
  return { http, urls };
}

describe('extractTitle', () => {
  it('decodes entities and collapses whitespace', () => {
    expect(extractTitle('<head><title>\n Acme &amp; Co\n</title></head>')).toBe('Acme & Co');
  });

  it('returns undefined without a title', () => {
    expect(extractTitle('<p>hi</p>')).toBeUndefined();
  });
});

describe('analyzePage', () => {
  it('flags for-sale wording in visible text', () => {
    const signals = analyzePage('<h1>This domain is for sale!</h1>', 'https://acme.com/');
    expect(signals.forSale).toBe(true);
  });

  it('ignores for-sale wording inside scripts', () => {
    const signals = analyzePage('<script>var t="buy this domain"</script><p>Hello</p>', 'x');
    expect(signals.forSale).toBe(false);
  });

  it('flags a redirect to a domain marketplace as for sale', () => {
    expect(analyzePage('', 'https://www.afternic.com/forsale/acme.com').forSale).toBe(true);
  });

  it('flags parking wording', () => {
    expect(analyzePage('<div>Related Searches</div>', 'https://acme.com/').parkedPage).toBe(true);
  });

  it('reports a normal page as neither parked nor for sale', () => {
    expect(analyzePage('<title>Acme</title><p>We build rockets</p>', 'https://acme.com/')).toEqual({
      title: 'Acme',
      forSale: false,
      parkedPage: false,
    });
  });
});

describe('readCapped', () => {
  it('stops reading at the byte limit', async () => {
    const text = await readCapped(new Response('a'.repeat(5000)), 1000);
    expect(text).toHaveLength(1000);
  });
});

describe('fetchHomepage', () => {
  it('returns status, title, and signals from https', async () => {
    const { http, urls } = routeHttp({ 'https://acme.com/': html('<title>Acme</title>') });
    const result = await fetchHomepage('acme.com', http);
    expect(result).toEqual({
      kind: 'ok',
      url: 'https://acme.com/',
      finalUrl: 'https://acme.com/',
      httpStatus: 200,
      title: 'Acme',
      forSale: false,
      parkedPage: false,
    });
    expect(urls).toEqual(['https://acme.com/']);
  });

  it('keeps an https error status instead of trying http', async () => {
    const { http, urls } = routeHttp({ 'https://acme.com/': html('Forbidden', 403) });
    const result = await fetchHomepage('acme.com', http);
    expect(result).toMatchObject({ kind: 'ok', httpStatus: 403 });
    expect(urls).toEqual(['https://acme.com/']);
  });

  it('falls back to http when https fails at the network level', async () => {
    const { http, urls } = routeHttp({
      'https://acme.com/': new Error('certificate expired'),
      'http://acme.com/': html('<p>Buy this domain</p>'),
    });
    const result = await fetchHomepage('acme.com', http);
    expect(result).toMatchObject({ kind: 'ok', url: 'http://acme.com/', forSale: true });
    expect(urls).toEqual(['https://acme.com/', 'http://acme.com/']);
  });

  it('skips the body of non-HTML responses', async () => {
    const { http } = routeHttp({
      'https://acme.com/': new Response('{"for sale": "buy this domain"}', {
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(await fetchHomepage('acme.com', http)).toMatchObject({ kind: 'ok', forSale: false });
  });

  it('returns an error when both schemes fail', async () => {
    const { http } = routeHttp({
      'https://acme.com/': new Error('ENOTFOUND'),
      'http://acme.com/': new Error('ENOTFOUND'),
    });
    expect(await fetchHomepage('acme.com', http)).toEqual({ kind: 'error', reason: 'ENOTFOUND' });
  });
});
