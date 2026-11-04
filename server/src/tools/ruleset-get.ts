import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StoreRuntime } from '../store/runtime-part.js';
import { READ_ONLY, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerRulesetGet(
  server: McpServer,
  rt: Pick<StoreRuntime, 'rulesetStore'>,
): void {
  server.registerTool(
    'ruleset_get',
    {
      title: 'Read a naming ruleset',
      description:
        'Read one ruleset in full: styles and weights, length, filters, TLD order and .com policy, fallback affixes, and score weights.',
      inputSchema: { id: z.string().min(1).max(40).describe('Ruleset id from ruleset_list') },
      annotations: READ_ONLY,
    },
    async ({ id }) => runStoreTool(async () => toolJson(await rt.rulesetStore.get(id))),
  );
}
