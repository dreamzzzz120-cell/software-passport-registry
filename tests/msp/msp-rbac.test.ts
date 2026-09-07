import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// SECTION 3 of the MSP acceptance spec: every role must be tested against
// every protected capability. TeamView.tsx already carries a PERMISSION_MATRIX
// that claims to mirror real requireRole(...) gates (with a drift-detection
// comment saying so) -- this verifies that claim against the actual routes,
// rather than trusting the comment on faith.
const teamView = fs.readFileSync(path.join(process.cwd(), 'src/components/TeamView.tsx'), 'utf8');

function matrixRow(capability: string): string[] {
  const idx = teamView.indexOf(`capability: '${capability}'`);
  expect(idx, `PERMISSION_MATRIX row "${capability}" not found`).toBeGreaterThan(-1);
  const rowEnd = teamView.indexOf('}', idx);
  const rolesMatch = teamView.slice(idx, rowEnd).match(/roles: \[([^\]]*)\]/);
  expect(rolesMatch, `PERMISSION_MATRIX row "${capability}" has no roles array`).not.toBeNull();
  return rolesMatch![1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
}

describe('PERMISSION_MATRIX rows genuinely match the requireRole gates on their real routes', () => {
  it('"Offboard tenant, view founder metrics" -> Owner only, matches /tenant/offboard and /founder/metrics', () => {
    expect(matrixRow('Offboard tenant, view founder metrics')).toEqual(['Owner']);
    const auth = fs.readFileSync(path.join(process.cwd(), 'src/routes/auth.ts'), 'utf8');
    expect(auth).toContain("router.post('/tenant/offboard', requireAuth, requireRole('Owner')");
    expect(auth).toContain("router.get('/founder/metrics', requireAuth, requireRole('Owner'), requireFounder");
  });

  it('"Invite, re-role, or remove team members" -> Owner/Admin, matches /organization/invite and team routes', () => {
    expect(matrixRow('Invite, re-role, or remove team members')).toEqual(['Owner', 'Admin']);
    const auth = fs.readFileSync(path.join(process.cwd(), 'src/routes/auth.ts'), 'utf8');
    expect(auth).toContain("router.post('/organization/invite', requireAuth, requireRole(['Owner', 'Admin'])");
    expect(auth).toContain("router.put('/organization/team/:userId/role', requireAuth, requireRole(['Owner', 'Admin'])");
    expect(auth).toContain("router.delete('/organization/team/:userId', requireAuth, requireRole(['Owner', 'Admin'])");
  });

  it('"Trigger scans, repository scans, agent jobs" -> Owner/Admin/Operator, matches scans.ts', () => {
    expect(matrixRow('Trigger scans, repository scans, agent jobs')).toEqual(['Owner', 'Admin', 'Operator']);
    const scans = fs.readFileSync(path.join(process.cwd(), 'src/routes/scans.ts'), 'utf8');
    expect(scans).toContain("router.post('/scans', requireRole(['Owner', 'Admin', 'Operator'])");
    expect(scans).toContain("router.post('/agent-jobs', requireRole(['Owner','Admin','Operator'])");
  });

  it('"Run monitoring checks, manage alert subscriptions" -> Owner/Admin/Technician, matches monitoring.ts', () => {
    expect(matrixRow('Run monitoring checks, manage alert subscriptions')).toEqual(['Owner', 'Admin', 'Technician']);
    const monitoring = fs.readFileSync(path.join(process.cwd(), 'src/routes/monitoring.ts'), 'utf8');
    expect(monitoring).toContain("router.post('/monitoring-configurations/:id/run', requireRole(['Owner', 'Admin', 'Technician'])");
    expect(monitoring).toContain("router.post('/alert-subscriptions', requireRole(['Owner', 'Admin', 'Technician'])");
  });
});

// SECTION 14 (client experience) and SECTION 18 (privilege escalation): the
// Client role is the narrowest role in the system and must never satisfy a
// requireRole check that grants write access to another tenant's -- or even
// its own MSP operator's -- administrative surface.
describe('the Client role never appears in a write-capable requireRole gate outside its own approval path', () => {
  it('no requireRole array in security-sensitive admin routes includes Client', () => {
    const files = ['auth.ts', 'billing.ts', 'connect.ts', 'monitoring.ts', 'scans.ts', 'msp.ts'];
    for (const name of files) {
      const source = fs.readFileSync(path.join(process.cwd(), 'src/routes', name), 'utf8');
      for (const match of source.matchAll(/requireRole\(\[([^\]]*)\]\)/g)) {
        expect(match[1], `${name}: a requireRole([...]) array includes 'Client' -- verify this is intentionally client-facing`).not.toContain("'Client'");
      }
    }
  });
});
