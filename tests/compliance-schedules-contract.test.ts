import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR compliance schedule contracts', () => {
  it('was previously a fully-built frontend calling a backend that did not exist anywhere', () => {
    // Documents the bug this migration/router pair closes: ComplianceView.tsx
    // called GET/POST/PUT/DELETE /api/compliance/schedules and POST .../run
    // with zero matching route in any router file.
    const view = read('src/components/ComplianceView.tsx');
    expect(view).toContain("apiFetch('/api/compliance/schedules')");
    expect(view).toContain('apiFetch(`/api/compliance/schedules/${encodeURIComponent(id)}/run`');
    const server = read('server.ts');
    expect(server).toContain("app.use('/api/compliance', createComplianceRouter());");
  });

  it('enables the same Row-Level Security every other tenant-scoped table has', () => {
    const migration = read('migrations/0022_compliance_schedules.sql');
    expect(migration).toContain('ALTER TABLE compliance_schedules ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain("current_setting(''app.tenant_id'', true)");
  });

  it('scopes every schedule query to the requesting tenant', () => {
    const routes = read('src/routes/compliance.ts');
    expect(routes).toContain('tenant_id=${req.user!.tenantId}');
    expect(routes).toContain('tenant_id=${tenantId}');
  });

  it('gates every mutation (create/update/delete/run) to Owner/Admin/Operator, matching the scan_schedules analog exactly', () => {
    const routes = read('src/routes/compliance.ts');
    expect(routes).toContain("router.post('/schedules', requireRole(['Owner', 'Admin', 'Operator'])");
    expect(routes).toContain("router.put('/schedules/:id', requireRole(['Owner', 'Admin', 'Operator'])");
    expect(routes).toContain("router.delete('/schedules/:id', requireRole(['Owner', 'Admin', 'Operator'])");
    expect(routes).toContain("router.post('/schedules/:id/run', requireRole(['Owner', 'Admin', 'Operator'])");
    // GET must stay open to any authenticated tenant member, not just managers.
    expect(routes).not.toMatch(/router\.get\('\/schedules', requireRole/);
  });

  it('reuses the existing report pipeline for "run" instead of building a second report generator', () => {
    const routes = read('src/routes/compliance.ts');
    expect(routes).toContain("import { buildAndPersistReport } from './trust-loop.ts'");
    expect(routes).toContain("buildAndPersistReport(db, tenantId, passport.id, 'compliance')");
    const trustLoop = read('src/routes/trust-loop.ts');
    expect(trustLoop).toContain('export async function buildAndPersistReport');
  });

  it('never claims an email was sent or a job was auto-scheduled, since neither capability exists in this codebase', () => {
    const routes = read('src/routes/compliance.ts');
    expect(routes).toContain('No email was sent to');
    expect(routes).toContain('no email delivery is configured in this deployment');
    // Confirms no email/SMTP library is silently introduced alongside this feature.
    expect(routes).not.toMatch(/nodemailer|sendgrid|ses\.send|mailgun/i);
    expect(routes.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')).not.toMatch(/smtp/i);
  });

  it('treats next_audit_at as informational display data only, not a real cron input, matching scan_schedules', () => {
    const migration = read('migrations/0022_compliance_schedules.sql');
    expect(migration).toContain('nothing ever');
    expect(migration).toContain('polls) and no email/SMTP integration exists');
    // No worker file should reference this table — if one ever does, it must
    // come with a real scheduler, or this claim becomes false.
    const workerFiles = fs.readdirSync(path.join(root, 'src/workers'));
    for (const file of workerFiles) {
      const contents = read(path.join('src/workers', file));
      expect(contents).not.toContain('compliance_schedules');
    }
  });

  it('shows compliance schedule actions as disabled for roles the backend will reject, matching the session-wide role-gating fix', () => {
    const view = read('src/components/ComplianceView.tsx');
    expect(view).toContain('canManageSchedules');
    expect(view).toContain("['Owner', 'Admin', 'Operator'].includes(role)");
    const app = read('src/App.tsx');
    expect(app).toContain('<ComplianceView clients={clients} role={role} />');
  });
});
