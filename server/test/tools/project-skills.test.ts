import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Runtime } from '../../src/runtime.js';
import { connectClient } from '../helpers/mcp.js';

const SKILLS = ['brief'];

// Tool names from the spec's MCP tools table, plus Plan 2's project_update_brief.
const KNOWN_TOOLS = [
  'check_domains',
  'profile_domain',
  'check_handles',
  'search_trademarks',
  'project_create',
  'project_list',
  'project_get',
  'project_add_names',
  'project_add_checks',
  'project_add_notes',
  'project_shortlist',
  'project_update_brief',
  'ruleset_list',
  'ruleset_get',
  'ruleset_save',
  'ruleset_delete',
  'tld_info',
  'registrar_quote',
  'registrar_status',
];

const TOOL_TOKEN = /\b(?:check|profile|search|project|ruleset|tld|registrar)_[a-z_]+\b/g;

async function skill(name: string): Promise<string> {
  return readFile(new URL(`../../../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
}

describe('Plan 2 skills', () => {
  it.each(SKILLS)('%s has frontmatter with its name and a trigger description', async (name) => {
    const match = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(await skill(name));
    expect(match?.[1]).toBe(name);
    expect(match?.[2]).toMatch(/^Use when /);
  });

  it.each(SKILLS)('%s names only known tools', async (name) => {
    const tokens = (await skill(name)).match(TOOL_TOKEN) ?? [];
    expect(tokens.filter((token) => !KNOWN_TOOLS.includes(token))).toEqual([]);
  });

  it.each(SKILLS)('%s has no emoji', async (name) => {
    expect(await skill(name)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('every project_* and ruleset_* tool a skill names is registered', async () => {
    const client = await connectClient({} as Runtime);
    const registered = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const name of SKILLS) {
      for (const token of (await skill(name)).match(TOOL_TOKEN) ?? []) {
        if (/^(?:project|ruleset)_/.test(token)) expect(registered.has(token), token).toBe(true);
      }
    }
  });
});
