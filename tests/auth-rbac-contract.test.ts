import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR authentication/RBAC/database release contracts', () => {
  it('requires Firebase revocation-aware authentication and a provisioned tenant-scoped DB identity', () => {
    const security = read('src/middleware/security.ts');
    expect(security).toContain('verifyIdToken(token, true)');
    expect(security).toContain('eq(users.uid, uid)');
    expect(security).toContain('dbUser.tenantId');
    expect(security).toContain('dbUser.role');
    expect(security).toContain('User identity does not match the provisioned account');
  });

  it('does not permit implicit tenant or role defaults in the authoritative migration', () => {
    const migration = read('migrations/0011_auth_rbac_integrity.sql');
    expect(migration).toContain('ALTER TABLE users ALTER COLUMN tenant_id DROP DEFAULT');
    expect(migration).toContain('ALTER TABLE users ALTER COLUMN role DROP DEFAULT');
    expect(migration).toContain("users_role_ck CHECK (role IN ('Owner','Admin','Technician','Viewer','Client'))");
    expect(migration).toContain("tenant_id <> 'tenant-default'");
    expect(migration).toContain('users_tenant_email_unique_idx');
  });

  it('enforces tenant-scoped composite foreign keys for the trust graph', () => {
    const migration = read('migrations/0012_tenant_composite_integrity.sql');
    expect(migration).toContain('FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id)');
    expect(migration).toContain('FOREIGN KEY (tenant_id, passport_id) REFERENCES passports(tenant_id, id)');
    expect(migration).toContain('FOREIGN KEY (tenant_id, webhook_id) REFERENCES spr_webhooks(tenant_id, id)');
    expect(migration).toContain('clients_tenant_id_unique');
    expect(migration).toContain('trust_observations_tenant_id_unique');
  });

  it('keeps migration execution serialized and transactional', () => {
    const runner = read('scripts/migrate.ts');
    expect(runner).toContain('pg_advisory_lock');
    expect(runner).toContain('BEGIN');
    expect(runner).toContain('COMMIT');
    expect(runner).toContain('ROLLBACK');
    expect(runner).toContain('ON CONFLICT (version) DO NOTHING');
  });

  it('keeps API-key management tenant-scoped and role-gated', () => {
    const connect = read('src/routes/connect.ts');
    expect(connect).toContain("requireRole(['Owner', 'Admin'])");
    expect(connect).toContain('tenant_id = ${req.user!.tenantId}');
    expect(connect).toContain('tenant_id = ${api.tenantId}');
    expect(connect).toContain('hash(raw)');
  });

  it('keeps owner-only founder/self-passport routes server-authorized', () => {
    const auth = read('src/routes/auth.ts');
    const founder = read('src/routes/founder-command-center.ts');
    expect(founder).toContain("router.get('/founder/overview', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder");
    expect(auth).toContain("requireRole('Owner')");
    expect(auth).toContain("router.get('/passports/self-passport'");
    expect(auth).toContain('requireFounder');
    // healthStatus is derived from the same three real checks /ready uses
    // (database, tenant RLS, least-privilege runtime role) -- never a
    // hardcoded literal, and never fabricated as "Healthy" without evidence.
    expect(auth).toContain("database.ok && rlsOk === true && leastPrivilege ? 'Healthy' : 'Not verified'");
    expect(auth).toContain('overallScore: null');
  });
});


describe('asynchronous tenant-boundary contracts', () => {
  it('report schedules never trust a caller-supplied tenant and bind foreign passport ids to the authenticated tenant', () => {
    const source = read('src/routes/report-schedules.ts');
    expect(source).toContain('tenant=req.user!.tenantId');
    expect(source).toContain('SELECT id FROM passports WHERE id=${p.data.passportId} AND tenant_id=${tenant}');
    expect(source).toContain('WHERE id=${req.params.id} AND tenant_id=${req.user!.tenantId}');
    expect(source).not.toMatch(/req\.(body|query|params)\.tenantId/);
  });

  it('PSA webhooks resolve and mutate findings inside the signed endpoint tenant only', () => {
    const source = read('src/routes/psa-webhooks.ts');
    expect(source).toContain('const scoped = await attachTenantScope(tenantId, res)');
    expect(source).toContain('WHERE tenant_id = ${tenantId} AND provider = ${provider}');
    expect(source).toContain('WHERE tenant_id = ${tenantId} AND psa_ticket_id = ${event.ticketId}');
    expect(source).toContain('WHERE tenant_id = ${tenantId} AND id = ${finding.id}');
    expect(source).not.toMatch(/findingId\s*=\s*event/i);
  });

  it('report schedule mutation remains Owner/Admin only', () => {
    const source = read('src/routes/report-schedules.ts');
    expect(source).toContain("const roles = ['Owner', 'Admin']");
    expect(source).toContain("router.post('/', requireRole(roles)");
    expect(source).toContain("router.patch('/:id', requireRole(roles)");
    expect(source).toContain("router.delete('/:id', requireRole(roles)");
  });
});


describe('persisted-role authorization invariants', () => {
  it('re-reads tenant and role from the database on every authenticated request instead of trusting token role claims', () => {
    const security = read('src/middleware/security.ts');
    expect(security).toContain('const dbUser = await db.select().from(users).where(eq(users.uid, uid))');
    expect(security).toContain('tenantId: dbUser.tenantId');
    expect(security).toContain('role: dbUser.role');
    expect(security).not.toMatch(/role:\s*decodedToken\./);
    expect(security).not.toMatch(/tenantId:\s*decodedToken\./);
  });

  it('checks Firebase revocation status on every authenticated request', () => {
    const security = read('src/middleware/security.ts');
    expect(security).toContain('adminAuth.verifyIdToken(token, true)');
    expect(security).toContain("code === 'auth/id-token-revoked'");
    expect(security).toContain("code: 'SESSION_REVOKED'");
  });
});
