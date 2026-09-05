import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';

// Real production regression test. It runs against the restricted runtime
// connection when APP_DATABASE_URL is configured; otherwise the live DB cases
// are skipped rather than pretending local unit tests prove RLS behavior.
const appDatabaseUrl = process.env.APP_DATABASE_URL;
const describeIfConfigured = appDatabaseUrl ? describe : describe.skip;

describeIfConfigured('spr_app_runtime cannot bypass Row-Level Security', () => {
  let pool: Pool;
  const TENANT_A = `rls-regression-tenant-A-${Date.now()}`;
  const TENANT_B = `rls-regression-tenant-B-${Date.now()}`;
  const TEST_CLIENT_ID = `rls-regression-client-${Date.now()}`;

  async function asTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(() => {
    const url = new URL(appDatabaseUrl!);
    pool = new Pool({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.replace(/^\//, ''), user: url.username, password: url.password, ssl: false });
  });

  afterAll(async () => {
    await asTenant(TENANT_A, (c) => c.query('DELETE FROM clients WHERE id = $1', [TEST_CLIENT_ID])).catch(() => undefined);
    await pool.end();
  });

  it('connects as the restricted role, not the table owner', async () => {
    const client = await pool.connect();
    try {
      const identity = await client.query('SELECT current_user');
      const bypass = await client.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(identity.rows[0].current_user).toBe('spr_app_runtime');
      expect(bypass.rows[0].rolbypassrls).toBe(false);
    } finally {
      client.release();
    }
  });

  it('a row created under one tenant is invisible to another tenant', async () => {
    await asTenant(TENANT_A, (c) => c.query(`
      INSERT INTO clients (id, tenant_id, name, domain, industry, trust_score, risk_level, avatar_color, subscription_tier, joined_date, team_count, passport_count, critical_risks_count, compliance_progress, software_inventory, compliance_status, team_members, activity_timeline)
      VALUES ($1, $2, 'RLS Regression Test', 'test.example', 'Test', 0, 'Low', '#000000', 'Standard', now()::text, 0, 0, 0, 0, '[]', '[]', '[]', '[]')
    `, [TEST_CLIENT_ID, TENANT_A]));

    const ownTenant = await asTenant(TENANT_A, (c) => c.query('SELECT id FROM clients WHERE id = $1', [TEST_CLIENT_ID]));
    expect(ownTenant.rows).toHaveLength(1);

    const otherTenant = await asTenant(TENANT_B, (c) => c.query('SELECT id FROM clients WHERE id = $1', [TEST_CLIENT_ID]));
    expect(otherTenant.rows).toHaveLength(0);
  });

  it('cross-tenant UPDATE and DELETE affect zero rows, not the target row', async () => {
    const update = await asTenant(TENANT_B, (c) => c.query("UPDATE clients SET name = 'HACKED' WHERE id = $1", [TEST_CLIENT_ID]));
    expect(update.rowCount).toBe(0);

    const remove = await asTenant(TENANT_B, (c) => c.query('DELETE FROM clients WHERE id = $1', [TEST_CLIENT_ID]));
    expect(remove.rowCount).toBe(0);

    const stillIntact = await asTenant(TENANT_A, (c) => c.query('SELECT name FROM clients WHERE id = $1', [TEST_CLIENT_ID]));
    expect(stillIntact.rows[0]?.name).toBe('RLS Regression Test');
  });

  it('rejects an INSERT that forges another tenant\'s tenant_id', async () => {
    await expect(
      asTenant(TENANT_B, (c) => c.query(`
        INSERT INTO clients (id, tenant_id, name, domain, industry, trust_score, risk_level, avatar_color, subscription_tier, joined_date, team_count, passport_count, critical_risks_count, compliance_progress, software_inventory, compliance_status, team_members, activity_timeline)
        VALUES ($1, $2, 'Forged tenant', 'test.example', 'Test', 0, 'Low', '#000000', 'Standard', now()::text, 0, 0, 0, 0, '[]', '[]', '[]', '[]')
      `, [`${TEST_CLIENT_ID}-forged`, TENANT_A]))
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('readiness keeps asserting the tenant RLS invariant', () => {
  const read = (relativePath: string) =>
    readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

  it('runs spr_assert_tenant_rls() and fails readiness unless the least-privileged runtime role is active', () => {
    const server = read('server.ts');
    expect(server).toContain('SELECT spr_assert_tenant_rls()');
    expect(server).toContain("const leastPrivilege = runtimeRole === 'spr_app_runtime';");
    expect(server).toContain('const ready = database.ok && rls === true && leastPrivilege;');
    expect(server).toContain('tenantRls: { ok: rls }');
    expect(server).not.toMatch(/const ready = database\.ok && rls;/);
  });

  it('ships a migration that forces RLS, so the assertion is satisfiable rather than aspirational', () => {
    const migration = read('migrations/0054_force_tenant_rls.sql');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('SELECT spr_assert_tenant_rls()');
  });
});
