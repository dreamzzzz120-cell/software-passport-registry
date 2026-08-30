import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptEvidenceForEvaluation, sourceFromSigner, claimFromEvidence } from '../src/lib/verification/evidenceAdapter.ts';
import { evaluateVerification } from '../src/lib/verification/evaluateVerification.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const SHA = 'df476048d023ff868cd45b35ee47f5fb0ca2b25a';
const NOW = Date.parse('2026-08-30T00:00:00.000Z');
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

// Evidence rows in the exact shape the workers actually persist.
const REAL_ROWS = [
  { id: 'ev-repo-1', name: 'Repository source descriptor', signer: 'github.com', timestamp: iso(1), hash: 'sha256:aaa' },
  { id: 'ev-sbom-1', name: 'Syft CycloneDX SBOM summary', signer: 'Syft 1.49.0', timestamp: iso(1), hash: 'sha256:bbb' },
  { id: 'ev-osv-1', name: 'OSV response for actions/checkout@v4', signer: 'api.osv.dev', timestamp: iso(1), hash: 'sha256:ccc' },
  { id: 'ev-osv-2', name: 'OSV response for actions/setup-node@v4', signer: 'api.osv.dev', timestamp: iso(1), hash: 'sha256:ddd' },
  { id: 'ev-sec-1', name: 'Multi-engine repository security scan', signer: 'SPR scanner', timestamp: iso(1), hash: 'sha256:eee' },
];

const run = (rows: typeof REAL_ROWS, openFindingEvidenceIds: string[] = [], version: string | null = SHA) => {
  const adapted = adaptEvidenceForEvaluation({ evidence: rows, passportVersion: version, openFindingEvidenceIds });
  return { adapted, decision: evaluateVerification({ evidence: adapted.evidence, evaluatedAt: NOW, targetIdentity: adapted.targetIdentity }) };
};

describe('adapter maps real worker evidence honestly', () => {
  it('derives source identity from the recorded signer', () => {
    expect(sourceFromSigner('github.com')).toBe('github.com');
    expect(sourceFromSigner('api.osv.dev')).toBe('api.osv.dev');
    expect(sourceFromSigner('Syft 1.49.0')).toBe('syft');
    expect(sourceFromSigner('SPR scanner')).toBe('spr-scanner');
    // Never guessed into a trusted source.
    expect(sourceFromSigner('totally-made-up')).toBe('unknown');
    expect(sourceFromSigner(null)).toBe('unknown');
  });

  it('excludes records it cannot map instead of attaching them to a claim', () => {
    const { adapted } = run([...REAL_ROWS, { id: 'x', name: 'Something unrecognised', signer: 'mystery', timestamp: iso(1), hash: 'sha256:x' }]);
    expect(adapted.unmappedCount).toBe(1);
    expect(adapted.evidence.map((e) => e.evidenceId)).not.toContain('x');
  });

  it('preserves a missing hash as missing rather than inventing provenance', () => {
    const { adapted } = run([{ id: 'ev-repo-1', name: 'Repository source descriptor', signer: 'github.com', timestamp: iso(1), hash: null } as any]);
    expect(adapted.evidence[0].contentHash).toBeUndefined();
  });

  it('treats a non-SHA passport version as unpinned', () => {
    const { adapted } = run(REAL_ROWS, [], '1.0.0');
    expect(adapted.targetIdentity).toBeNull();
  });

  it('reports undated records instead of silently dropping them', () => {
    const { adapted } = run([{ id: 'nodate', name: 'OSV response for x', signer: 'api.osv.dev', timestamp: null, hash: 'sha256:z' } as any]);
    expect(adapted.undatedCount).toBe(1);
  });
});

describe('integrated decision on realistic production evidence', () => {
  it('a repository scan alone does NOT reach VERIFIED', () => {
    const { decision } = run(REAL_ROWS);
    expect(decision.state).not.toBe('VERIFIED');
    // BUILD_PROVENANCE has no publisher attestation, so it stays UNKNOWN.
    expect(decision.claims.find((c) => c.claimId === 'BUILD_PROVENANCE')!.state).toBe('UNKNOWN');
  });

  it('repeated OSV observations remain one independent source', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `ev-osv-${i}`, name: `OSV response for pkg-${i}`, signer: 'api.osv.dev', timestamp: iso(1), hash: `sha256:${i}`,
    }));
    const { decision } = run(many as typeof REAL_ROWS);
    const claim = decision.claims.find((c) => c.claimId === 'DEPENDENCY_VULNERABILITY_STATE')!;
    expect(claim.distinctSources).toEqual(['api.osv.dev']);
    expect(decision.observationCount).toBe(300);
    expect(decision.independentSourceCount).toBe(1);
  });

  it('open findings drive INVESTIGATE rather than a silent pass', () => {
    const { decision } = run(REAL_ROWS, ['ev-osv-1']);
    expect(decision.state).toBe('INVESTIGATE');
    expect(decision.reasonCodes).toContain('ADVERSE_FINDINGS_PRESENT');
  });

  it('policy version and reason codes survive into the decision', () => {
    const { decision } = run(REAL_ROWS);
    expect(decision.policyVersion).toBe('1.0.0');
    expect(decision.reasonCodes.length).toBeGreaterThan(0);
    expect(decision.claims.every((c) => c.reasonCodes.length > 0)).toBe(true);
  });

  it('is deterministic across repeated evaluation', () => {
    expect(JSON.stringify(run(REAL_ROWS).decision)).toBe(JSON.stringify(run(REAL_ROWS).decision));
  });

  it('no evidence yields UNKNOWN, distinct from a retrieval failure', () => {
    const { decision } = run([]);
    expect(decision.state).toBe('UNKNOWN');
    expect(decision.reasonCodes).toContain('NO_EVIDENCE');
  });
});

