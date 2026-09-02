import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (r: string) => fs.readFileSync(path.join(root, r), 'utf8');
const worker = read('src/workers/security-scanner-worker.ts');

// Reproduced in production: a Free Review of octocat/Hello-World (default branch
// "master") failed with REPOSITORY_REF_NOT_FOUND, and the customer saw
// scanStatus "partial" with no evidence and no passport. The ref defaulted to
// the literal string 'main', so every repository not on 'main' was unscannable.
describe('repository scans resolve the real default branch', () => {
  it('prefers an explicit ref, then the repository default branch, before falling back', () => {
    expect(worker).toContain('metadata.default_branch');
    expect(worker).toContain("source.requested_ref || defaultBranch || 'main'");
    // The old unconditional fallback must not come back.
    expect(worker).not.toContain("source.requested_ref || 'main'");
  });

  it('reads the default branch from metadata already fetched, without an extra request', () => {
    const metadataIdx = worker.indexOf('const metadata: any = await metadataResponse.json()');
    const refIdx = worker.indexOf("source.requested_ref || defaultBranch || 'main'");
    expect(metadataIdx).toBeGreaterThan(-1);
    // The ref must be computed after metadata is available, not before it.
    expect(refIdx).toBeGreaterThan(metadataIdx);
    // Exactly two GitHub API calls: repository metadata, then the commit.
    expect([...worker.matchAll(/await fetch\(/g)]).toHaveLength(2);
  });

  it('still distinguishes a missing repository from a missing ref', () => {
    // These are different customer-facing situations and must not collapse.
    expect(worker).toContain("'REPOSITORY_NOT_FOUND'");
    expect(worker).toContain("'REPOSITORY_REF_NOT_FOUND'");
    expect(worker).toContain("'REPOSITORY_ACCESS_DENIED'");
  });

  it('keeps a failed scan diagnosable rather than silent', () => {
    // A scan that fails must say so in the logs; it previously wrote only to
    // agent_jobs.error, so production failures were invisible.
    expect(worker).toContain("event: 'security_scan_failed'");
    expect(worker).toContain('reason: safeFailureReason(code)');
  });

  it('never logs a credential-shaped failure reason', () => {
    expect(worker).toContain('function safeFailureReason');
    expect(worker).toContain('[REDACTED_TOKEN]');
  });
});
