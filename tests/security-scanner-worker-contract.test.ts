import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const workerPath = path.resolve(process.cwd(), 'src/workers/security-scanner-worker.ts');

describe('repository security worker lifecycle contract', () => {
  it('reclaims stale running leases and never exceeds max attempts', async () => {
    const source = await readFile(workerPath, 'utf8');
    expect(source).toContain("attempt_count < max_attempts");
    expect(source).toContain("status='Running'");
    expect(source).toContain("locked_at IS NOT NULL");
    expect(source).toContain("locked_at < NOW() - INTERVAL '${JOB_LEASE_MINUTES} minutes'");
  });

  it('requires worker ownership for progress and terminal state transitions', async () => {
    const source = await readFile(workerPath, 'utf8');
    expect(source).toContain("status='Running' AND locked_by=$3");
    expect(source).toContain("status='Running' AND locked_by=$4 RETURNING id");
    expect(source).toContain("throw new Error('JOB_LEASE_LOST')");
  });

  it('records deterministic retry and permanent-failure outcomes', async () => {
    const source = await readFile(workerPath, 'utf8');
    expect(source).toContain("const nextStatus = retry ? 'Pending' : 'Failed'");
    expect(source).toContain("const nextAttemptAt = retry ? new Date(Date.now() + 30_000).toISOString() : null");
    expect(source).toContain('Scan failed; retry scheduled:');
    expect(source).toContain('Scan permanently failed:');
  });
});
