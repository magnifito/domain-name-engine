import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NAME_STYLES, nonBlank, type Weights } from '../rulesets/schema.js';
import { StoreError } from '../store/errors.js';
import { ScorePartsSchema, USER_RULESET } from '../store/project-schema.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_WRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectAddNames(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_add_names',
    {
      title: 'Add names to a project',
      description:
        'Add generated or user-supplied names. Each name records its ruleset and the current brief version. Give scoreParts (0-10 per criterion); the server computes score (0-100) with the ruleset weights. Duplicates and names from rulesets outside the brief are skipped with a reason.',
      inputSchema: {
        slug: z.string().min(1).max(60),
        names: z
          .array(
            z.object({
              name: nonBlank(63).describe('Display form, e.g. "Leftover Lab"'),
              label: z
                .string()
                .max(63)
                .optional()
                .describe('Domain label if it differs from the name without spaces'),
              rulesetId: z
                .string()
                .min(1)
                .max(40)
                .describe(
                  `Ruleset the name came from, or "${USER_RULESET}" for a name the user supplied`,
                ),
              strategy: z.enum(NAME_STYLES).optional(),
              rationale: nonBlank(500)
                .optional()
                .describe('One line on why the name fits the brief'),
              scoreParts: ScorePartsSchema.optional().describe(
                'Ratings 0-10: length, say, spell, meaning, uniqueness, price. Leave price out until prices are known.',
              ),
            }),
          )
          .min(1)
          .max(100),
      },
      annotations: LOCAL_WRITE,
    },
    async ({ slug, names }) =>
      runStoreTool(async () => {
        const weights = new Map<string, Weights>();
        for (const id of new Set(names.map((n) => n.rulesetId))) {
          if (id === USER_RULESET) continue;
          try {
            weights.set(id, (await rt.rulesetStore.get(id)).ruleset.weights);
          } catch (error) {
            // Unknown ids are skipped per name by the store with a clearer reason.
            if (!(error instanceof StoreError)) throw error;
          }
        }
        const { result, loaded } = await rt.projectStore.addNames(slug, names, weights);
        return toolJson({
          added: result.added.map(({ name, label, rulesetId, score }) => ({
            name,
            label,
            rulesetId,
            score,
          })),
          skipped: result.skipped,
          ...recoveryWarning(loaded),
        });
      }),
  );
}
