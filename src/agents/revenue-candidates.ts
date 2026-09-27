export type FindingRecord = {
  id: string; passportId: string; clientId: string | null; title: string;
  severity: string; status: string; evidenceIds: unknown; updatedAt: string | null;
};
export type EvidenceRecord = {
  id: string; passportId: string; status: string; observedAt: string | null;
  verificationMethod: string | null; evidenceHash: string | null;
};

function linkedIds(value: unknown): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  } catch { return []; }
}

/** Candidates for a human review, never booked revenue or a sales authorization. */
export function findEvidenceBackedReviewCandidates(
  findings: FindingRecord[], evidence: EvidenceRecord[], now = new Date()
) {
  const current = now.getTime();
  return findings.flatMap(finding => {
    if (!['high', 'critical'].includes(finding.severity.toLowerCase()) ||
        !['open', 'active'].includes(finding.status.toLowerCase())) return [];
    const ids = new Set(linkedIds(finding.evidenceIds));
    const supporting = evidence.filter(item =>
      ids.has(item.id) && item.passportId === finding.passportId &&
      ['PASS', 'FAIL'].includes(item.status) &&
      Boolean(item.verificationMethod?.trim()) &&
      /^([a-f0-9]{64}|sha256:[a-f0-9]{64})$/i.test(item.evidenceHash ?? '') &&
      item.observedAt != null && Number.isFinite(Date.parse(item.observedAt)) &&
      Date.parse(item.observedAt) <= current &&
      current - Date.parse(item.observedAt) <= 30 * 86400000
    );
    if (!supporting.length) return [];
    return [{
      schemaVersion: 'spr-revenue-candidate-v1',
      id: `finding-review:${finding.id}`, passportId: finding.passportId,
      clientId: finding.clientId, findingId: finding.id,
      type: 'SECURITY_FINDING_REVIEW', status: 'REVIEW_CANDIDATE',
      severity: finding.severity.toLowerCase(), title: finding.title,
      evidenceIds: supporting.map(item => item.id).sort(),
      observedAt: supporting.map(item => item.observedAt!).sort().at(-1)!,
      suggestedService: 'Review the finding and scope remediation with the client',
      estimatedValue: null, currency: null,
      reason: 'An open high or critical finding has a linked, recent evidence record with a verification method and digest.',
      limitation: 'Evidence metadata and an open finding are not proof that the customer will buy a service. The digest is not revalidated by this read path.',
      requiresHumanApproval: true
    }];
  });
}
