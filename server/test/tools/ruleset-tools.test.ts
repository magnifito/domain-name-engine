import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import { RulesetStore } from '../../src/rulesets/store.js';
import type { Runtime } from '../../src/runtime.js';
import { ProjectStore } from '../../src/store/project-store.js';
import { callJson, connectClient } from '../helpers/mcp.js';

async function setup(): Promise<Client> {
  const home = await mkdtemp(join(tmpdir(), 'dne-ruleset-tools-'));
  const rt: Runtime = {
    ...({} as Runtime),
    projectStore: new ProjectStore(join(home, 'projects')),
    rulesetStore: new RulesetStore(join(home, 'rulesets')),
  };
  return connectClient(rt);
}

async function coinedCopy(client: Client, id: string): Promise<Record<string, unknown>> {
  const res = await callJson(client, 'ruleset_get', { id: 'coined' });
  const { ruleset } = res.data as { ruleset: Record<string, unknown> };
  return { ...ruleset, id, name: 'My coined' };
}

describe('ruleset tools', () => {
  it('registers the four ruleset tools with annotations', async () => {
    const client = await setup();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('ruleset_list')?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
    expect(byName.get('ruleset_get')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.get('ruleset_save')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get('ruleset_delete')?.annotations).toMatchObject({ destructiveHint: true });
  });

  it('lists the built-in rulesets', async () => {
    const client = await setup();
    const res = await callJson(client, 'ruleset_list', {});
    expect(res.isError).toBe(false);
    const data = res.data as {
      rulesets: Array<{ id: string; builtin: boolean }>;
      invalid: unknown[];
    };
    expect(data.rulesets).toHaveLength(9);
    expect(data.invalid).toEqual([]);
  });

  it('reads one ruleset', async () => {
    const client = await setup();
    const res = await callJson(client, 'ruleset_get', { id: 'dev-tool' });
    expect(res.data).toMatchObject({ builtin: true, ruleset: { id: 'dev-tool' } });
    const missing = await callJson(client, 'ruleset_get', { id: 'nope' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toBe(
      'Ruleset "nope" not found. Call ruleset_list to see the available ids.',
    );
  });

  it('saves, lists, and deletes a custom ruleset', async () => {
    const client = await setup();
    const saved = await callJson(client, 'ruleset_save', {
      ruleset: await coinedCopy(client, 'my-coined'),
    });
    expect(saved.data).toMatchObject({ created: true, ruleset: { id: 'my-coined' } });
    const listed = await callJson(client, 'ruleset_list', {});
    expect(
      (listed.data as { rulesets: Array<{ id: string; builtin: boolean }> }).rulesets.at(-1),
    ).toEqual(expect.objectContaining({ id: 'my-coined', builtin: false }));
    const deleted = await callJson(client, 'ruleset_delete', { id: 'my-coined' });
    expect(deleted.data).toEqual({ deleted: 'my-coined' });
  });

  it('refuses to overwrite or delete a built-in', async () => {
    const client = await setup();
    const saved = await callJson(client, 'ruleset_save', {
      ruleset: await coinedCopy(client, 'coined'),
    });
    expect(saved.isError).toBe(true);
    expect(saved.text).toContain('is a built-in ruleset id');
    const deleted = await callJson(client, 'ruleset_delete', { id: 'coined' });
    expect(deleted.isError).toBe(true);
    expect(deleted.text).toBe('"coined" is a built-in ruleset and cannot be deleted.');
  });

  it('rejects an invalid ruleset', async () => {
    const client = await setup();
    const ruleset = { ...(await coinedCopy(client, 'bad-one')), length: { min: 9, max: 3 } };
    const res = await callJson(client, 'ruleset_save', { ruleset });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('length.min must not exceed length.max.');
  });
});
