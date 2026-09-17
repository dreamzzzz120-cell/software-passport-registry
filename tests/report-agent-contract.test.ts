import { describe, expect, it } from 'vitest';
import { buildAgentReport, type ReportInput } from '../src/agents/report-agent.ts';

const base: ReportInput = {
  passport: { id: 'p1', name: 'Example' },
  verificationStatus: 'UNKNOWN',
  evidenceCount: 0,
  findingCount: 0,
  openFindingCount: 0,
  freshness: null,
  evaluatedAt: Date.parse('2026-09-17T00:00:00Z'),
};
const section = (input: ReportInput, title: string) => buildAgentReport(input).sections.find((s) => s.title === title);

describe('report agent provenance model', () => {
  it('reports absent agent results as UNKNOWN and a missing freshness value as a GAP, never as a positive claim', () => {
    const result = buildAgentReport(base);
    expect(result.agent).toBe('report');
    expect(result.schemaVersion).toBe('spr-report-agent-v1');
    expect(section(base, 'Vendor Risk')).toEqual({ title: 'Vendor Risk', source: 'UNKNOWN', facts: ['No vendor-risk result was supplied.'] });
    expect(section(base, 'Compliance')).toEqual({ title: 'Compliance', source: 'UNKNOWN', facts: ['No compliance result was supplied.'] });
    expect(section(base, 'Monitoring')).toEqual({ title: 'Monitoring', source: 'UNKNOWN', facts: ['No monitoring result was supplied.'] });
    expect(section(base, 'Freshness gap')).toEqual({ title: 'Freshness gap', source: 'GAP', facts: ['No current freshness value was supplied.'] });
    expect(section(base, 'Freshness')).toBeUndefined();
  });

  it('reports supplied results as DERIVED, including a monitoring result of zero material changes', () => {
    const input: ReportInput = { ...base, vendorRiskStatus: 'LOW', complianceStatus: 'PASS', monitoringMaterialChanges: 0, freshness: 'current' };
    expect(section(input, 'Vendor Risk')?.source).toBe('DERIVED');
    expect(section(input, 'Compliance')).toEqual({ title: 'Compliance', source: 'DERIVED', facts: ['Compliance agent status: PASS.'] });
    expect(section(input, 'Monitoring')).toEqual({ title: 'Monitoring', source: 'DERIVED', facts: ['Material observed changes: 0.'] });
    expect(section(input, 'Freshness')).toEqual({ title: 'Freshness', source: 'OBSERVED', facts: ['Latest observed freshness: current.'] });
  });

  it('reports verification status and counts as OBSERVED facts', () => {
    const input: ReportInput = { ...base, verificationStatus: 'PARTIAL', evidenceCount: 4, findingCount: 3, openFindingCount: 2 };
    expect(section(input, 'Verification')).toEqual({ title: 'Verification', source: 'OBSERVED', facts: ['Current verification status: PARTIAL.', 'Observed evidence items: 4.'] });
    expect(section(input, 'Findings')).toEqual({ title: 'Findings', source: 'OBSERVED', facts: ['Total findings observed: 3.', 'Open findings observed: 2.'] });
  });

  it('derives recommended actions only from open findings and material changes, with an evidence-backed default', () => {
    expect(section(base, 'Recommended Actions')).toEqual({ title: 'Recommended Actions', source: 'RECOMMENDED_ACTION', facts: ['Continue evidence-backed monitoring and re-evaluate when material evidence changes.'] });
    expect(section({ ...base, openFindingCount: 1 }, 'Recommended Actions')?.facts).toEqual(['Review and remediate unresolved findings.']);
    expect(section({ ...base, monitoringMaterialChanges: 2 }, 'Recommended Actions')?.facts).toEqual(['Review material changes before relying on the previous assessment.']);
    expect(section({ ...base, openFindingCount: 1, monitoringMaterialChanges: 2 }, 'Recommended Actions')?.facts).toHaveLength(2);
  });

  it('keeps the non-invention policy and an ISO evaluation timestamp', () => {
    const { policy } = buildAgentReport(base);
    expect(policy.rule).toContain('observed facts, derived agent results, unknowns, gaps, and recommendations');
    for (const term of ['evidence', 'provenance', 'compliance', 'financial impact', 'trust']) expect(policy.rule).toContain(term);
    expect(policy.evaluatedAt).toBe('2026-09-17T00:00:00.000Z');
  });
});
