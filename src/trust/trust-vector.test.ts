import { describe, expect, it } from 'vitest';
import { computeTrustVector, TRUST_DIMENSIONS, type TrustVectorInput } from './trust-vector.ts';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const empty: TrustVectorInput = {
  passportId: 'p1', now: NOW, evidenceCompleteness: null, sbomComponentCount: null,
  lastDependencyScanCompletedAt: null, lastSecurityScanCompletedAt: null, lastRepositoryAcquiredAt: null, lastObservationAt: null,
  findings: [], evidence: [], vendor: null, monitoring: [], remediationTasks: [],
};

describe('12-dimension Trust Vector', () => {
  it('has exactly twelve dimensions and every one is UNKNOWN when nothing was observed', () => {
    expect(TRUST_DIMENSIONS).toHaveLength(12);
    const v = computeTrustVector(empty);
    expect(v.dimensions).toHaveLength(12);
    expect(v.unknownCount).toBe(12);
    for (const d of v.dimensions) { expect(d.value).toBeNull(); expect(d.status).toBe('unknown'); expect(d.detail.length).toBeGreaterThan(10); }
    expect(v.policy).toContain('UNKNOWN, not a low score');
  });

  it('a completed scan with no findings is an observed reading, and each reading lists its basis records', () => {
    const v = computeTrustVector({ ...empty, sbomComponentCount: 40, lastDependencyScanCompletedAt: '2026-09-12T00:00:00.000Z', lastSecurityScanCompletedAt: '2026-09-12T00:00:00.000Z',
      findings: [
        { id: 'f_crit', severity: 'Critical', category: 'Vulnerability', status: 'Open', detectedAt: '2026-08-01T00:00:00.000Z', fixedVersion: '2.0.0', component: 'lodash@1.0.0', updatedAt: null },
        { id: 'f_done', severity: 'High', category: 'Vulnerability', status: 'Resolved', detectedAt: '2026-08-01T00:00:00.000Z', fixedVersion: null, component: 'x@1', updatedAt: null },
        { id: 'f_lic', severity: 'medium', category: 'License', status: 'Open', detectedAt: '2026-09-12T00:00:00.000Z', fixedVersion: null, component: 'y', updatedAt: null },
      ] });
    const byId = Object.fromEntries(v.dimensions.map((d) => [d.id, d]));
    expect(byId.vulnerability_exposure.value).toBe(65);
    expect(byId.vulnerability_exposure.basisIds).toEqual(['f_crit']);
    expect(byId.secrets_and_configuration.value).toBe(100);
    expect(byId.licence_compliance.value).toBe(98);
    expect(byId.licence_compliance.basisIds).toEqual(['f_lic']);
    expect(byId.remediation_responsiveness.status).toBe('observed');
    expect(byId.remediation_responsiveness.basisIds).toContain('f_done');
    expect(byId.evidence_freshness.value).toBe(100);
    // Never observed → still unknown, even though scans ran.
    expect(byId.vendor_due_diligence.value).toBeNull();
    expect(byId.monitoring_coverage.value).toBeNull();
    expect(byId.evidence_verification.value).toBeNull();
  });

  it('evidence verification is the observed share, never assumed', () => {
    const v = computeTrustVector({ ...empty, evidence: [
      { id: 'e1', type: 'Signature', verified: true, status: 'VERIFIED', timestamp: '2026-09-01T00:00:00.000Z' },
      { id: 'e2', type: 'Audit Report', verified: false, status: 'OBSERVED', timestamp: '2026-09-01T00:00:00.000Z' },
    ] });
    const byId = Object.fromEntries(v.dimensions.map((d) => [d.id, d]));
    expect(byId.evidence_verification.value).toBe(50);
    expect(byId.provenance_and_integrity.value).toBe(90);
    expect(byId.provenance_and_integrity.basisIds).toEqual(['e1']);
  });

  it('never produces a blended overall number', () => {
    const v = computeTrustVector(empty) as any;
    expect(v.overall).toBeUndefined();
    expect(v.overallScore).toBeUndefined();
  });
});
