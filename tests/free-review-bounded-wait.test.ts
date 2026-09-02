import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const route = read('src/routes/free-review-legacy.ts');
const osvWorker = read('src/workers/osv-worker.ts');

// Observed in production: a Free Review spun on "scanning" indefinitely. The two
// engines retry on different schedules -- the security scanner on a flat 30s
// backoff, the repository scanner on an exponential one reaching 3600s -- and
// `pending` was true while ANY job sat in Pending. So the slowest retry chain
// dictated the visitor's wait, and the page appeared to load forever.
describe('a Free Review is bounded and never spins forever', () => {
  it('the status endpoint stops reporting "scanning" past a deadline', () => {
    expect(route).toContain('FREE_REVIEW_DEADLINE_MS');
    expect(route).toMatch(/const pastDeadline = Date\.now\(\) - oldestStartedAt > FREE_REVIEW_DEADLINE_MS/);
    // The deadline must actually gate the scanning state, not merely exist.
    expect(route).toMatch(/const pending = !pastDeadline &&/);
  });

  it('the deadline is a real bound, not longer than a visitor would wait', () => {
    const match = route.match(/const FREE_REVIEW_DEADLINE_MS = ([^;]+);/);
    expect(match).not.toBeNull();
    // eslint-disable-next-line no-eval
    const ms = eval(match![1]) as number;
    expect(ms).toBeGreaterThan(60_000);
    expect(ms).toBeLessThanOrEqual(10 * 60_000);
  });

  it('a timed-out review reports failure honestly rather than a clean result', () => {
    // Unfinished jobs are excluded from success, so a run that only timed out
    // lands on 'failed' via `succeeded.length === 0`, never on 'complete'.
    expect(route).toMatch(/succeeded\.length === 0\s*\?\s*'failed'/);
    expect(route).toMatch(/did not finish in time/i);
    expect(route).toMatch(/nothing here should be read as a clean review/i);
  });

  it('never reports a failure reason while still claiming to be scanning', () => {
    // The two together told the visitor the run had failed while the UI spun.
    expect(route).toMatch(/const failureReason = pending\s*\?\s*null/);
  });

  it('the repository_scan worker logs its failures instead of failing silently', () => {
    expect(osvWorker).toContain("event: 'scan_job_failed'");
    expect(osvWorker).toContain('safeFailureReason(code)');
    // The logged reason must be redacted: it can carry an upstream error body.
    expect(osvWorker).toContain('[REDACTED_TOKEN]');
  });
});
