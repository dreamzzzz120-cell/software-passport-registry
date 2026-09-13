export type VendorRiskStatus = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

export type VendorRiskFinding = {
  id: string;
  severity: string;
  status: string;
  title: string;
  updatedAt: string | null;
};

export type VendorRiskEvidence = {
  id: string;
  provider: string | null;
  observedAt: string | null;
  verificationMethod: string | null;
  status: string | null;
  limitation: string | null;
};

export type VendorRiskInput = {
  passport: { id: string; name: string };
  findings: VendorRiskFinding[];
  evidence: VendorRiskEvidence[];
  latestObservationAt: string | null;
  completeness: number | null;
  evaluatedAt: number;
  staleAfterDays?: number;
};

export type VendorRiskResult = {
  agent: 'vendor-risk';
  schemaVersion: 'spr-vendor-risk-v1';
  status: VendorRiskStatus;
  confidence: 'EVIDENCE_BACKED' | 'PARTIAL' | 'UNKNOWN';
  passport: VendorRiskInput['passport'];
  summary: string;
  triggers: Array<{ type: string; severity: string; evidenceIds: string[]; reason: string }>;
  evidence: { count: number; independentProviders: number; latestObservedAt: string | null; completeness: number | null; stale: boolean };
  findings: { total: number; open: number; criticalOrHigh: number; items: VendorRiskFinding[] };
  recommendedActions: string[];
  policy: { rule: string; evaluatedAt: string };
};

const CLOSED = new Set(['resolved', 'closed', 'verified']);
const HIGH = new Set(['critical', 'high']);

function isStale(timestamp: string | null, evaluatedAt: number, staleAfterDays: number): boolean {
  if (!timestamp) return true;
  const observed = Date.parse(timestamp);
  if (!Number.isFinite(observed)) return true;
  return evaluatedAt - observed > staleAfterDays * 24 * 60 * 60 * 1000;
}

export function evaluateVendorRisk(input: VendorRiskInput): VendorRiskResult {
  const staleAfterDays = Math.max(1, Math.min(3650, Math.floor(input.staleAfterDays ?? 30)));
  const openFindings = input.findings.filter((finding) => !CLOSED.has(String(finding.status).toLowerCase()));
  const criticalOrHigh = openFindings.filter((finding) => HIGH.has(String(finding.severity).toLowerCase()));
  const independentProviders = new Set(input.evidence.map((item) => String(item.provider || '').trim().toLowerCase()).filter(Boolean)).size;
  const stale = isStale(input.latestObservationAt, input.evaluatedAt, staleAfterDays);
  const triggers: VendorRiskResult['triggers'] = [];

  if (criticalOrHigh.length) {
    triggers.push({ type: 'OPEN_HIGH_SEVERITY_FINDINGS', severity: 'HIGH', evidenceIds: criticalOrHigh.map((item) => item.id), reason: `${criticalOrHigh.length} open critical/high finding(s) require vendor review before trust is increased.` });
  }
  if (openFindings.length && !criticalOrHigh.length) {
    triggers.push({ type: 'OPEN_FINDINGS', severity: 'MEDIUM', evidenceIds: openFindings.map((item) => item.id), reason: `${openFindings.length} open finding(s) remain unresolved.` });
  }
  if (stale) {
    triggers.push({ type: 'STALE_OR_MISSING_OBSERVATION', severity: 'MEDIUM', evidenceIds: [], reason: input.latestObservationAt ? `Latest observation is older than ${staleAfterDays} days.` : 'No current observation timestamp is available.' });
  }
  if (!input.evidence.length) {
    triggers.push({ type: 'NO_OBSERVED_EVIDENCE', severity: 'UNKNOWN', evidenceIds: [], reason: 'No observed evidence is available for this vendor passport.' });
  }
  if (input.completeness != null && input.completeness < 0.5) {
    triggers.push({ type: 'LOW_EVIDENCE_COMPLETENESS', severity: 'MEDIUM', evidenceIds: [], reason: `Observed evidence completeness is ${(input.completeness * 100).toFixed(1)}%.` });
  }

  let status: VendorRiskStatus = 'UNKNOWN';
  if (input.evidence.length) {
    if (criticalOrHigh.length || (stale && openFindings.length)) status = 'HIGH';
    else if (openFindings.length || stale || (input.completeness != null && input.completeness < 0.5)) status = 'MEDIUM';
    else status = 'LOW';
  }

  const confidence: VendorRiskResult['confidence'] = !input.evidence.length ? 'UNKNOWN' : stale || independentProviders < 1 ? 'PARTIAL' : 'EVIDENCE_BACKED';
  const recommendedActions = status === 'HIGH'
    ? ['Review open critical/high findings.', 'Require fresh evidence before approving the vendor for sensitive use.', 'Document the vendor decision and remediation owner.']
    : status === 'MEDIUM'
      ? ['Request remediation for unresolved findings.', 'Refresh stale evidence and re-run the vendor review.', 'Reassess after evidence gaps are closed.']
      : status === 'LOW'
        ? ['Continue normal monitoring.', 'Re-run the review when material evidence changes.']
        : ['Collect observable evidence before making a vendor-risk determination.'];

  const summary = status === 'UNKNOWN'
    ? 'Vendor risk cannot be determined from the currently observed evidence.'
    : status === 'HIGH'
      ? 'Vendor requires review because observed evidence contains material unresolved risk signals.'
      : status === 'MEDIUM'
        ? 'Vendor has observable risk or evidence-freshness gaps that warrant follow-up.'
        : 'No material risk trigger was observed in the available evidence at evaluation time.';

  return {
    agent: 'vendor-risk',
    schemaVersion: 'spr-vendor-risk-v1',
    status,
    confidence,
    passport: input.passport,
    summary,
    triggers,
    evidence: { count: input.evidence.length, independentProviders, latestObservedAt: input.latestObservationAt, completeness: input.completeness, stale },
    findings: { total: input.findings.length, open: openFindings.length, criticalOrHigh: criticalOrHigh.length, items: openFindings.slice(0, 50) },
    recommendedActions,
    policy: { rule: 'Vendor risk is derived only from observed SPR evidence, findings, freshness and completeness. Missing evidence remains UNKNOWN.', evaluatedAt: new Date(input.evaluatedAt).toISOString() },
  };
}
