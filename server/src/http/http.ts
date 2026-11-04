import { USER_AGENT } from '../config.js';
import { type HostLimiter, sleep as realSleep } from '../limiter/limiter.js';

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  limiter: HostLimiter;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class HttpError extends Error {
  override name = 'HttpError';
}

const MAX_DELAY_MS = 60_000;

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

export function retryDelayMs(
  res: Response | undefined,
  attempt: number,
  baseDelayMs: number,
): number {
  const header = res?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_DELAY_MS);
  }
  return Math.min(baseDelayMs * 2 ** attempt, MAX_DELAY_MS);
}

export function createHttp(opts: HttpOptions): HttpFetch {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxTries = opts.maxTries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const sleepFn = opts.sleep ?? realSleep;

  return async (url, init = {}) => {
    const host = new URL(url).host;
    const headers = new Headers(init.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
    let lastError: unknown;

    for (let attempt = 0; attempt < maxTries; attempt++) {
      const isLast = attempt === maxTries - 1;
      let waitMs: number;
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        const res = await opts.limiter.schedule(host, () =>
          fetchImpl(url, { ...init, headers, signal }),
        );
        if (!shouldRetry(res.status) || isLast) return res;
        waitMs = retryDelayMs(res, attempt, baseDelayMs);
        // Release the connection held by the discarded response before retrying.
        await res.body?.cancel().catch(() => undefined);
      } catch (error) {
        lastError = error;
        // A caller-initiated abort is final; do not retry it.
        if (isLast || init.signal?.aborted) break;
        waitMs = retryDelayMs(undefined, attempt, baseDelayMs);
      }
      await sleepFn(waitMs);
    }
    throw new HttpError(`Request to ${host} failed after ${maxTries} tries`, {
      cause: lastError,
    });
  };
}
