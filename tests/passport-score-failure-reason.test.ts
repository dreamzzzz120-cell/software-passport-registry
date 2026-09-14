import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rootErrorMessage } from '../src/workers/osv-worker.ts';

// Production 2026-09-14 17:51Z (worker deploy 21084883): the OSV worker logged
//   passport_score_failed reason="Failed query: update \"passports\" set ..."
// -- Drizzle's wrapper message, cut at 200 chars, with the real Postgres error
// hidden in `cause`. The log said a statement failed and nothing about why.
const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('passport_score_failed reports the database error, not the wrapped SQL', () => {
  it('walks to the innermost cause', () => {
    const pg = new Error('canceling statement due to lock timeout');
    const drizzle = new Error('Failed query: update "passports" set "overall_score" = $1 ... params: 71,80', { cause: pg });
    const outer = new Error('scoring failed', { cause: drizzle });
    expect(rootErrorMessage(outer)).toBe('canceling statement due to lock timeout');
  });

  it('falls back to the error message (or the value) when there is no cause', () => {
    expect(rootErrorMessage(new Error('SBOM_EMPTY'))).toBe('SBOM_EMPTY');
    expect(rootErrorMessage('plain string')).toBe('plain string');
  });

  it('both workers log the root cause through the redacting formatter', () => {
    expect(read('src/workers/osv-worker.ts')).toContain("event: 'passport_score_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, passportId: job.passport_id, reason: safeFailureReason(rootErrorMessage(error))");
    expect(read('src/workers/security-scanner-worker.ts')).toContain("event: 'passport_score_failed', workerId: WORKER_ID, jobId: job.id, tenantId: job.tenant_id, passportId: job.passport_id, reason: safeFailureReason(rootErrorMessage(error))");
  });
});
