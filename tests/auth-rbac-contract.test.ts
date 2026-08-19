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
});
