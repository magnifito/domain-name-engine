import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VERSION } from './config.js';
import type { Runtime } from './runtime.js';
import { registerCheckDomains } from './tools/check-domains.js';
import { registerPlan2Tools } from './tools/register-plan2.js';
import { registerPlan3Tools } from './tools/register-plan3.js';
import { registerPlan4Tools } from './tools/register-plan4.js';

export const SERVER_INFO = { name: 'domain-name-engine', version: VERSION };

export function createServer(rt: Runtime): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerCheckDomains(server, rt);
  registerPlan2Tools(server, rt);
  registerPlan3Tools(server, rt);
  registerPlan4Tools(server, rt);
  return server;
}
