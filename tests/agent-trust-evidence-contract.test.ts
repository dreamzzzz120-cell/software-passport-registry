import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('agent trust evidence contract', () => {
  const route = fs.readFileSync('src/routes/ai-trust.ts', 'utf8');
  const migration = fs.readFileSync('migrations/0133_agent_trust_evidence.sql', 'utf8');

  it('keeps every agent evidence read tenant and passport scoped', () => {
    expect(route).toContain('WHERE id=${passportId} AND tenant_id=${tenantId}');
    expect(route).toContain('WHERE tenant_id=${tenantId} AND passport_id=${passportId}');
  });

  it('preserves unknown and unverified states instead of a safety score', () => {
    expect(migration).toContain("'OBSERVED','PARTIAL','UNKNOWN','UNOBSERVED'");
    expect(migration).toContain("'VERIFIED','UNVERIFIED','UNKNOWN'");
    expect(migration).not.toContain('safety_score');
    expect(migration).not.toContain('trusted boolean');
  });

  it('forces RLS on all new agent-evidence tables and explicitly authorizes the worker role', () => {
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("current_setting(''app.tenant_id'', true)");
    expect(migration).toContain('spr_worker_cross_tenant');
    expect(migration).toContain('agent_trust_snapshots');
    expect(migration).toContain('agent_trust_changes');
  });
});