describe('the API endpoint is authoritative and safely scoped', () => {
  const source = read('src/routes/auth.ts');

  it('exists, requires auth, and calls the single evaluator', () => {
    expect(source).toContain("router.get('/user/passports/:id/verification', requireAuth");
    expect(source).toContain('evaluateVerification({');
    expect(source).toContain('adaptEvidenceForEvaluation({');
  });

  it('scopes every query by tenant and respects Client-role restriction', () => {
    const start = source.indexOf("'/user/passports/:id/verification'");
    const handler = source.slice(start, start + 3000);
    expect(handler).toContain('tenant_id=${tenantId}');
    expect(handler).toContain('clientScope');
    // Same 404 whether absent or another tenant's - no existence probing.
    expect(handler).toContain("res.status(404).json({ error: 'Passport not found' })");
  });

  it('never caches a private decision', () => {
    const start = source.indexOf("'/user/passports/:id/verification'");
    expect(source.slice(start, start + 3000)).toContain("'private, max-age=0, no-store'");
  });

  it('reports observations separately from independent sources', () => {
    const start = source.indexOf("'/user/passports/:id/verification'");
    const handler = source.slice(start, start + 3000);
    expect(handler).toContain('observations:');
    expect(handler).toContain('independentSources:');
  });

  it('introduces no unsafe casts in the verification modules', () => {
    for (const file of ['src/lib/verification/evidenceAdapter.ts', 'src/lib/verification/evaluateVerification.ts', 'src/lib/verification/verificationPolicy.ts']) {
      const code = read(file);
      expect(code, file).not.toContain('@ts-ignore');
      expect(code, file).not.toContain('as unknown as');
    }
  });
});

describe('display layer formats the authoritative decision without reinterpreting it', () => {
  it('maps every evaluator state, and never upgrades one to a stronger state', async () => {
    const { trustStateFromDecision } = await import('../src/components/trust/TrustStateBadge.tsx');
    expect(trustStateFromDecision('VERIFIED')).toBe('VERIFIED');
    expect(trustStateFromDecision('PARTIAL')).toBe('PARTIALLY_VERIFIED');
    expect(trustStateFromDecision('UNKNOWN')).toBe('EVIDENCE_INCOMPLETE');
    // Neither adverse state may present as a pass.
    expect(trustStateFromDecision('INVESTIGATE')).not.toBe('VERIFIED');
    expect(trustStateFromDecision('AVOID')).not.toBe('VERIFIED');
    // Absent decision must not default to anything reassuring.
    expect(trustStateFromDecision(null)).toBe('UNINITIALIZED');
    expect(trustStateFromDecision(undefined)).toBe('UNINITIALIZED');
  });

  it('only VERIFIED from the evaluator can display as VERIFIED', async () => {
    const { trustStateFromDecision } = await import('../src/components/trust/TrustStateBadge.tsx');
    for (const state of ['PARTIAL', 'INVESTIGATE', 'AVOID', 'UNKNOWN'] as const) {
      expect(trustStateFromDecision(state)).not.toBe('VERIFIED');
    }
  });

  it('the legacy column mapping is documented as legacy and not authoritative', () => {
    const source = read('src/components/trust/TrustStateBadge.tsx');
    expect(source).toContain('LEGACY mapping');
    expect(source).toContain('NOT the authoritative verification decision');
    expect(source).toContain('trustStateFromDecision');
  });

  it('there is exactly one evaluator in the repository', () => {
    const evaluator = read('src/lib/verification/evaluateVerification.ts');
    expect(evaluator).toContain('export function evaluateVerification');
    // No presentation layer may implement its own predicate.
    for (const file of ['src/components/trust/TrustStateBadge.tsx', 'src/components/EvidenceDashboardView.tsx']) {
      expect(read(file), file).not.toContain('minThirdPartySources');
      expect(read(file), file).not.toContain('maxAgeDays');
    }
  });
});

