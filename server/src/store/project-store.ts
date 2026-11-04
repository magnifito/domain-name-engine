import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ValidationError } from '../domain/name.js';
import type { NameStyle, Weights } from '../rulesets/schema.js';
import { computeScore, EQUAL_WEIGHTS, type ScoreParts } from '../rulesets/score.js';
import { BriefSchema } from './brief.js';
import { StoreError, zodMessage } from './errors.js';
import { isExists, isNotFound } from './fs-utils.js';
import { readJsonWithBackup, writeJsonWithBackup } from './json-file.js';
import { nameLabel, slugify } from './names.js';
import {
  type CheckKind,
  DomainCheckSchema,
  type NameChecks,
  type NameEntry,
  type NoteSeverity,
  PROJECT_SCHEMA_VERSION,
  type Project,
  ProjectSchema,
  parseProject,
  type ResearchResult,
  ResearchResultSchema,
  SLUG,
  USER_RULESET,
} from './project-schema.js';

export const PROJECT_FILE = 'project.json';
export const REPORT_FILE = 'report.md';
const TITLE_MAX = 80;

export interface ProjectPaths {
  dir: string;
  projectFile: string;
  reportFile: string;
}

export interface LoadedProject {
  project: Project;
  paths: ProjectPaths;
  recoveredFromBackup: boolean;
  problem?: string;
}

export interface Mutation<T> {
  result: T;
  loaded: LoadedProject;
}

export interface ProjectSummary {
  slug: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  briefVersion: number;
  rulesets: string[];
  names: number;
  shortlist: number;
}

export interface ProjectListing {
  projects: ProjectSummary[];
  invalid: Array<{ slug: string; error: string }>;
}

export interface NewName {
  name: string;
  label?: string;
  rulesetId: string;
  strategy?: NameStyle;
  rationale?: string;
  scoreParts?: ScoreParts;
}

export interface AddNamesResult {
  added: NameEntry[];
  skipped: Array<{ name: string; reason: string }>;
}

export interface CheckBatch {
  name: string;
  kind: CheckKind;
  results: unknown[];
}

export interface StoredChecks {
  name: string;
  kind: CheckKind;
  stored: number;
}

export interface NewNote {
  name: string;
  text: string;
  kind?: string;
  language?: string;
  severity?: NoteSeverity;
}

export type ShortlistMode = 'set' | 'add' | 'remove';

export interface ProjectStoreOptions {
  now?: () => Date;
}

const RESEARCH_BUCKET = {
  profile: 'profiles',
  handle: 'handles',
  trademark: 'trademarks',
  competitor: 'competitors',
} as const;

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StoreError(`${what}: ${zodMessage(parsed.error)}`);
  return parsed.data;
}

function summarize(project: Project): ProjectSummary {
  return {
    slug: project.slug,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    briefVersion: project.brief.version,
    rulesets: project.brief.data.nameRules.rulesets,
    names: project.names.length,
    shortlist: project.shortlist.length,
  };
}

function emptyChecks(): NameChecks {
  return { domains: [], profiles: [], handles: [], trademarks: [], competitors: [] };
}

/** Merges by key; an incoming item replaces an existing one in place. */
function mergeBy<T>(existing: T[], incoming: T[], key: (item: T) => string): T[] {
  const merged = new Map(existing.map((item) => [key(item), item]));
  for (const item of incoming) merged.set(key(item), item);
  return [...merged.values()];
}

function identity(result: ResearchResult, field: string): string {
  const value = result[field];
  // Without the identity field, the result is kept as its own entry.
  return typeof value === 'string' ? value : JSON.stringify(result);
}

function mergeResearch(
  kind: Exclude<CheckKind, 'domain'>,
  existing: ResearchResult[],
  incoming: ResearchResult[],
): ResearchResult[] {
  if (kind === 'trademark' || kind === 'competitor') {
    // A trademark search or competitor scan is a full result set, so the newest batch replaces the old one.
    return incoming;
  }
  return mergeBy(existing, incoming, (r) => identity(r, kind === 'handle' ? 'platform' : 'domain'));
}

