import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';

// Real production incident, found and fixed via live behavioral testing:
// APP_DATABASE_URL was never configured, so the app's real per-request
// connection (attachTenantScope, src/middleware/tenant-scope.ts) fell back
// to the table-owner connection -- and Postgres bypasses Row-Level Security
// entirely for table owners. The spr_tenant_isolation policies existed on
// every tenant-scoped table but provided zero actual protection; the only
// thing preventing cross-tenant access was every route's own WHERE tenant_id
// filter, with no structural backstop. This test proves the restricted
// runtime role genuinely cannot bypass RLS, using the exact mechanism
// attachTenantScope uses (set_config('app.tenant_id', ..., true) inside a
// transaction), against real tables, with real cross-tenant attack attempts
// -- not just inspecting that a policy definition exists.
//
// Skipped when APP_DATABASE_URL isn't configured (e.g. local dev without a
// provisioned spr_app_runtime role) rather than failing -- this is a live
// database behavioral test, not a pure unit test.
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

// The readiness probe is the only signal an operator gets that tenant
// isolation still holds in the database this process is actually connected to,
// and it has been reporting {"tenantRls":{"ok":false}} in production since
// migration 0053 introduced spr_assert_tenant_rls(): RLS was ENABLED on every
// tenant table by 0020/0021/0041/0042/0048 but never FORCED, so the assertion
// could not pass. The tempting "fix" is to delete the assertion from /ready.
// These file-level assertions exist so that stays a deliberate act rather than
// a silent one, and they hold whether or not a database is reachable here.
describe('readiness keeps asserting the tenant RLS invariant', () => {
  const read = (relativePath: string) =>
    readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

  it('runs spr_assert_tenant_rls() in the readiness handler and fails readiness when it throws', () => {
    const server = read('server.ts');
    expect(server).toContain('SELECT spr_assert_tenant_rls()');
    // The readiness gate was tightened from `database.ok && rls` to
    // `database.ok && rls === true`, because rls is now tri-state: it starts
    // null so that an unreachable database reports {"tenantRls":{"ok":null}}
    // -- "not checked" -- instead of claiming a passing assertion that never
    // ran. Requiring an explicit true keeps null and false both un-ready, so
    // this is strictly stronger than the expression it replaces.
    expect(server).toContain('const ready = database.ok && rls === true;');
    expect(server).toContain('tenantRls: { ok: rls }');
    // null must never be able to satisfy readiness.
    expect(server).not.toMatch(/const ready = database\.ok && rls;/);
  });

  it('ships a migration that forces RLS, so the assertion is satisfiable rather than aspirational', () => {
    const migration = read('migrations/0054_force_tenant_rls.sql');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    // The migration asserts the invariant itself, so a deploy fails at the
    // migration step rather than booting into a permanently un-ready service.
    expect(migration).toContain('SELECT spr_assert_tenant_rls()');
  });
});
