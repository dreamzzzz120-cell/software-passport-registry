import { afterEach, expect, it, vi } from 'vitest';
import { superviseWorker } from '../src/workers/supervision.ts';

afterEach(() => vi.useRealTimers());

it('does not restart a consumer that completed after shutdown', async () => {
  const shutdown = new AbortController();
  const run = vi.fn(async () => { shutdown.abort(); });
  await superviseWorker(run, shutdown.signal, vi.fn());
  expect(run).toHaveBeenCalledTimes(1);
});

it('does not start consumers when shutdown happened during startup', async () => {
  const shutdown = new AbortController();
  shutdown.abort();
  const run = vi.fn();
  await superviseWorker(run, shutdown.signal, vi.fn());
  expect(run).not.toHaveBeenCalled();
});

it('cancels a retry backoff immediately when shutdown starts', async () => {
  const shutdown = new AbortController();
  const failure = new Error('dependency unavailable');
  const onFailure = vi.fn();
  const run = vi.fn().mockRejectedValue(failure);
  const task = superviseWorker(run, shutdown.signal, onFailure);
  await Promise.resolve();
  shutdown.abort();
  await task;
  expect(onFailure).toHaveBeenCalledWith(failure);
  expect(run).toHaveBeenCalledTimes(1);
});

it('continues normal finite worker cycles until shutdown', async () => {
  const shutdown = new AbortController();
  let cycles = 0;
  const run = vi.fn(async () => { if (++cycles === 3) shutdown.abort(); });
  await superviseWorker(run, shutdown.signal, vi.fn());
  expect(run).toHaveBeenCalledTimes(3);
});
