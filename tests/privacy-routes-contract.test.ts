import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = () => read('src/routes/privacy.ts');

describe('privacy router RBAC: internal privacy-program data is never Client-readable', () => {
  it('defines the shared non-Client role list and applies it to every read route', () => {
    const s = source();
    expect(s).toContain("const NOT_CLIENT_ROLE = ['Owner', 'Admin', 'Technician', 'Viewer'];");
    expect(s).toContain("router.get('/inventory', requireAuth, requireRole(NOT_CLIENT_ROLE)");
    expect(s).toContain("router.get('/requests', requireAuth, requireRole(NOT_CLIENT_ROLE)");
    expect(s).toContain("router.get('/pias', requireAuth, requireRole(NOT_CLIENT_ROLE)");
  });

  it('restricts inventory writes and PIA creation/decision to Owner/Admin only', () => {
    const s = source();
    expect(s).toContain("const WRITE_ROLE = ['Owner', 'Admin'];");
    expect(s).toContain("router.post('/inventory', requireAuth, requireRole(WRITE_ROLE)");
    expect(s).toContain("router.post('/pias', requireAuth, requireRole(WRITE_ROLE)");
    expect(s).toContain("router.post('/pias/:id/decide', requireAuth, requireRole(WRITE_ROLE)");
  });

  it('allows Technician to process (not just Owner/Admin) privacy requests', () => {
    const s = source();
    expect(s).toContain("const PROCESS_ROLE = ['Owner', 'Admin', 'Technician'];");
    expect(s).toContain("router.post('/requests', requireAuth, requireRole(PROCESS_ROLE)");
    expect(s).toContain("router.patch('/requests/:id', requireAuth, requireRole(PROCESS_ROLE)");
  });
});

describe('privacy router is mounted in server.ts', () => {
  it('mounts createPrivacyRouter at /api/privacy', () => {
    const s = read('server.ts');
    expect(s).toContain("import { createPrivacyRouter } from './src/routes/privacy.ts';");
    expect(s).toContain("app.use('/api/privacy', createPrivacyRouter());");
  });
});

describe('PIA decision is a distinct, explicit action requiring a named reviewer', () => {
  it('the create/edit routes never set reviewer_name or decision away from the default', () => {
    const s = source();
    const createStart = s.indexOf("router.post('/pias'");
    const createEnd = s.indexOf("router.post('/pias/:id/decide'");
    const createBody = s.slice(createStart, createEnd);
    const insertColumnList = createBody.slice(createBody.indexOf('INSERT INTO privacy_impact_assessments ('), createBody.indexOf('VALUES'));
    expect(insertColumnList).not.toContain('reviewer_name');
    expect(insertColumnList).not.toContain('decision');
  });

  it('the decide route requires a reviewerName and records who decided', () => {
    const s = source();
    expect(s).toContain("const piaDecisionSchema = z.object({\n  reviewerName: z.string().trim().min(1).max(255),\n  decision: z.enum(['APPROVED', 'REQUIRES_CHANGES', 'REJECTED']),\n}).strict();");
    expect(s).toContain('reviewer_name = ${d.reviewerName}, decided_at = CURRENT_TIMESTAMP');
  });
});

describe('privacy request completion requires the real completion fact, matching the DB CHECK constraint', () => {
  it('only sets completed_at when status transitions to COMPLETED, computed server-side', () => {
    const s = source();
    expect(s).toContain("const completedAt = p.status === 'COMPLETED' ? new Date().toISOString() : before.completed_at;");
  });

  it('surfaces the DB CHECK violation as a clean 400, not a 500', () => {
    const s = source();
    expect(s).toContain('COMPLETION_REQUIRES_COMPLETED_AT');
  });
});

describe('every mutation is scoped by tenant_id in its WHERE clause', () => {
  it('PATCH routes never update a row without also matching tenant_id', () => {
    const s = source();
    const patchInventory = s.slice(s.indexOf("router.patch('/inventory/:id'"), s.indexOf("// ---- Privacy Requests"));
    expect(patchInventory).toContain('AND tenant_id = ${tenantId}');
    const patchRequest = s.slice(s.indexOf("router.patch('/requests/:id'"), s.indexOf("// ---- Privacy Impact Assessments"));
    expect(patchRequest).toContain('AND tenant_id = ${tenantId}');
  });
});

describe('no automatic legal-compliance determination exists anywhere in this router', () => {
  it('never outputs a "compliant" or "certified" claim', () => {
    const s = source();
    expect(s.toLowerCase()).not.toContain('compliant');
    expect(s.toLowerCase()).not.toContain('certified');
  });
});

describe('migration 0042 creates the privacy schema with tenant RLS and honest constraints', () => {
  it('every privacy table gets RLS + spr_tenant_isolation', () => {
    const s = read('migrations/0042_privacy_management.sql');
    for (const table of ['privacy_information_inventory', 'privacy_requests', 'privacy_impact_assessments']) {
      expect(s).toContain(`'${table}'`);
    }
    expect(s).toContain('ENABLE ROW LEVEL SECURITY');
    expect(s).toContain('spr_tenant_isolation');
  });

  it('a PIA decision requires a named reviewer and timestamp whenever it leaves PENDING', () => {
    const s = read('migrations/0042_privacy_management.sql');
    expect(s).toMatch(/CHECK \(decision = 'PENDING' OR \(reviewer_name IS NOT NULL AND reviewer_name != '' AND decided_at IS NOT NULL\)\)/);
  });

  it('a COMPLETED privacy request requires completed_at to be set', () => {
    const s = read('migrations/0042_privacy_management.sql');
    expect(s).toContain("CHECK (status != 'COMPLETED' OR completed_at IS NOT NULL)");
  });
});
