import { afterEach, describe, expect, it, vi } from 'vitest';
const worker = vi.hoisted(() => ({ createWorkerPool: vi.fn() }));
vi.mock('../src/workers/worker-db.ts', () => worker);
vi.mock('../src/integrations/intake-storage.ts', () => ({ intakeBrokerConfigured: () => false, deleteIntakeObject: vi.fn() }));
import { runRetentionWorkerOnce, runRetentionWorkerLoop } from '../src/workers/retention-worker';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('bounded retention worker', () => {
  it('finishes one pass, closes its pool and schedules no polling timer', async () => {
    vi.useFakeTimers();
    const pool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), end: vi.fn().mockResolvedValue(undefined) };
    worker.createWorkerPool.mockReturnValue(pool);
    await runRetentionWorkerOnce();
    expect(pool.query).toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('closes its pool on a failed pass and propagates the failure', async () => {
    const failure = new Error('retention database failure');
    const pool = { query: vi.fn().mockRejectedValue(failure), end: vi.fn().mockResolvedValue(undefined) };
    worker.createWorkerPool.mockReturnValue(pool);
    await expect(runRetentionWorkerOnce()).rejects.toThrow(failure);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
  it('keeps the persistent worker polling and closes each pass before waiting', async () => {
    vi.useFakeTimers();
    const first = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), end: vi.fn().mockResolvedValue(undefined) };
    const second = { query: vi.fn().mockRejectedValue(new Error('stop test loop')), end: vi.fn().mockResolvedValue(undefined) };
    worker.createWorkerPool.mockReturnValueOnce(first).mockReturnValue(second);
    const done = runRetentionWorkerLoop().catch(error => error.message);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(first.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersToNextTimerAsync();
    expect(await done).toBe('stop test loop');
    expect(worker.createWorkerPool).toHaveBeenCalledTimes(2);
    expect(second.end).toHaveBeenCalledTimes(1);
  });
});
