import { describe, expect, it } from 'vitest';
import {
  SEVERITY_WEIGHTS,
  assessTrust,
  scoreLicensing,
  scoreSecurity,
  scoreSupplyChain,
  severityBreakdown,
  verdictFor,
  type ScoringInput,
} from '../src/free-review/scoring.ts';

const base: ScoringInput = {
  securityEngineCompleted: true,
  repositoryEngineCompleted: true,
  findings: [],
  sbomComponentCount: null,
  evidence: [],
};

const finding = (severity: string, category = 'Secret', status = 'open') => ({ severity, category, status });
const evidence = (type: string, verified: boolean | number = 0, engineId = 'engine-a') => ({ type, verified, engineId });

describe('security score', () => {
  it('is 100 when the engine completed and found nothing, and says so without implying a clean bill of health', () => {
    const result = scoreSecurity(base);
    expect(result).toMatchObject({ status: 'scored', score: 100 });
    expect(result.status === 'scored' && result.detail).toBe('No findings observed by the completed security engine.');
  });

  it('deducts the documented weight for each severity', () => {
    expect(scoreSecurity({ ...base, findings: [finding('critical')] })).toMatchObject({ score: 100 - SEVERITY_WEIGHTS.critical });
    expect(scoreSecurity({ ...base, findings: [finding('high')] })).toMatchObject({ score: 100 - SEVERITY_WEIGHTS.high });
    expect(scoreSecurity({ ...base, findings: [finding('medium')] })).toMatchObject({ score: 100 - SEVERITY_WEIGHTS.medium });
    expect(scoreSecurity({ ...base, findings: [finding('low')] })).toMatchObject({ score: 100 - SEVERITY_WEIGHTS.low });
    expect(scoreSecurity({ ...base, findings: [finding('info')] })).toMatchObject({ score: 100 });
  });

  it('adds mixed severities together', () => {
    const result = scoreSecurity({ ...base, findings: [finding('critical'), finding('high'), finding('medium'), finding('low')] });
    expect(result).toMatchObject({ score: 100 - (25 + 15 + 8 + 3) });
  });

  it('floors at zero rather than going negative', () => {
    const many = Array.from({ length: 20 }, () => finding('critical'));
    expect(scoreSecurity({ ...base, findings: many })).toMatchObject({ status: 'scored', score: 0 });
  });

  it('ignores findings that are already resolved', () => {
    expect(scoreSecurity({ ...base, findings: [finding('critical', 'Secret', 'resolved')] })).toMatchObject({ score: 100 });
  });

  it('does not count licence findings twice -- they are their own category', () => {
    expect(scoreSecurity({ ...base, findings: [finding('medium', 'License')] })).toMatchObject({ score: 100 });
  });

  // The dangerous case: a failed engine must never read as a clean result.
  it('is not observed when the security engine did not complete, never 100 and never 0', () => {
    const result = scoreSecurity({ ...base, securityEngineCompleted: false, findings: [] });
    expect(result.status).toBe('not_observed');
    expect(result).not.toHaveProperty('score');
  });
});

describe('licensing score', () => {
  it('is the real ratio of components carrying an observed licence', () => {
    const result = scoreLicensing({
      ...base,
      sbomComponentCount: 10,
      findings: [finding('medium', 'License'), finding('medium', 'License')],
    });
    expect(result).toMatchObject({ status: 'scored', score: 80 });
    expect(result.status === 'scored' && result.facts).toMatchObject({ components: 10, withLicence: 8, withoutLicence: 2 });
  });

  it('is 100 when every component declares a licence', () => {
    expect(scoreLicensing({ ...base, sbomComponentCount: 5, findings: [] })).toMatchObject({ score: 100 });
  });

  it('never reports more unlicensed components than the SBOM contains', () => {
    const result = scoreLicensing({
      ...base,
      sbomComponentCount: 2,
      findings: [finding('medium', 'License'), finding('medium', 'License'), finding('medium', 'License')],
    });
    expect(result).toMatchObject({ status: 'scored', score: 0 });
    expect(result.status === 'scored' && result.facts.withoutLicence).toBe(2);
  });

  it('is not observed when no SBOM was produced, rather than scoring zero', () => {
    expect(scoreLicensing({ ...base, sbomComponentCount: null }).status).toBe('not_observed');
    expect(scoreLicensing({ ...base, sbomComponentCount: 0 }).status).toBe('not_observed');
  });

  // Found in production: a run where both engines ended Failed still scored
  // licensing 0 of 9 components and published "35 / 100 -- HIGH RISK". A partial
  // component list is not a denominator.
  it('is not observed when the repository engine did not complete, even with components on hand', () => {
    const result = scoreLicensing({
      ...base,
      repositoryEngineCompleted: false,
      sbomComponentCount: 9,
      findings: Array.from({ length: 13 }, () => finding('medium', 'License')),
    });
    expect(result.status).toBe('not_observed');
    expect(result).not.toHaveProperty('score');
  });
});

