import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { tcpWhoisQuery } from '../src/sources/whois.js';

let server: Server | undefined;

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

async function listen(onConnection: (socket: import('node:net').Socket) => void): Promise<number> {
  const s = createServer(onConnection);
  server = s;
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const address = s.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('tcpWhoisQuery', () => {
  it('returns the full reply', async () => {
    const port = await listen((socket) => {
      socket.on('data', () => socket.end('Domain Name: A.TEST\r\n'));
    });
    expect(await tcpWhoisQuery(1000, port)('127.0.0.1', 'a.test')).toBe('Domain Name: A.TEST\r\n');
  });

  it('enforces an overall deadline against a slow drip', async () => {
    let timer: NodeJS.Timeout | undefined;
    const port = await listen((socket) => {
      socket.on('error', () => {});
      socket.on('close', () => clearInterval(timer));
      timer = setInterval(() => socket.write('x'), 20);
    });
    await expect(tcpWhoisQuery(150, port)('127.0.0.1', 'a.test')).rejects.toThrow(
      'WHOIS 127.0.0.1 exceeded 150 ms',
    );
  });

  it('caps the response size', async () => {
    const port = await listen((socket) => {
      socket.on('error', () => {});
      socket.on('data', () => socket.write(Buffer.alloc(70000, 'x')));
    });
    await expect(tcpWhoisQuery(2000, port)('127.0.0.1', 'a.test')).rejects.toThrow(
      'WHOIS 127.0.0.1 response exceeded 65536 bytes',
    );
  });
});
