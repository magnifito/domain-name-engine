import { describe, expect, it } from 'vitest';
import type { DomainCheck } from '../../src/domain/types.js';
import {
  DomainCheckSchema,
  parseProject,
  ResearchResultSchema,
} from '../../src/store/project-schema.js';
import { loadBrief } from './brief-fixture.js';

const AT = '2026-11-04T10:00:00.000Z';

async function minimalProject(): Promise<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    slug: 'fridgeplan',
    title: 'FridgePlan',
    createdAt: AT,
    updatedAt: AT,
    brief: { version: 1, createdAt: AT, data: await loadBrief() },
    briefHistory: [],
    names: [],
    checks: {},
    shortlist: [],
  };
}

describe('project schema', () => {
  it('accepts a minimal project', async () => {
    expect(parseProject(await minimalProject()).slug).toBe('fridgeplan');
  });

  it('rejects another schemaVersion with a clear message', async () => {
    const raw = { ...(await minimalProject()), schemaVersion: 2 };
    expect(() => parseProject(raw)).toThrow(
      'schemaVersion is 2; this engine reads schemaVersion 1.',
    );
    const { schemaVersion: _v, ...unversioned } = await minimalProject();
    expect(() => parseProject(unversioned)).toThrow('schemaVersion is undefined');
  });

  it('rejects a project with an invalid field', async () => {
    const raw = { ...(await minimalProject()), slug: 'Bad Slug' };
    expect(() => parseProject(raw)).toThrow(/^not a valid project: slug: /);
  });

  it('accepts check_domains results as domain checks', () => {
    const check: DomainCheck = {
      domain: 'fridgeplan.com',
      status: 'likely_available',
      source: 'rdap',
      confidence: 'high',
      checkedAt: AT,
    };
    expect(DomainCheckSchema.parse(check)).toEqual(check);
  });

  it('keeps research results as open payloads and checks the common fields when present', () => {
    const handle = {
      platform: 'github',
      status: 'taken',
      source: 'github-api',
      checkedAt: AT,
      confidence: 'high',
    };
    expect(ResearchResultSchema.parse(handle)).toEqual(handle);
    const trademarkSearch = {
      mark: 'FRIDGELY',
      offices: [{ office: 'euipo', status: 'no_matches' }],
    };
    expect(ResearchResultSchema.parse(trademarkSearch)).toEqual(trademarkSearch);
    expect(ResearchResultSchema.safeParse({ platform: 'x', checkedAt: 'yesterday' }).success).toBe(
      false,
    );
    expect(ResearchResultSchema.safeParse({ platform: 'x', confidence: 'certain' }).success).toBe(
      false,
    );
  });
});
