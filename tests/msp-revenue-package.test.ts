import { describe, expect, it } from 'vitest';
import { buildMspRevenuePackages } from '../src/agents/msp-revenue-package.ts';
import type { RevenueInput } from '../src/agents/revenue-agent.ts';

const base: RevenueInput = {
  passport: { id: 'passport-1', name: 'Real asset reference' },
  observedEvidenceCount: 0,
  openCriticalOrHigh: 0,
  openFindings: 0,
  stale: false,
  vendorRiskStatus: null,
  complianceStatus: 'UNKNOWN',
  monitoringEnabled: false,
  evidenceIds: [],
  findingIds: [],
  unknowns: ['Restore-test evidence missing'],
  catalog: {},
};

describe('MSP revenue package', () => {
  it('keeps absent evidence UNKNOWN and refuses invented prices or sales', () => {
    const [proposal] = buildMspRevenuePackages(base);
    expect(proposal.status).toBe('DRAFT_REQUIRES_APPROVAL');
    expect(proposal.evidence.basis).toBe('EVIDENCE_GAP');
    expect(proposal.evidence.unknowns).toContain('Restore-test evidence missing');
    expect(proposal.pricing.proposedAmount).toBeNull();
    expect(proposal.pricing.estimatedContribution).toBeNull();
  });

  it('uses only configured catalog prices and explicit costs', () => {
    const [proposal] = buildMspRevenuePackages({ ...base, catalog: { evidence_report: 299 } }, { directCostEstimate: 95 });
    expect(proposal.pricing.proposedAmount).toBe(299);
    expect(proposal.pricing.estimatedContribution).toBe(204);
    expect(proposal.pricing.source).toBe('CONFIGURED_CATALOG');
  });

  it('preserves linked findings and does not silently verify unknowns', () => {
    const proposals = buildMspRevenuePackages({
      ...base, observedEvidenceCount: 5, openCriticalOrHigh: 1, openFindings: 1,
      evidenceIds: ['ev-1'], findingIds: ['finding-1'],
      catalog: { security_assessment: 450 },
    });
    const remediation = proposals.find((p) => p.service === 'Security Remediation Assessment');
    expect(remediation?.evidence.findingIds).toEqual(['finding-1']);
    expect(remediation?.evidence.evidenceIds).toEqual(['ev-1']);
    expect(remediation?.status).toBe('DRAFT_REQUIRES_APPROVAL');
    expect(proposals.some((p) => p.evidence.unknowns.includes('Restore-test evidence missing'))).toBe(true);
  });

  it('rejects fabricated negative or invalid costs', () => {
    expect(() => buildMspRevenuePackages(base, { directCostEstimate: -1 })).toThrow();
    expect(() => buildMspRevenuePackages(base, { directCostEstimate: Number.NaN })).toThrow();
  });
});
