import { describe, expect, it } from 'vitest';
import { buildVendorDeficits, buildVendorEvidenceRequestText } from './vendorEvidenceRequest';

describe('vendor evidence request', () => {
  it('preserves missing evidence as unresolved and never fabricates source records', () => {
    const deficits = buildVendorDeficits({ evidence: [], findings: [], repositoryScan: { sbomComponentCount: 0 } });
    expect(deficits.map((d) => d.status)).toEqual(['UNVERIFIED', 'INSUFFICIENTLY OBSERVED', 'INCOMPLETE']);
    expect(deficits.every((d) => d.matchingEvidence.length === 0)).toBe(true);
  });

  it('includes attributable evidence identifiers and limitations in the generated request', () => {
    const report = {
      generatedAt: '2026-10-04T20:00:00Z',
      reportHash: 'abc123',
      evidence: [{ id: 'ev_1', subject: 'code signing certificate', status: 'UNKNOWN', source_url: 'https://vendor.example/signing', observed_at: '2026-10-04T19:00:00Z', limitation: 'certificate chain unavailable' }],
      repositoryScan: { sbomComponentCount: 2 },
    };
    const letter = buildVendorEvidenceRequestText({ report, productName: 'Widget', version: '1.2.3' });
    expect(letter).toContain('ev_1');
    expect(letter).toContain('certificate chain unavailable');
    expect(letter).toContain('SPR-PROV-001');
    expect(letter).toContain('abc123');
  });

  it('does not turn a single verified record into a passing deficit state', () => {
    const deficits = buildVendorDeficits({ evidence: [{ id: 'ev_sig', subject: 'signed release', status: 'VERIFIED' }] });
    expect(deficits[0].status).toBe('UNVERIFIED');
    expect(deficits[0].currentResult).toContain('remains conservative');
  });
});
