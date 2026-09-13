import { describe, expect, it } from 'vitest';
import { readCode, code } from './helpers/source-contract.ts';

const route = () => readCode('src/routes/free-review-legacy.ts');
const view = () => readCode('src/components/FreeReviewView.tsx');

describe('the free preview response withholds paid detail server-side', () => {
  it('returns aggregates, not the raw finding and evidence rows', () => {
    const source = route();
    expect(source).toContain(code`findings: { total: openFindings.length, elevated: criticalOrHigh.length, bySeverity, teasers }`);
    expect(source).toContain(code`evidence: { total: evidence.length, verified: verifiedEvidence, unverified: evidence.length - verifiedEvidence, byType: evidenceByType }`);
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

  it('reads the SBOM for its counts only, and never returns the components', () => {
    const source = route();
    expect(source).toContain(code`return { sbomComponentCount: parsed.length, licenceUnevaluatedComponentCount: parsed.filter((c: any) => !isLicenceEvaluable(c)).length };`);
    expect(source).not.toMatch(/sbomComponentss*:/);
    expect(source).toContain(code`sbom: { componentCount: sbomComponentCount }`);
    expect(source).toContain(code`const passport = passportRow ? { id: passportRow.id, name: passportRow.name, version: passportRow.version, publisher: passportRow.publisher, category: passportRow.category, verificationStatus: passportRow.verificationStatus } : null;`);
  });

  it('scores from the real security engine status, not from the overall scan status', () => {
    expect(route()).toContain(code`securityEngineCompleted: jobs.some((j: any) => String(j.job_type) === 'repository_security_scan' && j.status === 'Completed')`);
  });

  it('lists only capabilities whose evidence actually exists', () => {
    const source = route();
    expect(source).toContain(code`const engineIds = new Set(evidence.map((e: any) => String(e.engineId || '').trim()).filter(Boolean));`);
    expect(source).toContain(code`].filter((entry): entry is string => typeof entry === 'string');`);
  });
});

describe('the preview page renders only what the API sends', () => {
  it('does not map over raw findings', () => {
    const source = view();
    expect(source).not.toContain(code`result.findings.slice(0, 20).map`);
    expect(source).not.toContain(code`f.component`);
  });

  it('shows no score rather than a zero when nothing could be observed', () => {
    const source = view();
    expect(source).toContain(code`{result.assessment.score ?? '—'}`);
    expect(source).toContain('Not measured');
    expect(source).toContain('UNKNOWN');
  });

  it('keeps unobserved trust areas visible and neutrally worded', () => {
    const source = view();
    expect(source).toContain('What SPR could not verify');
    expect(source).toContain("value.status === 'not_observed'");
    expect(source).toContain('areas without enough evidence');
  });

  it('states zero verification as zero verification', () => {
    const source = view();
    expect(source).toContain('Verified');
    expect(source).toContain('capabilities with evidence');
    expect(source).toContain('No capability is presented as verified without supporting evidence.');
  });

  it('keeps the evidence-driven progress display', () => {
    const source = view();
    expect(source).toContain('result?.progress?.percent');
    expect(source).toContain('result.progress.elapsedSeconds');
    expect(source).toContain('Progress is read from the scan job. SPR does not invent movement or a result.');
  });
});
