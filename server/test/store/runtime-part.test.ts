import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/cache/cache.js';
import { enginePaths } from '../../src/config.js';
import type { HttpFetch } from '../../src/http/http.js';
import { HostLimiter } from '../../src/limiter/limiter.js';
import { BUILTIN_RULESETS } from '../../src/rulesets/builtin.js';
import { createRuntime } from '../../src/runtime.js';
import { createStoreRuntime } from '../../src/store/runtime-part.js';
import { loadBrief } from './brief-fixture.js';

const noHttp: HttpFetch = async () => {
  throw new Error('no network in unit tests');
};

describe('createStoreRuntime', () => {
  it('puts projects and custom rulesets under the engine paths', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dne-home-'));
    const paths = enginePaths(home);
    const rt = createStoreRuntime(paths, {
      http: noHttp,
      limiter: new HostLimiter(),
      cache: new DiskCache(paths.cache),
    });
    const base = BUILTIN_RULESETS[0];
    if (!base) throw new Error('no built-ins');
    await rt.rulesetStore.save({ ...base, id: 'mine' });
    expect(JSON.parse(await readFile(join(home, 'rulesets', 'mine.json'), 'utf8')).id).toBe('mine');
    const created = await rt.projectStore.create(await loadBrief(), 'Home Test');
    expect(created.paths.dir).toBe(join(home, 'projects', 'home-test'));
  });

  it('is part of the full runtime', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dne-home-'));
    const rt = createRuntime({ DOMAIN_ENGINE_HOME: home });
    expect((await rt.rulesetStore.list()).rulesets).toHaveLength(9);
    expect(await rt.projectStore.list()).toEqual({ projects: [], invalid: [] });
  });
});
