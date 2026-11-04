import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Writes via a temp file and rename so readers never see a half-written file. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    // Do not leak the temp file when the write or rename fails.
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
