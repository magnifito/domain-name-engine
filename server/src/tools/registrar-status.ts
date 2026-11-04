import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { toolJson } from './result.js';

export function registerRegistrarStatus(
  server: McpServer,
  rt: Pick<RegistrarRuntime, 'registrarStatus'>,
): void {
  server.registerTool(
    'registrar_status',
    {
      title: 'Registrar API key status',
      description:
        'Which registrars (Spaceship, Namecheap, Cloudflare) have API keys configured through environment variables, and which variable names are missing. Also lists the optional research key names and whether each is set. Never returns key values.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolJson(rt.registrarStatus()),
  );
}
