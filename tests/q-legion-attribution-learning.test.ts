import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeCopy } from '../src/lib/distribution-outreach.ts';

describe('Q-LEGION outreach attribution and learning', () => {
  it('renders materially different evidence-safe strategy copy', () => {
    const proof = makeCopy('Example MSP', { signals: { cybersecurity: true } }, false, 'proof_first');
    const revenue = makeCopy('Example MSP', { signals: { msp: true, multiClient: true } }, false, 'revenue_first');
    const compliance = makeCopy('Example MSP', { signals: { compliance: true } }, false, 'compliance_first');

    expect(proof.subject).toMatch(/White-label software risk reports/i);
    expect(revenue.subject).toMatch(/recurring software-assurance/i);
    expect(compliance.subject).toMatch(/SBOM and vendor-risk evidence/i);
    expect(revenue.intro.join(' ')).toContain('Unknowns stay UNKNOWN');
    expect(compliance.intro.join(' ')).toContain('UNKNOWN states');
    expect([proof.subject, revenue.subject, compliance.subject]).toHaveLength(3);
    expect(new Set([proof.subject, revenue.subject, compliance.subject]).size).toBe(3);
  });

  it('keeps the distribution engine as the sender while Q-LEGION supplies attribution', () => {
    const outreach = readFileSync(resolve(process.cwd(), 'src/lib/distribution-outreach.ts'), 'utf8');
    const qRoute = readFileSync(resolve(process.cwd(), 'src/routes/q-legion.ts'), 'utf8');

    expect(outreach).toContain('resolveQLegionAttribution');
    expect(outreach).toContain('q_legion_mission_id');
    expect(outreach).toContain('q_legion_strategy_id');
    expect(outreach).toContain("UPDATE q_legion_missions SET mode='ACTIVE'");
    expect(qRoute).not.toContain('sendBrandedEmail(');
    expect(qRoute).not.toContain('sendInitial(');
  });

  it('preserves the original attributed strategy for follow-ups', () => {
    const outreach = readFileSync(resolve(process.cwd(), 'src/lib/distribution-outreach.ts'), 'utf8');
    expect(outreach).toContain("WHERE tenant_id=$1 AND contact_id=$2 AND kind='initial' AND status='sent'");
    expect(outreach).toContain('missionId: row?.q_legion_mission_id');
    expect(outreach).toContain('probability: row?.q_legion_strategy_probability');
  });
});
