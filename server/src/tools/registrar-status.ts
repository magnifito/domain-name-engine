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
        'Which registrars (Spaceship, Namecheap, Cloudflare) have API keys configured (plugin settings, key file, or environment variables), and which names are missing. Also lists the optional research key names and whether each is set. Shows where the key file is and which names it sets. Never returns key values.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolJson(rt.registrarStatus()),
  );
}
