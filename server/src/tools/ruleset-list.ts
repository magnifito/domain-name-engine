import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { READ_ONLY, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerRulesetList(
  server: McpServer,
  rt: Pick<StoreRuntime, 'rulesetStore'>,
): void {
  server.registerTool(
    'ruleset_list',
    {
      title: 'List naming rulesets',
      description:
        'List the 9 built-in and any custom naming rulesets with id, name, description, examples, and builtin flag. Custom files that fail validation are listed under invalid.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runStoreTool(async () => toolJson(await rt.rulesetStore.list())),
  );
}
