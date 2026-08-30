import { describe, expect, it } from 'vitest';
import { evaluateVerification } from '../src/lib/verification/evaluateVerification.ts';
import { VERIFICATION_POLICY_VERSION, type NormalizedEvidence } from '../src/lib/verification/verificationPolicy.ts';

const NOW = Date.parse('2026-08-30T00:00:00.000Z');
const SHA = 'df476048d023ff868cd45b35ee47f5fb0ca2b25a';
const OTHER_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const daysAgo = (n: number) => NOW - n * 24 * 60 * 60 * 1000;

const ev = (over: Partial<NormalizedEvidence> & Pick<NormalizedEvidence, 'evidenceId' | 'claimId' | 'source'>): NormalizedEvidence => ({
  observedAt: daysAgo(1), contentHash: 'sha256:abc', targetIdentity: SHA, ...over,
});

const evaluate = (evidence: NormalizedEvidence[]) =>
  evaluateVerification({ evidence, evaluatedAt: NOW, targetIdentity: SHA });

// ---------------------------------------------------------------- GOLDEN
describe('golden fixtures', () => {
  it('1. no evidence -> UNKNOWN / NO_EVIDENCE', () => {
    const d = evaluate([]);
    expect(d.state).toBe('UNKNOWN');
    expect(d.reasonCodes).toContain('NO_EVIDENCE');
    expect(d.observationCount).toBe(0);
  });

  it('2. one observed third-party source verifies that claim only, passport stays PARTIAL', () => {
    const d = evaluate([ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com' })]);
    expect(d.claims.find((c) => c.claimId === 'REPOSITORY_IDENTITY')!.state).toBe('VERIFIED');
    // Other required claims have no evidence, so the passport cannot be VERIFIED.
    expect(d.state).toBe('PARTIAL');
  });

  it('3. repeated observations from ONE source are not independence', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      ev({ evidenceId: `osv-${i}`, claimId: 'DEPENDENCY_VULNERABILITY_STATE', source: 'api.osv.dev', contentHash: `sha256:${i}`, observedAt: daysAgo(i % 5) }),
    );
    const d = evaluate(many);
    const claim = d.claims.find((c) => c.claimId === 'DEPENDENCY_VULNERABILITY_STATE')!;
    expect(claim.distinctSources).toEqual(['api.osv.dev']);
    expect(d.observationCount).toBe(500);
    expect(d.independentSourceCount).toBe(1);
  });

  it('4. genuinely independent sources are counted separately', () => {
    const d = evaluate([
      ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com' }),
      ev({ evidenceId: 'e2', claimId: 'BUILD_PROVENANCE', source: 'publisher-attestation' }),
    ]);
    expect(d.independentSourceCount).toBe(2);
  });

  it('5. stale evidence cannot satisfy a claim but is still reported', () => {
    const d = evaluate([ev({ evidenceId: 'e1', claimId: 'DEPENDENCY_VULNERABILITY_STATE', source: 'api.osv.dev', observedAt: daysAgo(60) })]);
    const claim = d.claims.find((c) => c.claimId === 'DEPENDENCY_VULNERABILITY_STATE')!;
    expect(claim.state).toBe('UNKNOWN');
    expect(claim.reasonCodes).toContain('STALE_EVIDENCE');
    expect(d.observationCount).toBe(1);
  });

  it('6. missing provenance (no content hash) cannot verify', () => {
    const d = evaluate([ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com', contentHash: undefined })]);
    const claim = d.claims.find((c) => c.claimId === 'REPOSITORY_IDENTITY')!;
    expect(claim.state).toBe('UNKNOWN');
    expect(claim.reasonCodes).toContain('MISSING_PROVENANCE');
  });

  it('7. an unpinned target (branch name) cannot verify', () => {
    const d = evaluate([ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com', targetIdentity: 'main' })]);
    expect(d.claims.find((c) => c.claimId === 'REPOSITORY_IDENTITY')!.reasonCodes).toContain('UNPINNED_TARGET');
  });

  it('8. all required claims satisfied -> VERIFIED', () => {
    const d = evaluate([
      ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com' }),
      ev({ evidenceId: 'e2', claimId: 'DEPENDENCY_INVENTORY', source: 'github.com' }),
      ev({ evidenceId: 'e3', claimId: 'DEPENDENCY_VULNERABILITY_STATE', source: 'api.osv.dev' }),
      ev({ evidenceId: 'e4', claimId: 'BUILD_PROVENANCE', source: 'publisher-attestation' }),
    ]);
    expect(d.state).toBe('VERIFIED');
    expect(d.reasonCodes).toContain('POLICY_SATISFIED');
  });

  it('9. adverse evidence yields INVESTIGATE, never a silent pass or fail', () => {
    const d = evaluate([
      ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com' }),
      ev({ evidenceId: 'e3', claimId: 'DEPENDENCY_VULNERABILITY_STATE', source: 'api.osv.dev', adverse: true }),
    ]);
    expect(d.state).toBe('INVESTIGATE');
    expect(d.reasonCodes).toContain('ADVERSE_FINDINGS_PRESENT');
  });

  it('10. first-party-only evidence can never reach VERIFIED', () => {
    const d = evaluate([
      ev({ evidenceId: 'e1', claimId: 'DEPENDENCY_INVENTORY', source: 'syft' }),
      ev({ evidenceId: 'e2', claimId: 'SECRET_EXPOSURE_STATE', source: 'spr-scanner' }),
    ]);
    for (const id of ['DEPENDENCY_INVENTORY', 'SECRET_EXPOSURE_STATE'] as const) {
      const claim = d.claims.find((c) => c.claimId === id)!;
      expect(claim.state).not.toBe('VERIFIED');
      expect(claim.reasonCodes).toContain('INSUFFICIENT_INDEPENDENT_SOURCES');
    }
    expect(d.state).not.toBe('VERIFIED');
  });

  it('11. every decision carries the policy version', () => {
    expect(evaluate([]).policyVersion).toBe(VERIFICATION_POLICY_VERSION);
  });

  it('12. identical inputs produce identical decisions (determinism)', () => {
    const evidence = [
      ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com' }),
      ev({ evidenceId: 'e3', claimId: 'DEPENDENCY_VULNERABILITY_STATE', source: 'api.osv.dev' }),
    ];
    expect(JSON.stringify(evaluate(evidence))).toBe(JSON.stringify(evaluate([...evidence])));
  });
});

// ----------------------------------------------------------- ADVERSARIAL
describe('adversarial: the engine must not be fooled into VERIFIED', () => {
  it('cannot be verified by sheer volume of duplicate observations', () => {
    const d = evaluate(Array.from({ length: 5000 }, (_, i) =>
      ev({ evidenceId: `dup-${i}`, claimId: 'DEPENDENCY_VULNERABILITY_STATE', source: 'api.osv.dev' })));
    expect(d.state).not.toBe('VERIFIED');
  });

  it('cannot be verified by re-observing the same source under new job/evidence ids', () => {
    const d = evaluate(Array.from({ length: 50 }, (_, i) =>
      ev({ evidenceId: `job-${i}-osv`, claimId: 'BUILD_PROVENANCE', source: 'api.osv.dev' })));
    // OSV is not an accepted source for BUILD_PROVENANCE.
    expect(d.claims.find((c) => c.claimId === 'BUILD_PROVENANCE')!.state).toBe('UNKNOWN');
  });

  it('rejects evidence bound to a different commit', () => {
    const d = evaluate([ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com', targetIdentity: OTHER_SHA })]);
    expect(d.claims.find((c) => c.claimId === 'REPOSITORY_IDENTITY')!.reasonCodes).toContain('IDENTITY_MISMATCH');
  });

  it('rejects an unrecognised source claiming to be authoritative', () => {
    const d = evaluate([ev({ evidenceId: 'e1', claimId: 'BUILD_PROVENANCE', source: 'unknown' })]);
    expect(d.claims.find((c) => c.claimId === 'BUILD_PROVENANCE')!.state).toBe('UNKNOWN');
  });

  it('a future-dated observation is not rejected as stale but still needs a valid source', () => {
    const d = evaluate([ev({ evidenceId: 'e1', claimId: 'SECRET_EXPOSURE_STATE', source: 'spr-scanner', observedAt: NOW + 10_000 })]);
    expect(d.claims.find((c) => c.claimId === 'SECRET_EXPOSURE_STATE')!.state).not.toBe('VERIFIED');
  });

  it('never mutates the evidence it was given', () => {
    const evidence = [ev({ evidenceId: 'e1', claimId: 'REPOSITORY_IDENTITY', source: 'github.com' })];
    const snapshot = JSON.stringify(evidence);
    evaluate(evidence);
    expect(JSON.stringify(evidence)).toBe(snapshot);
  });

  it('separates observation count from unique evidence and independent sources', () => {
    const d = evaluate([
      ev({ evidenceId: 'same', claimId: 'DEPENDENCY_VULNERABILITY_STATE', source: 'api.osv.dev' }),
      ev({ evidenceId: 'same', claimId: 'DEPENDENCY_VULNERABILITY_STATE', source: 'api.osv.dev' }),
    ]);
    expect(d.observationCount).toBe(2);
    expect(d.uniqueEvidenceCount).toBe(1);
    expect(d.independentSourceCount).toBe(1);
  });
});

describe('purity', () => {
  it('does not read the clock: the caller supplies evaluatedAt', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const url = require('node:url') as typeof import('node:url');
    const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
    const raw = fs.readFileSync(path.join(root, 'src/lib/verification/evaluateVerification.ts'), 'utf8');
    // The doc comment states the purity guarantee in prose and names these
    // APIs, so assert against code only.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('Date.now(');
    expect(code).not.toContain('new Date(');
    expect(code).not.toContain('fetch(');
    expect(code).not.toContain('db.execute');
  });
});

describe('policy documentation matches the implementation (no drift)', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const url = require('node:url') as typeof import('node:url');
  const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const doc = fs.readFileSync(path.join(root, 'docs/verification-policy.md'), 'utf8');

  it('documents the same policy version the code exports', () => {
    expect(doc).toContain(`Policy version: ${VERIFICATION_POLICY_VERSION}`);
  });

  it('documents every claim id and every reason code', async () => {
    const { VERIFICATION_POLICY } = await import('../src/lib/verification/verificationPolicy.ts');
    for (const claim of VERIFICATION_POLICY.claims) expect(doc, claim.claimId).toContain(claim.claimId);
    for (const code of ['POLICY_SATISFIED', 'NO_EVIDENCE', 'REQUIRED_EVIDENCE_MISSING',
      'INSUFFICIENT_INDEPENDENT_SOURCES', 'STALE_EVIDENCE', 'MISSING_PROVENANCE',
      'IDENTITY_MISMATCH', 'UNPINNED_TARGET', 'ADVERSE_FINDINGS_PRESENT']) {
      expect(doc, code).toContain(code);
    }
  });

  it('states that unknown is not a safety failure and that SPR cannot verify itself', () => {
    // Normalize whitespace and markdown emphasis so line wrapping in the
    // document cannot break these assertions.
    const plain = doc.replace(/\*\*/g, '').replace(/\s+/g, ' ');
    expect(plain).toContain('Unknown is a successful result');
    expect(plain).toContain('never verify a claim');
    expect(plain).toContain('SPR vouching for SPR is not corroboration');
  });
});
