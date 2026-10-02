import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const route = fs.readFileSync(path.resolve('src/routes/msp-leads.ts'), 'utf8');
const migration = fs.readFileSync(path.resolve('migrations/0124_msp_evidence_lead_generation.sql'), 'utf8');
const server = fs.readFileSync(path.resolve('server.ts'), 'utf8');

describe('MSP lead intelligence hardening contract', () => {
  it('mounts the lead API behind authentication', () => {
    expect(server).toContain("app.use('/api/msp/leads', requireAuth, createMspLeadRouter())");
  });

  it('does not grant Client mutation or read access', () => {
    expect(route).not.toMatch(/requireRole\(\[[^\]]*'Client'/);
  });

  it('limits human approval to Owner/Admin', () => {
    expect(route).toContain("router.post('/:leadId/review', requireRole(['Owner','Admin'])");
  });

  it('fails qualification closed without current evidence', () => {
    expect(route).toContain("freshness_state='CURRENT' AND confidence > 0");
    expect(route).toContain('QUALIFICATION_EVIDENCE_REQUIRED');
  });

  it('uses an explicit transition allowlist', () => {
    expect(route).toContain('const allowedTransitions');
    expect(route).toContain('INVALID_LEAD_TRANSITION');
    expect(route).not.toMatch(/DISCOVERED:\s*\[[^\]]*WON/);
  });

  it('forces tenant RLS on every lead table', () => {
    for (const table of ['msp_leads','msp_lead_evidence','msp_lead_reviews','msp_lead_suppressions','msp_lead_outreach_events']) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
  });

  it('makes evidence append-only', () => {
    expect(migration).toContain('lead evidence is append-only');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON msp_lead_evidence');
  });

  it('blocks outreach without approval, current evidence, or when suppressed', () => {
    expect(migration).toContain('lead is not human-approved for outreach');
    expect(migration).toContain('lead has no current supporting evidence');
    expect(migration).toContain('outreach target is suppressed');
  });

  it('exposes suppression and guarded queueing rather than direct sending', () => {
    expect(route).toContain("router.post('/suppressions'");
    expect(route).toContain("router.post('/:leadId/outreach'");
    expect(route).toContain("'QUEUED'");
    expect(route).not.toContain("'SENT') ON CONFLICT");
  });

  it('exposes a human-readable persisted history with an explicit limitation', () => {
    expect(route).toContain("router.get('/:leadId/history'");
    expect(route).toContain('absence of a record is not evidence');
  });

  it('grants new tables to the least-privileged app role without granting the worker', () => {
    expect(migration).toContain('TO spr_app_runtime');
    expect(migration).not.toMatch(/msp_leads[^;]+TO spr_worker_runtime/);
  });

  it('enforces outreach idempotency per tenant', () => {
    expect(migration).toContain('UNIQUE (tenant_id, idempotency_key)');
  });

  it('guards child records against cross-tenant lead references', () => {
    expect(migration).toContain("RAISE EXCEPTION 'lead tenant mismatch'");
    expect(migration).toContain('msp_lead_evidence_tenant_guard');
    expect(migration).toContain('msp_lead_reviews_tenant_guard');
    expect(migration).toContain('msp_lead_outreach_tenant_guard');
  });
});
