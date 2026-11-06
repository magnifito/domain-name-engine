import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { registerKeysSetup } from './keys-setup.js';
import { registerRegistrarQuote } from './registrar-quote.js';
import { registerRegistrarStatus } from './registrar-status.js';
import { registerTldInfo } from './tld-info.js';

export function registerPlan4Tools(server: McpServer, rt: RegistrarRuntime): void {
  registerTldInfo(server, rt);
  registerRegistrarQuote(server, rt);
  registerRegistrarStatus(server, rt);
  registerKeysSetup(server, rt);
}
