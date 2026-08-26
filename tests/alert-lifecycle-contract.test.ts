import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR alert lifecycle contracts', () => {
  it('joins each finding to its own most recent remediation work item instead of an unrelated id', () => {
    const trustLoop = read('src/routes/trust-loop.ts');
    expect(trustLoop).toContain('LEFT JOIN LATERAL');
    expect(trustLoop).toContain('w.tenant_id = f.tenant_id AND w.finding_id = f.id');
    expect(trustLoop).toContain('ORDER BY w.created_at DESC LIMIT 1');
  });

  it('creates a remediation work item on demand before patching one that might not exist yet', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('const performAlertAction');
    expect(app).toContain("apiFetch('/api/trust-loop/remediations'");
    expect(app).toContain('if (!remediationId)');
  });

  it('derives alert status from the joined remediation status, not the finding status alone', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('function deriveAlertStatus');
    expect(app).toContain("case 'IN_PROGRESS': case 'READY_FOR_VERIFICATION': return 'Acknowledged';");
  });

  it('exposes acknowledge, assign, escalate, snooze, and resolve as distinct actions in the UI, not one status field', () => {
    const alertsView = read('src/components/AlertsView.tsx');
    expect(alertsView).toContain("type AlertAction = 'acknowledge' | 'assign' | 'resolve' | 'escalate' | 'snooze' | 'reopen';");
    expect(alertsView).toContain("run('acknowledge')");
    expect(alertsView).toContain("run('escalate')");
    expect(alertsView).toContain("run('assign', assignee.trim())");
  });
});
