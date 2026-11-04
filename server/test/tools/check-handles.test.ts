import { describe, expect, it } from 'vitest';
import type { HandleCheck } from '../../src/research/handles/check.js';
import { PLATFORMS, type Platform } from '../../src/research/handles/platforms.js';
import type { Runtime } from '../../src/runtime.js';
import { HANDLES_NOTE } from '../../src/tools/check-handles.js';
import { callJson, connectClient } from '../helpers/mcp.js';

function fakeRuntime(): Runtime & { seen: Array<{ handles: string[]; platforms: Platform[] }> } {
  const seen: Array<{ handles: string[]; platforms: Platform[] }> = [];
  return {
    ...({} as Runtime),
    seen,
    checkHandles: async (handles, platforms) => {
      seen.push({ handles, platforms: [...platforms] });
      return handles.flatMap((handle) =>
        platforms.map(
          (platform): HandleCheck => ({
            platform,
            handle,
            status: 'unknown',
            confidence: 'low',
            method: 'manual',
            source: 'none',
            checkedAt: '2026-11-04T10:00:00.000Z',
          }),
        ),
      );
    },
  };
}

describe('check_handles tool', () => {
  it('is listed as read-only and open-world', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'check_handles');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('defaults to every platform', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    const res = await callJson(client, 'check_handles', { handles: ['acme'] });
    expect(res.isError).toBe(false);
    expect(rt.seen[0]?.platforms).toEqual([...PLATFORMS]);
    expect(res.data).toMatchObject({ note: HANDLES_NOTE });
    expect((res.data as { results: unknown[] }).results).toHaveLength(PLATFORMS.length);
  });

  it('de-duplicates the requested platforms', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    await callJson(client, 'check_handles', { handles: ['acme'], platforms: ['npm', 'npm', 'x'] });
    expect(rt.seen[0]?.platforms).toEqual(['npm', 'x']);
  });

  it('rejects an unknown platform', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'check_handles', {
      handles: ['acme'],
      platforms: ['myspace'],
    });
    expect(res.isError).toBe(true);
  });
});
