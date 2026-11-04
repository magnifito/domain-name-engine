import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoreRuntime } from '../store/runtime-part.js';
import { registerProjectAddChecks } from './project-add-checks.js';
import { registerProjectAddNames } from './project-add-names.js';
import { registerProjectAddNotes } from './project-add-notes.js';
import { registerProjectCreate } from './project-create.js';
import { registerProjectGet } from './project-get.js';
import { registerProjectList } from './project-list.js';
import { registerProjectShortlist } from './project-shortlist.js';
import { registerProjectUpdateBrief } from './project-update-brief.js';
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
  registerProjectCreate(server, rt);
  registerProjectList(server, rt);
  registerProjectGet(server, rt);
  registerProjectAddNames(server, rt);
  registerProjectAddChecks(server, rt);
  registerProjectAddNotes(server, rt);
  registerProjectShortlist(server, rt);
  registerProjectUpdateBrief(server, rt);
}
