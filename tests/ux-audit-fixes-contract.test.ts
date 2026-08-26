import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR live-audit bug-fix contracts', () => {
  it('never lets a DB hiccup at boot crash the whole process before app.listen() binds a port', () => {
    // Reproduced live: without this fix, an unreachable DB during
    // ensureInitialSelfPassport() made startServer() reject, and the
    // top-level .catch(() => process.exit(1)) killed the process before
    // /health, /ready, or any static asset could ever be served.
    const server = read('server.ts');
    const startFnStart = server.indexOf('export async function startServer()');
    const startFnBody = server.slice(startFnStart, startFnStart + 1200);
    expect(startFnBody).toContain('try {');
    expect(startFnBody).toContain('await ensureInitialSelfPassport();');
    expect(startFnBody).toContain('catch (error)');
    const tryPos = startFnBody.indexOf('try {');
    const listenPos = startFnBody.indexOf('server = app.listen(');
    expect(tryPos).toBeGreaterThan(0);
    expect(listenPos).toBeGreaterThan(tryPos);
  });

  it('calls the monitoring endpoints at their real mounted path, not the unmounted root', () => {
    const server = read('server.ts');
    expect(server).toContain("app.use('/api/monitoring', createMonitoringRouter());");
    const view = read('src/components/MonitoringView.tsx');
    expect(view).toContain("apiFetch('/api/monitoring/monitoring-configurations')");
    expect(view).toContain("apiFetch('/api/monitoring/collector-jobs')");
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
    expect(view).toContain("vendors.length === 0 ? '—' :");
  });
});