describe('supply chain / buyer readiness score', () => {
  it('is not observed when nothing was collected', () => {
    expect(scoreSupplyChain({ ...base, evidence: [] }).status).toBe('not_observed');
  });

  it('rewards breadth across engines, capped', () => {
    const one = scoreSupplyChain({ ...base, evidence: [evidence('Build Log', 0, 'a')] });
    const two = scoreSupplyChain({ ...base, evidence: [evidence('Build Log', 0, 'a'), evidence('Build Log', 0, 'b')] });
    const three = scoreSupplyChain({ ...base, evidence: [evidence('Build Log', 0, 'a'), evidence('Build Log', 0, 'b'), evidence('Build Log', 0, 'c')] });
    expect(one).toMatchObject({ score: 20 });
    expect(two).toMatchObject({ score: 40 });
    expect(three).toMatchObject({ score: 40 });
  });

  it('credits an attestation when one is present', () => {
    const withAttestation = scoreSupplyChain({ ...base, evidence: [evidence('Attestation', 0, 'a')] });
    expect(withAttestation).toMatchObject({ score: 20 + 30 });
  });

  it('scales with the proportion of evidence that is actually verified', () => {
    const half = scoreSupplyChain({ ...base, evidence: [evidence('Build Log', 1, 'a'), evidence('Build Log', 0, 'a')] });
    // 20 breadth + 0 attestation + 15 verification
    expect(half).toMatchObject({ score: 35 });
  });

  // Today every free scan collects unverified evidence. The wording must not let
  // that read as successful verification.
  it('states plainly that nothing is verified when nothing is', () => {
    const result = scoreSupplyChain({ ...base, evidence: [evidence('Build Log', 0, 'a')] });
    expect(result.status === 'scored' && result.detail).toContain('None are cryptographically verified.');
  });
});

describe('overall assessment', () => {
  it('averages only the categories that were actually scored', () => {
    // security 100, licensing 80, supply chain 20 -> mean of three = 67
    const assessment = assessTrust({
      securityEngineCompleted: true,
      repositoryEngineCompleted: true,
      findings: [finding('medium', 'License'), finding('medium', 'License')],
      sbomComponentCount: 10,
      evidence: [evidence('Build Log', 0, 'a')],
    });
    expect(assessment.observedAreas).toBe(3);
    expect(assessment.totalAreas).toBe(5);
    expect(assessment.score).toBe(67);
  });

  it('keeps reliability and maintainability visible and unscored', () => {
    const assessment = assessTrust(base);
    expect(assessment.categories.reliability).toEqual({ status: 'not_observed', reason: 'No reliability collector currently produced evidence.' });
    expect(assessment.categories.maintainability).toEqual({ status: 'not_observed', reason: 'No maintainability collector currently produced evidence.' });
  });

  it('never lets an unobserved category drag the average down', () => {
    // Only security is observed, and it is perfect. The result must be 100 for
    // one area, not 20 because three others produced nothing.
    const assessment = assessTrust({ ...base, securityEngineCompleted: true });
    expect(assessment.observedAreas).toBe(1);
    expect(assessment.score).toBe(100);
  });

  it('reports no score at all when nothing could be observed', () => {
    const assessment = assessTrust({ ...base, securityEngineCompleted: false, repositoryEngineCompleted: false });
    expect(assessment.score).toBeNull();
    expect(assessment.verdict).toBeNull();
    expect(assessment.observedAreas).toBe(0);
  });

  // The exact production payload that exposed the defect: a Free Review of
  // expressjs/express on 2026-09-05 where both jobs ended Failed, yet 15
  // evidence items and 14 findings had been written before they died. It
  // published "35 / 100 -- HIGH RISK". A failed scan has no verdict.
  it('publishes no verdict for a run where every engine failed, however many rows it left behind', () => {
    const assessment = assessTrust({
      securityEngineCompleted: false,
      repositoryEngineCompleted: false,
      sbomComponentCount: 9,
      findings: [
        ...Array.from({ length: 13 }, () => finding('medium', 'License')),
        finding('high', 'Secret'),
      ],
      evidence: [
        ...Array.from({ length: 10 }, () => evidence('Security Scan', 0, 'osv-worker')),
        ...Array.from({ length: 4 }, () => evidence('Build Log', 0, 'repository-worker')),
        evidence('Attestation', 0, 'spr-security-orchestrator-v1'),
      ],
    });
    expect(assessment.score).toBeNull();
    expect(assessment.verdict).toBeNull();
    expect(assessment.observedAreas).toBe(0);
  });
});

