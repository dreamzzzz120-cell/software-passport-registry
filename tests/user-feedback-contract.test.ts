import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('User feedback contract', () => {
  it('requires auth and writes through the tenant-scoped connection, never the raw import', () => {
    const feedback = read('src/routes/feedback.ts');
    expect(feedback).toContain("router.post('/feedback', requireAuth");
    expect(feedback).toContain("router.get('/feedback', requireAuth");
    // Both handlers must use req.db (RLS-scoped), not a bare `db` import --
    // a bare import here would bypass tenant isolation for user-submitted
    // content, the exact failure class 0069 documents.
    expect(feedback).not.toMatch(/from '\.\.\/db\/index\.ts'/);
    expect(feedback).toContain('req.db!');
    expect(feedback).toContain('tenant_id = ${req.user!.tenantId}');
    expect(feedback).toContain("message: z.string().trim().min(1).max(4000)");
  });

  it('gates the cross-tenant founder inbox behind both requireRole(Owner) and requireFounder', () => {
    const founder = read('src/routes/founder-command-center.ts');
    expect(founder).toContain("router.get('/founder/feedback', requireAuth, requireRole('Owner'), requireFounder");
    expect(founder).toContain("router.patch('/founder/feedback/:id', requireAuth, requireRole('Owner'), requireFounder");
  });

  it('hardens user_feedback with forced RLS, a tenant policy, and a fail-closed assertion, matching the 0069 incident pattern', () => {
    const migration = read('migrations/0073_user_feedback.sql');
    expect(migration).toContain("ALTER TABLE %I ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE %I FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("tenant_id = current_setting(''app.tenant_id'', true)");
    expect(migration).toContain('SELECT spr_assert_tenant_rls();');
    expect(migration).toContain("REFERENCES users(id) ON DELETE CASCADE");
    expect(migration).toContain("CHECK (sentiment IN ('like', 'dislike', 'neutral'))");
    expect(migration).toContain("CHECK (category IN ('bug', 'complaint', 'suggestion', 'general'))");
  });

  it('is mounted under /api, inheriting the global rate limiter before any route-specific logic runs', () => {
    const serverSrc = read('server.ts');
    const rateLimiterIdx = serverSrc.indexOf("app.use('/api', rateLimiter)");
    const feedbackMountIdx = serverSrc.indexOf("app.use('/api', createFeedbackRouter())");
    expect(rateLimiterIdx).toBeGreaterThan(-1);
    expect(feedbackMountIdx).toBeGreaterThan(-1);
    expect(rateLimiterIdx).toBeLessThan(feedbackMountIdx);
  });
});
