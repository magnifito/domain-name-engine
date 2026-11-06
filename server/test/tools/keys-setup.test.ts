import { describe, expect, it } from 'vitest';
import type { Runtime } from '../../src/runtime.js';
import { callJson, connectClient } from '../helpers/mcp.js';

describe('keys_setup tool', () => {
  it('returns the path and next steps, never values', async () => {
    const rt = {
      keysSetup: () => ({
        path: '/home/u/.domain-engine/keys.env',
        exists: true,
        namesSet: ['SPACESHIP_API_KEY'],
        readableByOthers: false,
        created: true,
        permissionsFixed: false,
      }),
    } as unknown as Runtime;
    const client = await connectClient(rt);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'keys_setup')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    const res = await callJson(client, 'keys_setup', {});
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ path: '/home/u/.domain-engine/keys.env', created: true });
    expect(res.text).toContain('Never ask the user to paste a key into the chat');
  });

  it('reports a clean error when the file cannot be created', async () => {
    const rt = {
      keysSetup: () => {
        throw new Error('EACCES: permission denied');
      },
    } as unknown as Runtime;
    const res = await callJson(await connectClient(rt), 'keys_setup', {});
    expect(res.isError).toBe(true);
    expect(res.text).toBe('Could not create the key file: EACCES: permission denied');
  });
});
