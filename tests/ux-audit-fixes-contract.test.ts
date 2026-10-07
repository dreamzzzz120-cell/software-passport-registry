import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR live-audit bug-fix contracts', () => {
  it('does no database work before app.listen() binds a port', () => {
    // Reproduced live: an unreachable DB during the old boot-time
    // ensureInitialSelfPassport() made startServer() reject, and the top-level
    // .catch(() => process.exit(1)) killed the process before /health, /ready
    // or any static asset could be served. That bootstrap inserted a
    // placeholder self passport with an empty SBOM (migration 0080 removed
    // it); the guarantee now is that startServer() touches nothing but the
    // port before listening, so a database outage is reported by /ready
    // rather than by a dead process.
    const server = read('server.ts');
    expect(server).not.toContain('ensureInitialSelfPassport');
    expect(server).not.toContain('passport_spr_self');
    const startFnStart = server.indexOf('export async function startServer()');
    expect(startFnStart).toBeGreaterThan(0);
    const startFnBody = server.slice(startFnStart, server.indexOf('\n', startFnStart));
    const listenPos = startFnBody.indexOf('server = app.listen(');
    expect(listenPos).toBeGreaterThan(0);
    const beforeListen = startFnBody.slice(0, listenPos);
    expect(beforeListen).not.toMatch(/\b(db|appPool|pool)\./);
    expect(beforeListen).not.toContain('await ');
  });

  it('calls the monitoring endpoints at their real mounted path, not the unmounted root', () => {
    const server = read('server.ts');
    expect(server).toContain("app.use('/api/monitoring', createMonitoringRouter());");
    const view = read('src/components/MonitoringView.tsx');
    expect(view).toContain("apiFetch('/api/monitoring/monitoring-configurations', {");
    expect(view).toContain("apiFetch('/api/monitoring/collector-jobs', {");
    expect(view).toContain('/api/monitoring/monitoring-configurations/${id}/run');
  });

  it('never fires a second, untracked scan job as a side effect of running a schedule', () => {
    const view = read('src/components/ScansView.tsx');
    const fnStart = view.indexOf('const handleRunScheduleNow');
    const fnBody = view.slice(fnStart, fnStart + 900);
    expect(fnBody).not.toContain('runActualScan(schedule.assetHostName');
  });

  it('shows role-gated actions as disabled instead of letting every role attempt a mutation the backend will reject', () => {
    const passports = read('src/components/PassportsView.tsx');
    expect(passports).toContain('canRunAudit');
    expect(passports).toContain('canCreateRemediation');
    const scans = read('src/components/ScansView.tsx');
    expect(scans).toContain('canManageSchedules');
    const settings = read('src/components/SettingsView.tsx');
    expect(settings).toContain('const isOwner = currentRole');
    expect(settings).toContain('const canManageTeam');
  });

  it('never divides by zero into a literal NaN when the vendor list is empty', () => {
    const view = read('src/components/VendorsView.tsx');
    // Guards on scored.length now, not vendors.length -- stricter, since a
    // non-empty vendor list where none have a real scored audit yet must
    // also show '—' rather than averaging in fabricated/null scores.
    expect(view).toContain("scored.length === 0 ? '—' :");
  });
  it('locks the upgraded trust operations surfaces to evidence-first behavior', () => {
    const monitoring = read('src/components/MonitoringView.tsx');
    expect(monitoring).toContain('Monitoring control plane');
    expect(monitoring).toContain('Queueing a run is not proof; completed evidence is.');
    expect(monitoring).toContain('Missing evidence remains UNKNOWN');
    expect(monitoring).toContain('/api/monitoring/monitoring-configurations/');

    const trust = read('src/components/PublicTrustCenterView.tsx');
    expect(trust).toContain('Don’t trust the marketing. Inspect the evidence.');
    expect(trust).toContain('Observed / verified / UNKNOWN');
    expect(trust).toContain('Evidence infrastructure, not a certification badge.');
    expect(trust).toContain('/api/public/contact');

    const agents = read('src/components/AgentTrustView.tsx');
    expect(agents).toContain('Unknown stays UNKNOWN. Agent output is not evidence.');
    expect(agents).toContain('/api/experience-agent/v1/verify-software');
    expect(agents).toContain('/api/experience-agent/v1/verify-claim');
    expect(agents).toContain('/mcp');

    const alerts = read('src/components/AlertsView.tsx');
    expect(alerts).toContain('Resolution is not proof. New evidence is still required');
    expect(alerts).toContain('/api/trust-loop/remediations/');
    expect(alerts).toContain('/notes');
    expect(alerts).toContain('/approve');

    const msp = read('src/components/MSPCommandCenter.tsx');
    expect(msp).toContain('One queue for trust, change, and client action.');
    expect(msp).toContain('verificationDecisions?.[passport.id]');
    expect(msp).toContain('else unknown += 1');
    expect(msp).toContain('evidenceCoverage.pct == null');

    const integrations = read('src/components/IntegrationsView.tsx');
    expect(integrations).toContain('Signed webhooks');
    expect(integrations).toContain('x-spr-signature');
    expect(integrations).toContain('Destination URL (HTTPS only');
    expect(integrations).toContain('your receiver still decides what action to take');
  });

  it('does not reintroduce a default Viewer role in upgraded operator surfaces', () => {
    for (const relative of [
      'src/components/MonitoringView.tsx',
      'src/components/MSPCommandCenter.tsx',
      'src/components/AITrustCenterView.tsx',
    ]) {
      expect(read(relative)).not.toContain("role = 'Viewer'");
    }
  });

});
