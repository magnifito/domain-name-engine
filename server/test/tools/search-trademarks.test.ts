import { describe, expect, it } from 'vitest';
import type { TrademarkQuery, TrademarkSearch } from '../../src/research/trademarks/search.js';
import type { Runtime } from '../../src/runtime.js';
import { callJson, connectClient } from '../helpers/mcp.js';

function fakeRuntime(): Runtime & { seen: TrademarkQuery[] } {
  const seen: TrademarkQuery[] = [];
  return {
    ...({} as Runtime),
    seen,
    searchTrademarks: async (query): Promise<TrademarkSearch> => {
      seen.push(query);
      return { mark: query.mark, niceClasses: [], results: [], links: [], note: 'n' };
    },
  };
}

describe('search_trademarks tool', () => {
  it('is listed as read-only and open-world', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'search_trademarks');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  });

  it('passes the trimmed mark and classes to the runtime', async () => {
    const rt = fakeRuntime();
    const client = await connectClient(rt);
    const res = await callJson(client, 'search_trademarks', { mark: ' Acme ', niceClasses: [9] });
    expect(res.isError).toBe(false);
    expect(rt.seen).toEqual([{ mark: 'Acme', niceClasses: [9] }]);
    expect(res.data).toMatchObject({ mark: 'Acme' });
  });

  it('rejects an out-of-range Nice class', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'search_trademarks', { mark: 'acme', niceClasses: [46] });
    expect(res.isError).toBe(true);
  });
});
