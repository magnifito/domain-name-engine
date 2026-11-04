import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { READ_ONLY, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectList(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_list',
    {
      title: 'List naming projects',
      description:
        'List saved projects, newest first, with slug, title, brief version, rulesets, and name and shortlist counts. Unreadable projects are listed under invalid.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runStoreTool(async () => toolJson(await rt.projectStore.list())),
  );
}
