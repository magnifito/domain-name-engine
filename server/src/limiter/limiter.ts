export interface LimiterOptions {
  minIntervalMs?: number;
  intervals?: Record<string, number>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serializes tasks per host and keeps a minimum gap between task starts. */
export class HostLimiter {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly lastStart = new Map<string, number>();
  private readonly minIntervalMs: number;
  private readonly intervals: Record<string, number>;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(opts: LimiterOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.intervals = opts.intervals ?? {};
    this.sleepFn = opts.sleep ?? sleep;
    this.now = opts.now ?? Date.now;
  }

  schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(host) ?? Promise.resolve();
    const run = previous.then(() => this.runAfterInterval(host, task));
    // The chain must never reject, or one failure would block the host forever.
    this.chains.set(
      host,
      run.catch(() => undefined),
    );
    return run;
  }

  private async runAfterInterval<T>(host: string, task: () => Promise<T>): Promise<T> {
    const interval = this.intervals[host] ?? this.minIntervalMs;
    const last = this.lastStart.get(host);
    if (last !== undefined) {
      const wait = last + interval - this.now();
      if (wait > 0) await this.sleepFn(wait);
    }
    this.lastStart.set(host, this.now());
    return task();
  }
}
