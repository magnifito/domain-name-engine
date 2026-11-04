import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function toolJson(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
