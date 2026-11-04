import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_RULESETS } from '../../src/rulesets/builtin.js';
import type { RulesetInput } from '../../src/rulesets/schema.js';
import { RulesetStore } from '../../src/rulesets/store.js';
import { StoreError } from '../../src/store/errors.js';

async function setup(): Promise<{ store: RulesetStore; dir: string }> {
  const dir = join(await mkdtemp(join(tmpdir(), 'dne-rulesets-')), 'rulesets');
  return { store: new RulesetStore(dir), dir };
}

function custom(id = 'my-coined'): RulesetInput {
  const base = BUILTIN_RULESETS.find((r) => r.id === 'coined');
  if (!base) throw new Error('coined missing');
  return { ...structuredClone(base), id, name: 'My coined' };
}

describe('RulesetStore', () => {
  it('lists the nine built-ins when no custom folder exists', async () => {
    const { store } = await setup();
    const listing = await store.list();
    expect(listing.rulesets).toHaveLength(9);
    expect(listing.rulesets.every((r) => r.builtin)).toBe(true);
    expect(listing.invalid).toEqual([]);
  });

  it('saves a custom ruleset with schemaVersion 1', async () => {
    const { store, dir } = await setup();
    const first = await store.save(custom());
    expect(first.created).toBe(true);
    const onDisk = JSON.parse(await readFile(join(dir, 'my-coined.json'), 'utf8'));
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.id).toBe('my-coined');
    const second = await store.save({ ...custom(), description: 'Changed.' });
    expect(second.created).toBe(false);
    expect((await store.get('my-coined')).ruleset.description).toBe('Changed.');
  });

  it('lists custom rulesets after the built-ins', async () => {
    const { store } = await setup();
    await store.save(custom());
    const listing = await store.list();
    expect(listing.rulesets.at(-1)).toMatchObject({ id: 'my-coined', builtin: false });
  });

  it('reads built-in and custom rulesets', async () => {
    const { store } = await setup();
    await store.save(custom());
    expect(await store.get('premium')).toMatchObject({ builtin: true, ruleset: { id: 'premium' } });
    expect(await store.get('my-coined')).toMatchObject({
      builtin: false,
      ruleset: { id: 'my-coined' },
    });
  });

  it('reports an unknown ruleset id', async () => {
    const { store } = await setup();
    await expect(store.get('nope')).rejects.toThrow(
      'Ruleset "nope" not found. Call ruleset_list to see the available ids.',
    );
  });

  it('rejects ids that could escape the folder', async () => {
    const { store } = await setup();
    await expect(store.get('../x')).rejects.toBeInstanceOf(StoreError);
    await expect(store.delete('../x')).rejects.toBeInstanceOf(StoreError);
  });

  it('refuses to shadow a built-in id', async () => {
    const { store } = await setup();
    await expect(store.save(custom('coined'))).rejects.toThrow(
      '"coined" is a built-in ruleset id; choose a different id for a custom ruleset.',
    );
  });

  it('reserves the id "user" for names the user supplied', async () => {
    const { store } = await setup();
    await expect(store.save(custom('user'))).rejects.toThrow(/"user" is reserved/);
  });

  it('rejects an invalid ruleset with a readable message', async () => {
    const { store } = await setup();
    const bad = { ...custom(), length: { min: 9, max: 3 } };
    await expect(store.save(bad)).rejects.toThrow(
      'Invalid ruleset: length: length.min must not exceed length.max.',
    );
  });

  it('deletes custom rulesets only', async () => {
    const { store } = await setup();
    await store.save(custom());
    await store.delete('my-coined');
    await expect(store.get('my-coined')).rejects.toThrow('not found');
    await expect(store.delete('my-coined')).rejects.toThrow(
      'Custom ruleset "my-coined" not found.',
    );
    await expect(store.delete('budget')).rejects.toThrow(
      '"budget" is a built-in ruleset and cannot be deleted.',
    );
  });

  it('lists broken custom files under invalid instead of failing', async () => {
    const { store, dir } = await setup();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'broken.json'), '{');
    await writeFile(join(dir, 'old.json'), JSON.stringify({ schemaVersion: 0, ...custom('old') }));
    await writeFile(
      join(dir, 'wrong.json'),
      JSON.stringify({ schemaVersion: 1, ...custom('other') }),
    );
    const listing = await store.list();
    expect(listing.rulesets).toHaveLength(9);
    expect(listing.invalid).toEqual([
      { file: 'broken.json', error: 'broken.json is not valid JSON.' },
      {
        file: 'old.json',
        error: 'old.json has schemaVersion 0; this engine reads schemaVersion 1.',
      },
      {
        file: 'wrong.json',
        error: 'wrong.json declares id "other"; the file name must match the id.',
      },
    ]);
  });
});
