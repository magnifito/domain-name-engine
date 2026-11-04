import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { normalizeTld, ValidationError } from '../domain/name.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { toolError, toolJson } from './result.js';

export function registerTldInfo(server: McpServer, rt: Pick<RegistrarRuntime, 'tldInfo'>): void {
  server.registerTool(
    'tld_info',
    {
      title: 'TLD registrars, prices, and reputation',
      description:
        'For one TLD: which registrars sell it, first-year, renewal, and transfer reference prices per registrar from the bundled dated table, the cheapest 3-year option per currency, and the TLD reputation note. Every price carries its source and check date.',
      inputSchema: {
        tld: z.string().describe('TLD with or without a leading dot, e.g. "site" or ".co.uk"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tld }) => {
      let normalized: string;
      try {
        normalized = normalizeTld(tld);
      } catch (error) {
        if (error instanceof ValidationError) return toolError(error.message);
        throw error;
      }
      return toolJson(rt.tldInfo(normalized));
    },
  );
}
