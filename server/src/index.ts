import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRuntime } from './runtime.js';
import { createServer } from './server.js';

const server = createServer(createRuntime());
await server.connect(new StdioServerTransport());
