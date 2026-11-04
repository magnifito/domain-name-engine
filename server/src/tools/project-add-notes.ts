import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { nonBlank } from '../rulesets/schema.js';
import { LANGUAGE_CODE } from '../store/brief.js';
import { NOTE_SEVERITIES } from '../store/project-schema.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_WRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectAddNotes(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_add_notes',
    {
      title: 'Attach notes to names',
      description:
        'Append notes to names, for example language-check findings (kind "language", language as a BCP 47 code). severity is the risk level: low, medium, or high.',
      inputSchema: {
        slug: z.string().min(1).max(60),
        notes: z
          .array(
            z.object({
              name: z.string().min(1).max(63).describe('Name or label already in the project'),
              text: nonBlank(2000),
              kind: nonBlank(40).optional().describe('Defaults to "general"'),
              language: z.string().regex(LANGUAGE_CODE).optional(),
              severity: z.enum(NOTE_SEVERITIES).optional().describe('Defaults to "low"'),
            }),
          )
          .min(1)
          .max(200),
      },
      annotations: LOCAL_WRITE,
    },
    async ({ slug, notes }) =>
      runStoreTool(async () => {
        const { result, loaded } = await rt.projectStore.addNotes(slug, notes);
        return toolJson({ ...result, ...recoveryWarning(loaded) });
      }),
  );
}
