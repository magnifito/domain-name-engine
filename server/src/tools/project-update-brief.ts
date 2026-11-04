import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BriefSchema } from '../store/brief.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import {
  assertRulesetsExist,
  LOCAL_WRITE,
  recoveryWarning,
  runStoreTool,
} from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectUpdateBrief(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_update_brief',
    {
      title: 'Save a new brief version',
      description:
        'Replace the brief with an edited, user-confirmed version. The old brief moves to briefHistory and the version number goes up by one; existing names keep the version they were made with.',
      inputSchema: { slug: z.string().min(1).max(60), brief: BriefSchema },
      annotations: LOCAL_WRITE,
    },
    async ({ slug, brief }) =>
      runStoreTool(async () => {
        await assertRulesetsExist(rt, brief.nameRules.rulesets);
        const { result, loaded } = await rt.projectStore.updateBrief(slug, brief);
        return toolJson({ slug, ...result, ...recoveryWarning(loaded) });
      }),
  );
}
