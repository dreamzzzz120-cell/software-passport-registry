import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR team administration and audit log contracts', () => {
  it('exposes onboarded status so pending invitations are distinguishable from active members', () => {
    const auth = read('src/routes/auth.ts');
    expect(auth).toContain("router.get('/organization/team'");
    expect(auth).toContain('SELECT id, email, display_name AS "displayName", role, onboarded, created_at AS "createdAt"');
  });

  it('scopes session and login-history reads to the requesting tenant and user', () => {
    const auth = read('src/routes/auth.ts');
    expect(auth).toContain("router.get('/auth/sessions'");
    expect(auth).toContain('tenant_id = ${req.user!.tenantId} AND user_id = ${req.user!.id} AND revoked_at IS NULL');
    expect(auth).toContain("router.get('/auth/login-history'");
    expect(auth).toContain('FROM login_history WHERE tenant_id = ${req.user!.tenantId} AND user_id = ${req.user!.id}');
  });

  it('never allows a session to revoke itself through the API', () => {
    const auth = read('src/routes/auth.ts');
    expect(auth).toContain("router.post('/auth/sessions/revoke'");
    expect(auth).toContain('Cannot revoke the session you are currently using');
  });

  it('paginates the audit chain with a tenant-scoped cursor rather than an unbounded offset', () => {
    const auth = read('src/routes/auth.ts');
    expect(auth).toContain("router.get('/auth/audit-chain'");
    expect(auth).toContain('AND id < ${before}');
    expect(auth).toContain('tenant_id = ${req.user!.tenantId} AND id < ${before}');
  });

  it('keeps the permission matrix and CSV export sourced from real data, not fabricated rows', () => {
    const teamView = read('src/components/TeamView.tsx');
    expect(teamView).toContain('PERMISSION_MATRIX');
    expect(teamView).toContain("apiFetch('/api/auth/sessions')");
    expect(teamView).toContain("apiFetch('/api/auth/login-history')");
    const auditView = read('src/components/AuditLogView.tsx');
    expect(auditView).toContain('function objectAffected(entry: AuditEntry)');
    expect(auditView).toContain('const exportCsv');
  });
});
