import { REGISTRAR_NAMES, REGISTRARS, type RegistrarId } from '../tld/schema.js';

export interface SpaceshipCreds {
  apiKey: string;
  apiSecret: string;
}

export interface NamecheapCreds {
  apiUser: string;
  apiKey: string;
  clientIp: string;
}

export interface CloudflareCreds {
  apiToken: string;
  accountId: string;
}

export interface Credentials {
  spaceship?: SpaceshipCreds;
  namecheap?: NamecheapCreds;
  cloudflare?: CloudflareCreds;
}

export const ENV_VARS: Record<RegistrarId, readonly string[]> = {
  spaceship: ['SPACESHIP_API_KEY', 'SPACESHIP_API_SECRET'],
  namecheap: ['NAMECHEAP_API_USER', 'NAMECHEAP_API_KEY', 'NAMECHEAP_CLIENT_IP'],
  cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
};

const LIVE_FEATURES: Record<RegistrarId, string> = {
  spaceship: 'live availability, premium flag, and price',
  namecheap: 'live availability, premium flag, and price (the caller IP must be allow-listed)',
  cloudflare: 'live availability, premium tier, and price (Registrar API, beta)',
};

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  // An unexpanded "${VAR}" placeholder from .mcp.json means the variable is not set.
  return value && !value.startsWith('${') ? value : undefined;
}

/** Reads registrar keys from env. A registrar counts only when all its variables are set. */
export function readCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const creds: Credentials = {};
  const ssKey = read(env, 'SPACESHIP_API_KEY');
  const ssSecret = read(env, 'SPACESHIP_API_SECRET');
  if (ssKey && ssSecret) creds.spaceship = { apiKey: ssKey, apiSecret: ssSecret };

  const ncUser = read(env, 'NAMECHEAP_API_USER');
  const ncKey = read(env, 'NAMECHEAP_API_KEY');
  const ncIp = read(env, 'NAMECHEAP_CLIENT_IP');
  if (ncUser && ncKey && ncIp) creds.namecheap = { apiUser: ncUser, apiKey: ncKey, clientIp: ncIp };

  const cfToken = read(env, 'CLOUDFLARE_API_TOKEN');
  const cfAccount = read(env, 'CLOUDFLARE_ACCOUNT_ID');
  if (cfToken && cfAccount) creds.cloudflare = { apiToken: cfToken, accountId: cfAccount };
  return creds;
}

/** Every configured value, longest first, so redaction never leaves a partial secret. */
export function secretValues(creds: Credentials): string[] {
  const values = [creds.spaceship, creds.namecheap, creds.cloudflare].flatMap((c) =>
    c ? Object.values(c) : [],
  );
  return [...new Set(values.filter((v) => v.length >= 4))].sort((a, b) => b.length - a.length);
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out;
}

export interface RegistrarStatusEntry {
  registrar: RegistrarId;
  name: string;
  configured: boolean;
  envVars: string[];
  missing: string[];
  liveFeatures: string;
}

/** A non-registrar key that another tool reads. Only the name and whether it is set are shown. */
export interface OtherKeyStatus {
  name: string;
  usedFor: string;
  configured: boolean;
}

export interface RegistrarStatusReport {
  registrars: RegistrarStatusEntry[];
  otherKeys: OtherKeyStatus[];
  note: string;
}

/** Optional research keys (read by the research tools), listed so one tool shows every key. */
export const OTHER_ENV_VARS: ReadonlyArray<{ name: string; usedFor: string }> = [
  { name: 'GITHUB_TOKEN', usedFor: 'check_handles: higher GitHub rate limit' },
  { name: 'REDDIT_CLIENT_ID', usedFor: 'check_handles: Reddit username lookup' },
  { name: 'REDDIT_CLIENT_SECRET', usedFor: 'check_handles: Reddit username lookup' },
  { name: 'YOUTUBE_API_KEY', usedFor: 'check_handles: YouTube handle lookup' },
  { name: 'EUIPO_CLIENT_ID', usedFor: 'search_trademarks: EUIPO trademark search' },
  { name: 'EUIPO_CLIENT_SECRET', usedFor: 'search_trademarks: EUIPO trademark search' },
  { name: 'EUIPO_ENV', usedFor: 'search_trademarks: "sandbox" for EUIPO test data' },
];

export const STATUS_NOTE =
  'Key values are never returned, logged, or stored. Without keys, registrar_quote returns bundled table prices only.';

export function registrarStatus(env: NodeJS.ProcessEnv = process.env): RegistrarStatusReport {
  return {
    registrars: REGISTRARS.map((registrar) => {
      const envVars = [...ENV_VARS[registrar]];
      const missing = envVars.filter((name) => !read(env, name));
      return {
        registrar,
        name: REGISTRAR_NAMES[registrar],
        configured: missing.length === 0,
        envVars,
        missing,
        liveFeatures: LIVE_FEATURES[registrar],
      };
    }),
    otherKeys: OTHER_ENV_VARS.map(({ name, usedFor }) => ({
      name,
      usedFor,
      configured: read(env, name) !== undefined,
    })),
    note: STATUS_NOTE,
  };
}
