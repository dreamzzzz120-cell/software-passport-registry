import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('intake analysis handoff contract', () => {
  const review = read('src/components/IntakeReviewWorkspace.tsx');
  const intake = read('src/routes/universal-intake.ts');
  const scans = read('src/routes/scans.ts');

  it('moves uploaded evidence from review into the real scan queue', () => {
    const claimAt = review.indexOf("apiFetch('/api/intake/claim'");
    const submitAt = review.indexOf("apiFetch('/api/scans/submit'");
    expect(claimAt).toBeGreaterThanOrEqual(0);
    expect(submitAt).toBeGreaterThan(claimAt);
    expect(review).toContain("source: 'upload'");
    expect(review).toContain('intakeJobId');
    expect(review).toContain('/api/agent-jobs/');
  });

  it('uses Launch Ticket language in the handoff UI', () => {
    expect(review).toContain('Launch Ticket');
    expect(review).not.toContain('Software Passport" state=');
  });

  it('makes claim retries idempotent for the owning tenant', () => {
    expect(intake).toContain("session.status === 'CLAIMED'");
    expect(intake).toContain('alreadyClaimed: true');
    expect(intake).toContain("session.tenantId === req.user!.tenantId");
  });

  it('deduplicates repeated upload scan submissions by intake session', () => {
    expect(scans).toContain('intake_session_id');
    expect(scans).toContain('existing: true');
    expect(scans).toContain('intakeJobId');
    expect(scans).toContain("source: 'upload'");
  });
});
