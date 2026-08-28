import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// ClientOps was ~70% built already: trust_remediation_work_items, the full
// OPEN -> IN_PROGRESS -> READY_FOR_VERIFICATION -> VERIFIED/CLOSED state
// machine, and a real verify-against-evidence step all pre-existed, along
// with a real acknowledge/assign/escalate/snooze/resolve/reopen UI in
// AlertsView.tsx. What was missing: a list endpoint (only create-one and
// patch-one-by-id existed), a note thread, and a client sign-off step.
describe('remediation queue and notes schema', () => {
  it('trust_remediation_work_items gains client_id for scoping, matching every other tenant-scoped operational table', () => {
    const migration = read('migrations/0036_clientops_remediation_queue.sql');
    expect(migration).toContain('ALTER TABLE trust_remediation_work_items ADD COLUMN IF NOT EXISTS client_id text;');
  });

  it('remediation_notes is a real append-only ledger, TG_OP checked before touching NEW', () => {
    const migration = read('migrations/0036_clientops_remediation_queue.sql');
    const body = migration.slice(migration.indexOf('spr_enforce_remediation_note_immutable'));
    const tgOpIndex = body.indexOf("TG_OP = 'UPDATE' OR TG_OP = 'DELETE'");
    const firstNewDereference = body.indexOf('NEW.remediation_id');
    expect(tgOpIndex).toBeGreaterThan(-1);
    expect(tgOpIndex).toBeLessThan(firstNewDereference);
  });
});

describe('GET /trust-loop/remediations (list) and client scoping', () => {
  const source = () => read('src/routes/trust-loop.ts');

  it('exists and scopes to a single client for the Client role, same pattern as /findings', () => {
    const s = source();
    expect(s).toContain("router.get('/remediations', async (req: AuthenticatedRequest, res, next) => {");
    expect(s).toContain('AND (${clientScope}::text IS NULL OR client_id = ${clientScope})');
  });

  it('populates client_id from the finding at creation time', () => {
    expect(source()).toContain('${finding.client_id},${p.externalSystem}');
  });

  it('notes require the caller to already have access to the remediation (tenant + client scope), before insert', () => {
    const s = source();
    expect(s).toContain("router.post('/remediations/:id/notes'");
    expect(s).toContain("if (!remediation) return res.status(404).json({ error: 'REMEDIATION_NOT_FOUND' });");
  });
});

describe('client approval endpoint', () => {
  const source = () => read('src/routes/trust-loop.ts');
  const serverSource = () => read('server.ts');

  it('is restricted to the Client role and only affects work already ready for verification or verified', () => {
    const s = source();
    expect(s).toContain("router.post('/remediations/:id/approve', requireRole(['Client'])");
    expect(s).toContain("AND status IN ('READY_FOR_VERIFICATION','VERIFIED')");
  });

  it('never lets a Client approve another client\'s remediation (scoped by client_id, not just tenant)', () => {
    expect(source()).toContain('WHERE id=${req.params.id} AND tenant_id=${tenantId} AND client_id=${clientScope}');
  });

  it('is carved out of the router-wide staff-only mutation gate, which otherwise blocks every Client-role POST under /api/trust-loop', () => {
    const s = serverSource();
    expect(s).toContain("/\\/remediations\\/[^/]+\\/approve$/.test(req.path)");
    expect(s).toContain("requireRole(['Owner', 'Admin', 'Operator', 'Technician', 'Client'])");
  });
});

describe('AlertsView surfaces notes and client approval', () => {
  const source = () => read('src/components/AlertsView.tsx');

  it('loads the real remediation record (notes + approval) lazily when a remediation exists', () => {
    const s = source();
    expect(s).toContain('apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(alert.remediationId)}`)');
  });

  it('posts new notes through the real endpoint', () => {
    expect(source()).toContain('/notes`, {');
  });

  it('only offers the approve action to the Client role, and only once the remediation is actually ready', () => {
    const s = source();
    expect(s).toContain("role === 'Client' && !remediation?.clientApprovedAt");
    expect(s).toContain("remediation?.status === 'READY_FOR_VERIFICATION' || remediation?.status === 'VERIFIED'");
  });
});
