import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { persistInventory, recomputeCoverage, settleScanRun, pinScanCommit, markScanRunRunning, linkFindingsToInventory, recordPassportAssociation, type Queryable } from '../src/scanners/scan-ledger.ts';
import { entriesFromListing, setOutcome, type InventoryEntry } from '../src/scanners/file-inventory.ts';

// Runs every migration in order against a real (in-process) Postgres, then
// exercises the ledger persistence with real SQL: the merge rules of the
// inventory upsert, coverage recomputation, commit pinning and run settlement.
// These are the statements the workers execute in production; nothing here is
// mocked.

let pg: PGlite;
let db: Queryable;
const TENANT = 'tenant-test';

beforeAll(async () => {
  pg = new PGlite();
  const dir = path.resolve(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    try { await pg.exec(sql); }
    catch (error) { throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  db = { query: async (text, values) => { const result = await pg.query(text, values as any[]); return { rows: result.rows as any[], rowCount: result.affectedRows ?? null }; } };
  await db.query(`INSERT INTO passports (id,tenant_id,name,version,publisher,category,verification_status,release_date,file_hash,license_type) VALUES ('pass_1',$1,'fixture','pending','x','Repository','unverified','2026-01-01','pending','Unknown')`, [TENANT]);
  await db.query(`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,software_identity,source,source_ref,job_id,worker_job_id,passport_id,client_id) VALUES ('scan_1',$1,'fixture','Repository scan','tester','Queued',0,NULL,'2026-01-01T00:00:00Z','Unassigned','o/r','github','o/r@default','job_a','job_b','pass_1',NULL)`, [TENANT]);
  await db.query(`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,scan_id) VALUES ('job_a',$1,'repository-scanner','pass_1','repository_scan','Pending',0,'scan_1'),('job_b',$1,'security-scanner','pass_1','repository_security_scan','Pending',0,'scan_1')`, [TENANT]);
}, 120_000);

afterAll(async () => { await pg?.close(); });

describe('migration 0104 on a real Postgres', () => {
  it('created the ledger tables with RLS enabled and forced', async () => {
    const rows = (await db.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('scan_file_inventory','scan_coverage','intake_scan_sources') ORDER BY relname`)).rows;
    expect(rows.map((r: any) => r.relname)).toEqual(['intake_scan_sources', 'scan_coverage', 'scan_file_inventory']);
    for (const row of rows) { expect(row.relrowsecurity).toBe(true); expect(row.relforcerowsecurity).toBe(true); }
    const policies = (await db.query(`SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('scan_file_inventory','scan_coverage','intake_scan_sources') ORDER BY tablename, policyname`)).rows;
    expect(policies.filter((p: any) => p.policyname === 'spr_tenant_isolation').length).toBe(3);
  });
  it('rejects a disposition outside the vocabulary', async () => {
    await expect(db.query(`INSERT INTO scan_file_inventory (id,tenant_id,scan_id,passport_id,sequence,path,filename,source,disposition) VALUES ('bad',$1,'scan_1','pass_1',999,'x','x','github-archive','maybe')`, [TENANT])).rejects.toThrow();
  });
});

function fixtureEntries(): InventoryEntry[] {
  const { entries } = entriesFromListing(['r/', 'r/package.json', 'r/src/a.ts', 'r/logo.png', 'r/dup.md', 'r/dup.md'], { source: 'github-archive', stripSegments: 1 });
  for (const e of entries) { e.size = 10; e.sha256 = 'a'.repeat(64); e.disposition = 'inventoried'; }
  return entries;
}

describe('inventory persistence merges engine contributions idempotently', () => {
  it('first job: manifests inventoried, catalogued file analyzed, png unsupported; retrying the same write changes nothing', async () => {
    const ctx = { tenantId: TENANT, scanId: 'scan_1', passportId: 'pass_1', clientId: null };
    const entries = fixtureEntries();
    setOutcome(entries[0], { disposition: 'analyzed', analysisStatus: 'analyzed', inspectionStatus: 'inspected', inspectionLevel: 'catalog', tool: { name: 'syft', version: '1.49.0', action: 'catalog' } });
    entries[0].relatedComponents.push('lodash@4.17.21');
    setOutcome(entries[2], { disposition: 'unsupported', reasonCode: 'NOT_A_CONTENT_INSPECTED_TYPE' });
    entries[1].reasonCode = 'CONTENT_NOT_INSPECTED_BY_THIS_JOB';
    await persistInventory(db, ctx, entries);
    await persistInventory(db, ctx, entries);
    const rows = (await db.query(`SELECT sequence, path, disposition, inspection_status, analysis_status, tools, related_components FROM scan_file_inventory WHERE scan_id='scan_1' ORDER BY sequence`)).rows;
    expect(rows.length).toBe(5);
    expect(rows.filter((r: any) => r.path === 'dup.md').length).toBe(2);
    expect(rows[0]).toMatchObject({ path: 'package.json', disposition: 'analyzed', analysis_status: 'analyzed' });
    expect(rows[0].tools).toEqual([{ name: 'syft', version: '1.49.0', action: 'catalog' }]);
    expect(rows[0].related_components).toEqual(['lodash@4.17.21']);
    expect(rows[1]).toMatchObject({ path: 'src/a.ts', disposition: 'inventoried', inspection_status: 'not_inspected' });
    expect(rows[2]).toMatchObject({ path: 'logo.png', disposition: 'unsupported' });
    const coverage = await recomputeCoverage(db, ctx, { inventoryComplete: true, limitations: [] });
    expect(coverage).toMatchObject({ filesDiscovered: 5, filesAccountedFor: 5, filesAnalyzed: 1, filesUnsupported: 1, filesInspected: 1, inspectionApplicable: 4 });
    expect(coverage.accountingCoveragePct).toBe(100);
    expect(coverage.inspectionCoveragePct).toBe(25);
  });

  it('second job: content inspection merges in without erasing the first job, failures stay visible, findings link to files', async () => {
    const ctx = { tenantId: TENANT, scanId: 'scan_1', passportId: 'pass_1', clientId: null };
    const entries = fixtureEntries();
    const tool = { name: 'spr-secret-scanner-v1', version: '1', action: 'content' };
    setOutcome(entries[0], { disposition: 'inspected', inspectionStatus: 'inspected', inspectionLevel: 'content', tool });
    setOutcome(entries[1], { disposition: 'inspected', inspectionStatus: 'inspected', inspectionLevel: 'content', tool });
    setOutcome(entries[2], { disposition: 'unsupported', reasonCode: 'NOT_A_CONTENT_INSPECTED_TYPE', tool });
    setOutcome(entries[3], { disposition: 'failed', inspectionStatus: 'failed', reasonCode: 'READ_FAILED', tool });
    setOutcome(entries[4], { disposition: 'inspected', inspectionStatus: 'inspected', inspectionLevel: 'content', tool });
    await persistInventory(db, ctx, entries);
    await db.query(`INSERT INTO scan_findings (id,tenant_id,asset_id,job_id,severity,category,title,description,component,status,detected_at,engine_id,file_path,scan_id) VALUES ('finding-1',$1,'pass_1','job_b','high','Secret','x','y',NULL,'Open','2026-01-01','spr-secret-scanner-v1','src/a.ts','scan_1')`, [TENANT]);
    await linkFindingsToInventory(db, ctx, [{ id: 'finding-1', filePath: 'src/a.ts' }]);
    const rows = (await db.query(`SELECT sequence, path, disposition, inspection_status, analysis_status, inspection_level, tools, reason_code, related_finding_ids, notes FROM scan_file_inventory WHERE scan_id='scan_1' ORDER BY sequence`)).rows;
    // package.json keeps 'analyzed' (higher rank) and gains the content tool + level.
    expect(rows[0]).toMatchObject({ disposition: 'analyzed', analysis_status: 'analyzed', inspection_status: 'inspected' });
    expect(rows[0].inspection_level).toBe('catalog+content');
    expect((rows[0].tools as any[]).map((t) => t.name).sort()).toEqual(['spr-secret-scanner-v1', 'syft']);
    expect(rows[1]).toMatchObject({ disposition: 'inspected', inspection_status: 'inspected', related_finding_ids: ['finding-1'] });
    expect(rows[3]).toMatchObject({ path: 'dup.md', disposition: 'failed', inspection_status: 'failed', reason_code: 'READ_FAILED' });
    expect(rows[4]).toMatchObject({ path: 'dup.md', disposition: 'inspected' });
    const coverage = await recomputeCoverage(db, ctx, { inventoryComplete: true, limitations: [] });
    expect(coverage).toMatchObject({ filesDiscovered: 5, filesInspected: 3, filesFailed: 1, filesUnsupported: 1, filesWithFindings: 1, filesWithoutFindings: 4 });
    expect(coverage.inspectionCoveragePct).toBe(75);
    const stored = (await db.query(`SELECT files_discovered, inspection_coverage_pct, inventory_complete FROM scan_coverage WHERE scan_id='scan_1'`)).rows[0];
    expect(Number(stored.files_discovered)).toBe(5);
    expect(Number(stored.inspection_coverage_pct)).toBe(75);
    expect(Number(stored.inventory_complete)).toBe(1);
  });

  it('an upsert for a different path at the same sequence is refused rather than silently rewriting the row', async () => {
    const ctx = { tenantId: TENANT, scanId: 'scan_1', passportId: 'pass_1', clientId: null };
    const { entries } = entriesFromListing(['r/', 'r/ANOTHER.json'], { source: 'github-archive', stripSegments: 1 });
    entries[0].disposition = 'analyzed';
    await persistInventory(db, ctx, entries);
    const row = (await db.query(`SELECT path, disposition FROM scan_file_inventory WHERE scan_id='scan_1' AND sequence=0`)).rows[0];
    expect(row.path).toBe('package.json');
  });
});

describe('scan run lifecycle', () => {
  it('pins the first commit and keeps it for the second job', async () => {
    expect(await pinScanCommit(db, TENANT, 'scan_1', 'A'.repeat(40))).toBe('a'.repeat(40));
    expect(await pinScanCommit(db, TENANT, 'scan_1', 'b'.repeat(40))).toBe('a'.repeat(40));
  });
  it('derives the run status from its jobs and completes the customer-facing scans row', async () => {
    await markScanRunRunning(db, TENANT, 'scan_1');
    expect((await db.query(`SELECT status, started_at FROM scans WHERE id='scan_1'`)).rows[0]).toMatchObject({ status: 'Scanning' });
    expect(await settleScanRun(db, TENANT, 'scan_1')).toBe('Queued');
    await db.query(`UPDATE agent_jobs SET status='Completed', attempt_count=1 WHERE id='job_a'`);
    expect(await settleScanRun(db, TENANT, 'scan_1')).toBe('Scanning');
    expect((await db.query(`SELECT status FROM scans WHERE id='scan_1'`)).rows[0].status).toBe('Scanning');
    await db.query(`UPDATE agent_jobs SET status='Failed', error='SBOM_EMPTY' WHERE id='job_b'`);
    expect(await settleScanRun(db, TENANT, 'scan_1')).toBe('Partial');
    const scan = (await db.query(`SELECT status, error_code, error_state, completed_at, findings_count, coverage_state, duration_ms FROM scans WHERE id='scan_1'`)).rows[0];
    expect(scan.status).toBe('Partial');
    expect(scan.error_code).toBe('SBOM_EMPTY');
    expect(scan.error_state).toBe('job_failed');
    expect(scan.completed_at).not.toBeNull();
    expect(Number(scan.findings_count)).toBe(1);
    expect(scan.coverage_state).toBe('inventory_complete');
    expect(Number(scan.duration_ms)).toBeGreaterThanOrEqual(0);
    await db.query(`UPDATE agent_jobs SET status='Completed', error=NULL WHERE id='job_b'`);
    // Both jobs are complete, but the durable inventory still contains a real
    // failed file, so the customer-facing run remains Partial.
    expect(await settleScanRun(db, TENANT, 'scan_1')).toBe('Partial');
    expect((await db.query(`SELECT status, error_code FROM scans WHERE id='scan_1'`)).rows[0]).toMatchObject({ status: 'Partial', error_code: null });
  });
  it('records a passport association failure on the run without touching the scan', async () => {
    await recordPassportAssociation(db, TENANT, 'scan_1', { ok: false, failure: 'permission denied for table passports' });
    const run = (await db.query(`SELECT status, passport_status, passport_failure FROM scans WHERE id='scan_1'`)).rows[0];
    expect(run.status).toBe('Partial');
    expect(run.passport_status).toBe('failed');
    expect(run.passport_failure).toBe('permission denied for table passports');
    expect(Number((await db.query(`SELECT COUNT(*)::int AS c FROM scan_file_inventory WHERE scan_id='scan_1'`)).rows[0].c)).toBe(5);
    await recordPassportAssociation(db, TENANT, 'scan_1', { ok: true });
    expect((await db.query(`SELECT passport_status FROM scans WHERE id='scan_1'`)).rows[0].passport_status).toBe('associated');
  });
  it('the deterministic-failure trigger still applies to ledger jobs', async () => {
    await db.query(`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,scan_id) VALUES ('job_c',$1,'repository-scanner','pass_1','repository_scan','Running',0,'scan_1')`, [TENANT]);
    await db.query(`UPDATE agent_jobs SET status='Pending', error='NO_SUPPORTED_MANIFESTS' WHERE id='job_c'`);
    expect((await db.query(`SELECT status FROM agent_jobs WHERE id='job_c'`)).rows[0].status).toBe('Failed');
  });
});