describe('batch verification is orchestration, not a second evaluator', () => {
  const source = read('src/routes/auth.ts');

  it('exists, requires auth, and reuses the single adapter and evaluator', () => {
    expect(source).toContain("router.get('/user/verification', requireAuth");
    const start = source.indexOf("'/user/verification'");
    const handler = source.slice(start, start + 4000);
    expect(handler).toContain('adaptEvidenceForEvaluation({');
    expect(handler).toContain('evaluateVerification({');
    // No predicate of its own.
    expect(handler).not.toContain('minThirdPartySources');
    expect(handler).not.toContain('maxAgeDays');
  });

  it('avoids N+1: evidence and findings are fetched in one query each', () => {
    const start = source.indexOf("'/user/verification'");
    const handler = source.slice(start, start + 4000);
    expect(handler).toContain('asset_id = ANY(');
    expect(handler).toContain('evidenceByPassport');
  });

  it('stays tenant-scoped, Client-restricted and uncacheable', () => {
    const start = source.indexOf("'/user/verification'");
    const handler = source.slice(start, start + 4000);
    expect(handler).toContain('tenant_id=${tenantId}');
    expect(handler).toContain('clientScope');
    expect(handler).toContain("'private, max-age=0, no-store'");
  });

  it('uses one evaluation instant so freshness is consistent across the batch', () => {
    const start = source.indexOf("'/user/verification'");
    expect(source.slice(start, start + 4000)).toContain('const evaluatedAt = Date.now()');
  });
});

describe('PDF makes no claim stronger than the authoritative decision', () => {
  it('an unassessed score reads NOT ASSESSED rather than 0/100', async () => {
    const { scoreDisplay, assessmentDisplay } = await import('../src/utils/pdfGenerator.ts');
    expect(scoreDisplay(0)).toBe('NOT ASSESSED');
    expect(scoreDisplay(null)).toBe('NOT ASSESSED');
    expect(scoreDisplay(undefined)).toBe('NOT ASSESSED');
    expect(assessmentDisplay(0)).toBe('NOT ASSESSED');
    // A genuine value is still shown if one is ever computed.
    expect(scoreDisplay(81)).toBe('81/100');
    expect(assessmentDisplay(40)).toBe('40%');
  });

  it('never prints an unqualified Safe risk claim', async () => {
    const { riskDisplay } = await import('../src/utils/pdfGenerator.ts');
    expect(riskDisplay('Safe')).toBe('Risk not assessed');
    expect(riskDisplay('Unknown')).toBe('Risk not assessed');
    expect(riskDisplay('')).toBe('Risk not assessed');
    expect(riskDisplay('High')).toContain('not verified');
  });

  it('the PDF no longer colours an unassessed client green or asserts Safe Risk', () => {
    const pdf = read('src/utils/pdfGenerator.ts');
    expect(pdf).not.toContain("client.riskLevel === 'Safe' ? [16, 185, 129]");
    expect(pdf).not.toContain("client.riskLevel + ' Risk'");
    expect(pdf).not.toContain('`${client.trustScore}/100`');
  });
});

describe('TrustRoom and MSPCommandCenter consume the authoritative decision', () => {
  it('TrustRoom no longer uses the legacy column mapping', () => {
    const source = read('src/components/trust/TrustRoom.tsx');
    expect(source).toContain('trustStateFromDecision(verificationDecision)');
    expect(source).not.toContain('trustStateFromVerification');
    expect(source).not.toContain('passport.verificationStatus');
  });

  it('MSPCommandCenter maps grid state and rollup counts from decisions', () => {
    const source = read('src/components/MSPCommandCenter.tsx');
    expect(source).toContain('trustStateFromDecision(verificationDecisions?.[item.passportId])');
    expect(source).toContain("const decision = verificationDecisions?.[passport.id]");
    expect(source).not.toContain('trustStateFromVerification');
    expect(source).not.toContain("passport.verificationStatus === 'verified'");
  });

  it('MSPCommandCenter issues no per-passport verification request (no N+1)', () => {
    const source = read('src/components/MSPCommandCenter.tsx');
    // Assert against code only: prose like "verification time" appears in
    // this component's copy, and its props doc comment names the batch
    // endpoint precisely to explain that the grid does NOT call it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('/api/user/verification');
    expect(code).not.toMatch(/user\/passports\/[^'`]*\/verification/);
    expect(code).not.toContain('apiFetch(`/api/user/passports/');
  });

  it('App fetches decisions once via the batch endpoint and passes them down', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("apiFetch('/api/user/verification')");
    expect((app.match(/api\/user\/verification/g) || []).length).toBe(1);
    // Both surfaces receive the decisions; adjacency of props is not pinned,
    // so adding a prop cannot break the behaviour this guards.
    expect(app).toContain('verificationDecisions={verificationDecisions}');
    expect(app).toContain('<PassportsView verificationDecisions={verificationDecisions}');
    expect(app).toContain('<MSPCommandCenter');
    expect(app).toContain('verificationDetails={verificationDetails}');
  });

  it('a failed batch retrieval never becomes a reassuring state', () => {
    const app = read('src/App.tsx');
    // Failure clears the map; an absent decision renders UNINITIALIZED.
    expect(app).toContain('setVerificationDecisions({})');
    expect(app).not.toContain("state: 'VERIFIED'");
  });

  it('each passport receives its own decision, keyed by its own id', () => {
    const msp = read('src/components/MSPCommandCenter.tsx');
    expect(msp).toContain('verificationDecisions?.[item.passportId]');
    const pv = read('src/components/PassportsView.tsx');
    expect(pv).toContain('verificationDecisions?.[selected.id]');
  });
});
