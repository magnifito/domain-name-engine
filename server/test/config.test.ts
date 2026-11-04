import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { engineHome, enginePaths, USER_AGENT, VERSION } from '../src/config.js';
import { errorMessage } from '../src/util/errors.js';

describe('config', () => {
  it('defaults the engine home to ~/.domain-engine', () => {
    expect(engineHome({})).toBe(join(homedir(), '.domain-engine'));
  });

  it('honors DOMAIN_ENGINE_HOME', () => {
    expect(engineHome({ DOMAIN_ENGINE_HOME: '/tmp/x' })).toBe('/tmp/x');
  });

  it('falls back to the default when DOMAIN_ENGINE_HOME is empty', () => {
    expect(engineHome({ DOMAIN_ENGINE_HOME: '' })).toBe(join(homedir(), '.domain-engine'));
  });

  it('derives subfolders from the home', () => {
    expect(enginePaths('/h')).toEqual({
      home: '/h',
      cache: join('/h', 'cache'),
      projects: join('/h', 'projects'),
      rulesets: join('/h', 'rulesets'),
    });
  });

  it('uses a generic user agent with the repo URL', () => {
    expect(USER_AGENT).toBe(
      'domain-name-engine/0.1.0 (+https://github.com/magnifito/domain-name-engine)',
    );
  });

  it('turns any thrown value into a message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('text')).toBe('text');
  });

  it('keeps VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
