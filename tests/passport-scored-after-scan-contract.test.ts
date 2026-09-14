import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Production 2026-09-14: every repository-scanned passport, including the
// founder's own, stayed verification_status='unverified' with NULL scores no
// matter how much evidence the scan persisted (axios/axios: 960 evidence
// items, 841 findings, still 'unverified'). The canonical scorer was only
// invoked from the manual SLSA attestation upload route. These pins keep the
// scan -> score link in place and keep the scorer honest about what it counts.
const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('a passport is re-scored when its scans complete', () => {
  const osv = read('src/workers/osv-worker.ts');
  const security = read('src/workers/security-scanner-worker.ts');
  const scanner = read('src/utils/scanner.ts');

  it('the repository-scan worker scores the passport after persisting findings, under its own pool', () => {
    expect(osv).toContain("mark('findings_hash_persisted');\n    await scorePassportAfterScan(pool, job, mark);");
    expect(osv).toContain('calculateAndStoreTrustScore(job.passport_id, job.tenant_id, { pool })');
    expect(osv).toContain("mark('trust_scored'");
    expect(osv).toContain("event: 'passport_score_failed'");
  });

  it('the security-scan worker scores the passport on completion, under its own pool', () => {
    expect(security).toContain('calculateAndStoreTrustScore(job.passport_id, job.tenant_id, { pool })');
    expect(security).toContain("event: 'passport_scored'");
    expect(security).toContain("event: 'passport_score_failed'");
  });

  it('the scorer runs on the caller-supplied pool and audits through the pool writer (same hash chain)', () => {
    expect(scanner).toContain('const database = executor.pool ? drizzle(executor.pool, { schema }) : db;');
    expect(scanner).toContain("if (executor.pool) await appendAuditEntryViaPool(executor.pool, { tenantId, action: 'TRUST_SCORE_CALCULATED'");
    expect(scanner).toMatch(/calculateAndPersistPassportScore\(tenantId, assetId, \{[\s\S]*?\}, database\);/);
  });

  it('every finding category the scanners write is counted by the scorer', () => {
    // Categories written to scan_findings by src/workers/osv-worker.ts and
    // src/scanners/real-repository-scanners.ts. An unmapped category is a
    // finding the score silently ignores.
    for (const category of ['Vulnerability', 'Secret', 'Configuration', 'License']) {
      expect(scanner, category).toContain(`f.category === '${category}'`);
    }
    expect(scanner).toMatch(/f\.category === 'Secret'[^\n]*\n[\s\S]{0,400}category: 'security'/);
    expect(scanner).toMatch(/f\.category === 'License'\) \{\n\s*canonicalFindings\.push\(\{ severity, category: 'compliance'/);
  });

  it('the scorer reports verification status and completeness so the worker can log what was observed', () => {
    expect(scanner).toContain('verificationStatus: result.verificationStatus,');
    expect(scanner).toContain('evidenceCompleteness: result.evidenceCompleteness,');
  });
});
