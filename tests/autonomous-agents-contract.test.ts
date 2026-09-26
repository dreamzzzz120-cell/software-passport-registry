import { describe, expect, it } from 'vitest';
import { evaluateMonitoring } from '../src/agents/monitoring-agent.ts';
import { buildAgentReport } from '../src/agents/report-agent.ts';
import { evaluateRevenue } from '../src/agents/revenue-agent.ts';
import { readFileSync } from 'node:fs';

const agentApiSource = readFileSync(new URL('../src/routes/agent-api.ts', import.meta.url), 'utf8');

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

  it('preserves evidence lineage and unknowns on revenue opportunities', () => {
    const result = evaluateRevenue({
      passport: { id: 'p1', name: 'Example' },
      openCriticalOrHigh: 1,
      openFindings: 3,
      stale: true,
      vendorRiskStatus: 'MEDIUM',
      complianceStatus: 'UNKNOWN',
      monitoringEnabled: false,
      observedEvidenceCount: 2,
      catalog: { security_assessment: 500, monitoring: 100 },
      evidenceIds: ['e2', 'e1', 'e1'],
      findingIds: ['f1'],
      unknowns: ['SBOM coverage is not established'],
    });
    expect(result.schemaVersion).toBe('spr-revenue-agent-v2');
    expect(result.opportunities.some(o => o.basis === 'VERIFIED_FINDING' && o.findingIds.includes('f1'))).toBe(true);
    expect(result.opportunities.some(o => o.basis === 'EVIDENCE_GAP' && o.unknowns.includes('SBOM coverage is not established'))).toBe(true);
    expect(result.opportunities.every(o => Array.isArray(o.evidenceIds) && Array.isArray(o.findingIds) && Array.isArray(o.unknowns))).toBe(true);
    expect(result.summary.configuredValue).toBe(600);
  });

  it('fails closed to an evidence-baseline opportunity when nothing is observed', () => {
    const result = evaluateRevenue({
      passport: { id: 'p1', name: 'Example' },
      openCriticalOrHigh: 0,
      openFindings: 0,
      stale: false,
      vendorRiskStatus: null,
      complianceStatus: null,
      monitoringEnabled: false,
      observedEvidenceCount: 0,
      catalog: {},
    });
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].type).toBe('UNKNOWN');
    expect(result.opportunities[0].basis).toBe('EVIDENCE_GAP');
    expect(result.opportunities[0].value).toBeNull();
  });
  it('wires revenue opportunities to tenant-scoped persisted trust records', () => {
    expect(agentApiSource).toContain("router.post('/revenue-opportunities'");
    expect(agentApiSource).toContain('WHERE tenant_id=${tenantId} AND passport_id=${passport.id}');
    expect(agentApiSource).toContain("table: 'evidence_ledger'");
    expect(agentApiSource).toContain("table: 'trust_findings'");
    expect(agentApiSource).toContain("table: 'trust_observations'");
    expect(agentApiSource).toContain("table: 'monitoring_configurations'");
  });

});
