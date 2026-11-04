import { readFile, rename } from 'node:fs/promises';
import { writeFileAtomic } from '../fs/atomic.js';
import { errorMessage } from '../util/errors.js';
import { NewerVersionError, StoreError } from './errors.js';
import { isNotFound } from './fs-utils.js';

export interface JsonRead<T> {
  value: T;
  recoveredFromBackup: boolean;
  problem?: string;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; problem: string };

export function backupPath(path: string): string {
  return `${path}.bak`;
}

/** Reads and parses one file. A missing file throws the raw ENOENT error. */
async function attempt<T>(path: string, parse: (raw: unknown) => T): Promise<Attempt<T>> {
  const text = await readFile(path, 'utf8');
  try {
    return { ok: true, value: parse(JSON.parse(text)) };
  } catch (error) {
    // A newer file is not corruption: never fall back to a backup or overwrite it.
    if (error instanceof NewerVersionError) throw error;
    return { ok: false, problem: errorMessage(error) };
  }
}

/** Reads a JSON file; if it does not parse or validate, reads `<path>.bak` and says so. */
export async function readJsonWithBackup<T>(
  path: string,
  parse: (raw: unknown) => T,
): Promise<JsonRead<T>> {
  let main: Attempt<T>;
  try {
    main = await attempt(path, parse);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    // The main file vanished (for example a corrupt file was moved aside and the rewrite failed);
    // a valid backup must still be served instead of reporting "not found".
    const backup = await attempt(backupPath(path), parse).catch((backupError: unknown) => {
      if (isNotFound(backupError)) throw error;
      throw backupError;
    });
    if (!backup.ok) throw error;
    return { value: backup.value, recoveredFromBackup: true, problem: `${path} is missing` };
  }
  if (main.ok) return { value: main.value, recoveredFromBackup: false };
  let backup: Attempt<T>;
  try {
    backup = await attempt(backupPath(path), parse);
  } catch (error) {
    if (isNotFound(error)) {
      throw new StoreError(`${path} is unreadable (${main.problem}) and has no backup.`);
    }
    throw error;
  }
  if (!backup.ok) {
    throw new StoreError(
      `${path} is unreadable (${main.problem}) and its backup is unreadable too (${backup.problem}).`,
    );
  }
  return { value: backup.value, recoveredFromBackup: true, problem: main.problem };
}

function accepts(text: string, parse: (raw: unknown) => unknown): boolean {
  try {
    parse(JSON.parse(text));
    return true;
  } catch (error) {
    if (error instanceof NewerVersionError) throw error;
    return false;
  }
}

/**
 * Writes JSON atomically. The current file becomes `<path>.bak` first, but only when it is
 * still valid, so a corrupt file never replaces a good backup.
 */
export async function writeJsonWithBackup(
  path: string,
  value: unknown,
  parse: (raw: unknown) => unknown,
): Promise<void> {
  let current: string | undefined;
  try {
    current = await readFile(path, 'utf8');
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (current !== undefined) {
    if (accepts(current, parse)) {
      await writeFileAtomic(backupPath(path), current);
    } else {
      // Keep the invalid file for manual recovery instead of overwriting it.
      const stamp = new Date().toISOString().replaceAll(':', '-');
      await rename(path, `${path}.corrupt-${stamp}`);
    }
  }
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
