import { REPO_URL, VERSION } from '../../config.js';
import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';
import { type Checker, statusProbe, unknownProbe } from './checkers.js';

export const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
// Reddit asks API clients for a "<platform>:<app id>:<version>" User-Agent.
export const REDDIT_USER_AGENT = `nodejs:domain-name-engine:${VERSION} (+${REPO_URL})`;

export function redditChecker(
  http: HttpFetch,
  creds: { clientId: string; clientSecret: string },
  now: () => number = Date.now,
): Checker {
  let token: { value: string; expiresAt: number } | undefined;

  const getToken = async (): Promise<string> => {
    if (token && token.expiresAt > now()) return token.value;
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const res = await http(REDDIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': REDDIT_USER_AGENT,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Reddit token request returned HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') {
      throw new Error('Reddit token response had no access_token');
    }
    const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    token = { value: body.access_token, expiresAt: now() + Math.max(lifetime - 60, 0) * 1000 };
    return token.value;
  };

  return async (handle) => {
    let bearer: string;
    try {
      bearer = await getToken();
    } catch (error) {
      return unknownProbe('reddit-api', errorMessage(error));
    }
    return statusProbe(
      http,
      `https://oauth.reddit.com/user/${encodeURIComponent(handle)}/about`,
      { headers: { authorization: `Bearer ${bearer}`, 'user-agent': REDDIT_USER_AGENT } },
      'reddit-api',
      'No Reddit account has this name. Deleted accounts also return 404 and their names cannot be reused.',
    );
  };
}

export function youtubeChecker(http: HttpFetch, apiKey: string): Checker {
  return async (handle) => {
    const url =
      'https://www.googleapis.com/youtube/v3/channels?part=id' +
      `&forHandle=${encodeURIComponent(`@${handle}`)}`;
    try {
      // The key goes in a header so it never appears in a URL, log line, or error message.
      const res = await http(url, { headers: { 'x-goog-api-key': apiKey } });
      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        return unknownProbe('youtube-data-api', `youtube-data-api returned HTTP ${res.status}`);
      }
      const body = (await res.json()) as { items?: unknown };
      if (Array.isArray(body.items) && body.items.length > 0) {
        return { status: 'taken', confidence: 'high', method: 'api', source: 'youtube-data-api' };
      }
      return {
        status: 'likely_available',
        confidence: 'medium',
        method: 'api',
        source: 'youtube-data-api',
        reason: 'No YouTube channel uses this handle. YouTube may still reserve or block it.',
      };
    } catch (error) {
      return unknownProbe('youtube-data-api', errorMessage(error));
    }
  };
}
