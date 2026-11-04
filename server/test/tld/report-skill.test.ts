import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { Runtime } from '../../src/runtime.js';
import { connectClient } from '../helpers/mcp.js';

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

async function read(path: string): Promise<string> {
  return readFile(new URL(`../../../skills/report/${path}`, import.meta.url), 'utf8');
}

describe('report skill', () => {
  it('has frontmatter with its name and a trigger description', async () => {
    const match = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(await read('SKILL.md'));
    expect(match?.[1]).toBe('report');
    expect(match?.[2]).toMatch(/^Use when /);
  });

  it.each(['SKILL.md', 'references/report-template.md'])(
    '%s names only known tools',
    async (path) => {
      const tokens = (await read(path)).match(TOOL_TOKEN) ?? [];
      expect(tokens.filter((token) => !KNOWN_TOOLS.includes(token))).toEqual([]);
    },
  );

  it.each(['SKILL.md', 'references/report-template.md'])('%s has no emoji', async (path) => {
    expect(await read(path)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('states the honesty rules', async () => {
    const text = (await read('SKILL.md')).toLowerCase();
    for (const phrase of [
      'say "likely available" only',
      'reference price from <registrar>, checked <date> — verify at registrar',
      'live price from <registrar> api, <time>',
      'side by side',
      'written as "unknown"',
      'never convert a currency',
      'no urgency copy',
      'paths.reportfile',
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it('every Plan 4 tool it names is registered', async () => {
    const client = await connectClient({} as Runtime);
    const registered = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const token of (await read('SKILL.md')).match(TOOL_TOKEN) ?? []) {
      if (/^(?:tld|registrar)_/.test(token)) expect(registered.has(token), token).toBe(true);
    }
  });
});
