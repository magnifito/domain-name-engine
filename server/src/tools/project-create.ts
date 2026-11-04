import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nonBlank } from '../rulesets/schema.js';
import { BriefSchema } from '../store/brief.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { assertRulesetsExist, LOCAL_WRITE, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectCreate(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_create',
    {
      title: 'Create a naming project',
      description:
        'Create a project from a brief the user has confirmed. Rejects a brief with missing required fields or unknown ruleset ids. Returns the slug that every other project_* tool takes, and the project paths.',
      inputSchema: {
        brief: BriefSchema,
        title: nonBlank(80)
          .optional()
          .describe('Short project title; the slug is derived from it. Defaults to subject.what.'),
      },
      annotations: LOCAL_WRITE,
    },
    async ({ brief, title }) =>
      runStoreTool(async () => {
        await assertRulesetsExist(rt, brief.nameRules.rulesets);
        const { project, paths } = await rt.projectStore.create(brief, title);
        return toolJson({
          slug: project.slug,
          title: project.title,
          briefVersion: project.brief.version,
          paths,
        });
      }),
  );
}
