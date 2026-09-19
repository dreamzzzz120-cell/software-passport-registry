import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { deleteWorkspaceRows, listTenantTables } from '../src/services/workspace-deletion.ts';
import type { Queryable } from '../src/scanners/scan-ledger.ts';

// Runs every migration against a real in-process Postgres, seeds two tenants
// across tables joined by real foreign keys (clients <- passports <- scans
// <- agent_jobs, evidence, findings, users, audit), deletes one tenant, and
// proves the other is untouched. No table list is hard-coded here either:
// the assertion walks every public table with a tenant_id column.

let pg: PGlite;
let db: Queryable;
const A = 'tenant-delete-me';
const B = 'tenant-keep-me';

async function seed(tenant: string, suffix: string) {
  await db.query(`INSERT INTO users (uid, email, tenant_id, role, onboarded) VALUES ($1, $2, $3, 'Owner', 1)`, [`uid_${suffix}`, `owner_${suffix}@example.test`, tenant]);
  // An append-only audit row: its trigger refuses DELETE outside a declared workspace deletion.
  await db.query(`INSERT INTO login_history (id, tenant_id, user_id, ip, user_agent, status) SELECT $1, $2, u.id, '127.0.0.1', 'test', 'Verified' FROM users u WHERE u.uid = $3`, [`lh_${suffix}`, tenant, `uid_${suffix}`]);
  await db.query(`INSERT INTO clients (id, tenant_id, name, domain, industry, trust_score, risk_level, avatar_color, subscription_tier, joined_date, team_count, passport_count, critical_risks_count, compliance_progress) VALUES ($1, $2, 'Client', 'c.example', 'Software', 0, 'Unknown', 'indigo', 'Standard', NOW(), 1, 0, 0, 0)`, [`client_${suffix}`, tenant]);
  await db.query(`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,verification_status,release_date,file_hash,license_type) VALUES ($1,$2,$3,'fixture','pending','x','Repository','unverified','2026-01-01','hash','Unknown')`, [`pass_${suffix}`, tenant, `client_${suffix}`]);
  await db.query(`INSERT INTO scans (id,tenant_id,target_name,scan_type,triggered_by,status,duration_ms,findings_count,timestamp,client_name,software_identity,source,source_ref,passport_id) VALUES ($1,$2,'fixture','Repository scan','uid','Queued',0,0,NOW(),'Client','fixture','github','o/r',$3)`, [`scan_${suffix}`, tenant, `pass_${suffix}`]);
  await db.query(`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,scan_id) VALUES ($1,$2,'repository-scanner',$3,'repository_scan','Pending',0,$4)`, [`job_${suffix}`, tenant, `pass_${suffix}`, `scan_${suffix}`]);
  await db.query(`INSERT INTO evidence_items (id,tenant_id,asset_id,name,type,verified,status,signer,timestamp,hash,engine_id,scan_id) VALUES ($1,$2,$3,'ev','Security Scan',0,'OBSERVED','test',NOW(),'sha256:x','osv-worker',$4)`, [`ev_${suffix}`, tenant, `pass_${suffix}`, `scan_${suffix}`]);
  await db.query(`INSERT INTO scan_findings (id,tenant_id,asset_id,job_id,scan_id,severity,category,title,description,status,detected_at,engine_id) VALUES ($1,$2,$3,$5,$4,'high','Secret','t','d','Open',NOW(),'e')`, [`f_${suffix}`, tenant, `pass_${suffix}`, `scan_${suffix}`, `job_${suffix}`]);
}

