import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import { RulesetStore } from '../../src/rulesets/store.js';
import type { Runtime } from '../../src/runtime.js';
import { ProjectStore } from '../../src/store/project-store.js';
import { callJson, connectClient } from '../helpers/mcp.js';
import { loadBrief } from '../store/brief-fixture.js';

const AT = '2026-11-04T10:00:00.000Z';

const PROJECT_TOOLS = [
  'project_create',
  'project_list',
  'project_get',
  'project_add_names',
  'project_add_checks',
  'project_add_notes',
  'project_shortlist',
  'project_update_brief',
];

async function setup(): Promise<{ client: Client; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'dne-project-tools-'));
  const rt: Runtime = {
    ...({} as Runtime),
    projectStore: new ProjectStore(join(home, 'projects'), { now: () => new Date(AT) }),
    rulesetStore: new RulesetStore(join(home, 'rulesets')),
  };
  return { client: await connectClient(rt), home };
}

async function created(client: Client): Promise<string> {
  const res = await callJson(client, 'project_create', {
    brief: await loadBrief(),
    title: 'FridgePlan',
  });
  expect(res.isError).toBe(false);
  return (res.data as { slug: string }).slug;
}

function domain(name: string, status = 'likely_available') {
  return { domain: name, status, source: 'rdap', confidence: 'high', checkedAt: AT };
}