describe('verdict bands', () => {
  it('maps each documented band', () => {
    expect(verdictFor(100)).toBe('STRONG');
    expect(verdictFor(90)).toBe('STRONG');
    expect(verdictFor(89)).toBe('GOOD');
    expect(verdictFor(75)).toBe('GOOD');
    expect(verdictFor(74)).toBe('INVESTIGATE');
    expect(verdictFor(60)).toBe('INVESTIGATE');
    expect(verdictFor(59)).toBe('ATTENTION');
    expect(verdictFor(40)).toBe('ATTENTION');
    expect(verdictFor(39)).toBe('HIGH RISK');
    expect(verdictFor(0)).toBe('HIGH RISK');
  });

  it('has no verdict without a score', () => {
    expect(verdictFor(null)).toBeNull();
  });
});

describe('severity breakdown', () => {
  it('counts open findings by severity and folds informational into info', () => {
    expect(severityBreakdown([
      finding('critical'), finding('high'), finding('high'),
      finding('medium'), finding('low'), finding('informational'),
      finding('critical', 'Secret', 'resolved'),
    ])).toEqual({ critical: 1, high: 2, medium: 1, low: 1, info: 1 });
  });
});

// Taken from a real production Free Review of expressjs/express on 2026-09-05:
// 13 medium License findings and 1 high Secret finding, 13 evidence items across
// osv-worker, repository-worker and spr-security-orchestrator-v1, one of them an
// attestation, none verified. Those are the observed values.
//
// The SBOM component total is the one number here that is NOT from that scan --
// the status API does not expose it yet, so 40 is a stand-in chosen only to
// exercise the ratio. When the API starts returning the real component count
// this figure should be replaced with it, and the licensing expectation below
// will move with it. It is called out rather than quietly asserted because a
// test that looks like production data but is not is its own kind of lie.
describe('a real production scan shape (expressjs/express)', () => {
  const realScan: ScoringInput = {
    securityEngineCompleted: true,
    repositoryEngineCompleted: true,
    findings: [
      ...Array.from({ length: 13 }, () => finding('medium', 'License')),
      finding('high', 'Secret'),
    ],
    sbomComponentCount: 40,
    evidence: [
      ...Array.from({ length: 10 }, () => evidence('Security Scan', 0, 'osv-worker')),
      ...Array.from({ length: 2 }, () => evidence('Build Log', 0, 'repository-worker')),
      evidence('Attestation', 0, 'spr-security-orchestrator-v1'),
    ],
  };

  it('scores the three observed areas and leaves two honestly unscored', () => {
    const assessment = assessTrust(realScan);
    expect(assessment.observedAreas).toBe(3);
    expect(assessment.categories.security).toMatchObject({ status: 'scored', score: 85 });
    expect(assessment.categories.licensing).toMatchObject({ status: 'scored', score: 68 });
    expect(assessment.categories.supplyChain).toMatchObject({ status: 'scored', score: 70 });
    expect(assessment.score).toBe(74);
    expect(assessment.verdict).toBe('INVESTIGATE');
  });
});
