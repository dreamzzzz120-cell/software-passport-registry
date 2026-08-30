import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Trust Room renders only real Passport data', () => {
  const source = () => read('src/components/trust/TrustRoom.tsx');

  it('derives Current Trust State from the real verificationStatus via the shared mapping, not a local guess', () => {
    const s = source();
    expect(s).toContain("import TrustStateBadge, { trustStateFromDecision, type VerificationDecisionState } from './TrustStateBadge';");
    expect(s).toContain('const trustState = trustStateFromDecision(verificationDecision);');
  });

  it('reuses the existing TrustField rather than a second competing visualization', () => {
    const s = source();
    expect(s).toContain("import TrustField from './TrustField';");
    expect(s).toContain('<TrustField state={trustState}');
  });

  it('only shows the 4 real scoring-engine dimensions, with null rendered as N/A by TrustField, never invented here', () => {
    const s = source();
    expect(s).toContain("{ key: 'security', label: 'Security', value: passport.securityScore ?? null }");
    expect(s).toContain("{ key: 'compliance', label: 'Compliance', value: passport.complianceScore ?? null }");
    expect(s).toContain("{ key: 'vendor', label: 'Vendor Rep.', value: passport.vendorReputationScore ?? null }");
    expect(s).toContain("{ key: 'confidence', label: 'Confidence', value: passport.confidenceScore ?? null }");
  });

  it('Trust Score and Evidence Confidence show "Not available" rather than a fabricated number', () => {
    const s = source();
    expect(s).toContain("passport.overallScore == null ? 'Not available' : passport.overallScore");
    expect(s).toContain("passport.confidenceScore == null ? 'Not available' : `${passport.confidenceScore}%`");
  });

  it('"Why this state" is computed only from a real evidence count, never an AI-generated or invented explanation', () => {
    const s = source();
    expect(s).toContain('const verifiedEvidenceCount = evidence.filter((item) => item.status === \'VERIFIED\').length;');
    expect(s).toContain('No evidence has been recorded for this software yet.');
  });

  it('every evidence field renders "Not available" instead of inventing a source/hash/timestamp', () => {
    const s = source();
    expect(s).toContain("item.signer || 'Not available'");
    expect(s).toContain("formatTimestamp(item.timestamp) || 'Not available'");
    expect(s).toContain("item.hash || 'Not available'");
  });

  it('"What we don\'t know" lists real unmeasured dimensions and reuses the same SLSA-detection predicate as Lineage', () => {
    const s = source();
    expect(s).toContain('const unmeasuredDimensions = dimensions.filter((dimension) => dimension.value === null);');
    expect(s).toContain("function findSlsaEvidence(passport: SoftwarePassport)");
    expect(s).toContain("item.type === 'Attestation' && /slsa/i.test(item.name)");
  });

  it('"What changed" comes only from the real passport.timeline, with an honest empty state', () => {
    const s = source();
    expect(s).toContain('timeline.length > 0 ? (');
    expect(s).toContain('No observations yet.');
  });

  it('the zero-data empty state never shows a fabricated healthy/verified impression', () => {
    const s = source();
    expect(s).toContain('const zeroData = evidence.length === 0 && vulnerabilities.length === 0 && timeline.length === 0;');
    expect(s).toContain('Trust state: Unknown');
    expect(s).toContain('Evidence is not yet sufficient to establish a verified trust state.');
  });

  it('Share Passport calls the real, already-implemented public passport token endpoint, not a fake button', () => {
    const s = source();
    expect(s).toContain("apiFetch(`/api/public/v1/passports/${encodeURIComponent(passport.id)}/token`, { method: 'POST' })");
  });

  it('breadcrumb navigation uses real client/passport data and the real onNavigateTab handler', () => {
    const s = source();
    expect(s).toContain("onNavigateTab('/msp')");
    expect(s).toContain("onNavigateTab('/clients', client.id)");
  });
});

describe('TrustRoom is wired into the real Passport detail view without losing existing functionality', () => {
  const source = () => read('src/components/PassportsView.tsx');

  it('replaces the inline detail panel with TrustRoom, passing the real audit/remediation handlers through unchanged', () => {
    const s = source();
    expect(s).toContain('import TrustRoom from \'./trust/TrustRoom\';');
    expect(s).toContain('canRunAudit={canRunAudit}');
    expect(s).toContain('onRunAudit={() => void runAudit()}');
    expect(s).toContain('canCreateRemediation={canCreateRemediation}');
    expect(s).toContain('onCreateRemediation={(v) => void createRemediation(v)}');
    expect(s).toContain("onViewLineage={() => setTab('lineage')}");
  });

  it('resolves the owning client from the real softwareInventory relationship, not a fabricated lookup', () => {
    const s = source();
    expect(s).toContain('(c.softwareInventory || []).some((item) => item.passportId === selected.id)');
  });

  it('preserves the role-gated audit/remediation contract pinned by the UX audit test', () => {
    const s = source();
    expect(s).toContain('canRunAudit');
    expect(s).toContain('canCreateRemediation');
  });
});

describe('Trust Network -> Passport navigation is real, not a dead link', () => {
  it('MSPCommandCenter threads a real onSelectPassport through to TrustNetworkMap', () => {
    const s = read('src/components/MSPCommandCenter.tsx');
    expect(s).toContain('onSelectPassport?.(passportId)');
  });

  it('App.tsx wires the real setSelectedPassportId state into the Trust Network page', () => {
    const s = read('src/App.tsx');
    expect(s).toContain('onSelectPassport={setSelectedPassportId}');
  });
});
