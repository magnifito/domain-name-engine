import { describe, expect, it } from 'vitest';
import { USER_AGENT } from '../src/config.js';
import { createHttp, HttpError, retryDelayMs } from '../src/http/http.js';
import { HostLimiter } from '../src/limiter/limiter.js';

function sequenceFetch(steps: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let i = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup(steps: Array<Response | Error>) {
  const waits: number[] = [];
  const { fetchImpl, calls } = sequenceFetch(steps);
  const http = createHttp({
    limiter: new HostLimiter({ minIntervalMs: 0 }),
    fetchImpl,
    baseDelayMs: 100,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { http, calls, waits };
}

describe('createHttp', () => {
  it('sends the engine user agent and returns the response', async () => {
    const { http, calls } = setup([new Response('ok', { status: 200 })]);
    const res = await http('https://a.test/x');
    expect(res.status).toBe(200);
    expect(new Headers(calls[0]?.init?.headers).get('user-agent')).toBe(USER_AGENT);
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries on 429 and honors Retry-After seconds', async () => {
    const { http, calls, waits } = setup([
      new Response('', { status: 429, headers: { 'retry-after': '2' } }),
      new Response('ok', { status: 200 }),
    ]);
    const res = await http('https://a.test/x');
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it('backs off exponentially on 5xx and returns the last response', async () => {
    const { http, calls, waits } = setup([
      new Response('', { status: 503 }),
      new Response('', { status: 503 }),
      new Response('', { status: 503 }),
    ]);
    const res = await http('https://a.test/x');
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([100, 200]);
  });

  it('does not retry on 404', async () => {
    const { http, calls } = setup([new Response('', { status: 404 })]);
    expect((await http('https://a.test/x')).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('throws HttpError after repeated network errors', async () => {
    const { http, calls } = setup([new TypeError('fetch failed')]);
    await expect(http('https://a.test/x')).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(3);
  });

  it('caps Retry-After at 60 seconds', () => {
    const res = new Response('', { status: 429, headers: { 'retry-after': '9999' } });
    expect(retryDelayMs(res, 0, 100)).toBe(60_000);
  });

  it('honors a caller-supplied abort signal', async () => {
    const { http, calls } = setup([new Response('ok', { status: 200 })]);
    const controller = new AbortController();
    await http('https://a.test/x', { signal: controller.signal });
    const signal = calls[0]?.init?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it('cancels the body of a retryable response before retrying', async () => {
    const first = new Response('busy', { status: 503 });
    let cancelled = false;
    const original = first.body?.cancel.bind(first.body);
    Object.defineProperty(first, 'body', {
      value: {
        cancel: async (reason?: unknown) => {
          cancelled = true;
          return original?.(reason);
        },
      },
    });
    const { http } = setup([first, new Response('ok', { status: 200 })]);
    const res = await http('https://a.test/x');
    expect(res.status).toBe(200);
    expect(cancelled).toBe(true);
  });
});
