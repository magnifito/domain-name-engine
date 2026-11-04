import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ValidationError } from '../domain/name.js';
import { MAX_QUOTE_DOMAINS } from '../registrars/quote.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { toolError, toolJson } from './result.js';

export function registerRegistrarQuote(
  server: McpServer,
  rt: Pick<RegistrarRuntime, 'registrarQuote'>,
): void {
  server.registerTool(
    'registrar_quote',
    {
      title: 'Registrar quote for exact domains',
      description:
        'For exact domains: per-registrar first-year, renewal, and 3-year prices. Without registrar API keys it returns bundled table prices only. With keys it adds live availability, the premium flag, and live prices from that registrar API (cached 1 hour). Every price has a label naming its origin and time.',
      inputSchema: {
        domains: z
          .array(z.string())
          .min(1)
          .max(MAX_QUOTE_DOMAINS)
          .describe('Fully qualified domains, e.g. "zentrova.site"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ domains }) => {
      try {
        return toolJson(await rt.registrarQuote(domains));
      } catch (error) {
        if (error instanceof ValidationError) return toolError(error.message);
        throw error;
      }
    },
  );
}
