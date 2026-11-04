import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResearchRuntime } from '../research/runtime-part.js';
import { registerCheckHandles } from './check-handles.js';
import { registerProfileDomain } from './profile-domain.js';
import { registerSearchTrademarks } from './search-trademarks.js';

/** Registers the research tools: profile_domain, check_handles, search_trademarks. */
export function registerPlan3Tools(server: McpServer, rt: ResearchRuntime): void {
  registerProfileDomain(server, rt);
  registerCheckHandles(server, rt);
  registerSearchTrademarks(server, rt);
}
