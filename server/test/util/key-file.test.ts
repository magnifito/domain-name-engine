import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createKeySource,
  KEY_FILE_TEMPLATE,
  KEY_NAMES,
  keyFilePath,
  parseKeyFile,
} from '../../src/util/key-file.js';

const posix = process.platform !== 'win32';

async function tempPath(): Promise<string> {
  // A missing subfolder proves setup creates the engine folder too.
  return keyFilePath(join(await mkdtemp(join(tmpdir(), 'dne-keys-')), 'home'));
}

describe('parseKeyFile', () => {
  it('reads NAME=value lines and ignores comments, blanks and unknown names', () => {
    const text = [
      '﻿# comment',
      '',
      'SPACESHIP_API_KEY=abc123',
      'export SPACESHIP_API_SECRET = "s3cret"',
      "GITHUB_TOKEN='ghp_x'",
      'YOUTUBE_API_KEY=yt-key  # my key',
      'REDDIT_CLIENT_ID=',
      'PATH=/usr/bin',
      'not a line',
    ].join('\r\n');
    expect(parseKeyFile(text)).toEqual({
      SPACESHIP_API_KEY: 'abc123',
      SPACESHIP_API_SECRET: 's3cret',
      GITHUB_TOKEN: 'ghp_x',
      YOUTUBE_API_KEY: 'yt-key',
    });
  });

  it('keeps a # inside a value without a space before it', () => {
    expect(parseKeyFile('NAMECHEAP_API_KEY=ab#cd')).toEqual({ NAMECHEAP_API_KEY: 'ab#cd' });
  });

  it('parses the template to no values and lists every key name in it', () => {
    expect(parseKeyFile(KEY_FILE_TEMPLATE)).toEqual({});
    for (const name of KEY_NAMES) expect(KEY_FILE_TEMPLATE).toContain(`\n${name}=\n`);
  });
});

describe('createKeySource', () => {
  it('returns the plain env when the file is missing', async () => {
    const env = { A: 'b' };
    const keys = createKeySource(env, await tempPath());
    expect(keys.env()).toBe(env);
    expect(keys.status()).toMatchObject({ exists: false, namesSet: [], readableByOthers: false });
  });

  it('setup creates a private template once and never overwrites it', async () => {
    const path = await tempPath();
    const keys = createKeySource({}, path);
    const first = keys.setup();
    expect(first).toMatchObject({ path, created: true, exists: true, namesSet: [] });
    expect(await readFile(path, 'utf8')).toBe(KEY_FILE_TEMPLATE);
    if (posix) expect((await stat(path)).mode & 0o777).toBe(0o600);

    await writeFile(path, 'SPACESHIP_API_KEY=kept\n');
    expect(keys.setup()).toMatchObject({ created: false, namesSet: ['SPACESHIP_API_KEY'] });
    expect(await readFile(path, 'utf8')).toBe('SPACESHIP_API_KEY=kept\n');
  });

  it.runIf(posix)('setup makes a file readable by others private', async () => {
    const path = await tempPath();
    const keys = createKeySource({}, path);
    keys.setup();
    await chmod(path, 0o644);
    expect(keys.status().readableByOthers).toBe(true);
    expect(keys.setup()).toMatchObject({ permissionsFixed: true, readableByOthers: false });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('picks up edits without a restart and keeps the same env object while unchanged', async () => {
    const path = await tempPath();
    const keys = createKeySource({}, path);
    keys.setup();
    expect(keys.env().SPACESHIP_API_KEY).toBeUndefined();

    await writeFile(path, 'SPACESHIP_API_KEY=from-file\nSPACESHIP_API_SECRET=secret-1\n');
    const env = keys.env();
    expect(env).toMatchObject({ SPACESHIP_API_KEY: 'from-file', SPACESHIP_API_SECRET: 'secret-1' });
    expect(keys.env()).toBe(env);
    expect(keys.status().namesSet).toEqual(['SPACESHIP_API_KEY', 'SPACESHIP_API_SECRET']);
  });

  it('lets the plugin settings form and env variables win over the file', async () => {
    const path = await tempPath();
    const keys = createKeySource(
      { USER_CONFIG_GITHUB_TOKEN: 'form', SPACESHIP_API_KEY: 'shell', YOUTUBE_API_KEY: '' },
      path,
    );
    keys.setup();
    await writeFile(
      path,
      'GITHUB_TOKEN=file\nSPACESHIP_API_KEY=file-key\nYOUTUBE_API_KEY=file-yt\n',
    );
    const env = keys.env();
    expect(env.USER_CONFIG_GITHUB_TOKEN).toBe('form');
    expect(env.SPACESHIP_API_KEY).toBe('shell');
    // An empty env variable (what .mcp.json passes for an unset key) does not hide the file value.
    expect(env.YOUTUBE_API_KEY).toBe('file-yt');
  });
});
