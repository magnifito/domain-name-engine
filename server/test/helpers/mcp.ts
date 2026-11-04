import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Runtime } from '../../src/runtime.js';
import { createServer } from '../../src/server.js';

export async function connectClient(rt: Runtime): Promise<Client> {
  const server = createServer(rt);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; data: unknown; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const first = (result.content as Array<{ type: string; text?: string }>)[0];
  const text = first?.text ?? '';
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { isError: result.isError === true, data, text };
}
