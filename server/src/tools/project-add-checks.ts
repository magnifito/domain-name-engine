import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CHECK_KINDS } from '../store/project-schema.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { LOCAL_WRITE, recoveryWarning, runStoreTool } from './project-common.js';
import { toolJson } from './result.js';

export function registerProjectAddChecks(server: McpServer, rt: StoreRuntime): void {
  server.registerTool(
    'project_add_checks',
    {
      title: 'Attach check results to names',
      description:
        'Store check results under a name. kind "domain" takes check_domains results as returned. kinds "profile", "handle", and "trademark" take profile_domain, check_handles, and search_trademarks results as returned; kind "competitor" takes competitor-scan findings (source "websearch", checkedAt, url). Non-domain results are stored as given. Newer results replace older ones for the same domain (domain, profile) or platform (handle); a new trademark or competitor batch replaces the previous one.',
      inputSchema: {
        slug: z.string().min(1).max(60),
        checks: z
          .array(
            z.object({
              name: z.string().min(1).max(63).describe('Name or label already in the project'),
              kind: z.enum(CHECK_KINDS),
              results: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
            }),
          )
          .min(1)
          .max(100),
      },
      annotations: LOCAL_WRITE,
    },
    async ({ slug, checks }) =>
      runStoreTool(async () => {
        const { result, loaded } = await rt.projectStore.addChecks(slug, checks);
        return toolJson({ stored: result, ...recoveryWarning(loaded) });
      }),
  );
}
