import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ValidationError } from '../domain/name.js';
import { StoreError } from '../store/errors.js';
import type { LoadedProject } from '../store/project-store.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { toolError } from './result.js';

// Annotations for Plan 2 tools. All of them touch only local files under the engine home.
export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
export const LOCAL_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
export const LOCAL_OVERWRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
export const LOCAL_DELETE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Runs a store-backed tool body and turns expected store failures into tool errors. */
export async function runStoreTool(task: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof StoreError || error instanceof ValidationError) {
      return toolError(error.message);
    }
    throw error;
  }
}

/** A warning to attach to a tool result when project.json was read from its backup. */
export function recoveryWarning(loaded: Pick<LoadedProject, 'recoveredFromBackup' | 'problem'>): {
  warning?: string;
} {
  if (!loaded.recoveredFromBackup) return {};
  return {
    warning: `project.json could not be read (${loaded.problem ?? 'unknown problem'}); the backup project.json.bak was used. Changes made after that backup are lost; tell the user.`,
  };
}

/** Throws StoreError naming the first ruleset id that does not exist. */
export async function assertRulesetsExist(
  rt: Pick<StoreRuntime, 'rulesetStore'>,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) await rt.rulesetStore.get(id);
}
