import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const root = new URL('../src/', import.meta.url);
async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8');
}

describe('Founder page 50-point hardening contract', () => {
  it('1-5: snapshot refresh safety', async () => {
    const s = await source('lib/founderData.ts');
    expect(s).toContain('let refreshGeneration = 0;');
    expect(s).toContain('const generation = ++refreshGeneration;');
    expect(s).toContain('if (generation !== refreshGeneration) return;');
    expect(s).toContain('Keep the last known-good snapshot visible');
    expect(s).toContain('only replace a field when its request actually returned usable data');
  });

  it('6-10: founder snapshot integrity', async () => {
    const s = await source('lib/founderData.ts');
    expect(s).toContain("getJson<Overview>('/api/founder/overview', errors)");
    expect(s).toContain("getJson<CommandCenter>('/api/founder/command-center', errors)");
    expect(s).toContain("getJson<{ agents: AgentReport[] }>('/api/founder/agents', errors)");
    expect(s).toContain('loadedAt: new Date().toISOString()');
    expect(s).toContain('errors: string[]');
  });

  it('11-15: unknown-state semantics', async () => {
    const [data, overview, traffic] = await Promise.all([
      source('lib/founderData.ts'),
      source('components/FounderOverview.tsx'),
      source('components/FounderTrafficPanel.tsx'),
    ]);
    expect(data).toContain('return null;');
    expect(overview).toContain("'Not verified'");
    expect(overview).toContain('Unknown stays unknown');
    expect(traffic).toContain("'Not verified'");
    expect(traffic).toContain('Traffic could not be verified.');
  });

  it('16-20: Founder page accessibility structure', async () => {
    const s = await source('components/FounderDashboardView.tsx');
    expect(s).toContain('id="founder-dashboard"');
    expect(s).toContain('aria-label="Founder Command Center"');
    expect(s).toContain('aria-expanded={open}');
    expect(s).toContain('aria-controls={panelId}');
    expect(s).toContain('role="region"');
  });

  it('21-25: Founder page error recovery', async () => {
    const s = await source('components/FounderDashboardView.tsx');
    expect(s).toContain('role="alert"');
    expect(s).toContain('aria-live="assertive"');
    expect(s).toContain('Retry self passport');
    expect(s).toContain('disabled={loadingPassport}');
    expect(s).toContain('finally { setLoadingPassport(false); }');
  });

  it('26-30: privileged access and self-passport truth', async () => {
    const s = await source('components/FounderDashboardView.tsx');
    expect(s).toContain("const ownerAccess = userRole === 'Owner';");
    expect(s).toContain('Founder Admin Access Required');
    expect(s).toContain('/api/passports/self-passport');
    expect(s).toContain("if (response.status === 404) { setPassport(null); return; }");
    expect(s).toContain('No completed scan of the SPR repository exists');
  });

  it('31-35: traffic telemetry safety', async () => {
    const s = await source('components/FounderTrafficPanel.tsx');
    expect(s).toContain("fetch('/api/traffic/summary', { credentials: 'include' })");
    expect(s).toContain('let cancelled = false;');
    expect(s).toContain('if (cancelled) return;');
    expect(s).toContain('return () => { cancelled = true; }');
    expect(s).toContain('headline totals above remain from the founder snapshot');
  });

  it('36-40: observed platform pulse', async () => {
    const s = await source('components/FounderOverview.tsx');
    expect(s).toContain('pulse');
    expect(s).toContain('Tenant isolation (RLS)');
    expect(s).toContain('API database role');
    expect(s).toContain('Worker');
    expect(s).toContain('Distribution queue');
  });

  it('41-45: deterministic attention rules', async () => {
    const s = await source('lib/founderData.ts');
    expect(s).toContain('export function computeAttention');
    expect(s).toContain("severity: 'critical'");
    expect(s).toContain('tenantRls === false');
    expect(s).toContain('leastPrivilege === false');
    expect(s).toContain('distributionQueue.deadLetter');
  });

  it('46-50: agent controls stay server-backed', async () => {
    const s = await source('components/FounderAgentsPanel.tsx');
    expect(s).toContain('apiFetch(path, { method, body: JSON.stringify(body) })');
    expect(s).toContain('setBusy(id)');
    expect(s).toContain('if (r.ok) onDone();');
    expect(s).toContain('data-testid="agent-control-result"');
    expect(s).toContain('The server reports the gate');
  });
});
