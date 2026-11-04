import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StoreRuntime } from '../store/runtime-part.js';
import { READ_ONLY, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectGet(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_get',
    {
      title: 'Read a naming project',
      description:
        'Read a full project: brief (current version and history), names with ruleset, brief version, score and notes, checks keyed by name label, and shortlist. Also returns paths, including reportFile for report.md. If project.json was damaged, the backup is returned with a warning.',
      inputSchema: { slug: z.string().min(1).max(60).describe('Project slug from project_list') },
      annotations: READ_ONLY,
    },
    async ({ slug }) =>
      runStoreTool(async () => {
        const loaded = await rt.projectStore.get(slug);
        return toolJson({
          project: loaded.project,
          paths: loaded.paths,
          recoveredFromBackup: loaded.recoveredFromBackup,
          ...recoveryWarning(loaded),
        });
      }),
  );
}
