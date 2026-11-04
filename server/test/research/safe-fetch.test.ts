import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer as createTcpServer } from 'node:net';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { HostLimiter } from '../../src/limiter/limiter.js';
import { fetchHomepage, readCapped } from '../../src/research/profile/homepage.js';
import {
  BlockedError,
  createGuardedHttp,
  isBlockedAddress,
  nodeTransport,
  type Transport,
} from '../../src/research/profile/safe-fetch.js';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '0.1.2.3',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'febf::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::127.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    '0:0:0:0:0:0:0:1',
    '::ffff:0:7f00:1',
    '::ffff:0:127.0.0.1',
    '64:ff9b:1::7f00:1',
    '64:ff9b:1:ffff::1',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '169.253.0.1',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2a00:1450:4001::200e',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it('blocks text that is not an IP address', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

function setup(resolve: (host: string) => Promise<{ address: string; family: number }[]>) {
  const calls: { url: string; address: string; init: RequestInit }[] = [];
  const scheduled: string[] = [];
  const limiter = new HostLimiter({ minIntervalMs: 0 });
  const realSchedule = limiter.schedule.bind(limiter);
  limiter.schedule = ((host: string, task: () => Promise<unknown>) => {
    scheduled.push(host);
    return realSchedule(host, task);
  }) as typeof limiter.schedule;
  const transport: Transport = async ({ url, address, init }) => {
    calls.push({ url: url.href, address, init });
    return new Response('ok');
  };
  const http = createGuardedHttp({ limiter, resolve, transport });
  return { http, calls, scheduled };
}

describe('createGuardedHttp', () => {
  it('refuses a host that resolves to a private address, before any request', async () => {
    const { http, calls } = setup(async () => [{ address: '127.0.0.1', family: 4 }]);
    await expect(http('http://localtest.me/')).rejects.toBeInstanceOf(BlockedError);
    await expect(http('http://localtest.me/')).rejects.toThrow(
      'blocked: localtest.me resolves to a private or reserved address',
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses when any resolved address is private', async () => {
    const { http, calls } = setup(async () => [...PUBLIC, { address: '10.0.0.5', family: 4 }]);
    await expect(http('https://mixed.example/')).rejects.toBeInstanceOf(BlockedError);
    expect(calls).toHaveLength(0);
  });

  it('refuses an IP literal URL and an IPv4-mapped IPv6 literal', async () => {
    const resolve = async (host: string) => {
      const bare = host.replace(/^\[|\]$/g, '');
      return [{ address: bare, family: bare.includes(':') ? 6 : 4 }];
    };
    const { http } = setup(resolve);
    await expect(http('http://127.0.0.1/')).rejects.toBeInstanceOf(BlockedError);
    await expect(http('http://2130706433/')).rejects.toBeInstanceOf(BlockedError);
    await expect(http('http://[::ffff:127.0.0.1]/')).rejects.toBeInstanceOf(BlockedError);
  });

  it('refuses non-default ports and non-http schemes', async () => {
    const { http, calls } = setup(async () => PUBLIC);
    await expect(http('http://example.com:8080/')).rejects.toThrow(
      'blocked: example.com uses a non-default port',
    );
    await expect(http('https://example.com:444/')).rejects.toBeInstanceOf(BlockedError);
    await expect(http('ftp://example.com/')).rejects.toBeInstanceOf(BlockedError);
    await expect(http('file:///etc/passwd')).rejects.toBeInstanceOf(BlockedError);
    expect(calls).toHaveLength(0);
  });

  it('pins the vetted address, never follows redirects, and goes through the limiter', async () => {
    const { http, calls, scheduled } = setup(async () => PUBLIC);
    const res = await http('https://example.com/', { headers: { accept: 'text/html' } });
    expect(await res.text()).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.address).toBe('93.184.216.34');
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(scheduled).toEqual(['example.com']);
  });

  it('turns a 302 to a loopback address into a blocked redirect', async () => {
    const limiter = new HostLimiter({ minIntervalMs: 0 });
    const transport: Transport = async ({ url }) =>
      url.hostname === 'public.example'
        ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
        : new Response('<title>Admin</title>', { headers: { 'content-type': 'text/html' } });
    const http = createGuardedHttp({
      limiter,
      resolve: async (host) =>
        host === 'public.example' ? PUBLIC : [{ address: host, family: 4 }],
      transport,
    });
    expect(await fetchHomepage('public.example', http)).toEqual({
      kind: 'error',
      reason: 'blocked: redirect to 127.0.0.1 resolves to a private or reserved address',
    });
  });
});

describe('nodeTransport', () => {
  it('connects to the given address regardless of the URL host name', async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end(`host=${req.headers.host}`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await nodeTransport({
        url: new URL(`http://pinned.invalid:${port}/`),
        address: '127.0.0.1',
        family: 4,
        init: { redirect: 'manual' },
        timeoutMs: 2000,
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`host=pinned.invalid:${port}`);
    } finally {
      server.close();
    }
  });

  it('returns a redirect response as-is', async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', 'http://127.0.0.1/');
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await nodeTransport({
        url: new URL(`http://pinned.invalid:${port}/`),
        address: '127.0.0.1',
        family: 4,
        init: {},
        timeoutMs: 2000,
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('http://127.0.0.1/');
    } finally {
      server.close();
    }
  });
});

describe('nodeTransport hostile responses', () => {
  it('turns an out-of-range status into an error without crashing or hanging', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('uncaughtException', onUnhandled);
    process.on('unhandledRejection', onUnhandled);
    const server = createTcpServer((socket) => {
      socket.on('data', () => socket.end('HTTP/1.1 999 Weird\r\ncontent-length: 0\r\n\r\n'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const http = createGuardedHttp({
        limiter: new HostLimiter({ minIntervalMs: 0 }),
        resolve: async () => PUBLIC,
        transport: (request) =>
          nodeTransport({
            ...request,
            url: new URL(`http://pinned.invalid:${port}/`),
            address: '127.0.0.1',
            family: 4,
            timeoutMs: 2000,
          }),
      });
      const result = await fetchHomepage('example.com', http);
      expect(result.kind).toBe('error');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('uncaughtException', onUnhandled);
      process.off('unhandledRejection', onUnhandled);
      server.close();
    }
  }, 10_000);
});

describe('nodeTransport content encoding', () => {
  async function serve(handler: Parameters<typeof createServer>[1]) {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, port: (server.address() as AddressInfo).port };
  }
  const call = (port: number) =>
    nodeTransport({
      url: new URL(`http://pinned.invalid:${port}/`),
      address: '127.0.0.1',
      family: 4,
      init: {},
      timeoutMs: 3000,
    });

  it('asks for identity encoding and decompresses a gzip page anyway', async () => {
    let asked = '';
    const { server, port } = await serve((req, res) => {
      asked = String(req.headers['accept-encoding']);
      res.setHeader('content-type', 'text/html');
      res.setHeader('content-encoding', 'gzip');
      res.end(gzipSync('<title>Zipped Acme</title>'));
    });
    try {
      const res = await call(port);
      expect(asked).toBe('identity');
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(await readCapped(res)).toContain('<title>Zipped Acme</title>');
    } finally {
      server.close();
    }
  });

  it('caps the decompressed size, so a zip bomb is cut off', async () => {
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 97));
    const { server, port } = await serve((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.setHeader('content-encoding', 'gzip');
      res.end(bomb);
    });
    try {
      const res = await call(port);
      const text = await readCapped(res, 1000);
      expect(text).toHaveLength(1000);
    } finally {
      server.close();
    }
  });
});
