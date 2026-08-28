// Trust Response's matching engine: given a question's text and the
// tenant's real findings for a passport, produce a draft answer, a
// confidence score, and a status -- never a fabricated answer when no
// evidence supports one. This deliberately does not reuse trust-loop.ts's
// private semanticSignals() (it operates on a Finding object, not raw
// question text); the topic taxonomy here is the same idea, extended with
// categories that actually show up in real security questionnaires.

export type QuestionnaireFinding = { id: string; controlId: string; title: string; description: string; status: 'OPEN' | 'UNKNOWN' | 'RESOLVED'; severity: string; evidenceIds: string[]; updatedAt: string };
export type MatchResult = { category: string | null; draftAnswer: string | null; confidenceBasisPoints: number; status: 'UNKNOWN' | 'NEEDS_REVIEW' | 'ANSWERED'; evidenceIds: string[] };

const TOPICS: Record<string, RegExp> = {
  mfa: /\bmfa\b|multi.?factor|two.?factor|\b2fa\b/i,
  encryption: /encrypt|kms|key management|at rest|in transit|tls|cryptograph/i,
  access_review: /access review|least privilege|role.?based access|user access|deprovision/i,
  logging: /logging|audit log|activity log|siem|monitoring/i,
  vulnerability: /vulnerabilit|penetration test|pen.?test|patch management|cve/i,
  backup: /backup|disaster recovery|business continuity|\brto\b|\brpo\b/i,
  incident_response: /incident response|breach notification|security incident/i,
  subprocessor: /subprocessor|sub.?processor|third.?party|vendor management/i,
  data_retention: /data retention|data deletion|right to erasure|data disposal/i,
  certification: /soc ?2|iso ?27001|pci.?dss|hipaa|gdpr|fedramp/i,
  exposure: /internet.?facing|publicly accessible|external exposure|perimeter/i,
  privilege: /privileged access|administrator access|root access|admin account/i,
};

export function classifyQuestionTopic(questionText: string): string | null {
  for (const [topic, pattern] of Object.entries(TOPICS)) {
    if (pattern.test(questionText)) return topic;
  }
  return null;
}

function findingSignals(finding: QuestionnaireFinding): Set<string> {
  const text = `${finding.controlId} ${finding.title} ${finding.description}`;
  const signals = new Set<string>();
  for (const [topic, pattern] of Object.entries(TOPICS)) if (pattern.test(text)) signals.add(topic);
  return signals;
}

// Same freshness-decay shape used elsewhere in this codebase
// (src/utils/monitoring.ts's confidenceAt / trust-loop.ts's
// freshnessMultiplier): full confidence for a day, decaying to a floor
// after a month. Reimplemented locally in basis points since those
// functions aren't exported for this shape.
function freshnessMultiplier(updatedAt: string, now = Date.now()): number {
  const ageHours = Math.max(0, (now - new Date(updatedAt).getTime()) / 3_600_000);
  if (!Number.isFinite(ageHours)) return 0;
  if (ageHours <= 24) return 1;
  if (ageHours <= 168) return 0.9;
  if (ageHours <= 720) return 0.75;
  return 0.5;
}

export function matchQuestionToEvidence(questionText: string, findings: QuestionnaireFinding[]): MatchResult {
  const topic = classifyQuestionTopic(questionText);
  if (!topic) return { category: null, draftAnswer: null, confidenceBasisPoints: 0, status: 'UNKNOWN', evidenceIds: [] };

  const matching = findings.filter((finding) => findingSignals(finding).has(topic));
  if (!matching.length) return { category: topic, draftAnswer: null, confidenceBasisPoints: 0, status: 'UNKNOWN', evidenceIds: [] };

  const open = matching.filter((finding) => finding.status === 'OPEN');
  const resolved = matching.filter((finding) => finding.status === 'RESOLVED');
  const evidenceIds = [...new Set(matching.flatMap((finding) => finding.evidenceIds))];
  const mostRecent = matching.reduce((latest, finding) => new Date(finding.updatedAt) > new Date(latest.updatedAt) ? finding : latest, matching[0]);
  const confidenceBasisPoints = Math.round(8000 * freshnessMultiplier(mostRecent.updatedAt));

  if (open.length) {
    return {
      category: topic, evidenceIds, confidenceBasisPoints, status: 'NEEDS_REVIEW',
      draftAnswer: `Evidence collected on ${new Date(mostRecent.updatedAt).toLocaleDateString()} shows an open finding related to this control (${open[0].title}). This answer requires review before it is sent -- do not represent this control as fully satisfied.`,
    };
  }
  return {
    category: topic, evidenceIds, confidenceBasisPoints, status: 'ANSWERED',
    draftAnswer: `Based on evidence collected on ${new Date(mostRecent.updatedAt).toLocaleDateString()} (${resolved.length} control${resolved.length === 1 ? '' : 's'} verified), this requirement is satisfied. See cited evidence for verification method and source.`,
  };
}
