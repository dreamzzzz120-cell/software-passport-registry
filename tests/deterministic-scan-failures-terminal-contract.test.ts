import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A deterministic scan failure (no supported manifests, repository over the
// size limit, invalid SBOM) does not change on retry, so it is terminal on
// the first attempt. Three places must agree on that set: the OSV worker
// (repository_scan), the security scanner (repository_security_scan) and the
// queue-boundary trigger in migration 0100. Production on 2026-09-14 showed
// the OSV worker logging willRetry:true for these while the trigger made them
// terminal -- the log was lying about what happened. This pins all three.
const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const EXPECTED = ['SBOM_INVALID', 'SBOM_EMPTY', 'SBOM_MALFORMED', 'NO_SUPPORTED_MANIFESTS', 'REPOSITORY_TOO_LARGE', 'REPOSITORY_FILE_LIMIT_EXCEEDED', 'REPOSITORY_PATH_INVALID'];

function setFrom(source: string, file: string): string[] {
  const m = source.match(/DETERMINISTIC_TERMINAL_ERRORS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  expect(m, `${file} declares DETERMINISTIC_TERMINAL_ERRORS`).toBeTruthy();
  return [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
}

describe('deterministic scan failures are terminal everywhere', () => {
  const osv = read('src/workers/osv-worker.ts');
  const security = read('src/workers/security-scanner-worker.ts');
  const migration = read('migrations/0100_deterministic_scan_failures_terminal.sql');

  it('the OSV worker, the security scanner and migration 0100 name the same error codes', () => {
    const expected = [...EXPECTED].sort();
    expect(setFrom(osv, 'osv-worker')).toEqual(expected);
    expect(setFrom(security, 'security-scanner-worker')).toEqual(expected);
    const inMigration = [...migration.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
    expect(inMigration).toEqual(expected);
  });

  it('the OSV worker refuses to retry a deterministic failure and says so in its log line', () => {
    expect(osv).toContain('const terminal = DETERMINISTIC_TERMINAL_ERRORS.has(code);');
    expect(osv).toContain('const retry = !terminal && job.attempt_count < job.max_attempts;');
    // The structured failure event carries both flags so the log states the
    // real outcome rather than a retry that the queue will refuse.
    expect(osv).toMatch(/event: 'scan_job_failed'[\s\S]{0,400}willRetry: retry,\s*terminal,/);
  });

  it('the queue trigger converts a deterministic Pending retry into a terminal Failed row', () => {
    expect(migration).toContain("IF NEW.status = 'Pending'");
    expect(migration).toContain("NEW.status := 'Failed';");
    expect(migration).toContain('NEW.next_attempt_at := NULL;');
    expect(migration).toMatch(/CREATE TRIGGER agent_jobs_deterministic_scan_failure_terminal\s+BEFORE UPDATE OF status, error ON agent_jobs/);
  });
});
