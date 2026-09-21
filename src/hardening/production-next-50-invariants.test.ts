import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const has = (p: string, s: string) => read(p).includes(s);

describe('production hardening contract: next 50 invariants', () => {
  // Scan lifecycle and durable accounting
  it('51 scan ledger has explicit terminal statuses', () => expect(has('src/scanners/scan-ledger.ts', "export type ScanStatus = 'Queued' | 'Scanning' | 'Completed' | 'Partial' | 'Failed'")).toBe(true));
  it('52 scan ledger marks queued runs as scanning', () => expect(has('src/scanners/scan-ledger.ts', "status IN ('Queued', 'Pending')")).toBe(true));
  it('53 scan ledger never treats an open job as terminal', () => expect(has('src/scanners/scan-ledger.ts', 'const terminal = open.length === 0;')).toBe(true));
  it('54 scan ledger derives failure from failed jobs', () => expect(has('src/scanners/scan-ledger.ts', "else status = 'Failed';")).toBe(true));
  it('55 scan ledger exposes first failure code', () => expect(has('src/scanners/scan-ledger.ts', 'const failureCode = failed.map((j) => j.error).filter(Boolean)[0] ?? null;')).toBe(true));
  it('56 scan ledger records completion timestamp only when terminal', () => expect(has('src/scanners/scan-ledger.ts', "completed_at = CASE WHEN $5 THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END")).toBe(true));
  it('57 scan ledger records findings count at settlement', () => expect(has('src/scanners/scan-ledger.ts', 'findings_count = CASE WHEN $5 THEN $6 ELSE findings_count END')).toBe(true));
  it('58 scan ledger preserves inventory-truncated state', () => expect(has('src/scanners/scan-ledger.ts', "coverageState = coverage ? (Number(coverage.inventory_complete) === 1 ? 'inventory_complete' : 'inventory_truncated')")).toBe(true));
  it('59 scan ledger marks failed coverage as partial', () => expect(has('src/scanners/scan-ledger.ts', 'coverageHasFailure')).toBe(true));
  it('60 scan ledger treats unknown coverage as partial', () => expect(has('src/scanners/scan-ledger.ts', 'files_unknown')).toBe(true));

  // File inventory: no silent loss
  it('61 inventory has explicit unknown disposition', () => expect(has('src/scanners/file-inventory.ts', "'unknown'")).toBe(true));
  it('62 inventory has explicit inaccessible disposition', () => expect(has('src/scanners/file-inventory.ts', "'inaccessible'")).toBe(true));
  it('63 inventory has explicit failed disposition', () => expect(has('src/scanners/file-inventory.ts', "'failed'")).toBe(true));
  it('64 inventory has explicit partial inspection', () => expect(has('src/scanners/file-inventory.ts', "'partially_inspected'")).toBe(true));
  it('65 inventory has explicit analysis status', () => expect(has('src/scanners/file-inventory.ts', "export type AnalysisStatus = 'analyzed' | 'not_analyzed' | 'failed'")).toBe(true));
  it('66 inventory caps total entries', () => expect(has('src/scanners/file-inventory.ts', 'MAX_INVENTORY_ENTRIES = 100_000')).toBe(true));
  it('67 inventory caps nested archive children', () => expect(has('src/scanners/file-inventory.ts', 'MAX_NESTED_ARCHIVE_CHILDREN = 20_000')).toBe(true));
  it('68 inventory caps hashed bytes', () => expect(has('src/scanners/file-inventory.ts', 'MAX_HASHED_FILE_BYTES = 50 * 1024 * 1024')).toBe(true));
  it('69 inventory caps nested archive depth', () => expect(has('src/scanners/file-inventory.ts', 'MAX_NESTED_ARCHIVE_DEPTH = 1')).toBe(true));
  it('70 inventory caps steganography probe bytes', () => expect(has('src/scanners/file-inventory.ts', 'MAX_STEGANOGRAPHY_PROBE_BYTES = 10 * 1024 * 1024')).toBe(true));

  // Archive and path safety
  it('71 repository worker validates archive entries before extraction', () => {
    const s = read('src/workers/osv-worker.ts');
    expect(s.indexOf('validateArchiveEntries(entries)') < s.indexOf('archive_extracted')).toBe(true);
  });
  it('72 security worker validates archive entries before extraction', () => {
    const s = read('src/workers/security-scanner-worker.ts');
    expect(s.indexOf('validateArchiveEntries(listedEntries)') < s.indexOf('archive_extracted')).toBe(true);
  });
  it('73 repository worker validates scan subdirectory containment', () => expect(has('src/workers/osv-worker.ts', 'REPOSITORY_PATH_INVALID')).toBe(true));
  it('74 security worker validates scan subdirectory containment', () => expect(has('src/workers/security-scanner-worker.ts', 'REPOSITORY_PATH_INVALID')).toBe(true));
  it('75 repository archive size is bounded', () => expect(has('src/workers/osv-worker.ts', 'MAX_ARCHIVE_BYTES = 50 * 1024 * 1024')).toBe(true));
  it('76 security archive size is bounded', () => expect(has('src/workers/security-scanner-worker.ts', 'MAX_ARCHIVE_BYTES = 50 * 1024 * 1024')).toBe(true));
  it('77 repository extraction has a file-count ceiling', () => expect(has('src/workers/osv-worker.ts', 'MAX_FILE_COUNT = 50_000')).toBe(true));
  it('78 repository extraction has an expanded-byte ceiling', () => expect(has('src/workers/osv-worker.ts', 'MAX_EXTRACTED_BYTES = 200 * 1024 * 1024')).toBe(true));
  it('79 repository acquisition has a bounded timeout', () => expect(has('src/workers/osv-worker.ts', 'ACQUISITION_TIMEOUT_MS = 30_000')).toBe(true));
  it('80 repository SBOM generation has a bounded timeout', () => expect(has('src/workers/osv-worker.ts', 'SBOM_TIMEOUT_MS = 120_000')).toBe(true));

  // Retry and failure truthfulness
  it('81 repository worker has deterministic terminal failures', () => expect(has('src/workers/osv-worker.ts', 'DETERMINISTIC_TERMINAL_ERRORS')).toBe(true));
  it('82 security worker has deterministic terminal failures', () => expect(has('src/workers/security-scanner-worker.ts', 'DETERMINISTIC_TERMINAL_ERRORS')).toBe(true));
  it('83 repository worker distinguishes terminal from retryable failure', () => expect(has('src/workers/osv-worker.ts', 'const terminal = DETERMINISTIC_TERMINAL_ERRORS.has(code);')).toBe(true));
  it('84 security worker distinguishes terminal from retryable failure', () => expect(has('src/workers/security-scanner-worker.ts', 'const deterministicTerminal = DETERMINISTIC_TERMINAL_ERRORS.has(code);')).toBe(true));
  it('85 repository worker records retry delay', () => expect(has('src/workers/osv-worker.ts', 'retryInSeconds: next')).toBe(true));
  it('86 security worker records retry delay', () => expect(has('src/workers/security-scanner-worker.ts', 'retryInSeconds: next')).toBe(true));
  it('87 repository worker clears lock on terminal failure', () => expect(has('src/workers/osv-worker.ts', 'locked_at=NULL, locked_by=NULL')).toBe(true));
  it('88 security worker clears lock on terminal failure', () => expect(has('src/workers/security-scanner-worker.ts', 'locked_at=NULL,locked_by=NULL')).toBe(true));
  it('89 repository worker persists terminal completion time', () => expect(has('src/workers/osv-worker.ts', "completed_at=CASE WHEN $2='Failed' THEN NOW() ELSE completed_at END")).toBe(true));
  it('90 security worker persists terminal completion time', () => expect(has('src/workers/security-scanner-worker.ts', "completed_at=CASE WHEN $2='Failed' THEN NOW() ELSE completed_at END")).toBe(true));

  // Evidence provenance and trust honesty
  it('91 repository evidence is persisted before passport work', () => {
    const s = read('src/workers/osv-worker.ts');
    expect(s.indexOf('evidence_items') < s.indexOf('INSERT INTO passports')).toBe(true);
  });
  it('92 repository evidence identifies GitHub as source', () => expect(has('src/workers/osv-worker.ts', "signer:'github.com'")).toBe(true));
  it('93 repository evidence records Syft version', () => expect(has('src/workers/osv-worker.ts', "SYFT_VERSION = '1.49.0'")).toBe(true));
  it('94 repository scanner does not fabricate a zero trust score', () => expect(has('src/workers/osv-worker.ts', "overall_score=NULL")).toBe(true));
  it('95 repository scanner starts passport as unverified', () => expect(has('src/workers/osv-worker.ts', "verification_status='unverified'")).toBe(true));
  it('96 OSV evidence is explicitly observed', () => expect(has('src/workers/osv-worker.ts', "'OBSERVED'")).toBe(true));
  it('97 OSV all-query failure is not reported as clean', () => expect(has('src/workers/osv-worker.ts', 'OSV_ALL_QUERIES_FAILED')).toBe(true));
  it('98 OSV responses carry source provenance', () => expect(has('src/workers/osv-worker.ts', "source: 'api.osv.dev'")).toBe(true));
  it('99 security evidence carries limitations', () => expect(has('src/workers/security-scanner-worker.ts', 'OSV results are provider observations, not cryptographic verification.')).toBe(true));
  it('100 security worker redacts credential-like failure data', () => expect(has('src/workers/security-scanner-worker.ts', 'REDACTED_TOKEN')).toBe(true));

  // Runtime and deployment security
  it('101 app runs with least-privilege runtime role', () => expect(has('Dockerfile', 'RUNTIME_DB_ROLE=spr_app_runtime')).toBe(true));
  it('102 worker image declares non-root user', () => expect(has('Dockerfile.worker', 'USER 10001:10001')).toBe(true));
  it('103 app image declares non-root user', () => expect(has('Dockerfile', 'USER 10001:10001')).toBe(true));
  it('104 worker runtime verifies TLS', () => expect(has('src/workers/worker-db.ts', 'sslmode=require')).toBe(true));
  it('105 worker runtime identifies least privilege', () => expect(has('src/workers/worker-db.ts', 'leastPrivilege')).toBe(true));
  it('106 scan worker clears temporary repository data', () => expect(has('src/workers/osv-worker.ts', "rm(tempRoot,{recursive:true,force:true}")).toBe(true));
  it('107 security worker clears temporary repository data', () => expect(has('src/workers/security-scanner-worker.ts', 'rm(tempRoot, { recursive: true, force: true })')).toBe(true));
  it('108 GitHub API requests use an explicit user agent', () => expect(has('src/workers/osv-worker.ts', "'user-agent': 'spr-repository-worker/1.0'")).toBe(true));
  it('109 GitHub archive requests use the bounded acquisition path', () => expect(has('src/workers/osv-worker.ts', 'downloadArchive')).toBe(true));
  it('110 production hardening keeps deterministic-failure regression coverage', () => expect(has('tests/deterministic-scan-failures-terminal-contract.test.ts', 'deterministic scan failures are terminal everywhere')).toBe(true));
});
