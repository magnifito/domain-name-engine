import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_OVERWRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectShortlist(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_shortlist',
    {
      title: 'Set the shortlist',
      description:
        'Set, extend, or trim the shortlist of names for research and the report. mode "set" (default) replaces it, "add" appends, "remove" drops. An empty list with mode "set" clears it.',
      inputSchema: {
        slug: z.string().min(1).max(60),
        names: z.array(z.string().min(1).max(63)).max(50),
        mode: z.enum(['set', 'add', 'remove']).default('set'),
      },
      annotations: LOCAL_OVERWRITE,
    },
    async ({ slug, names, mode }) =>
      runStoreTool(async () => {
        const { result, loaded } = await rt.projectStore.setShortlist(slug, names, mode);
        return toolJson({ shortlist: result, ...recoveryWarning(loaded) });
      }),
  );
}
