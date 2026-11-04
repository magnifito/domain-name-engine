import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RulesetSchema } from '../rulesets/schema.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_OVERWRITE, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerRulesetSave(
  server: McpServer,
  rt: Pick<StoreRuntime, 'rulesetStore'>,
): void {
  server.registerTool(
    'ruleset_save',
    {
      title: 'Save a custom ruleset',
      description:
        'Create or replace a custom ruleset in ~/.domain-engine/rulesets/<id>.json. Built-in ids cannot be used. To copy a built-in, read it with ruleset_get, change the id and fields, then save.',
      inputSchema: { ruleset: RulesetSchema },
      annotations: LOCAL_OVERWRITE,
    },
    async ({ ruleset }) => runStoreTool(async () => toolJson(await rt.rulesetStore.save(ruleset))),
  );
}
