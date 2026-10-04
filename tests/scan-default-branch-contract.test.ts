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
  it('prefers an explicit ref, then the observed repository default branch, before any literal fallback', () => {
    expect(worker).toContain('metadata.default_branch');
    expect(worker).toContain('gitFallback?.defaultBranch');
    expect(worker).toContain("source.requested_ref || defaultBranch || 'main'");
    // The old unconditional fallback must not come back.
    expect(worker).not.toContain("source.requested_ref || 'main'");
  });

  it('uses fetched metadata when available and a Git-observed default branch only when the API is rate limited', () => {
    const metadataParseIdx = worker.indexOf('metadata = await metadataResponse.json()');
    const defaultBranchIdx = worker.indexOf('const defaultBranch = ');
    expect(metadataParseIdx).toBeGreaterThan(-1);
    expect(defaultBranchIdx).toBeGreaterThan(metadataParseIdx);

    expect(worker).toContain('if (isRateLimited(metadataResponse))');
    expect(worker).toContain('resolvePublicGitHubRefViaGit');
    expect(worker).toContain("event: 'github_api_rate_limit_fallback'");
    // Normal acquisition still uses the two REST observations (metadata and
    // commit); the fallback is a separate Git protocol path, not a guessed ref.
    expect([...worker.matchAll(/await fetchGitHubApi\(/g)]).toHaveLength(2);
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

// The worker fallback alone was not enough: Free Review stored the literal
// string 'main' as requested_ref, so `source.requested_ref || defaultBranch`
// always short-circuited on 'main' and the repository's real default branch was
// never consulted. Both halves are required for a master-default repo to scan.
describe('Free Review does not pin every scan to "main"', () => {
  const route = read('src/routes/free-review-legacy.ts');

  it('does not default the requested ref, so the worker can resolve it', () => {
    expect(route).not.toContain("ref: z.string().min(1).max(200).default('main')");
    expect(route).toContain('ref: z.string().min(1).max(200).optional()');
  });

  it('stores null rather than a guessed branch name', () => {
    expect(route).toContain('const requestedRef = ref ?? null;');
    expect(route).toContain('ref: requestedRef');
    const submit = read('src/routes/free-review-submit.ts');
    expect(submit).toContain('const requestedRef = input.ref ?? null;');
    expect(submit).toContain('ref: requestedRef');
    // The raw optional value must never reach the insert, which now lives in
    // the shared scan-ledger enqueue and binds exactly what it was given.
    const submission = read('src/scanners/scan-submission.ts');
    expect(submission).toContain('${input.ref}');
    expect(submission).not.toContain("'main'");
  });

  it('still lets a caller pin an explicit ref', () => {
    expect(route).toMatch(/ref: z\.string\(\)\.min\(1\)\.max\(200\)\.optional\(\)/);
  });
});
