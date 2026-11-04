import type { Confidence } from '../../domain/types.js';
import type { HttpFetch } from '../../http/http.js';
import { errorMessage } from '../../util/errors.js';

export type HandleStatus = 'taken' | 'likely_available' | 'unknown' | 'invalid';
export type HandleMethod = 'api' | 'manual' | 'none';

/** What one platform check found, before the handle and profile URL are attached. */
export interface Probe {
  status: Exclude<HandleStatus, 'invalid'>;
  confidence: Confidence;
  method: HandleMethod;
  source: string;
  reason?: string;
}

export type Checker = (handle: string) => Promise<Probe>;

export function unknownProbe(source: string, reason: string): Probe {
  return { status: 'unknown', confidence: 'low', method: 'api', source, reason };
}

/** A platform without a reliable open method: no request, always unknown. */
export function manualChecker(reason: string): Checker {
  return async () => ({
    status: 'unknown',
    confidence: 'low',
    method: 'manual',
    source: 'none',
    reason,
  });
}

/** 2xx means taken, 404 means likely available, anything else is unknown. */
export async function statusProbe(
  http: HttpFetch,
  url: string,
  init: RequestInit,
  source: string,
  notFoundReason: string,
): Promise<Probe> {
  try {
    const res = await http(url, init);
    void res.body?.cancel().catch(() => undefined);
    if (res.ok) return { status: 'taken', confidence: 'high', method: 'api', source };
    if (res.status === 404) {
      return {
        status: 'likely_available',
        confidence: 'medium',
        method: 'api',
        source,
        reason: notFoundReason,
      };
    }
    return unknownProbe(source, `${source} returned HTTP ${res.status}`);
  } catch (error) {
    return unknownProbe(source, errorMessage(error));
  }
}

export function githubChecker(http: HttpFetch, token?: string): Checker {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return (handle) =>
    statusProbe(
      http,
      `https://api.github.com/users/${encodeURIComponent(handle)}`,
      { method: 'HEAD', headers },
      'github-api',
      'No GitHub user or organization has this name. GitHub may still reserve some names.',
    );
}

export function npmChecker(http: HttpFetch): Checker {
  return (handle) =>
    statusProbe(
      http,
      `https://registry.npmjs.org/${encodeURIComponent(handle)}`,
      { method: 'HEAD' },
      'npm-registry',
      'No npm package has this name. npm may still reject names too similar to existing packages.',
    );
}

export function pypiChecker(http: HttpFetch): Checker {
  return (handle) =>
    statusProbe(
      http,
      `https://pypi.org/simple/${encodeURIComponent(handle)}/`,
      { method: 'HEAD', headers: { accept: 'application/vnd.pypi.simple.v1+json' } },
      'pypi-simple-api',
      'No PyPI project has this normalized name. PyPI may still block prohibited or previously used names.',
    );
}
