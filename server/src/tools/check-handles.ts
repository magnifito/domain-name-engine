import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PLATFORMS } from '../research/handles/platforms.js';
import type { ResearchRuntime } from '../research/runtime-part.js';
import { toolJson } from './result.js';

export const HANDLES_NOTE =
  'taken and likely_available come from official APIs (GitHub, npm, PyPI; Reddit and YouTube only with keys). likely_available means the API found no account or package; the platform may still reserve or block the name. unknown with method "manual" means no reliable open method exists: open profileUrl to check by hand. invalid means the name breaks the platform rules.';

export function registerCheckHandles(
  server: McpServer,
  rt: Pick<ResearchRuntime, 'checkHandles'>,
): void {
  server.registerTool(
    'check_handles',
    {
      title: 'Check social handles and package names',
      description:
        'Check each handle on each platform. Each result is taken, likely_available, unknown, or invalid, with method (api, manual, none), source, checkedAt, confidence, and a profile URL for manual checks.',
      inputSchema: {
        handles: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(20)
          .describe('Handles without platform prefix; a leading "@" is ignored'),
        platforms: z
          .array(z.enum(PLATFORMS))
          .min(1)
          .optional()
          .describe(`Platforms to check; default all: ${PLATFORMS.join(', ')}`),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ handles, platforms }) => {
      const list = [...new Set(platforms ?? PLATFORMS)];
      const results = await rt.checkHandles(handles, list);
      return toolJson({ results, note: HANDLES_NOTE });
    },
  );
}
