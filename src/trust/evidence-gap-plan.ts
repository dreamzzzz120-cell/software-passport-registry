import type { CanonicalReport } from './plain-english-report';

export type EvidenceGapAction = {
  id: string;
  basis: 'finding' | 'evidence' | 'limitation' | 'coverage';
  status: 'UNKNOWN' | 'NEEDS_REVIEW';
  title: string;
  controlId: string | null;
  findingId: string | null;
  reason: string;
  whyItMatters: string;
  requestedEvidence: string;
  question: string;
  nextStep: string;
  completionCriteria: string;
  owner: null;
  suggestedRecipient: string;
  evidence: Array<{ id: string; provider: string; observedAt: string; status: string; sourceUrl: string | null; verificationMethod: string; hash: string | null }>;
};

export type EvidenceGapPlan = {
  passportId: string;
  productName: string;
  generatedAt: string;
  reportHash: string | null;
  unknownDimensions: number;
  limitation: string;
  actions: EvidenceGapAction[];
};

const boundary = 'This is a proposed review plan derived from this report, not assigned or completed work. Unknown does not mean unsafe or safe. A response or uploaded document does not verify a control; recollect and evaluate evidence before changing its status. Client suitability and authorization require a separate decision.';

/** No scoring, provider calls, task writes, or inferred control coverage. */
export function buildEvidenceGapPlan(report: CanonicalReport): EvidenceGapPlan {
  const actions: EvidenceGapAction[] = [];
  const evidenceFor = (controlId: string | null, evidenceIds: string[] = []) => report.evidence
    .filter(e => evidenceIds.length ? evidenceIds.includes(e.id) : (controlId !== null && e.control_id === controlId))
    .map(e => ({ id: e.id, provider: e.provider, observedAt: e.observed_at, status: e.status,
      sourceUrl: e.source_url ?? null, verificationMethod: e.verification_method, hash: e.evidence_hash ?? null }));
  const add = (input: Omit<EvidenceGapAction, 'owner' | 'completionCriteria'>) => actions.push({
    ...input, owner: null,
    completionCriteria: `An authorized reviewer checks attributable evidence for the same product, control and scope, records the result, and generates a new report. ${input.status === 'UNKNOWN' ? 'Keep this gap UNKNOWN if evidence remains insufficient.' : 'Keep the finding open until corrective work has been independently verified.'}`,
  });

  for (const finding of report.findings) {
    if (finding.status === 'RESOLVED') continue;
    const open = finding.status === 'OPEN';
    const topic = `${finding.title} (${finding.control_id})`;
    let ids: string[] = [];
    if (Array.isArray(finding.evidence_ids)) ids = finding.evidence_ids.filter((id): id is string => typeof id === 'string');
    else if (typeof finding.evidence_ids === 'string') {
      try { const parsed: unknown = JSON.parse(finding.evidence_ids); if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === 'string'); } catch { /* Malformed linkage is not evidence. */ }
    }
    add({
      id: `finding:${finding.id}`, basis: 'finding', status: open ? 'NEEDS_REVIEW' : 'UNKNOWN',
      title: finding.title, controlId: finding.control_id, findingId: finding.id,
      reason: finding.description || 'The report does not contain an explanation for this unresolved finding.',
      whyItMatters: open
        ? 'The report records an open finding. Review whether it applies to the intended use and verify any corrective work.'
        : 'This check cannot support a conclusion yet. If the intended use depends on it, obtain evidence before relying on it.',
      requestedEvidence: `A dated source record for ${topic}, identifying the product/version or environment, scope, observed result and verification method. Include any access or collection limitations.`,
      question: `What evidence supports ${topic} for the product or environment under review? Please identify its scope, date and source, and explain anything that could not be checked.`,
      nextStep: open ? (finding.remediation || 'Review the source evidence, determine applicable corrective work, and collect a new observation.') : 'Ask the responsible source owner for the evidence above; check collection permissions if a connected source could not be read.',
      suggestedRecipient: 'Responsible vendor or environment administrator; confirm who owns this check.',
      evidence: evidenceFor(finding.control_id, ids),
    });
  }

  for (const record of report.evidence) {
    // Source status is preserved, not interpreted as a new risk finding.
    if (['PASS', 'VERIFIED', 'RESOLVED'].includes(record.status.toUpperCase())) continue;
    if (report.findings.some(f => f.control_id === record.control_id && f.status !== 'RESOLVED') || record.limitation) continue;
    add({
      id: `evidence:${record.id}`, basis: 'evidence', status: 'UNKNOWN',
      title: `Source record needs review: ${record.control_id}`, controlId: record.control_id, findingId: null,
      reason: `The source record reports status ${record.status || 'UNKNOWN'} without a linked unresolved finding or stated limitation. It does not establish a passing result.`,
      whyItMatters: 'Unresolved source evidence can remain even when the finding list is empty or resolved.',
      requestedEvidence: 'The source result and its collection or verification explanation, including scope, date and any limitations.',
      question: `Why does source record ${record.id} for ${record.control_id} have status ${record.status || 'UNKNOWN'}, and what evidence is needed to evaluate it?`,
      nextStep: 'Inspect the source record with its owner and recollect or verify it through the supported path. Do not treat the absence of a finding as a pass.',
      suggestedRecipient: `Source owner for ${record.provider}; confirm the responsible person.`, evidence: evidenceFor(null, [record.id]),
    });
  }

  // A limitation can coexist with a verified record. Never turn its status
  // into proof that the unobserved remainder passed.
  const limitations = [...(report.limitations ?? []), ...report.evidence
    .filter(e => e.limitation).map(e => ({ evidenceId: e.id, limitation: e.limitation! }))];
  const seen = new Set<string>();
  for (const limitation of limitations) {
    if (!limitation.limitation?.trim()) continue;
    const key = JSON.stringify([limitation.evidenceId ?? null, limitation.limitation]);
    if (seen.has(key)) continue;
    seen.add(key);
    const record = report.evidence.find(e => e.id === limitation.evidenceId);
    add({
      id: `limitation:${actions.length}`, basis: 'limitation', status: 'UNKNOWN',
      title: record ? `Evidence limitation: ${record.control_id}` : 'Report coverage limitation',
      controlId: record?.control_id ?? null, findingId: null, reason: limitation.limitation,
      whyItMatters: 'The report explicitly limits what can be concluded. A verified record does not verify the part it could not observe.',
      requestedEvidence: 'Evidence addressing the stated limitation, with the source, date, product or environment scope and collection method; or an explanation of why it remains unavailable.',
      question: `How can the following observation gap be checked, and what source can establish the missing information? ${limitation.limitation}`,
      nextStep: 'Review the limitation with the responsible source owner, collect what is available, and rerun the affected check. Preserve the limitation if it cannot be resolved.',
      suggestedRecipient: record ? `Source owner for ${record.provider}; confirm the responsible person.` : 'MSP reviewer to identify the responsible source owner.',
      evidence: limitation.evidenceId ? evidenceFor(null, [limitation.evidenceId]) : [],
    });
  }

  const unknownDimensions = report.evidenceQuality.unknownDimensions;
  if (unknownDimensions > 0) add({
    id: 'coverage:unknown-dimensions', basis: 'coverage', status: 'UNKNOWN',
    title: `${unknownDimensions} unknown dimension${unknownDimensions === 1 ? '' : 's'} in the report`,
    controlId: null, findingId: null,
    reason: 'The canonical report contains an aggregate unknown-dimension count. It does not identify every dimension here; this count may overlap the findings and limitations above.',
    whyItMatters: 'Resolved findings are not an all-clear when coverage still contains unknown dimensions.',
    requestedEvidence: 'The underlying observation and control coverage identifying which dimensions are unknown and why, followed by attributable evidence for the applicable checks.',
    question: 'Which dimensions remain unknown in the underlying observation, what prevented each check, and which authorized source could resolve it?',
    nextStep: 'Inspect the underlying observation before requesting specific controls. Do not invent missing control names from an aggregate count.',
    suggestedRecipient: 'MSP reviewer responsible for collection coverage.', evidence: [],
  });

  if (!report.evidence.length && !(report.repositoryScan?.evidence.length) && !(report.repositoryScan?.sbomComponentCount) && !actions.length) add({
    id: 'coverage:no-evidence', basis: 'coverage', status: 'UNKNOWN', title: 'No source evidence in this report',
    controlId: null, findingId: null, reason: 'No provider evidence, repository evidence or SBOM components are present in the report.',
    whyItMatters: 'An empty result cannot establish software suitability.',
    requestedEvidence: 'Identify the intended review scope and an authorized source: a supported repository, connected environment or attributable vendor documentation.',
    question: 'What software and intended use are being reviewed, and what authorized evidence source is available?',
    nextStep: 'Agree the scope and collect evidence through a supported path before drawing conclusions.',
    suggestedRecipient: 'MSP reviewer and client software owner.', evidence: [],
  });

  return { passportId: report.passport.id, productName: report.passport.name, generatedAt: report.generatedAt,
    reportHash: report.reportHash ?? null, unknownDimensions, limitation: boundary, actions };
}

