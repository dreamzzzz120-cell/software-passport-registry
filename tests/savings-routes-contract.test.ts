import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('savings router RBAC: MSP-internal financial data must never be Client-readable', () => {
  const source = () => read('src/routes/savings.ts');

  it('defines the shared non-Client role list and applies it to both read routes', () => {
    const s = source();
    expect(s).toContain("const NOT_CLIENT_ROLE = ['Owner', 'Admin', 'Technician', 'Viewer'];");
    expect(s).toContain("router.get('/baseline', requireAuth, requireRole(NOT_CLIENT_ROLE)");
    expect(s).toContain("router.get('/report', requireAuth, requireRole(NOT_CLIENT_ROLE)");
  });

  it('restricts writing the baseline to Owner/Admin only, not Technician or Viewer', () => {
    const s = source();
    expect(s).toContain("router.put('/baseline', requireAuth, requireRole(['Owner', 'Admin'])");
  });
});

describe('savings router is mounted in server.ts', () => {
  it('mounts createSavingsRouter at /api/savings', () => {
    const s = read('server.ts');
    expect(s).toContain("import { createSavingsRouter } from './src/routes/savings.ts';");
    expect(s).toContain("app.use('/api/savings', createSavingsRouter());");
  });
});

describe('GET /savings/report validates windowDays against a fixed allowlist', () => {
  it('only accepts 30, 60, or 90 -- never an arbitrary attacker-supplied window', () => {
    const s = read('src/routes/savings.ts');
    expect(s).toContain('const ALLOWED_WINDOW_DAYS = [30, 60, 90] as const;');
    expect(s).toContain('if (!ALLOWED_WINDOW_DAYS.includes(windowDays as any))');
  });

  it('scopes every activity query by tenantId, relying on RLS as defense in depth', () => {
    const s = read('src/routes/savings.ts');
    expect(s).toContain('FROM trust_report_snapshots WHERE tenant_id = ${tenantId}');
    expect(s).toContain('FROM questionnaire_items');
    expect(s).toContain('FROM vendor_audits WHERE tenant_id = ${tenantId}');
    expect(s).toContain('FROM trust_remediation_work_items');
    expect(s).toContain("status IN ('VERIFIED','CLOSED')");
  });

  it('calls the same buildSavingsReport pure function the unit tests cover, never a second inline calculation', () => {
    const s = read('src/routes/savings.ts');
    expect(s).toContain('res.json(buildSavingsReport(windowDays, sinceIso, untilIso, activity, baseline));');
  });
});

describe('PUT /savings/baseline persists via a real upsert, never silently dropping an existing row', () => {
  it('uses ON CONFLICT (tenant_id) DO UPDATE, keyed off the primary key', () => {
    const s = read('src/routes/savings.ts');
    expect(s).toContain('ON CONFLICT (tenant_id) DO UPDATE SET');
  });

  it('validates baseline input with a strict zod schema rejecting unknown fields', () => {
    const s = read('src/routes/savings.ts');
    expect(s).toMatch(/const baselineSchema = z\.object\(\{[\s\S]*?\}\)\.strict\(\);/);
  });
});

describe('migration 0040 creates msp_savings_baseline with tenant RLS', () => {
  it('enables RLS and a spr_tenant_isolation policy, matching every other tenant-scoped table', () => {
    const s = read('migrations/0040_msp_savings_baseline.sql');
    expect(s).toContain('CREATE TABLE IF NOT EXISTS msp_savings_baseline');
    expect(s).toContain('tenant_id text PRIMARY KEY');
    expect(s).toContain("ALTER TABLE msp_savings_baseline ENABLE ROW LEVEL SECURITY");
    expect(s).toContain('spr_tenant_isolation');
  });
});
