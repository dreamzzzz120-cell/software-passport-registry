import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('dashboard alert source consistency', () => {
  it('does not double-count trust findings as a second alert stream', () => {
    const source = read('src/components/EvidenceDashboardView.tsx');
    expect(source).toContain('const activeFindings = alerts.filter');
    expect(source).not.toContain('activeAlerts.length + metrics.highFindings');
    expect(source).toContain('label="Open trust findings" value={String(activeFindings.length)}');
  });

  it('routes trust-finding attention to Alerts rather than mislabelling it as monitoring', () => {
    const source = read('src/components/EvidenceDashboardView.tsx');
    expect(source).toContain("path: '/alerts'");
    expect(source).not.toContain("'Active monitoring alert'");
    expect(source).toContain('title="Monitoring" value="Open workspace"');
  });

  it('names monitoring alerts as the separate change-detection stream', () => {
    const source = read('src/components/MonitoringView.tsx');
    expect(source).toContain('Monitoring change alerts');
    expect(source).toContain('Trust findings are tracked separately in the Alerts workspace.');
  });
});
