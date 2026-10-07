import { afterEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ createWorkerPool: vi.fn(), assertWorkerDatabase: vi.fn() }));
vi.mock('../src/workers/worker-db.ts', () => db);
import { runWorkerLoop } from '../src/workers/osv-worker.ts';
import { runSecurityScannerLoop } from '../src/workers/security-scanner-worker.ts';
import { runIntakeScannerLoop } from '../src/workers/intake-scan-worker.ts';

afterEach(() => vi.restoreAllMocks());

describe.each([
  ['repository', runWorkerLoop],
  ['security', runSecurityScannerLoop],
  ['intake', runIntakeScannerLoop],
] as const)('%s worker resource cleanup', (_name, run) => {
  it('does not accumulate signal listeners or pools across repeated processing failures', async () => {
    const baseline = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    const failure = new Error('database unavailable during polling');
    const pool = {
      query: vi.fn(async (sql: string) => { if (sql === 'SELECT 1') return { rows: [] }; throw failure; }),
      connect: vi.fn().mockRejectedValue(failure),
      end: vi.fn().mockResolvedValue(undefined),
    };
    db.createWorkerPool.mockReturnValue(pool);
    db.assertWorkerDatabase.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < 15; i++) {
      await expect(run()).rejects.toThrow(failure);
      expect(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal))).toEqual(baseline);
    }
    expect(pool.end).toHaveBeenCalledTimes(15);
  });

  it('closes its pool even when initial database verification fails', async () => {
    const baseline = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    const failure = new Error('startup database failure');
    const pool = { query: vi.fn().mockRejectedValue(failure), end: vi.fn().mockResolvedValue(undefined) };
    db.createWorkerPool.mockReturnValue(pool);
    db.assertWorkerDatabase.mockRejectedValue(failure);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(run()).rejects.toThrow(failure);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal))).toEqual(baseline);
  });
});
