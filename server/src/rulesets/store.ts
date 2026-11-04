import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../fs/atomic.js';
import { StoreError, zodMessage } from '../store/errors.js';
import { fileExists, isNotFound } from '../store/fs-utils.js';
import { BUILTIN_IDS, BUILTIN_RULESETS } from './builtin.js';
import { RULESET_ID, RULESET_SCHEMA_VERSION, type Ruleset, RulesetSchema } from './schema.js';

export interface RulesetSummary {
  id: string;
  name: string;
  description: string;
  examples: string[];
  builtin: boolean;
}

export interface RulesetListing {
  rulesets: RulesetSummary[];
  invalid: Array<{ file: string; error: string }>;
}

function summarize(ruleset: Ruleset, builtin: boolean): RulesetSummary {
  const { id, name, description, examples } = ruleset;
  return { id, name, description, examples, builtin };
}

/** Built-in rulesets from the bundle plus custom rulesets stored as <dir>/<id>.json. */
export class RulesetStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async list(): Promise<RulesetListing> {
    const rulesets = BUILTIN_RULESETS.map((r) => summarize(r, true));
    const invalid: RulesetListing['invalid'] = [];
    for (const file of await this.customFiles()) {
      try {
        rulesets.push(summarize(await this.readCustom(file), false));
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        invalid.push({ file, error: error.message });
      }
    }
    return { rulesets, invalid };
  }

  async get(id: string): Promise<{ ruleset: Ruleset; builtin: boolean }> {
    const builtin = BUILTIN_RULESETS.find((r) => r.id === id);
    if (builtin) return { ruleset: builtin, builtin: true };
    this.checkId(id);
    try {
      return { ruleset: await this.readCustom(`${id}.json`), builtin: false };
    } catch (error) {
      if (isNotFound(error)) {
        throw new StoreError(
          `Ruleset "${id}" not found. Call ruleset_list to see the available ids.`,
        );
      }
      throw error;
    }
  }

  async save(input: unknown): Promise<{ ruleset: Ruleset; created: boolean }> {
    const parsed = RulesetSchema.safeParse(input);
    if (!parsed.success) throw new StoreError(`Invalid ruleset: ${zodMessage(parsed.error)}`);
    const ruleset = parsed.data;
    if (BUILTIN_IDS.has(ruleset.id)) {
      throw new StoreError(
        `"${ruleset.id}" is a built-in ruleset id; choose a different id for a custom ruleset.`,
      );
    }
    const path = this.path(ruleset.id);
    const created = !(await fileExists(path));
    const file = { schemaVersion: RULESET_SCHEMA_VERSION, ...ruleset };
    await writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
    return { ruleset, created };
  }

  async delete(id: string): Promise<void> {
    if (BUILTIN_IDS.has(id)) {
      throw new StoreError(`"${id}" is a built-in ruleset and cannot be deleted.`);
    }
    this.checkId(id);
    try {
      await rm(this.path(id));
    } catch (error) {
      if (isNotFound(error)) throw new StoreError(`Custom ruleset "${id}" not found.`);
      throw error;
    }
  }

  private checkId(id: string): void {
    if (!RULESET_ID.test(id)) {
      throw new StoreError(
        `"${id}" is not a valid ruleset id: use 1-40 lowercase letters, digits, or inner hyphens.`,
      );
    }
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async customFiles(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((file) => file.endsWith('.json')).sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  /** Reads one custom file; a missing file throws the raw ENOENT error, anything else StoreError. */
  private async readCustom(file: string): Promise<Ruleset> {
    const text = await readFile(join(this.dir, file), 'utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new StoreError(`${file} is not valid JSON.`);
    }
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const { schemaVersion, ...rest } = record;
    if (schemaVersion !== RULESET_SCHEMA_VERSION) {
      throw new StoreError(
        `${file} has schemaVersion ${String(schemaVersion)}; this engine reads schemaVersion ${RULESET_SCHEMA_VERSION}.`,
      );
    }
    const parsed = RulesetSchema.safeParse(rest);
    if (!parsed.success) {
      throw new StoreError(`${file} is not a valid ruleset: ${zodMessage(parsed.error)}`);
    }
    if (`${parsed.data.id}.json` !== file) {
      throw new StoreError(
        `${file} declares id "${parsed.data.id}"; the file name must match the id.`,
      );
    }
    if (BUILTIN_IDS.has(parsed.data.id)) {
      throw new StoreError(`${file} uses the built-in id "${parsed.data.id}" and is ignored.`);
    }
    return parsed.data;
  }
}