function findName(project: Project, name: string): NameEntry {
  let label: string | undefined;
  try {
    label = nameLabel(name);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }
  const entry = project.names.find((n) => n.name === name || n.label === name || n.label === label);
  if (!entry) {
    throw new StoreError(
      `"${name}" is not in project "${project.slug}"; add it with project_add_names first.`,
    );
  }
  return entry;
}

/** JSON project store: <dir>/<slug>/project.json with a .bak of the previous write. */
export class ProjectStore {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(dir: string, opts: ProjectStoreOptions = {}) {
    this.dir = dir;
    this.now = opts.now ?? (() => new Date());
  }

  paths(slug: string): ProjectPaths {
    const dir = join(this.dir, slug);
    return { dir, projectFile: join(dir, PROJECT_FILE), reportFile: join(dir, REPORT_FILE) };
  }

  async create(brief: unknown, title?: string): Promise<LoadedProject> {
    const data = parseOrThrow(BriefSchema, brief, 'Invalid brief');
    const finalTitle = (title?.trim() || data.subject.what.trim()).slice(0, TITLE_MAX).trim();
    const at = this.now().toISOString();
    await mkdir(this.dir, { recursive: true });
    const slug = await this.claimSlug(slugify(finalTitle));
    const project: Project = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      slug,
      title: finalTitle,
      createdAt: at,
      updatedAt: at,
      brief: { version: 1, createdAt: at, data },
      briefHistory: [],
      names: [],
      checks: {},
      shortlist: [],
    };
    await this.write(project);
    return { project, paths: this.paths(slug), recoveredFromBackup: false };
  }

  async get(slug: string): Promise<LoadedProject> {
    if (!SLUG.test(slug)) throw new StoreError(`"${slug}" is not a valid project slug.`);
    const paths = this.paths(slug);
    try {
      const read = await readJsonWithBackup(paths.projectFile, parseProject);
      return {
        project: read.value,
        paths,
        recoveredFromBackup: read.recoveredFromBackup,
        ...(read.problem === undefined ? {} : { problem: read.problem }),
      };
    } catch (error) {
      if (isNotFound(error)) {
        throw new StoreError(
          `Project "${slug}" not found. Call project_list to see existing projects.`,
        );
      }
      throw error;
    }
  }

  async list(): Promise<ProjectListing> {
    let slugs: string[];
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      slugs = entries.filter((e) => e.isDirectory() && SLUG.test(e.name)).map((e) => e.name);
    } catch (error) {
      if (isNotFound(error)) return { projects: [], invalid: [] };
      throw error;
    }
    const projects: ProjectSummary[] = [];
    const invalid: ProjectListing['invalid'] = [];
    for (const slug of slugs.sort()) {
      try {
        projects.push(summarize((await this.get(slug)).project));
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        invalid.push({ slug, error: error.message });
      }
    }
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.slug.localeCompare(b.slug));
    return { projects, invalid };
  }

  addNames(
    slug: string,
    names: NewName[],
    weights: ReadonlyMap<string, Weights>,
  ): Promise<Mutation<AddNamesResult>> {
    return this.update(slug, (project, at) => {
      const allowed = [...project.brief.data.nameRules.rulesets, USER_RULESET];
      const known = new Set(project.names.map((n) => n.label));
      const result: AddNamesResult = { added: [], skipped: [] };
      for (const item of names) {
        let label: string;
        try {
          label = nameLabel(item.label ?? item.name);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          result.skipped.push({ name: item.name, reason: error.message });
          continue;
        }
        if (!allowed.includes(item.rulesetId)) {
          result.skipped.push({
            name: item.name,
            reason: `ruleset "${item.rulesetId}" is not one of this project's rulesets (${allowed.join(', ')}).`,
          });
          continue;
        }
        if (known.has(label)) {
          result.skipped.push({ name: item.name, reason: `"${label}" is already in the project.` });
          continue;
        }
        const scoreParts = item.scoreParts ?? {};
        const entry: NameEntry = {
          name: item.name,
          label,
          rulesetId: item.rulesetId,
          briefVersion: project.brief.version,
          strategy: item.strategy,
          rationale: item.rationale,
          scoreParts,
          score: computeScore(scoreParts, weights.get(item.rulesetId) ?? EQUAL_WEIGHTS),
          notes: [],
          addedAt: at,
        };
        project.names.push(entry);
        known.add(label);
        result.added.push(entry);
      }
      return result;
    });
  }

  addChecks(slug: string, batches: CheckBatch[]): Promise<Mutation<StoredChecks[]>> {
    return this.update(slug, (project) =>
      batches.map((batch) => {
        const entry = findName(project, batch.name);
        let checks = project.checks[entry.label];
        if (!checks) {
          checks = emptyChecks();
          project.checks[entry.label] = checks;
        }
        if (batch.kind === 'domain') {
          const incoming = parseOrThrow(
            z.array(DomainCheckSchema),
            batch.results,
            `Invalid domain results for "${batch.name}"`,
          );
          checks.domains = mergeBy(checks.domains, incoming, (c) => c.domain);
          return { name: entry.label, kind: batch.kind, stored: checks.domains.length };
        }
        const incoming = parseOrThrow(
          z.array(ResearchResultSchema),
          batch.results,
          `Invalid ${batch.kind} results for "${batch.name}"`,
        );
        const bucket = RESEARCH_BUCKET[batch.kind];
        checks[bucket] = mergeResearch(batch.kind, checks[bucket], incoming);
        return { name: entry.label, kind: batch.kind, stored: checks[bucket].length };
      }),
    );
  }

  addNotes(slug: string, notes: NewNote[]): Promise<Mutation<{ added: number }>> {
    return this.update(slug, (project, at) => {
      for (const note of notes) {
        findName(project, note.name).notes.push({
          kind: note.kind ?? 'general',
          text: note.text,
          ...(note.language === undefined ? {} : { language: note.language }),
          severity: note.severity ?? 'low',
          createdAt: at,
        });
      }
      return { added: notes.length };
    });
  }

  setShortlist(
    slug: string,
    names: string[],
    mode: ShortlistMode = 'set',
  ): Promise<Mutation<string[]>> {
    return this.update(slug, (project) => {
      const labels = names.map((name) => findName(project, name).label);
      if (mode === 'remove') {
        const drop = new Set(labels);
        project.shortlist = project.shortlist.filter((label) => !drop.has(label));
      } else {
        const base = mode === 'add' ? project.shortlist : [];
        project.shortlist = [...new Set([...base, ...labels])];
      }
      return project.shortlist;
    });
  }

  async updateBrief(slug: string, brief: unknown): Promise<Mutation<{ briefVersion: number }>> {
    const data = parseOrThrow(BriefSchema, brief, 'Invalid brief');
    return this.update(slug, (project, at) => {
      project.briefHistory.push(project.brief);
      project.brief = { version: project.brief.version + 1, createdAt: at, data };
      return { briefVersion: project.brief.version };
    });
  }

  /** Loads, changes, and writes one project under a per-slug lock. Nothing is written on a throw. */
  private update<T>(
    slug: string,
    change: (project: Project, at: string) => T,
  ): Promise<Mutation<T>> {
    return this.lock(slug, async () => {
      const loaded = await this.get(slug);
      const at = this.now().toISOString();
      const result = change(loaded.project, at);
      loaded.project.updatedAt = at;
      await this.write(loaded.project);
      return { result, loaded };
    });
  }

  private async write(project: Project): Promise<void> {
    const valid = parseOrThrow(ProjectSchema, project, 'Refusing to save an invalid project');
    await writeJsonWithBackup(this.paths(project.slug).projectFile, valid, parseProject);
  }

  /** Claims a slug by creating its folder; mkdir fails with EEXIST when the slug is taken. */
  private async claimSlug(base: string): Promise<string> {
    for (let n = 1; n < 1000; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      try {
        await mkdir(join(this.dir, slug));
        return slug;
      } catch (error) {
        if (!isExists(error)) throw error;
      }
    }
    throw new StoreError(`No free project slug for "${base}".`);
  }

  /** Runs tasks for the same key one after another. */
  private lock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const settled = run.catch(() => undefined);
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return run;
  }
}
