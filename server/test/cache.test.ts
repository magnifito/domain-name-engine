import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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

describe('DiskCache', () => {
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
