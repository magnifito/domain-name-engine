import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VERSION } from './config.js';
import type { Runtime } from './runtime.js';
import { registerCheckDomains } from './tools/check-domains.js';

export const SERVER_INFO = { name: 'domain-name-engine', version: VERSION };

export function createServer(rt: Runtime): McpServer {
  const server = new McpServer(SERVER_INFO);
  registerCheckDomains(server, rt);
  return server;
}
