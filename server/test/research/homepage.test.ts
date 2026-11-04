import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  analyzePage,
  extractTitle,
  fetchHomepage,
  readCapped,
} from '../../src/research/profile/homepage.js';
import { BlockedError } from '../../src/research/profile/safe-fetch.js';

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

  it('does not flag a marketplace host when it is the profiled domain itself', () => {
    expect(analyzePage('<p>Hello</p>', 'https://www.godaddy.com/', 'godaddy.com').forSale).toBe(
      false,
    );
    expect(analyzePage('', 'https://afternic.com/', 'afternic.com').forSale).toBe(false);
  });

  it('still flags a redirect from another domain to a marketplace', () => {
    expect(analyzePage('', 'https://www.godaddy.com/x', 'acme.com').forSale).toBe(true);
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

  it('stops pulling from an endless stream near the cap', async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(100).fill(97));
        if (pulls > 10_000) controller.error(new Error('read far past the cap'));
      },
    });
    const text = await readCapped(new Response(endless), 1000);
    expect(text).toHaveLength(1000);
    // The cap is 10 chunks; the stream may prefetch a little (highWaterMark) but must not run on.
    expect(pulls).toBeLessThanOrEqual(12);
  });
});

describe('fetchHomepage marketplace domains', () => {
  it('does not call godaddy.com for sale just because it is a marketplace host', async () => {
    const http: HttpFetch = async () => html('<title>GoDaddy</title>');
    expect(await fetchHomepage('godaddy.com', http)).toMatchObject({ forSale: false });
  });
});

describe('fetchHomepage body cap', () => {
  it('applies the default cap to a huge or endless page', async () => {
    let pulls = 0;
    const chunk = new Uint8Array(16_384).fill(97);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
        if (pulls > 10_000) controller.error(new Error('read far past the cap'));
      },
    });
    const http: HttpFetch = async () =>
      new Response(endless, { headers: { 'content-type': 'text/html' } });
    const result = await fetchHomepage('acme.com', http);
    expect(result).toMatchObject({ kind: 'ok', httpStatus: 200 });
    // 262144 / 16384 = 16 chunks, plus a small prefetch allowance.
    expect(pulls).toBeLessThanOrEqual(18);
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

  const redirect = (location: string, status = 302): Response =>
    new Response(null, { status, headers: { location } });

  it('follows a public redirect manually and reports the final URL', async () => {
    const { http, urls } = routeHttp({
      'https://acme.com/': redirect('https://www.acme.com/home'),
      'https://www.acme.com/home': html('<title>Acme Home</title>'),
    });
    expect(await fetchHomepage('acme.com', http)).toMatchObject({
      kind: 'ok',
      url: 'https://acme.com/',
      finalUrl: 'https://www.acme.com/home',
      httpStatus: 200,
      title: 'Acme Home',
    });
    expect(urls).toEqual(['https://acme.com/', 'https://www.acme.com/home']);
  });

  it('asks the fetcher not to follow redirects itself', async () => {
    const inits: (RequestInit | undefined)[] = [];
    const http: HttpFetch = async (_url, init) => {
      inits.push(init);
      return html('<title>Acme</title>');
    };
    await fetchHomepage('acme.com', http);
    expect(inits[0]?.redirect).toBe('manual');
  });

  it('reports a blocked redirect target and does not fall back to http', async () => {
    const urls: string[] = [];
    const http: HttpFetch = async (url) => {
      urls.push(url);
      if (url === 'https://acme.com/') return redirect('http://127.0.0.1/admin');
      throw new BlockedError('127.0.0.1', 'resolves to a private or reserved address');
    };
    expect(await fetchHomepage('acme.com', http)).toEqual({
      kind: 'error',
      reason: 'blocked: redirect to 127.0.0.1 resolves to a private or reserved address',
    });
    expect(urls).toEqual(['https://acme.com/', 'http://127.0.0.1/admin']);
  });

  it('reports a blocked start host without the redirect wording', async () => {
    const http: HttpFetch = async () => {
      throw new BlockedError('acme.com', 'resolves to a private or reserved address');
    };
    expect(await fetchHomepage('acme.com', http)).toEqual({
      kind: 'error',
      reason: 'blocked: acme.com resolves to a private or reserved address',
    });
  });

  it('gives up after 5 redirects', async () => {
    const urls: string[] = [];
    const http: HttpFetch = async (url) => {
      urls.push(url);
      return redirect(`https://acme.com/${urls.length}`);
    };
    const result = await fetchHomepage('acme.com', http);
    expect(result).toMatchObject({ kind: 'error' });
    expect(result.kind === 'error' && result.reason).toContain('redirect');
    expect(urls.filter((u) => u.startsWith('https://'))).toHaveLength(6);
  });
});
