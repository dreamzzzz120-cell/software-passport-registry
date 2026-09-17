export type ComplianceDecision = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ComplianceEvidence = {
  id: string;
  controlId: string | null;
  status: string | null;
  observedAt: string | null;
  verificationMethod: string | null;
  limitation: string | null;
};
export type ComplianceFinding = {
  id: string;
  controlId: string | null;
  severity: string;
  status: string;
  title: string;
};
export type ComplianceInput = {
  passport: { id: string; name: string };
  evidence: ComplianceEvidence[];
  findings: ComplianceFinding[];
  evaluatedAt: number;
  staleAfterDays?: number;
};
export type ComplianceControlResult = {
  controlId: string;
  decision: ComplianceDecision;
  evidenceIds: string[];
  findingIds: string[];
  reason: string;
};
export type ComplianceResult = {
  agent: 'compliance';
  schemaVersion: 'spr-compliance-agent-v1';
  passport: ComplianceInput['passport'];
  overall: ComplianceDecision;
  confidence: 'EVIDENCE_BACKED' | 'PARTIAL' | 'UNKNOWN';
  controls: ComplianceControlResult[];
  gaps: string[];
  remediationRequests: string[];
  policy: { rule: string; evaluatedAt: string };
};

const CLOSED = new Set(['resolved', 'closed', 'verified']);
const PASS = new Set(['pass', 'passed', 'verified', 'valid', 'compliant', 'satisfied', 'success']);
const FAIL = new Set(['fail', 'failed', 'invalid', 'noncompliant', 'non-compliant', 'unsatisfied', 'blocked']);

function stale(timestamp: string | null, evaluatedAt: number, days: number): boolean {
  if (!timestamp) return true;
  const parsed = Date.parse(timestamp);
  return !Number.isFinite(parsed) || evaluatedAt - parsed > days * 86400000;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function evaluateCompliance(input: ComplianceInput): ComplianceResult {
  const staleAfterDays = Math.max(1, Math.min(3650, Math.floor(input.staleAfterDays ?? 30)));
  const controlIds = new Set<string>();
  for (const item of input.evidence) {
    if (item.controlId?.trim()) controlIds.add(item.controlId.trim());
  }
  for (const item of input.findings) {
    if (item.controlId?.trim()) controlIds.add(item.controlId.trim());
  }

  const controls: ComplianceControlResult[] = [...controlIds].sort().map((controlId) => {
    const evidence = input.evidence.filter((item) => item.controlId?.trim() === controlId);
    const findings = input.findings.filter((item) => item.controlId?.trim() === controlId && !CLOSED.has(normalize(item.status)));
    const evidenceIds = evidence.map((item) => item.id).sort();
    const findingIds = findings.map((item) => item.id).sort();
    const hasFailingEvidence = evidence.some((item) => FAIL.has(normalize(item.status)));
    const hasPassingEvidence = evidence.some((item) => PASS.has(normalize(item.status)));
    const hasStaleEvidence = evidence.length > 0 && evidence.every((item) => stale(item.observedAt, input.evaluatedAt, staleAfterDays));

    if (findings.length > 0 || hasFailingEvidence) {
      return { controlId, decision: 'FAIL', evidenceIds, findingIds, reason: findings.length ? `${findings.length} unresolved finding(s) are attached to this control.` : 'Observed evidence explicitly reports a failing or invalid status.' };
    }
    if (evidence.length === 0) {
      return { controlId, decision: 'UNKNOWN', evidenceIds, findingIds, reason: 'No observed evidence is available for this control.' };
    }
    if (hasStaleEvidence) {
      return { controlId, decision: 'UNKNOWN', evidenceIds, findingIds, reason: `All observed evidence for this control is older than ${staleAfterDays} days or has no valid observation timestamp.` };
    }
    if (hasPassingEvidence && evidence.every((item) => PASS.has(normalize(item.status)) || !item.status)) {
      return { controlId, decision: 'PASS', evidenceIds, findingIds, reason: 'Current observed evidence supports this control and no unresolved finding contradicts it.' };
    }
    return { controlId, decision: 'UNKNOWN', evidenceIds, findingIds, reason: 'Observed evidence is insufficient or does not contain a supported pass/fail state.' };
  });

  const failCount = controls.filter((control) => control.decision === 'FAIL').length;
  const unknownCount = controls.filter((control) => control.decision === 'UNKNOWN').length;
  const passCount = controls.filter((control) => control.decision === 'PASS').length;
  const overall: ComplianceDecision = !controls.length ? 'UNKNOWN' : failCount ? 'FAIL' : unknownCount ? 'UNKNOWN' : passCount ? 'PASS' : 'UNKNOWN';
  const confidence: ComplianceResult['confidence'] = !input.evidence.length ? 'UNKNOWN' : unknownCount ? 'PARTIAL' : 'EVIDENCE_BACKED';
  const gaps = controls.filter((control) => control.decision === 'UNKNOWN').map((control) => `${control.controlId}: ${control.reason}`);
  const remediationRequests = controls.filter((control) => control.decision === 'FAIL').map((control) => `${control.controlId}: review the observed finding/evidence and document remediation before treating the control as satisfied.`);

  return {
    agent: 'compliance',
    schemaVersion: 'spr-compliance-agent-v1',
    passport: input.passport,
    overall,
    confidence,
    controls,
    gaps,
    remediationRequests,
    policy: {
      rule: 'Compliance decisions are derived only from observed SPR evidence and unresolved findings. Missing, stale, contradictory, or unsupported evidence remains UNKNOWN; payment, vendor reputation, and unsupported claims cannot create PASS.',
      evaluatedAt: new Date(input.evaluatedAt).toISOString(),
    },
  };
}
