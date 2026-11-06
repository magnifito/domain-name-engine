import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readEnv } from './env.js';

/** The file name of the key file inside the engine home folder. */
export const KEY_FILE_NAME = 'keys.env';

/** Every key name the server reads. The key file accepts only these names. */
export const KEY_NAMES = [
  'SPACESHIP_API_KEY',
  'SPACESHIP_API_SECRET',
  'NAMECHEAP_API_USER',
  'NAMECHEAP_API_KEY',
  'NAMECHEAP_CLIENT_IP',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'GITHUB_TOKEN',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'YOUTUBE_API_KEY',
  'EUIPO_CLIENT_ID',
  'EUIPO_CLIENT_SECRET',
  'EUIPO_ENV',
] as const;

const KNOWN = new Set<string>(KEY_NAMES);

export const KEY_FILE_TEMPLATE = `# domain-name-engine API keys. All keys are optional.
# Paste each value after its = sign and save. No quotes needed. The server
# reads this file again when it changes, so there is no restart.
# How to get each key: https://github.com/magnifito/domain-name-engine/blob/main/docs/api-keys.md
# Never paste keys into a chat. Keys in the Claude Code plugin settings
# and environment variables win over this file.

# Spaceship: API Manager, domains:read scope only
SPACESHIP_API_KEY=
SPACESHIP_API_SECRET=

# Namecheap: Profile, Tools, API Access. NAMECHEAP_CLIENT_IP is your allow-listed public IP.
NAMECHEAP_API_USER=
NAMECHEAP_API_KEY=
NAMECHEAP_CLIENT_IP=

# Cloudflare: API Tokens
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=

# Research: GitHub, Reddit, YouTube handle checks and the EUIPO trademark search
GITHUB_TOKEN=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
YOUTUBE_API_KEY=
EUIPO_CLIENT_ID=
EUIPO_CLIENT_SECRET=
# Set to sandbox to use EUIPO test data
EUIPO_ENV=
`;

export function keyFilePath(home: string): string {
  return join(home, KEY_FILE_NAME);
}

/**
 * Parses NAME=value lines. Blank lines, # comments, an "export " prefix, matching quotes
 * around the value, Windows line endings and a byte order mark are all accepted.
 * Unknown names and empty values are ignored.
 */
export function parseKeyFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(raw);
    if (!match?.[1] || !KNOWN.has(match[1])) continue;
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1).trim();
    } else {
      // An unquoted " #" starts a trailing comment.
      value = value.replace(/\s+#.*$/, '');
    }
    if (value) values[match[1]] = value;
  }
  return values;
}

export interface KeyFileStatus {
  path: string;
  exists: boolean;
  /** Names with a value in the file. Values are never included. */
  namesSet: string[];
  /** True when other users on this machine can read the file (POSIX only). */
  readableByOthers: boolean;
  /** Why the file could not be read, when it exists but is unreadable. */
  error?: string;
}

export interface KeyFileSetup extends KeyFileStatus {
  created: boolean;
  permissionsFixed: boolean;
}

export interface KeySource {
  /** The process env with key file values added for names the env does not set. Same object while nothing changed. */
  env(): NodeJS.ProcessEnv;
  status(): KeyFileStatus;
  /** Creates the key file from the template when missing and makes it private. Never overwrites. */
  setup(): KeyFileSetup;
}

export interface KeyFileFs {
  stat(path: string): { mtimeMs: number; size: number; mode: number } | undefined;
  read(path: string): string;
  /** Writes a new file with owner-only permissions. Throws with code EEXIST when it exists. */
  create(path: string, text: string): void;
  chmodPrivate(path: string): void;
  platform: NodeJS.Platform;
}

export const nodeKeyFileFs: KeyFileFs = {
  stat: (path) => {
    try {
      return statSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  },
  read: (path) => readFileSync(path, 'utf8'),
  create: (path, text) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, text, { mode: 0o600, flag: 'wx' });
  },
  chmodPrivate: (path) => chmodSync(path, 0o600),
  platform: process.platform,
};

function mergeEnv(env: NodeJS.ProcessEnv, values: Record<string, string>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...env };
  for (const [name, value] of Object.entries(values)) {
    // The plugin settings form and real env variables win over the file.
    if (readEnv(env, name) === undefined) merged[name] = value;
  }
  return merged;
}

/**
 * Reads the key file at path. A stat on each call detects edits, so a saved change applies
 * to the next tool call without a restart. Read errors leave the file's keys unset.
 */
export function createKeySource(
  env: NodeJS.ProcessEnv,
  path: string,
  fs: KeyFileFs = nodeKeyFileFs,
): KeySource {
  let stamp = '';
  let values: Record<string, string> = {};
  let merged: NodeJS.ProcessEnv = env;
  let info: { exists: boolean; mode: number; error?: string } = { exists: false, mode: 0 };

  const refresh = (): void => {
    let next = 'missing';
    let stat: ReturnType<KeyFileFs['stat']>;
    try {
      stat = fs.stat(path);
      if (stat) next = `${stat.mtimeMs}:${stat.size}:${stat.mode}`;
    } catch (error) {
      next = `error:${(error as NodeJS.ErrnoException).code ?? 'unknown'}`;
    }
    if (next === stamp) return;
    stamp = next;
    values = {};
    info = { exists: stat !== undefined, mode: stat?.mode ?? 0 };
    if (stat) {
      try {
        values = parseKeyFile(fs.read(path));
      } catch (error) {
        info.error = `cannot read the key file (${(error as NodeJS.ErrnoException).code ?? 'error'})`;
      }
    } else if (next.startsWith('error:')) {
      info.error = `cannot check the key file (${next.slice(6)})`;
    }
    merged = Object.keys(values).length > 0 ? mergeEnv(env, values) : env;
  };

  const status = (): KeyFileStatus => {
    refresh();
    const result: KeyFileStatus = {
      path,
      exists: info.exists,
      namesSet: KEY_NAMES.filter((name) => values[name] !== undefined),
      readableByOthers: info.exists && fs.platform !== 'win32' && (info.mode & 0o077) !== 0,
    };
    if (info.error) result.error = info.error;
    return result;
  };

  return {
    env: () => {
      refresh();
      return merged;
    },
    status,
    setup: () => {
      let created = false;
      try {
        fs.create(path, KEY_FILE_TEMPLATE);
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      let permissionsFixed = false;
      if (!created && status().readableByOthers) {
        fs.chmodPrivate(path);
        permissionsFixed = true;
      }
      return { ...status(), created, permissionsFixed };
    },
  };
}

/** A key source without a file, for tests and callers that only use env variables. */
export function envOnlyKeySource(env: NodeJS.ProcessEnv): KeySource {
  const status = (): KeyFileStatus => ({
    path: '',
    exists: false,
    namesSet: [],
    readableByOthers: false,
  });
  return {
    env: () => env,
    status,
    setup: () => ({ ...status(), created: false, permissionsFixed: false }),
  };
}
