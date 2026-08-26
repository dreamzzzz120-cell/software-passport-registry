import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR MSP command center remediation contracts', () => {
  it('drives the MSP command center remediation panel from the real trust-loop workflow, not the nonexistent /api/remediation-tasks and /api/alerts/:id endpoints', () => {
    const view = read('src/components/MSPCommandCenter.tsx');
    expect(view).not.toContain('/api/remediation-tasks');
    expect(view).not.toContain('/api/alerts/');
    expect(view).toContain("apiFetch('/api/trust-loop/remediations'");
    expect(view).toContain('/api/trust-loop/remediations/${encodeURIComponent(task.id)}');
    expect(view).toContain('/api/trust-loop/remediations/${encodeURIComponent(selected.remediationId)}');
  });

  it('sources finding detail from the findings already fetched at app level instead of a second network round trip', () => {
    const view = read('src/components/MSPCommandCenter.tsx');
    expect(view).toContain('findings.find((item: any) => String(item.id) === selected.id)');
    const app = read('src/App.tsx');
    expect(app).toContain('<MSPCommandCenter clients={clients} alerts={alerts} findings={findings} role={role}');
  });

  it('fixes the monitoring-configurations path bug by removing the dependency entirely rather than leaving a wrong path', () => {
    const view = read('src/components/MSPCommandCenter.tsx');
    expect(view).not.toContain('/api/monitoring-configurations');
    expect(view).not.toContain('monitoringConfiguration');
  });

  it('reuses verifyRemediation() for the command-center verify action instead of building a second verification path', () => {
    const routes = read('src/routes/trust-loop.ts');
    expect(routes).toContain("router.post('/remediations/:id/verify-latest'");
    // Must call the same function /verify uses, not reimplement its checks.
    const verifyLatestSection = routes.split("router.post('/remediations/:id/verify-latest'")[1]?.split("router.patch('/remediations/:id'")[0] ?? '';
    expect(verifyLatestSection).toContain('await verifyRemediation(');
    expect(verifyLatestSection).toContain('ORDER BY observation_version DESC LIMIT 1');
  });

  it('fails honestly instead of faking success when there is no observation to verify against', () => {
    const routes = read('src/routes/trust-loop.ts');
    expect(routes).toContain("res.status(409).json({ error: 'NO_OBSERVATION_ON_FILE'");
    expect(routes).toMatch(/VERIFICATION_\|\^FINDING_NOT_FOUND\$/);
  });

  it('keeps every trust-loop mutation behind role enforcement and every query tenant-scoped, matching the rest of the app', () => {
    const server = read('server.ts');
    expect(server).toContain("app.use('/api/trust-loop', requireAuth, requireTrustMutationRole)");
    const routes = read('src/routes/trust-loop.ts');
    expect(routes).toContain('WHERE w.id=${req.params.id} AND w.tenant_id=${tenantId}');
    expect(routes).toContain('WHERE tenant_id=${tenantId} AND passport_id=${work.passport_id}');
  });

  it('adds a real /api/ready alias so the diagnostics panel actually reaches the backend instead of the Vercel SPA fallback', () => {
    const server = read('server.ts');
    expect(server).toContain("app.get('/ready', readinessHandler)");
    expect(server).toContain("app.get('/api/ready', readinessHandler)");
    // Confirms the bug this closes: Vercel's rewrite table proxies /health and
    // /api/*, but never bare /ready, so the old /api/ready call silently hit
    // the SPA fallback (index.html) instead of 404ing where it would be caught.
    const vercelConfig = read('vercel.json');
    expect(JSON.parse(vercelConfig).rewrites.some((r: any) => r.source === '/ready')).toBe(false);
    const settings = read('src/components/SettingsView.tsx');
    expect(settings).toContain("apiFetch('/api/ready')");
  });
});
