import type { DiskCache } from '../cache/cache.js';
import type { enginePaths } from '../config.js';
import type { HttpFetch } from '../http/http.js';
import type { HostLimiter } from '../limiter/limiter.js';
import { RulesetStore } from '../rulesets/store.js';
import { ProjectStore } from './project-store.js';

export type EnginePaths = ReturnType<typeof enginePaths>;

export interface StoreRuntime {
  projectStore: ProjectStore;
  rulesetStore: RulesetStore;
}

/** Shared runtime services. Every plan's runtime part takes the same deps; the store needs none yet. */
export interface StoreRuntimeDeps {
  http: HttpFetch;
  limiter: HostLimiter;
  cache: DiskCache;
}

export function createStoreRuntime(paths: EnginePaths, _deps: StoreRuntimeDeps): StoreRuntime {
  return {
    projectStore: new ProjectStore(paths.projects),
    rulesetStore: new RulesetStore(paths.rulesets),
  };
}
