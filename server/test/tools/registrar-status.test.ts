import { describe, expect, it } from 'vitest';
import { registrarStatus } from '../../src/registrars/credentials.js';
import type { Runtime } from '../../src/runtime.js';
import { callJson, connectClient } from '../helpers/mcp.js';

const ENV = {
  SPACESHIP_API_KEY: 'ss-key-1234',
  SPACESHIP_API_SECRET: 'ss-secret-5678',
  CLOUDFLARE_API_TOKEN: 'cf-token-efgh',
};

function fakeRuntime(): Runtime {
  return { registrarStatus: () => registrarStatus(ENV) } as Runtime;
}

describe('registrar_status tool', () => {
  it('is listed with read-only, closed-world annotations', async () => {
    const client = await connectClient(fakeRuntime());
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'registrar_status');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('reports which registrars are configured and never returns key values', async () => {
    const client = await connectClient(fakeRuntime());
    const res = await callJson(client, 'registrar_status', {});
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      registrars: [
        { registrar: 'spaceship', configured: true, missing: [] },
        { registrar: 'namecheap', configured: false },
        { registrar: 'cloudflare', configured: false, missing: ['CLOUDFLARE_ACCOUNT_ID'] },
      ],
    });
    for (const value of Object.values(ENV)) expect(res.text).not.toContain(value);
  });
});
