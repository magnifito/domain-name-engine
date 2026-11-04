import type { z } from 'zod';

/** An expected store failure whose message is safe to show the user. */
export class StoreError extends Error {
  override name = 'StoreError';
}

/** A stored file was written by a newer engine; it must never be read from a backup or overwritten. */
export class NewerVersionError extends StoreError {
  override name = 'NewerVersionError';
}

/** Formats zod issues as "path: message" pairs on one line. */
export function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}
