import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { registerRulesetDelete } from './ruleset-delete.js';
import { registerRulesetGet } from './ruleset-get.js';
import { registerRulesetList } from './ruleset-list.js';
import { registerRulesetSave } from './ruleset-save.js';

/** Registers every Plan 2 tool: rulesets and the project store. */
export function registerPlan2Tools(server: McpServer, rt: StoreRuntime): void {
  registerRulesetList(server, rt);
  registerRulesetGet(server, rt);
  registerRulesetSave(server, rt);
  registerRulesetDelete(server, rt);
}
