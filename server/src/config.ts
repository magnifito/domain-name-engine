import { homedir } from 'node:os';
import { join } from 'node:path';
import { readEnv } from './util/env.js';

export const VERSION = '0.2.0';
export const REPO_URL = 'https://github.com/magnifito/domain-name-engine';
export const USER_AGENT = `domain-name-engine/${VERSION} (+${REPO_URL})`;

export function engineHome(env: NodeJS.ProcessEnv = process.env): string {
  return readEnv(env, 'DOMAIN_ENGINE_HOME') || join(homedir(), '.domain-engine');
}

export function enginePaths(home: string): {
  home: string;
  cache: string;
  projects: string;
  rulesets: string;
} {
  return {
    home,
    cache: join(home, 'cache'),
    projects: join(home, 'projects'),
    rulesets: join(home, 'rulesets'),
  };
}
