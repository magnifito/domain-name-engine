import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DomainCheck } from '../../src/domain/types.js';
import { BUILTIN_RULESETS } from '../../src/rulesets/builtin.js';
import type { Weights } from '../../src/rulesets/schema.js';
import { StoreError } from '../../src/store/errors.js';
import { ProjectStore } from '../../src/store/project-store.js';
import { loadBrief } from './brief-fixture.js';

const AT = '2026-11-04T10:00:00.000Z';

async function setup(): Promise<{ store: ProjectStore; dir: string }> {
  const dir = join(await mkdtemp(join(tmpdir(), 'dne-projects-')), 'projects');
  let tick = 0;
  // Each call returns a later time so updatedAt ordering is deterministic.
  const now = () => new Date(Date.parse(AT) + 1000 * tick++);
  return { store: new ProjectStore(dir, { now }), dir };
}

function weightsOf(...ids: string[]): Map<string, Weights> {
  return new Map(BUILTIN_RULESETS.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.weights]));
}

function domain(name: string, status: DomainCheck['status'] = 'likely_available'): DomainCheck {
  return { domain: name, status, source: 'rdap', confidence: 'high', checkedAt: AT };
}

async function withProject(): Promise<{ store: ProjectStore; dir: string; slug: string }> {
  const { store, dir } = await setup();
  const { project } = await store.create(await loadBrief(), 'FridgePlan');
  return { store, dir, slug: project.slug };
}

describe('ProjectStore.create', () => {
  it('writes a versioned project.json under the slug folder', async () => {
    const { store, dir } = await setup();
    const created = await store.create(await loadBrief(), 'FridgePlan');
    expect(created.paths).toEqual({
      dir: join(dir, 'fridgeplan'),
      projectFile: join(dir, 'fridgeplan', 'project.json'),
      reportFile: join(dir, 'fridgeplan', 'report.md'),
    });
    const onDisk = JSON.parse(await readFile(created.paths.projectFile, 'utf8'));
    expect(onDisk).toMatchObject({
      schemaVersion: 1,
      slug: 'fridgeplan',
      title: 'FridgePlan',
      brief: { version: 1 },
      briefHistory: [],
      names: [],
      checks: {},
      shortlist: [],
    });
  });

  it('picks a free slug and derives the title from the brief when none is given', async () => {
    const { store } = await setup();
    await store.create(await loadBrief(), 'FridgePlan');
    expect((await store.create(await loadBrief(), 'FridgePlan')).project.slug).toBe('fridgeplan-2');
    const untitled = await store.create(await loadBrief());
    expect(untitled.project.slug).toBe('a-mobile-app-that-plans-weekly-meals');
    expect(untitled.project.title).toBe(
      'A mobile app that plans weekly meals from what is already in the fridge.',
    );
  });

  it('rejects an invalid brief', async () => {
    const { store } = await setup();
    const brief = await loadBrief();
    await expect(store.create({ ...brief, mode: { type: 'personal' } })).rejects.toThrow(
      /^Invalid brief: mode/,
    );
  });
});

describe('ProjectStore.get and list', () => {
  it('reports a missing project', async () => {
    const { store } = await setup();
    await expect(store.get('nope')).rejects.toThrow(
      'Project "nope" not found. Call project_list to see existing projects.',
    );
    await expect(store.get('../etc')).rejects.toBeInstanceOf(StoreError);
  });

  it('recovers from a corrupt project.json using the backup', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    const { paths } = await store.get(slug);
    await writeFile(paths.projectFile, '{ broken');
    const loaded = await store.get(slug);
    expect(loaded.recoveredFromBackup).toBe(true);
    expect(loaded.problem).toBeTruthy();
    expect(loaded.project.names).toEqual([]);
    // The next write repairs project.json and keeps the good backup.
    const { loaded: after } = await store.addNotes(slug, []);
    expect(after.recoveredFromBackup).toBe(true);
    expect((await store.get(slug)).recoveredFromBackup).toBe(false);
    JSON.parse(await readFile(`${paths.projectFile}.bak`, 'utf8'));
  });

  it('refuses a project with another schemaVersion', async () => {
    const { store, slug } = await withProject();
    const { paths } = await store.get(slug);
    const raw = JSON.parse(await readFile(paths.projectFile, 'utf8'));
    await writeFile(paths.projectFile, JSON.stringify({ ...raw, schemaVersion: 2 }));
    await expect(store.get(slug)).rejects.toThrow(
      /schemaVersion is 2; this engine reads schemaVersion 1\./,
    );
  });

  it('lists projects newest first and reports unreadable ones', async () => {
    const { store, dir } = await setup();
    await store.create(await loadBrief(), 'First');
    await store.create(await loadBrief(), 'Second');
    await mkdir(join(dir, 'empty'));
    const listing = await store.list();
    expect(listing.projects.map((p) => p.slug)).toEqual(['second', 'first']);
    expect(listing.projects[0]).toMatchObject({
      title: 'Second',
      briefVersion: 1,
      rulesets: ['coined', 'compound'],
      names: 0,
      shortlist: 0,
    });
    expect(listing.invalid).toEqual([
      {
        slug: 'empty',
        error: 'Project "empty" not found. Call project_list to see existing projects.',
      },
    ]);
  });

  it('lists nothing when the projects folder does not exist', async () => {
    const { store } = await setup();
    expect(await store.list()).toEqual({ projects: [], invalid: [] });
  });
});

