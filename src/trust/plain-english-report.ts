// Plain-English report layer: a pure presentation/translation function over
// buildAndPersistReport's existing, authoritative output (src/routes/
// trust-loop.ts). This module never computes a score, never talks to the
// database, and never decides what a finding's status is -- it only
// explains, in plain language, facts that already exist. The evidence
// engine and scoring engine remain the sole source of truth; this is a
// view, not a second opinion.

export type CanonicalReport = {
  passport: { id: string; name: string };
  risk: { overall: number | null; security: number | null; compliance: number | null; verificationStatus: string };
  evidenceQuality: { completenessBasisPoints: number; unknownDimensions: number; latestObservationAt: string | null };
  findings: Array<{ id: string; control_id: string; title: string; severity: string; status: string; description: string; remediation: string; updated_at: string; resolved_at: string | null }>;
  evidence: Array<{ id: string; provider: string; control_id: string; observed_at: string; verification_method: string; status: string; limitation?: string | null }>;
  generatedAt: string;
};

export const GLOSSARY: Record<string, string> = {
  'SBOM (Software Bill of Materials)': 'A list of the software components contained in a piece of software. Think of it like an ingredient list for software.',
  'Vulnerability': 'A known weakness in software or a system that could potentially be used to cause harm.',
  'CVE': 'A standardized identification number used to refer to a publicly documented software security weakness.',
  'Evidence': 'Information SPR received from a connected system or other trusted source that supports a conclusion.',
  'Trust Observation': 'A recorded fact SPR observed at a particular time and used when evaluating the software or environment.',
  'Finding': "A specific, evidence-backed statement about one thing SPR checked -- what it found, and whether it's resolved.",
  'Confidence': "How fresh and reliable the evidence behind a conclusion is, expressed as a percentage.",
  'Completeness': 'What share of the things SPR checks for could actually be resolved to a real pass or fail, versus left unknown.',
  'Remediation': 'The work being done to fix a finding.',
};

function severityPlainLanguage(severity: string): string {
  switch (severity) {
    case 'critical': return 'This deserves immediate attention -- it could create a serious security or operational risk.';
    case 'high': return 'This deserves prompt attention because it could create a meaningful security or operational risk if it applies to the affected system.';
    case 'medium': return 'This is worth reviewing and addressing in normal course, but is not urgent on its own.';
    case 'low': return 'This is a minor item, useful to track but unlikely to cause real harm on its own.';
    default: return 'This is informational -- it does not represent a problem.';
  }
}

export type ExplainedFinding = {
  id: string;
  whatWeFound: string;
  whyItMatters: string;
  howSerious: { level: string; explanation: string };
  whatWeKnow: string;
  whatWeDontKnow: string | null;
  whatToDoNext: string;
  status: 'Verified' | 'Needs Review' | 'Unknown' | 'Resolved';
  technical: { controlId: string; title: string; severity: string; rawStatus: string; updatedAt: string };
};

export function explainFinding(finding: CanonicalReport['findings'][number]): ExplainedFinding {
  const statusMap: Record<string, ExplainedFinding['status']> = { OPEN: 'Needs Review', UNKNOWN: 'Unknown', RESOLVED: 'Resolved' };
  const status = statusMap[finding.status] ?? 'Unknown';
  return {
    id: finding.id,
    whatWeFound: finding.title,
    whyItMatters: finding.status === 'OPEN'
      ? 'The available evidence shows this has not been resolved, which may leave a real gap depending on how this system is used.'
      : finding.status === 'UNKNOWN'
        ? 'SPR does not currently have enough reliable evidence to say whether this is a problem.'
        : 'The available evidence supports that this specific item is resolved.',
    howSerious: { level: finding.severity, explanation: severityPlainLanguage(finding.severity) },
    whatWeKnow: finding.description,
    whatWeDontKnow: finding.status === 'UNKNOWN' ? 'SPR could not obtain reliable evidence for this check -- this does not mean there is a problem, only that SPR cannot confirm either way.' : null,
    whatToDoNext: finding.status === 'OPEN' ? (finding.remediation || 'Review this finding and decide on next steps.') : finding.status === 'UNKNOWN' ? 'Connect or authorize the data source needed to check this, if one is available.' : 'No action needed for this item.',
    status,
    technical: { controlId: finding.control_id, title: finding.title, severity: finding.severity, rawStatus: finding.status, updatedAt: finding.updated_at },
  };
}

export type PlainEnglishReport = {
  headline: string;
  situation: string;
  whatIsGood: string[];
  whatNeedsAttention: string[];
  scoreExplanation: { value: number | null; explanation: string; disclaimer: string };
  findings: ExplainedFinding[];
  glossary: Record<string, string>;
  generatedAt: string;
};

