import { describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../src/http/http.js';
import {
  REDDIT_TOKEN_URL,
  redditChecker,
  youtubeChecker,
} from '../../src/research/handles/keyed-checkers.js';

const SECRET = 'SECRET-VALUE-42';

function fakeHttp(respond: (url: string, init?: RequestInit) => Response | Error): {
  http: HttpFetch;
  urls: string[];
} {
  const urls: string[] = [];
  const http: HttpFetch = async (url, init) => {
    urls.push(url);
    const out = respond(url, init);
    if (out instanceof Error) throw out;
    return out;
  };
  return { http, urls };
}

const tokenResponse = () => Response.json({ access_token: 'bearer-1', expires_in: 3600 });

describe('redditChecker', () => {
  const creds = { clientId: 'id-1', clientSecret: SECRET };

  it('gets an app-only token once and reports taken on 200', async () => {
    const { http, urls } = fakeHttp((url) =>
      url === REDDIT_TOKEN_URL ? tokenResponse() : Response.json({ name: 'acme' }),
    );
    const check = redditChecker(http, creds, () => 0);
    expect(await check('acme')).toMatchObject({ status: 'taken', source: 'reddit-api' });
    await check('other');
    expect(urls).toEqual([
      REDDIT_TOKEN_URL,
      'https://oauth.reddit.com/user/acme/about',
      'https://oauth.reddit.com/user/other/about',
    ]);
  });

  it('reports likely_available on 404', async () => {
    const { http } = fakeHttp((url) =>
      url === REDDIT_TOKEN_URL ? tokenResponse() : new Response(null, { status: 404 }),
    );
    expect(await redditChecker(http, creds)('acme')).toMatchObject({
      status: 'likely_available',
      confidence: 'medium',
    });
  });

  it('reports unknown when the token request fails, without leaking the secret', async () => {
    const { http } = fakeHttp(() => new Response('denied', { status: 401 }));
    const probe = await redditChecker(http, creds)('acme');
    expect(probe).toMatchObject({
      status: 'unknown',
      reason: 'Reddit token request returned HTTP 401',
    });
    expect(JSON.stringify(probe)).not.toContain(SECRET);
  });
});

describe('youtubeChecker', () => {
  it('reports taken when the channel list has items', async () => {
    const inits: (RequestInit | undefined)[] = [];
    const { http, urls } = fakeHttp((_url, init) => {
      inits.push(init);
      return Response.json({ items: [{ id: 'UC1' }] });
    });
    expect(await youtubeChecker(http, SECRET)('acme')).toMatchObject({ status: 'taken' });
    expect(urls[0]).toContain('forHandle=%40acme');
    expect(urls[0]).not.toContain(SECRET);
    expect(urls[0]).not.toContain('key=');
    expect(((inits[0]?.headers ?? {}) as Record<string, string>)['x-goog-api-key']).toBe(SECRET);
  });

  it('reports likely_available when items is empty or missing', async () => {
    const { http } = fakeHttp(() => Response.json({ kind: 'youtube#channelListResponse' }));
    expect(await youtubeChecker(http, SECRET)('acme')).toMatchObject({
      status: 'likely_available',
      confidence: 'medium',
    });
  });

  it('reports unknown on quota errors, without the key in the result', async () => {
    const { http } = fakeHttp(() => new Response('{}', { status: 403 }));
    const probe = await youtubeChecker(http, SECRET)('acme');
    expect(probe).toMatchObject({
      status: 'unknown',
      reason: 'youtube-data-api returned HTTP 403',
    });
    expect(JSON.stringify(probe)).not.toContain(SECRET);
  });
});
