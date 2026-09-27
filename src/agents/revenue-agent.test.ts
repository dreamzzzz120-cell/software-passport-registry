import { describe, expect, it } from 'vitest';
import { evaluateRevenue, type RevenueInput } from './revenue-agent.ts';

const input = (overrides: Partial<RevenueInput> = {}): RevenueInput => ({
  passport: { id: 'p1', name: 'Observed software' },
  openCriticalOrHigh: 0, openFindings: 0, stale: false,
  vendorRiskStatus: null, complianceStatus: null,
  monitoringEnabled: false, observedEvidenceCount: 0,
  catalog: { evidence_report: 1000, monitoring: 200, security_assessment: 500 },
  ...overrides
});

describe('Revenue Agent evidence gates', () => {
  it('never prices an unknown evidence state', () => {
    expect(evaluateRevenue(input()).opportunities).toEqual([
      expect.objectContaining({ type: 'UNKNOWN', value: null })
    ]);
  });

  it('does not turn active monitoring or unknown compliance into a sales claim', () => {
    expect(evaluateRevenue(input({ observedEvidenceCount: 1, monitoringEnabled: true,
      complianceStatus: 'UNKNOWN' })).opportunities).toEqual([]);
  });

  it('retains a finding-backed assessment with an explicit catalog price', () => {
    expect(evaluateRevenue(input({ observedEvidenceCount: 1, openCriticalOrHigh: 2 })).opportunities)
      .toEqual([expect.objectContaining({ type: 'ACTIVE_OPPORTUNITY', value: 500 })]);
  });
});
