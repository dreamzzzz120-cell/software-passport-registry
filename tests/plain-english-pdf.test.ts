import { describe, expect, it } from 'vitest';
import { buildPlainEnglishPdf } from '../src/utils/plainEnglishPdf';
import { toPlainEnglish, type CanonicalReport } from '../src/trust/plain-english-report';

describe('explained report PDF', () => {
  it('includes unknowns and source limitations, and paginates long records', () => {
    const canonical: CanonicalReport = {
      passport: { id: 'p', name: 'Example software' },
      risk: { overall: null, security: null, compliance: null, verificationStatus: 'unverified' },
      evidenceQuality: { completenessBasisPoints: 0, unknownDimensions: 3, latestObservationAt: null },
      findings: [{ id: 'f', control_id: 'mfa', title: 'Sign-in review', severity: 'high', status: 'UNKNOWN', description: 'Evidence unavailable. '.repeat(300), remediation: '', updated_at: '2026-10-08', resolved_at: null }],
      evidence: [{ id: 'e', provider: 'Example source', control_id: 'mfa', observed_at: '2026-10-08', verification_method: 'API', status: 'UNKNOWN', limitation: 'Only one workspace observed.' }],
      generatedAt: '2026-10-08',
    };
    const doc = buildPlainEnglishPdf(toPlainEnglish(canonical));
    const serialized = doc.output();
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(serialized).toContain('Not calculable');
    expect(serialized).toContain('Only one workspace observed.');
    expect(serialized).toContain('Page 1 of');
    expect(serialized).toContain('Plain-language glossary');
    expect(serialized).toContain('Unknown');
  });
});
