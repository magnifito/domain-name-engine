import { describe, expect, it } from 'vitest';
import { HostLimiter } from '../src/limiter/limiter.js';

function fakeClock() {
  const state = { now: 0, waits: [] as number[] };
  return {
    state,
    now: () => state.now,
    sleep: async (ms: number) => {
      state.waits.push(ms);
      state.now += ms;
    },
  };
}

describe('HostLimiter', () => {
  it('spaces tasks for the same host by the minimum interval', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    await Promise.all(
      [1, 2, 3].map(() =>
        limiter.schedule('a.test', async () => {
          starts.push(clock.state.now);
        }),
      ),
    );
    expect(starts).toEqual([0, 1000, 2000]);
    expect(clock.state.waits).toEqual([1000, 1000]);
  });

  it('does not delay tasks for different hosts', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
    await Promise.all([
      limiter.schedule('a.test', async () => 1),
      limiter.schedule('b.test', async () => 2),
    ]);
    expect(clock.state.waits).toEqual([]);
  });

  it('uses a per-host interval override', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({
      minIntervalMs: 1000,
      intervals: { 'fast.test': 200 },
      now: clock.now,
      sleep: clock.sleep,
    });
    await limiter.schedule('fast.test', async () => 1);
    await limiter.schedule('fast.test', async () => 2);
    expect(clock.state.waits).toEqual([200]);
  });

  it('keeps the queue moving after a task fails', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    const failed = limiter.schedule('a.test', async () => {
      throw new Error('boom');
    });
    const next = limiter.schedule('a.test', async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('still spaces the next task after a task fails', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
    const failed = limiter.schedule('a.test', async () => {
      throw new Error('boom');
    });
    const next = limiter.schedule('a.test', async () => clock.state.now);
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe(1000);
  });

  it('does not sleep when the interval has already elapsed', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 1000, now: clock.now, sleep: clock.sleep });
    await limiter.schedule('a.test', async () => 1);
    clock.state.now += 5000;
    await limiter.schedule('a.test', async () => 2);
    expect(clock.state.waits).toEqual([]);
  });

  it('never overlaps long-running tasks for one host', async () => {
    const clock = fakeClock();
    const limiter = new HostLimiter({ minIntervalMs: 0, now: clock.now, sleep: clock.sleep });
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    };
    await Promise.all([1, 2, 3].map(() => limiter.schedule('a.test', task)));
    expect(maxActive).toBe(1);
  });
});
