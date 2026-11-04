import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StoreError } from '../../src/store/errors.js';
import { isNotFound } from '../../src/store/fs-utils.js';
import { backupPath, readJsonWithBackup, writeJsonWithBackup } from '../../src/store/json-file.js';

interface Doc {
  n: number;
}

function parseDoc(raw: unknown): Doc {
  if (typeof raw !== 'object' || raw === null || typeof (raw as Doc).n !== 'number') {
    throw new StoreError('not a doc');
  }
  return raw as Doc;
}

async function file(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'dne-json-')), 'sub', 'doc.json');
}

describe('writeJsonWithBackup', () => {
  it('writes pretty JSON and creates no backup on the first write', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    expect(await readFile(path, 'utf8')).toBe('{\n  "n": 1\n}\n');
    await expect(readFile(backupPath(path), 'utf8')).rejects.toSatisfy(isNotFound);
  });

  it('keeps the previous valid file as .bak', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeJsonWithBackup(path, { n: 2 }, parseDoc);
    expect(JSON.parse(await readFile(backupPath(path), 'utf8'))).toEqual({ n: 1 });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ n: 2 });
  });

  it('never replaces a good backup with a corrupt file', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeJsonWithBackup(path, { n: 2 }, parseDoc);
    await writeFile(path, '{"n":');
    await writeJsonWithBackup(path, { n: 3 }, parseDoc);
    expect(JSON.parse(await readFile(backupPath(path), 'utf8'))).toEqual({ n: 1 });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ n: 3 });
  });
});

describe('readJsonWithBackup', () => {
  it('reads a valid file', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    expect(await readJsonWithBackup(path, parseDoc)).toEqual({
      value: { n: 1 },
      recoveredFromBackup: false,
    });
  });

  it('falls back to the backup and reports the problem', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeJsonWithBackup(path, { n: 2 }, parseDoc);
    await writeFile(path, '{"n": "two"}');
    expect(await readJsonWithBackup(path, parseDoc)).toEqual({
      value: { n: 1 },
      recoveredFromBackup: true,
      problem: 'not a doc',
    });
  });

  it('throws StoreError when the file is bad and there is no backup', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeFile(path, 'oops');
    await expect(readJsonWithBackup(path, parseDoc)).rejects.toThrow(
      /is unreadable \(.+\) and has no backup\./,
    );
  });

  it('throws StoreError when both the file and the backup are bad', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeFile(path, 'oops');
    await writeFile(backupPath(path), 'oops');
    await expect(readJsonWithBackup(path, parseDoc)).rejects.toThrow(
      /its backup is unreadable too/,
    );
  });

  it('throws the raw not-found error for a missing file', async () => {
    await expect(readJsonWithBackup(await file(), parseDoc)).rejects.toSatisfy(isNotFound);
  });

  it('recovers from the backup when the main file is gone but .bak exists', async () => {
    const path = await file();
    await writeJsonWithBackup(path, { n: 1 }, parseDoc);
    await writeJsonWithBackup(path, { n: 2 }, parseDoc);
    await rm(path);
    const read = await readJsonWithBackup(path, parseDoc);
    expect(read.value).toEqual({ n: 1 });
    expect(read.recoveredFromBackup).toBe(true);
  });
});
