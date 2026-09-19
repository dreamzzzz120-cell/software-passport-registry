import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A review submitted without a client created an unassigned passport that no
// client view could find (observed live 2026-09-19). Two things close that:
// New Review lets the submitter pick the client (and name the software) and
// sends both to /api/scans/submit, and a passport can be moved under a client
// afterwards through PATCH /api/user/passports/:id/client. These checks pin
// the tenant-ownership rule of that route and the fields the intake sends.
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('PATCH /api/user/passports/:id/client', () => {
  const s = read('src/routes/auth.ts');
  it('exists, is authenticated and limited to roles that may mutate passports', () => {
    expect(s).toContain("router.patch('/user/passports/:id/client', requireAuth, requireRole(['Owner', 'Admin', 'Operator'])");
  });
  it('checks the client belongs to the caller\'s tenant before assigning it', () => {
    const start = s.indexOf("router.patch('/user/passports/:id/client'");
    const body = s.slice(start, s.indexOf("router.get('/user/passports'", start));
    expect(body).toContain('SELECT id, name FROM clients WHERE id=${parsed.data.clientId} AND tenant_id=${tenantId} LIMIT 1');
    expect(body).toContain('UPDATE passports SET client_id=${parsed.data.clientId} WHERE id=${passportId} AND tenant_id=${tenantId}');
    expect(body).toContain('UPDATE scans SET client_id=${parsed.data.clientId}, client_name=${clientName ?? \'Unassigned\'} WHERE passport_id=${passportId} AND tenant_id=${tenantId}');
    expect(body).toContain("action: 'passport.client_assigned'");
  });
});

describe('New Review sends the chosen client and software name', () => {
  const s = read('src/components/NewReviewIntake.tsx');
  it('loads the workspace clients and offers an explicit Unassigned choice', () => {
    expect(s).toContain("apiFetch('/api/user/clients')");
    expect(s).toContain('<option value="">Unassigned (no client)</option>');
  });
  it('sends clientId and name on both the repository and the upload submissions', () => {
    expect(s).toContain("body: JSON.stringify({ source: 'github', owner: parts[0], repository: parts[1], ...submissionFields() })");
    expect(s).toContain("body: JSON.stringify({ source: 'upload', sessionId: session.sessionId, ...submissionFields() })");
    expect(s).toContain("...(clientId ? { clientId } : {}), ...(softwareName.trim() ? { name: softwareName.trim() } : {})");
  });
});

describe('the passport detail offers the same assignment', () => {
  const s = read('src/components/PassportsView.tsx');
  it('calls the route and re-fetches workspace data instead of editing local state', () => {
    expect(s).toContain("apiFetch(`/api/user/passports/${encodeURIComponent(passportId)}/client`, { method: 'PATCH'");
    expect(s).toContain('onReload?.();');
  });
});
