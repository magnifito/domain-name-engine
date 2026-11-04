export const PLATFORMS = [
  'github',
  'npm',
  'pypi',
  'reddit',
  'youtube',
  'x',
  'instagram',
  'tiktok',
  'linkedin',
] as const;

export type Platform = (typeof PLATFORMS)[number];

interface PlatformRule {
  pattern: RegExp;
  rule: string;
  normalize(handle: string): string;
  profileUrl(handle: string): string;
}

const lower = (handle: string): string => handle.toLowerCase();

export const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  github: {
    pattern: /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/,
    rule: '1-39 letters, digits, or single inner hyphens',
    normalize: lower,
    profileUrl: (h) => `https://github.com/${h}`,
  },
  npm: {
    pattern: /^[a-z0-9][a-z0-9._~-]{0,213}$/,
    rule: 'up to 214 lower-case URL-safe characters, not starting with "." or "_"',
    normalize: lower,
    profileUrl: (h) => `https://www.npmjs.com/package/${h}`,
  },
  pypi: {
    pattern: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    rule: 'letters, digits, ".", "_", or "-", starting and ending with a letter or digit',
    // PEP 503 normalization: runs of "-", "_", "." become one "-".
    normalize: (h) => h.toLowerCase().replace(/[-_.]+/g, '-'),
    profileUrl: (h) => `https://pypi.org/project/${h}/`,
  },
  reddit: {
    pattern: /^[a-z0-9_-]{3,20}$/,
    rule: '3-20 letters, digits, "_" or "-"',
    normalize: lower,
    profileUrl: (h) => `https://www.reddit.com/user/${h}/`,
  },
  youtube: {
    pattern: /^[a-z0-9._-]{3,30}$/,
    rule: '3-30 letters, digits, ".", "_" or "-"',
    normalize: lower,
    profileUrl: (h) => `https://www.youtube.com/@${h}`,
  },
  x: {
    pattern: /^[a-z0-9_]{4,15}$/,
    rule: '4-15 letters, digits, or "_"',
    normalize: lower,
    profileUrl: (h) => `https://x.com/${h}`,
  },
  instagram: {
    pattern: /^[a-z0-9._]{1,30}$/,
    rule: '1-30 letters, digits, "." or "_"',
    normalize: lower,
    profileUrl: (h) => `https://www.instagram.com/${h}/`,
  },
  tiktok: {
    pattern: /^[a-z0-9._]{2,24}$/,
    rule: '2-24 letters, digits, "." or "_"',
    normalize: lower,
    profileUrl: (h) => `https://www.tiktok.com/@${h}`,
  },
  linkedin: {
    pattern: /^[a-z0-9-]{3,100}$/,
    rule: '3-100 letters, digits, or "-" (company page URL)',
    normalize: lower,
    profileUrl: (h) => `https://www.linkedin.com/company/${h}/`,
  },
};

export type NormalizedHandle = { ok: true; handle: string } | { ok: false; reason: string };

export function normalizeHandle(platform: Platform, raw: string): NormalizedHandle {
  const rule = PLATFORM_RULES[platform];
  const handle = rule.normalize(raw.trim().replace(/^@/, ''));
  if (!rule.pattern.test(handle)) {
    return { ok: false, reason: `"${raw}" is not a valid ${platform} name: ${rule.rule}.` };
  }
  return { ok: true, handle };
}

export function profileUrl(platform: Platform, handle: string): string {
  return PLATFORM_RULES[platform].profileUrl(handle);
}
