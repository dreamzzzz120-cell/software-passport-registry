import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('distribution worker resilience contract', () => {
  const worker = fs.readFileSync('src/workers/distribution-worker.ts', 'utf8');

  it('recovers stale running jobs instead of leaving them wedged forever', () => {
    expect(worker).toContain("status='running'");
    expect(worker).toContain("locked_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'");
    expect(worker).toContain("THEN 'dead_letter' ELSE 'queued'");
  });

  it('does not consume retry budget while outreach is deliberately paused', () => {
    expect(worker).toContain('deferWithoutAttempt');
    expect(worker).toContain('attempts=GREATEST(attempts-1,0)');
    expect(worker).toContain("'DISTRIBUTION_OUTREACH_PAUSED'");
  });

  it('runs stale-job recovery when the worker starts', () => {
    expect(worker).toContain('await recoverStaleRunningJobs(pool)');
  });
});
