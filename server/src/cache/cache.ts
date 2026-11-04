import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../fs/atomic.js';

interface Entry<T> {
  expiresAt: number;
  value: T;
}

export class DiskCache {
  private readonly dir: string;
  private readonly now: () => number;

  constructor(dir: string, now: () => number = Date.now) {
    this.dir = dir;
    this.now = now;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.file(key), 'utf8')) as Entry<T>;
      return entry.expiresAt > this.now() ? entry.value : undefined;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return;
    const entry: Entry<T> = { expiresAt: this.now() + ttlMs, value };
    await writeFileAtomic(this.file(key), JSON.stringify(entry));
  }

  private file(key: string): string {
    return join(this.dir, `${createHash('sha256').update(key).digest('hex')}.json`);
  }
}
