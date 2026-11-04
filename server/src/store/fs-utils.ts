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

const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** True for Windows reserved device names, which cannot be used as file or folder names there. */
export function isReservedDeviceName(name: string): boolean {
  return RESERVED_DEVICE.test(name);
}
