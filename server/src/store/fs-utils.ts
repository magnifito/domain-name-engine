import { access } from 'node:fs/promises';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

export function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

export function isExists(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}
