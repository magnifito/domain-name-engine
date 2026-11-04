import type { DiskCache } from '../../cache/cache.js';
import { TTL } from '../../cache/ttl.js';
import type { Confidence } from '../../domain/types.js';
import type { HttpFetch } from '../../http/http.js';
import type { ResearchKeys } from '../keys.js';
import {
  type Checker,
  githubChecker,
  type HandleMethod,
  type HandleStatus,
  manualChecker,
  npmChecker,
  pypiChecker,
} from './checkers.js';
import { redditChecker, youtubeChecker } from './keyed-checkers.js';
import { normalizeHandle, type Platform, profileUrl } from './platforms.js';

export interface HandleCheck {
  platform: Platform;
  handle: string;
  status: HandleStatus;
  confidence: Confidence;
  method: HandleMethod;
  source: string;
  checkedAt: string;
  profileUrl?: string;
  reason?: string;
}

export interface HandleDeps {
  checkers: Record<Platform, Checker>;
  cache: DiskCache;
  now?: () => Date;
}

// Reasons are dated so a reader knows when the platform behaviour was last confirmed.
export const MANUAL_REASONS = {
  reddit:
    'Reddit refuses logged-out API requests (HTTP 403, checked 2026-11-04). Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for an approved Reddit app, or open the profile URL.',
  youtube:
    'YouTube handle lookup needs the YouTube Data API. Set YOUTUBE_API_KEY, or open the profile URL.',
  x: 'X has no free lookup API and its pages block automated clients (checked 2026-11-04). Open the profile URL.',
  instagram:
    'Instagram has no open lookup API and its pages block automated clients (checked 2026-11-04). Open the profile URL.',
  tiktok:
    'TikTok has no open lookup API and its pages block automated clients (checked 2026-11-04). Open the profile URL.',
  linkedin:
    'LinkedIn has no open lookup API and its pages block automated clients (checked 2026-11-04). Open the company URL.',
} as const;

export function createCheckers(http: HttpFetch, keys: ResearchKeys): Record<Platform, Checker> {
  return {
    github: githubChecker(http, keys.githubToken),
    npm: npmChecker(http),
    pypi: pypiChecker(http),
    reddit: keys.reddit ? redditChecker(http, keys.reddit) : manualChecker(MANUAL_REASONS.reddit),
    youtube: keys.youtubeApiKey
      ? youtubeChecker(http, keys.youtubeApiKey)
      : manualChecker(MANUAL_REASONS.youtube),
    x: manualChecker(MANUAL_REASONS.x),
    instagram: manualChecker(MANUAL_REASONS.instagram),
    tiktok: manualChecker(MANUAL_REASONS.tiktok),
    linkedin: manualChecker(MANUAL_REASONS.linkedin),
  };
}

async function checkOne(platform: Platform, raw: string, deps: HandleDeps): Promise<HandleCheck> {
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();
  const normalized = normalizeHandle(platform, raw);
  if (!normalized.ok) {
    return {
      platform,
      handle: raw.trim(),
      status: 'invalid',
      confidence: 'high',
      method: 'none',
      source: 'none',
      checkedAt,
      reason: normalized.reason,
    };
  }
  const { handle } = normalized;
  const key = `handle:${platform}:${handle}`;
  const cached = await deps.cache.get<HandleCheck>(key);
  if (cached) return cached;

  const probe = await deps.checkers[platform](handle);
  const result: HandleCheck = {
    platform,
    handle,
    ...probe,
    checkedAt,
    profileUrl: profileUrl(platform, handle),
  };
  if (result.status === 'taken' || result.status === 'likely_available') {
    try {
      await deps.cache.set(key, result, TTL.handles);
    } catch {
      // The cache is only an optimisation; a write failure must not fail the check.
    }
  }
  return result;
}

export async function checkHandles(
  handles: readonly string[],
  platforms: readonly Platform[],
  deps: HandleDeps,
  concurrency = 4,
): Promise<HandleCheck[]> {
  const jobs = handles.flatMap((handle) => platforms.map((platform) => ({ handle, platform })));
  const results: HandleCheck[] = new Array(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index] as { handle: string; platform: Platform };
      results[index] = await checkOne(job.platform, job.handle, deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}