// Explains a real change from GET /trust-loop/reports/:passportId/changes
// (compareCanonicalObservations' output) in plain English. Reuses that
// endpoint's real before/after values -- never recalculates or guesses.
export function explainChange(change: { type: string; before: unknown; after: unknown; subject?: string }): { before: string; now: string; whyItChanged: string; whatItMeans: string } {
  const num = (v: unknown) => (v === null || v === undefined ? 'not calculated' : String(v));
  switch (change.type) {
    case 'score_decreased':
      return { before: `Trust score: ${num(change.before)}`, now: `Trust score: ${num(change.after)}`, whyItChanged: 'New evidence changed what SPR could verify since the last report.', whatItMeans: 'The trust position is weaker than it was -- see the findings list for the specific items driving this.' };
    case 'score_increased':
      return { before: `Trust score: ${num(change.before)}`, now: `Trust score: ${num(change.after)}`, whyItChanged: 'New evidence resolved one or more previous issues.', whatItMeans: 'The trust position has improved since the last report.' };
    case 'score_became_ineligible':
      return { before: `Trust score: ${num(change.before)}`, now: 'Trust score: not currently calculable', whyItChanged: 'The evidence SPR relied on for a score is no longer sufficient.', whatItMeans: 'This is not the same as a bad score -- it means SPR can no longer confidently calculate one at all. Review what evidence source may have stopped reporting.' };
    case 'score_became_eligible':
      return { before: 'Trust score: not previously calculable', now: `Trust score: ${num(change.after)}`, whyItChanged: 'SPR obtained its first resolvable evidence for this software.', whatItMeans: 'A trust score can now be reported for the first time.' };
    case 'finding_created':
      return { before: 'Not previously observed', now: `New item: ${change.subject ?? 'a new finding'}`, whyItChanged: 'New evidence surfaced a condition SPR had not seen before.', whatItMeans: 'This is a new item that needs review -- see the findings list for details.' };
    case 'finding_resolved':
      return { before: `Previously open: ${change.subject ?? 'a finding'}`, now: 'Resolved', whyItChanged: 'New evidence confirmed this item is no longer a problem.', whatItMeans: 'One fewer item needs attention.' };
    case 'confidence_decreased':
      return { before: 'Higher confidence', now: 'Lower confidence', whyItChanged: 'The evidence behind this assessment has aged or become less certain.', whatItMeans: 'SPR is less sure of its conclusions than it was -- fresher evidence would help.' };
    case 'completeness_decreased':
      return { before: 'More of the picture was checkable', now: 'Less of the picture is checkable', whyItChanged: 'Fewer checks could be resolved to a real pass or fail this time.', whatItMeans: 'There is more SPR currently cannot verify than there was before.' };
    default:
      return { before: num(change.before), now: num(change.after), whyItChanged: 'New evidence changed this value.', whatItMeans: 'See the technical detail for this change.' };
  }
}

// The one and only place that turns the canonical report into plain
// English -- called identically by both the executive and detailed report
// routes, so they can never disagree about the underlying facts.
export function toPlainEnglish(report: CanonicalReport): PlainEnglishReport {
  const open = report.findings.filter((f) => f.status === 'OPEN');
  const unknown = report.findings.filter((f) => f.status === 'UNKNOWN');
  const resolved = report.findings.filter((f) => f.status === 'RESOLVED');
  const needsAttentionCount = open.length + unknown.length;

  const headline = needsAttentionCount === 0
    ? (report.findings.length === 0 ? 'No checks have produced evidence yet' : 'Nothing currently needs attention')
    : `${needsAttentionCount} item${needsAttentionCount === 1 ? '' : 's'} need${needsAttentionCount === 1 ? 's' : ''} attention`;

  const situation = report.findings.length === 0
    ? 'SPR has not yet collected enough evidence about this software to report a status. This is not the same as being unsafe -- it means nothing has been checked yet.'
    : needsAttentionCount === 0
      ? `SPR checked ${report.findings.length} item${report.findings.length === 1 ? '' : 's'} for this software and found no unresolved issues in what it could verify. Nothing in this report should be read as a guarantee that the environment is completely secure -- SPR reports only what it can actually verify from the evidence available.`
      : `SPR found ${needsAttentionCount} item${needsAttentionCount === 1 ? '' : 's'} that should be reviewed out of ${report.findings.length} checked. ${resolved.length ? `${resolved.length} other item${resolved.length === 1 ? '' : 's'} ${resolved.length === 1 ? 'is' : 'are'} already resolved.` : ''} Nothing in this report should be read as a guarantee that the environment is completely secure -- SPR reports only what it can actually verify from the evidence available.`;

  const scoreExplanation = {
    value: report.risk.overall,
    explanation: report.risk.overall === null
      ? 'SPR does not yet have enough resolved evidence to calculate a trust score for this software.'
      : report.risk.overall >= 85
        ? 'Based on the evidence SPR currently has, this software has a generally healthy trust position.'
        : report.risk.overall >= 60
          ? 'Based on the evidence SPR currently has, this software has a generally healthy trust position, but there are areas that need attention.'
          : 'Based on the evidence SPR currently has, there are significant areas that need attention.',
    disclaimer: 'This score is not a guarantee of security. It is SPR\'s evidence-based assessment of the information available at the time of this report.',
  };

  return {
    headline,
    situation,
    whatIsGood: resolved.map((f) => `${f.title}: resolved`),
    whatNeedsAttention: [...open, ...unknown].map((f) => `${f.title}${f.status === 'UNKNOWN' ? ' (not enough evidence to confirm either way)' : ''}`),
    scoreExplanation,
    findings: report.findings.map(explainFinding),
    glossary: GLOSSARY,
    generatedAt: report.generatedAt,
  };
}
