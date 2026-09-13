import { describe, expect, it } from 'vitest';
import { evaluateMonitoring } from '../src/agents/monitoring-agent.ts';
import { buildAgentReport } from '../src/agents/report-agent.ts';
import { evaluateRevenue } from '../src/agents/revenue-agent.ts';

describe('autonomous agent suite', () => {
  it('detects monitoring changes deterministically', () => {
    const input = { passport: { id: 'p1', name: 'Example' }, evaluatedAt: Date.parse('2026-09-12T00:00:00Z'), previous: [{ id: 'e1', fingerprint: 'a', observedAt: '2026-09-11T00:00:00Z', status: 'verified' }], current: [{ id: 'e1', fingerprint: 'b', observedAt: '2026-09-12T00:00:00Z', status: 'verified' }] };
    expect(evaluateMonitoring(input).changes[0].type).toBe('CHANGED');
    expect(evaluateMonitoring(input)).toEqual(evaluateMonitoring(input));
  });

  it('keeps report facts separated from unknowns and recommendations', () => {
    const result = buildAgentReport({ passport: { id: 'p1', name: 'Example' }, verificationStatus: 'VERIFIED', evidenceCount: 3, findingCount: 2, openFindingCount: 1, vendorRiskStatus: 'MEDIUM', complianceStatus: 'UNKNOWN', freshness: 'current', evaluatedAt: Date.now() });
    expect(result.sections.find(s => s.title === 'Verification')?.source).toBe('OBSERVED');
    expect(result.sections.find(s => s.title === 'Compliance')?.source).toBe('DERIVED');
    expect(result.sections.find(s => s.title === 'Recommended Actions')?.source).toBe('RECOMMENDED_ACTION');
  });

  it('never invents revenue value when catalog pricing is absent', () => {
    const result = evaluateRevenue({ passport: { id: 'p1', name: 'Example' }, openCriticalOrHigh: 1, openFindings: 1, stale: true, vendorRiskStatus: 'HIGH', complianceStatus: 'FAIL', monitoringEnabled: false, observedEvidenceCount: 2, catalog: {} });
    expect(result.opportunities.length).toBeGreaterThan(0);
    expect(result.opportunities.every(o => o.value === null)).toBe(true);
  });

  it('returns UNKNOWN revenue state when evidence is absent', () => {
    const result = evaluateRevenue({ passport: { id: 'p1', name: 'Example' }, openCriticalOrHigh: 0, openFindings: 0, stale: false, vendorRiskStatus: null, complianceStatus: null, monitoringEnabled: false, observedEvidenceCount: 0, catalog: { evidence_report: 99 } });
    expect(result.opportunities[0]).toMatchObject({ type: 'UNKNOWN', service: 'Evidence review', value: 99 });
  });
});
