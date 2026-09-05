import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR MSP technician assignment and AI Trust Center contracts', () => {
  it('enables the same Row-Level Security on the new tables that every other tenant-scoped table has', () => {
    const migration = read('migrations/0021_msp_and_ai_trust.sql');
    expect(migration).toContain("ARRAY['client_assignments', 'ai_systems', 'ai_system_observations']");
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain("current_setting(''app.tenant_id'', true)");
  });

  it('requires the composite tenant+id unique index to exist before the observations table can reference it', () => {
    const migration = read('migrations/0021_msp_and_ai_trust.sql');
    const uniqueIndexPos = migration.indexOf('ai_systems_tenant_id_unique');
    const foreignKeyPos = migration.indexOf('FOREIGN KEY (tenant_id, ai_system_id)');
    expect(uniqueIndexPos).toBeGreaterThan(0);
    expect(foreignKeyPos).toBeGreaterThan(uniqueIndexPos);
  });

  it('scopes every client_assignments query to the requesting tenant and gates mutation to Owner/Admin', () => {
    const msp = read('src/routes/msp.ts');
    expect(msp).toContain('tenant_id=${tenantId}');
    expect(msp).toContain("router.put('/assignments', requireRole(['Owner', 'Admin'])");
    expect(msp).toContain("router.delete('/assignments/:clientId', requireRole(['Owner', 'Admin'])");
    expect(msp).toContain("const isClient = req.user!.role === 'Client';");
    expect(msp).toContain('client_id = ${clientId}');
  });

  it('verifies AI system ownership before accepting or listing observations for it, not just checking the id exists globally', () => {
    const aiTrust = read('src/routes/ai-trust.ts');
    expect(aiTrust).toContain("SELECT id FROM ai_systems WHERE id=${req.params.id} AND tenant_id=${tenantId}");
  });

  it('fails closed on tenant-wide AI Trust reads until AI systems have an explicit client ownership boundary', () => {
    const aiTrust = read('src/routes/ai-trust.ts');
    expect(aiTrust).toContain("const AI_TRUST_READ_ROLES = ['Owner', 'Admin', 'Operator'] as const;");
    expect(aiTrust).toContain("router.get('/systems', requireRole([...AI_TRUST_READ_ROLES])");
    expect(aiTrust).toContain("router.get('/systems/:id/observations', requireRole([...AI_TRUST_READ_ROLES])");
    expect(aiTrust).toContain("router.post('/explain-passport', requireRole([...AI_TRUST_READ_ROLES])");
  });

  it('mounts both new routers behind requireAuth at the server level rather than per-route', () => {
    const server = read('server.ts');
    expect(server).toContain("app.use('/api/msp', requireAuth, createMspRouter());");
    expect(server).toContain("app.use('/api/ai-trust', requireAuth, createAiTrustRouter());");
    const msp = read('src/routes/msp.ts');
    expect(msp).not.toContain('requireAuth');
  });

  it('tells the user in the UI that the AI registry is self-reported, not auto-discovered', () => {
    const view = read('src/components/AITrustCenterView.tsx');
    expect(view).toContain('self-reported registry');
    expect(view).toContain('no mechanism to auto-discover AI agents');
    expect(view).toContain('Capability boundary');
  });

  it('drives the MSP cross-client risk table and technician assignment from real endpoints, not client-side mock data', () => {
    const msp = read('src/components/MSPCommandCenter.tsx');
    expect(msp).toContain("apiFetch('/api/msp/assignments')");
    expect(msp).toContain("apiFetch('/api/organization/team')");
    expect(msp).toContain('clientRiskRollup');
  });
});