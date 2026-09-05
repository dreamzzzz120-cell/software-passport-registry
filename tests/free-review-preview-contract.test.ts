import { describe, expect, it } from 'vitest';
import { readCode, code } from './helpers/source-contract.ts';

const route = () => readCode('src/routes/free-review-legacy.ts');
const view = () => readCode('src/components/FreeReviewView.tsx');

// The Free Review status endpoint is reachable by anyone holding the signed
// status token, which every anonymous visitor receives. It used to return every
// finding with its title, description and affected component, and every evidence
// item with its signer -- the whole paid report, to an unauthenticated caller,
// with the browser as the only thing deciding what to show. These contracts hold
// the line that the withholding happens server-side.
describe('the free preview response withholds paid detail server-side', () => {
  it('returns aggregates, not the raw finding and evidence rows', () => {
    const source = route();
    expect(source).toContain(code`findings: { total: openFindings.length, elevated: criticalOrHigh.length, bySeverity, teasers }`);
    expect(source).toContain(code`evidence: { total: evidence.length, verified: verifiedEvidence, unverified: evidence.length - verifiedEvidence, byType: evidenceByType }`);
    // The bare arrays must not be spread into the response any more.
    expect(source).not.toMatch(/return res\.json\(\{[^}]*\bfindings,/);
    expect(source).not.toMatch(/return res\.json\(\{[^}]*\bevidence,/);
  });

  it('never sends a finding description, title or affected component to a free caller', () => {
    const source = route();
    const responseStart = source.indexOf('return res.json({ passportId, scanStatus, failureReason, progress, passport, assessment');
    expect(responseStart).toBeGreaterThan(-1);
    const response = source.slice(responseStart);
    for (const leaked of ['f.description', 'f.title', 'f.component', 'e.signer', 'e.hash', 'rawContent']) {
      expect(response, `${leaked} must not appear in the free response`).not.toContain(leaked);
    }
  });

  it('builds teasers from real rows carrying only severity, category and a count', () => {
    const source = route();
    expect(source).toContain(code`const teaserMap = new Map<string, { category: string; severity: string; count: number }>();`);
    expect(source).toContain(code`for (const f of openFindings) {`);
  });

  it('reads the SBOM for its length only, and never returns the components', () => {
    const source = route();
    expect(source).toContain(code`return Array.isArray(parsed) && parsed.length > 0 ? parsed.length : null;`);
    expect(source).toContain(code`sbom: { componentCount: sbomComponentCount }`);
    // The passport object handed back is rebuilt field by field, so the sbom
    // column cannot ride along on a SELECT *.
    expect(source).toContain(code`const passport = passportRow ? { id: passportRow.id, name: passportRow.name, version: passportRow.version, publisher: passportRow.publisher, category: passportRow.category, verificationStatus: passportRow.verificationStatus } : null;`);
  });

  it('scores from the real security engine status, not from the overall scan status', () => {
    expect(route()).toContain(code`securityEngineCompleted: jobs.some((j: any) => String(j.job_type) === 'repository_security_scan' && j.status === 'Completed')`);
  });

  it('lists only capabilities whose evidence actually exists', () => {
    const source = route();
    expect(source).toContain(code`const engineIds = new Set(evidence.map((e: any) => String(e.engineId || '')).filter(Boolean));`);
    expect(source).toContain(code`].filter((entry): entry is string => typeof entry === 'string');`);
  });
});

describe('the preview page renders only what the API sends', () => {
  it('no longer maps over raw findings', () => {
    const source = view();
    expect(source).not.toContain(code`result.findings.slice(0, 20).map`);
    expect(source).not.toContain(code`f.component`);
  });

  it('shows no score rather than a zero when nothing could be observed', () => {
    const source = view();
    expect(source).toContain(code`No trust area could be observed for this repository, so SPR reports no score. That is an absence of evidence, not a poor result.`);
  });

  it('keeps the unobserved categories visible and neutrally worded', () => {
    const source = view();
    expect(source).toContain(code`['reliability', '🧱', 'Reliability'],`);
    expect(source).toContain(code`['maintainability', '🔧', 'Maintainability'],`);
    expect(source).toContain(code`Not observed`);
  });

  it('states zero verification as zero verification', () => {
    expect(view()).toContain(code`None of the ${'${result.evidence.total}'} evidence items are cryptographically verified.`.replace('${result.evidence.total}', '${result.evidence.total}'));
  });

  it('keeps the evidence-driven progress display', () => {
    const source = view();
    expect(source).toContain(code`aria-valuenow={result?.progress?.percent ?? 0}`);
    expect(source).toContain(code`elapsed`);
  });
});