describe('ProjectStore.addNames', () => {
  it('adds names with label, brief version, and a computed score', async () => {
    const { store, slug } = await withProject();
    const { result } = await store.addNames(
      slug,
      [
        {
          name: 'Fridgely',
          rulesetId: 'coined',
          strategy: 'invented',
          rationale: 'Fridge plus a friendly ending.',
          scoreParts: { length: 8, say: 9, spell: 7 },
        },
        { name: 'Leftover Lab', rulesetId: 'compound', strategy: 'compound' },
      ],
      weightsOf('coined', 'compound'),
    );
    expect(result.skipped).toEqual([]);
    // coined weights: length 0.8, say 1, spell 0.8 -> (6.4 + 9 + 5.6) / 2.6 = 8.08 -> 80.8
    expect(result.added[0]).toMatchObject({
      name: 'Fridgely',
      label: 'fridgely',
      rulesetId: 'coined',
      briefVersion: 1,
      score: 80.8,
      notes: [],
    });
    expect(result.added[1]).toMatchObject({ label: 'leftoverlab', score: null });
    expect((await store.get(slug)).project.names).toHaveLength(2);
  });

  it('skips duplicates, bad labels, and rulesets outside the brief', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    const { result } = await store.addNames(
      slug,
      [
        { name: 'FRIDGELY', rulesetId: 'coined' },
        { name: 'a!b', rulesetId: 'coined' },
        { name: 'Pantrypal', rulesetId: 'premium' },
        { name: 'My Own Pick', rulesetId: 'user' },
      ],
      weightsOf('coined', 'premium'),
    );
    expect(result.added.map((n) => n.label)).toEqual(['myownpick']);
    expect(result.skipped.map((s) => s.name)).toEqual(['FRIDGELY', 'a!b', 'Pantrypal']);
    expect(result.skipped[0]?.reason).toBe('"fridgely" is already in the project.');
    expect(result.skipped[2]?.reason).toBe(
      'ruleset "premium" is not one of this project\'s rulesets (coined, compound, user).',
    );
  });

  it('serializes concurrent writes to one project', async () => {
    const { store, slug } = await withProject();
    await Promise.all(
      ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((name) =>
        store.addNames(slug, [{ name, rulesetId: 'coined' }], weightsOf('coined')),
      ),
    );
    expect((await store.get(slug)).project.names).toHaveLength(5);
  });
});