async function countRows(tenant: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of await listTenantTables(db)) {
    const r = await db.query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE tenant_id = $1`, [tenant]);
    if (Number(r.rows[0].n) > 0) out[table] = Number(r.rows[0].n);
  }
  return out;
}

beforeAll(async () => {
  pg = new PGlite();
  const dir = path.resolve(__dirname, '..', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
    try { await pg.exec(fs.readFileSync(path.join(dir, file), 'utf8')); }
    catch (error) { throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  db = { query: async (text, values) => { const result = await pg.query(text, values as any[]); return { rows: result.rows as any[], rowCount: result.affectedRows ?? null }; } };
  await seed(A, 'a');
  await seed(B, 'b');
}, 120_000);

afterAll(async () => { await pg?.close(); });

describe('append-only audit tables stay immutable outside a declared workspace deletion', () => {
  it('rejects a plain DELETE on login_history, and a delete declared for a different tenant', async () => {
    await db.query('BEGIN');
    await expect(db.query('DELETE FROM login_history WHERE tenant_id = $1', [A])).rejects.toThrow(/LOGIN_HISTORY_IMMUTABLE/);
    await db.query('ROLLBACK');
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.workspace_deletion', $1, true)", [B]);
    await expect(db.query('DELETE FROM login_history WHERE tenant_id = $1', [A])).rejects.toThrow(/LOGIN_HISTORY_IMMUTABLE/);
    await db.query('ROLLBACK');
    expect((await countRows(A)).login_history).toBe(1);
  });
});

describe('deleteWorkspaceRows on the real schema', () => {
  it('discovers the tenant tables from information_schema rather than a hard-coded list', async () => {
    const tables = await listTenantTables(db);
    expect(tables.length).toBeGreaterThan(50);
    for (const t of ['users', 'clients', 'passports', 'scans', 'agent_jobs', 'evidence_items', 'scan_findings']) expect(tables).toContain(t);
  });

  it('removes every row of the deleted tenant and none of the other tenant, inside the caller\'s transaction', async () => {
    const beforeA = await countRows(A);
    const beforeB = await countRows(B);
    expect(Object.keys(beforeA).length).toBeGreaterThanOrEqual(7);
    await db.query('BEGIN');
    const result = await deleteWorkspaceRows(db, A);
    await db.query('COMMIT');
    expect(await countRows(A)).toEqual({});
    expect(await countRows(B)).toEqual(beforeB);
    // Every seeded table with rows was reported, with the exact counts.
    for (const [table, n] of Object.entries(beforeA)) expect(result.deleted[table]).toBe(n);
    expect(result.passes).toBeGreaterThanOrEqual(1);
  });

  it('is all-or-nothing: a rolled-back transaction leaves the tenant intact', async () => {
    const before = await countRows(B);
    await db.query('BEGIN');
    await deleteWorkspaceRows(db, B);
    await db.query('ROLLBACK');
    expect(await countRows(B)).toEqual(before);
  });
});

describe('deleteWorkspaceRows with a pre-count from an RLS-bypassing connection', () => {
  it('refuses when fewer rows were deletable than exist (a policy hiding rows), and rolls back cleanly', async () => {
    const { countTenantRows, WorkspaceDeletionBlocked } = await import('../src/services/workspace-deletion.ts');
    const before = await countRows(B);
    const expected = await countTenantRows(db, B);
    expect(expected).toEqual(before);
    // Pretend the bypassing count saw one more passport than the deleting role can reach.
    const inflated = { ...expected, passports: (expected.passports ?? 0) + 1 };
    await db.query('BEGIN');
    await expect(deleteWorkspaceRows(db, B, inflated)).rejects.toBeInstanceOf(WorkspaceDeletionBlocked);
    await db.query('ROLLBACK');
    expect(await countRows(B)).toEqual(before);
  });

  it('succeeds when the pre-count matches what was deleted', async () => {
    const { countTenantRows } = await import('../src/services/workspace-deletion.ts');
    const expected = await countTenantRows(db, B);
    await db.query('BEGIN');
    const result = await deleteWorkspaceRows(db, B, expected);
    await db.query('COMMIT');
    expect(await countRows(B)).toEqual({});
    for (const [table, n] of Object.entries(expected)) expect(result.deleted[table]).toBe(n);
  });
});