export function evidenceGapPlanText(plan: EvidenceGapPlan): string {
  const lines = ['SPR SOFTWARE REVIEW PLAN', `Product: ${plan.productName}`, `Launch Ticket: ${plan.passportId}`,
    `Report generated: ${plan.generatedAt}`, `Report hash: ${plan.reportHash ?? 'Not supplied'}`, '', plan.limitation, ''];
  if (!plan.actions.length) lines.push('No proposed actions were derived from the supplied report. This does not establish complete coverage or software approval.');
  for (const action of plan.actions) {
    lines.push(`${action.title} [${action.status}]`, `Basis: ${action.basis}`, `Finding: ${action.findingId ?? 'Not applicable'}`,
      `Control: ${action.controlId ?? 'Not identified'}`, `Reason: ${action.reason}`, `Why it matters: ${action.whyItMatters}`,
      `Evidence to request: ${action.requestedEvidence}`, `Question: ${action.question}`, `Next step: ${action.nextStep}`,
      'Owner: Unassigned', `Suggested recipient: ${action.suggestedRecipient}`, `Completion criteria: ${action.completionCriteria}`,
      ...action.evidence.map(e => `Source record: ${e.id} | ${e.provider} | ${e.status} | ${e.observedAt}\nSource: ${e.sourceUrl ?? 'Not supplied'} | Method: ${e.verificationMethod} | Hash: ${e.hash ?? 'Not supplied'}`), '');
  }
  return lines.join('\n');
}
