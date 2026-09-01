import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRole } from '../src/middleware/security.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Owner command center operational-health contracts', () => {
  it('reuses the exact requireAuth + requireRole(Owner) pattern /api/founder/metrics already uses, not a second authorization system', () => {
    const auth = read('src/routes/auth.ts');
    expect(auth).toContain("router.get('/founder/operations', requireAuth, requireRole('Owner')");
    // Confirms the original endpoint's own gate is untouched.
    expect(auth).toContain("router.get('/founder/metrics', requireAuth, requireRole('Owner')");
  });

  it("actually denies a non-Owner and an unauthenticated caller through the real requireRole('Owner') middleware, not just in source text", () => {
    const invoke = (role: string | undefined) => {
      let status = 200; let called = false;
      const req: any = { user: role ? { role } : undefined };
      const res: any = { status(code: number) { status = code; return this; }, json() { return this; } };
      requireRole('Owner')(req, res, () => { called = true; });
      return { status, called };
    };
    expect(invoke('Owner')).toEqual({ status: 200, called: true });
    expect(invoke('Admin')).toEqual({ status: 403, called: false });
    expect(invoke('Viewer')).toEqual({ status: 403, called: false });
    expect(invoke(undefined)).toEqual({ status: 401, called: false });
  });

  it('scopes every operational-health query to the requesting tenant', () => {
    const auth = read('src/routes/auth.ts');
    const section = auth.split("router.get('/founder/operations'")[1].split("router.get('/passports/self-passport'")[0];
    const tenantScopedQueries = section.match(/tenant_id=\$\{tenantId\}/g) ?? [];
    // One per real table this endpoint reads: agent_jobs (x4), collector_jobs (x3),
    // spr_webhook_deliveries, spr_webhooks (x2), spr_webhook_deliveries join,
    // integration_credentials, integrations, agent_jobs (queue), compliance_schedules.
    expect(tenantScopedQueries.length).toBeGreaterThanOrEqual(12);
    expect(section).not.toMatch(/FROM (agent_jobs|collector_jobs|spr_webhooks|spr_webhook_deliveries|integration_credentials|integrations|compliance_schedules)(?!\w)(?![^;]*tenant_id)/);
  });

  it('reuses verifyAuditChain instead of implementing a second verifier', () => {
    const auth = read('src/routes/auth.ts');
    const section = auth.split("router.get('/founder/operations'")[1].split("router.get('/passports/self-passport'")[0];
    expect(section).toContain('await verifyAuditChain(db, tenantId)');
    expect(section).not.toMatch(/function verifyAuditChain|computeHash\(/);
  });

  it('discloses that monitoring-worker.ts is dead code instead of presenting it as a running system', () => {
    const auth = read('src/routes/auth.ts');
    const section = auth.split("router.get('/founder/operations'")[1].split("router.get('/passports/self-passport'")[0];
    expect(section).toContain('monitoring-worker.ts is dead code');
    const workerEntry = read('worker.ts');
    expect(workerEntry).not.toContain('/monitoring-worker.ts');
  });

  it('reuses the real INTEGRATION_CATALOG instead of a second provider list', () => {
    const auth = read('src/routes/auth.ts');
    expect(auth).toContain("import { INTEGRATION_CATALOG } from '../integrations/catalog.ts'");
    const section = auth.split("router.get('/founder/operations'")[1].split("router.get('/passports/self-passport'")[0];
    expect(section).toContain('INTEGRATION_CATALOG.map(');
  });

  it('wires the dashboard to the new endpoint behind the same ownerAccess gate as founder/metrics', () => {
    const view = read('src/components/FounderDashboardView.tsx');
    expect(view).toContain("apiFetch('/api/founder/operations')");
    expect(view).toContain('if (!ownerAccess) return');
    expect(view).toContain('void loadOperations()');
  });
});