describe('project tools', () => {
  it('registers all project tools with local-only annotations', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of PROJECT_TOOLS) {
      expect(byName.get(name)?.annotations?.openWorldHint, name).toBe(false);
    }
    expect(byName.get('project_get')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('project_list')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('project_create')?.annotations?.readOnlyHint).toBe(false);
  });

  it('creates a project and returns its slug and paths', async () => {
    const { client, home } = await setup();
    const res = await callJson(client, 'project_create', {
      brief: await loadBrief(),
      title: 'FridgePlan',
    });
    expect(res.data).toEqual({
      slug: 'fridgeplan',
      title: 'FridgePlan',
      briefVersion: 1,
      paths: {
        dir: join(home, 'projects', 'fridgeplan'),
        projectFile: join(home, 'projects', 'fridgeplan', 'project.json'),
        reportFile: join(home, 'projects', 'fridgeplan', 'report.md'),
      },
    });
  });

  it('rejects a brief with a missing required field', async () => {
    const { client } = await setup();
    const brief = await loadBrief();
    const { what: _what, ...subject } = brief.subject;
    const res = await callJson(client, 'project_create', { brief: { ...brief, subject } });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Input validation error');
    expect(res.text).toContain('what');
  });

  it('rejects a brief that names an unknown ruleset', async () => {
    const { client } = await setup();
    const brief = await loadBrief();
    const res = await callJson(client, 'project_create', {
      brief: { ...brief, nameRules: { rulesets: ['nope'] } },
    });
    expect(res.isError).toBe(true);
    expect(res.text).toBe('Ruleset "nope" not found. Call ruleset_list to see the available ids.');
  });

  it('runs a full round: names, checks, notes, shortlist, get', async () => {
    const { client } = await setup();
    const slug = await created(client);

    const names = await callJson(client, 'project_add_names', {
      slug,
      names: [
        {
          name: 'Fridgely',
          rulesetId: 'coined',
          strategy: 'invented',
          scoreParts: { length: 8, say: 9, spell: 7 },
        },
        { name: 'Leftover Lab', rulesetId: 'compound', strategy: 'compound' },
        { name: 'Fridgely', rulesetId: 'coined' },
        { name: 'Ghost', rulesetId: 'nope' },
      ],
    });
    expect(names.data).toEqual({
      added: [
        { name: 'Fridgely', label: 'fridgely', rulesetId: 'coined', score: 80.8 },
        { name: 'Leftover Lab', label: 'leftoverlab', rulesetId: 'compound', score: null },
      ],
      skipped: [
        { name: 'Fridgely', reason: '"fridgely" is already in the project.' },
        {
          name: 'Ghost',
          reason: 'ruleset "nope" is not one of this project\'s rulesets (coined, compound, user).',
        },
      ],
    });

    const checks = await callJson(client, 'project_add_checks', {
      slug,
      checks: [
        {
          name: 'Fridgely',
          kind: 'domain',
          results: [domain('fridgely.com'), domain('fridgely.io')],
        },
        {
          name: 'Fridgely',
          kind: 'handle',
          results: [
            {
              platform: 'github',
              status: 'available',
              source: 'github-api',
              checkedAt: AT,
              confidence: 'high',
            },
          ],
        },
      ],
    });
    expect(checks.data).toEqual({
      stored: [
        { name: 'fridgely', kind: 'domain', stored: 2 },
        { name: 'fridgely', kind: 'handle', stored: 1 },
      ],
    });

    const notes = await callJson(client, 'project_add_notes', {
      slug,
      notes: [
        {
          name: 'Fridgely',
          kind: 'language',
          language: 'de',
          severity: 'low',
          text: 'Fine in German.',
        },
      ],
    });
    expect(notes.data).toEqual({ added: 1 });

    const shortlist = await callJson(client, 'project_shortlist', {
      slug,
      names: ['Fridgely', 'Leftover Lab'],
    });
    expect(shortlist.data).toEqual({ shortlist: ['fridgely', 'leftoverlab'] });
    const trimmed = await callJson(client, 'project_shortlist', {
      slug,
      names: ['leftoverlab'],
      mode: 'remove',
    });
    expect(trimmed.data).toEqual({ shortlist: ['fridgely'] });

    const got = await callJson(client, 'project_get', { slug });
    const data = got.data as {
      project: {
        schemaVersion: number;
        names: Array<{ label: string; notes: unknown[] }>;
        checks: Record<string, { domains: unknown[]; handles: unknown[] }>;
        shortlist: string[];
      };
      recoveredFromBackup: boolean;
      paths: { reportFile: string };
    };
    expect(data.recoveredFromBackup).toBe(false);
    expect(data.project.schemaVersion).toBe(1);
    expect(data.project.names.map((n) => n.label)).toEqual(['fridgely', 'leftoverlab']);
    expect(data.project.names[0]?.notes).toHaveLength(1);
    expect(data.project.checks.fridgely?.domains).toHaveLength(2);
    expect(data.project.checks.fridgely?.handles).toHaveLength(1);
    expect(data.project.shortlist).toEqual(['fridgely']);
    expect(data.paths.reportFile.endsWith(join('fridgeplan', 'report.md'))).toBe(true);
  });

  it('returns tool errors for unknown projects and names', async () => {
    const { client } = await setup();
    const missing = await callJson(client, 'project_get', { slug: 'nope' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe(
      'Project "nope" not found. Call project_list to see existing projects.',
    );
    const slug = await created(client);
    const res = await callJson(client, 'project_add_checks', {
      slug,
      checks: [{ name: 'Nobody', kind: 'domain', results: [domain('nobody.com')] }],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toBe(
      '"Nobody" is not in project "fridgeplan"; add it with project_add_names first.',
    );
  });

  it('versions the brief', async () => {
    const { client } = await setup();
    const slug = await created(client);
    const brief = await loadBrief();
    const res = await callJson(client, 'project_update_brief', {
      slug,
      brief: { ...brief, positioning: { ...brief.positioning, priceTier: 'premium' } },
    });
    expect(res.data).toEqual({ slug, briefVersion: 2 });
    const got = await callJson(client, 'project_get', { slug });
    expect(got.data).toMatchObject({
      project: { brief: { version: 2, data: { positioning: { priceTier: 'premium' } } } },
    });
  });

  it('lists projects', async () => {
    const { client } = await setup();
    await created(client);
    const res = await callJson(client, 'project_list', {});
    expect(res.data).toMatchObject({
      projects: [{ slug: 'fridgeplan', title: 'FridgePlan', briefVersion: 1, names: 0 }],
      invalid: [],
    });
  });
});
