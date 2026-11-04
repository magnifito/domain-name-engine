import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ResearchRuntime } from '../research/runtime-part.js';
import { toolJson } from './result.js';

export function registerSearchTrademarks(
  server: McpServer,
  rt: Pick<ResearchRuntime, 'searchTrademarks'>,
): void {
  server.registerTool(
    'search_trademarks',
    {
      title: 'Search trademarks',
      description:
        'Search for marks whose word element contains the given mark. EUIPO is queried when EUIPO_CLIENT_ID and EUIPO_CLIENT_SECRET are set; USPTO and WIPO have no usable open API and return unknown. Always returns direct search links for USPTO, EUIPO, TMview, and WIPO.',
      inputSchema: {
        mark: z.string().trim().min(1).max(100).describe('The brand name to search, e.g. "acme"'),
        niceClasses: z
          .array(z.number().int().min(1).max(45))
          .max(10)
          .optional()
          .describe('Optional Nice classes to limit the search, e.g. [9, 42]'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ mark, niceClasses }) => toolJson(await rt.searchTrademarks({ mark, niceClasses })),
  );
}