describe('ProjectStore.addChecks', () => {
  it('merges domain results by domain and keys them by label', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    await store.addChecks(slug, [
      {
        name: 'Fridgely',
        kind: 'domain',
        results: [domain('fridgely.com'), domain('fridgely.io')],
      },
    ]);
    const { result } = await store.addChecks(slug, [
      { name: 'fridgely', kind: 'domain', results: [domain('fridgely.com', 'registered')] },
    ]);
    expect(result).toEqual([{ name: 'fridgely', kind: 'domain', stored: 2 }]);
    const checks = (await store.get(slug)).project.checks.fridgely;
    expect(checks?.domains.map((d) => [d.domain, d.status])).toEqual([
      ['fridgely.com', 'registered'],
      ['fridgely.io', 'likely_available'],
    ]);
  });

  it('merges handles by platform and replaces trademarks and competitors per batch', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    const common = { checkedAt: AT, confidence: 'high' };
    await store.addChecks(slug, [
      {
        name: 'Fridgely',
        kind: 'handle',
        results: [
          { ...common, source: 'github-api', platform: 'github', status: 'available' },
          { ...common, source: 'npm', platform: 'npm', status: 'taken' },
        ],
      },
      {
        name: 'Fridgely',
        kind: 'trademark',
        results: [
          { ...common, source: 'uspto', mark: 'FRIDGELY' },
          { ...common, source: 'uspto', mark: 'FRIDGELEY' },
          { ...common, source: 'euipo', mark: 'FRIDGE LY' },
        ],
      },
    ]);
    await store.addChecks(slug, [
      {
        name: 'Fridgely',
        kind: 'handle',
        results: [{ ...common, source: 'github-api', platform: 'github', status: 'taken' }],
      },
      {
        name: 'Fridgely',
        kind: 'trademark',
        results: [{ ...common, source: 'uspto', mark: 'NONE' }],
      },
      {
        name: 'Fridgely',
        kind: 'competitor',
        results: [
          {
            source: 'websearch',
            checkedAt: AT,
            url: 'https://fridgely.example',
            finding: 'Same-name app',
          },
        ],
      },
    ]);
    const checks = (await store.get(slug)).project.checks.fridgely;
    expect(checks?.handles.map((h) => [h.platform, h.status])).toEqual([
      ['github', 'taken'],
      ['npm', 'taken'],
    ]);
    expect(checks?.trademarks.map((t) => [t.source, t.mark])).toEqual([['uspto', 'NONE']]);
    expect(checks?.competitors.map((c) => c.url)).toEqual(['https://fridgely.example']);
  });

  it('rejects unknown names and invalid results without writing', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    await expect(
      store.addChecks(slug, [
        { name: 'Fridgely', kind: 'domain', results: [domain('fridgely.com')] },
        { name: 'Nobody', kind: 'domain', results: [domain('nobody.com')] },
      ]),
    ).rejects.toThrow(
      '"Nobody" is not in project "fridgeplan"; add it with project_add_names first.',
    );
    await expect(
      store.addChecks(slug, [{ name: 'Fridgely', kind: 'domain', results: [{ domain: 'x.com' }] }]),
    ).rejects.toThrow(/^Invalid domain results for "Fridgely": 0\.status/);
    expect((await store.get(slug)).project.checks).toEqual({});
  });
});

describe('ProjectStore notes, shortlist, and brief versions', () => {
  it('adds notes with defaults', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    await store.addNotes(slug, [
      { name: 'Fridgely', text: 'Easy to say.' },
      {
        name: 'Fridgely',
        kind: 'language',
        language: 'de',
        severity: 'medium',
        text: 'Reads as "Fridge-li" in German.',
      },
    ]);
    const [entry] = (await store.get(slug)).project.names;
    expect(entry?.notes).toEqual([
      { kind: 'general', severity: 'low', text: 'Easy to say.', createdAt: expect.any(String) },
      {
        kind: 'language',
        language: 'de',
        severity: 'medium',
        text: 'Reads as "Fridge-li" in German.',
        createdAt: expect.any(String),
      },
    ]);
  });

  it('sets, extends, and trims the shortlist', async () => {
    const { store, slug } = await withProject();
    await store.addNames(
      slug,
      ['Alpha', 'Bravo', 'Charlie'].map((name) => ({ name, rulesetId: 'coined' })),
      weightsOf('coined'),
    );
    expect((await store.setShortlist(slug, ['Alpha', 'bravo', 'Alpha'])).result).toEqual([
      'alpha',
      'bravo',
    ]);
    expect((await store.setShortlist(slug, ['Charlie'], 'add')).result).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ]);
    expect((await store.setShortlist(slug, ['bravo'], 'remove')).result).toEqual([
      'alpha',
      'charlie',
    ]);
    expect((await store.setShortlist(slug, [])).result).toEqual([]);
    await expect(store.setShortlist(slug, ['Zulu'])).rejects.toThrow('"Zulu" is not in project');
  });

  it('versions the brief and tags new names with the new version', async () => {
    const { store, slug } = await withProject();
    await store.addNames(slug, [{ name: 'Fridgely', rulesetId: 'coined' }], weightsOf('coined'));
    const brief = await loadBrief();
    const next = { ...brief, nameRules: { ...brief.nameRules, rulesets: ['premium'] } };
    expect((await store.updateBrief(slug, next)).result).toEqual({ briefVersion: 2 });
    await store.addNames(slug, [{ name: 'Aeron', rulesetId: 'premium' }], weightsOf('premium'));
    const { project } = await store.get(slug);
    expect(project.brief.version).toBe(2);
    expect(project.briefHistory.map((b) => b.version)).toEqual([1]);
    expect(project.names.map((n) => [n.label, n.briefVersion])).toEqual([
      ['fridgely', 1],
      ['aeron', 2],
    ]);
  });
});
