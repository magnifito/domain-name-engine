import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_DELETE, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerRulesetDelete(
  server: McpServer,
  rt: Pick<StoreRuntime, 'rulesetStore'>,
): void {
  server.registerTool(
    'ruleset_delete',
    {
      title: 'Delete a custom ruleset',
      description:
        'Delete a custom ruleset file. Built-in rulesets cannot be deleted. Projects keep the ruleset id on names they already have.',
      inputSchema: { id: z.string().min(1).max(40).describe('Custom ruleset id') },
      annotations: LOCAL_DELETE,
    },
    async ({ id }) =>
      runStoreTool(async () => {
        await rt.rulesetStore.delete(id);
        return toolJson({ deleted: id });
      }),
  );
}
