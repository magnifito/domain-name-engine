import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/cache/cache.js';
import { TTL } from '../src/cache/ttl.js';
import { writeFileAtomic } from '../src/fs/atomic.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dne-cache-'));
}

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temp files', async () => {
    const dir = await tempDir();
    await writeFileAtomic(join(dir, 'a.json'), '{"a":1}');
    expect(await readFile(join(dir, 'a.json'), 'utf8')).toBe('{"a":1}');
    expect(await readdir(dir)).toEqual(['a.json']);
  });
});

describe('writeFileAtomic failure', () => {
  it('removes the temp file when the rename fails', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'target'));
    await expect(writeFileAtomic(join(dir, 'target'), 'x')).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['target']);
  });
});

describe('DiskCache', () => {
  it('returns undefined when the cache directory does not exist', async () => {
    const cache = new DiskCache(join(await tempDir(), 'missing'));
    expect(await cache.get('k')).toBeUndefined();
  });

  it('overwrites a key and keeps keys isolated', async () => {
    const cache = new DiskCache(await tempDir());
    await cache.set('a', 1, 10_000);
    await cache.set('b', 2, 10_000);
    await cache.set('a', 3, 10_000);
    expect(await cache.get('a')).toBe(3);
    expect(await cache.get('b')).toBe(2);
  });

  it('does not store values with a negative TTL', async () => {
    const dir = await tempDir();
    const cache = new DiskCache(dir);
    await cache.set('k', 1, -5);
    expect(await readdir(dir)).toEqual([]);
  });

  it('returns undefined on a miss', async () => {
    const cache = new DiskCache(await tempDir());
    expect(await cache.get('nope')).toBeUndefined();
  });

  it('stores and reads a value before expiry', async () => {
    let now = 1000;
    const cache = new DiskCache(await tempDir(), () => now);
    await cache.set('k', { status: 'registered' }, 500);
    now = 1499;
    expect(await cache.get('k')).toEqual({ status: 'registered' });
  });

  it('expires values after the TTL', async () => {
    let now = 1000;
    const cache = new DiskCache(await tempDir(), () => now);
    await cache.set('k', 1, 500);
    now = 1500;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('does not store values with a TTL of zero', async () => {
    const dir = await tempDir();
    const cache = new DiskCache(dir);
    await cache.set('k', 1, 0);
    expect(await cache.get('k')).toBeUndefined();
  });

  it('treats a corrupt entry as a miss', async () => {
    const dir = await tempDir();
    const cache = new DiskCache(dir);
    await cache.set('k', 1, 10_000);
    const [file] = await readdir(dir);
    await writeFile(join(dir, file as string), 'not json');
    expect(await cache.get('k')).toBeUndefined();
  });

  it('defines the spec TTLs', () => {
    const hour = 3_600_000;
    expect(TTL.registered).toBe(7 * 24 * hour);
    expect(TTL.likelyAvailable).toBe(hour);
    expect(TTL.rdapBootstrap).toBe(24 * hour);
  });
});
