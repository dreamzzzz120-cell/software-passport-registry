import crypto from 'node:crypto';

export const CHANGE_TYPES = [
  'dimension_became_known', 'dimension_became_unknown', 'dimension_became_stale',
  'dimension_became_expired', 'dimension_became_unavailable', 'score_became_eligible',
  'score_became_ineligible', 'confidence_decreased', 'confidence_increased',
  'completeness_decreased', 'completeness_increased', 'finding_created',
  'finding_changed', 'finding_resolved', 'collector_failed', 'collector_recovered'
  , 'evidence_added', 'evidence_removed', 'evidence_expired', 'limitations_changed',
  'score_increased', 'score_decreased', 'initial_observation_created'
] as const;

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

export function observationHash(payload: unknown) {
  return `sha256:${crypto.createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex')}`;
}

export type ObservationChange = { type: typeof CHANGE_TYPES[number]; subject: string; before: unknown; after: unknown };

export function compareObservationPayloads(previous: any | null, current: any): ObservationChange[] {
  if (!previous) return [{ type: 'initial_observation_created', subject: 'observation', before: null, after: current.observedAt }];
  const changes: ObservationChange[] = [];
  const previousVector = previous.vector || {};
  const currentVector = current.vector || {};
  for (const dimension of Object.keys(currentVector).sort()) {
    const before = previousVector[dimension] || {};
    const after = currentVector[dimension] || {};
    if (before.state !== after.state) {
      const type = after.state === 'unknown' ? 'dimension_became_unknown'
        : after.state === 'stale' ? 'dimension_became_stale'
        : after.state === 'expired' ? 'dimension_became_expired'
        : after.state === 'unavailable' ? 'dimension_became_unavailable'
        : 'dimension_became_known';
      changes.push({ type, subject: dimension, before: before.state ?? null, after: after.state });
    }
    if (before.score === null && typeof after.score === 'number') changes.push({ type: 'score_became_eligible', subject: dimension, before: null, after: after.score });
    if (typeof before.score === 'number' && after.score === null) changes.push({ type: 'score_became_ineligible', subject: dimension, before: before.score, after: null });
    if (typeof before.score === 'number' && typeof after.score === 'number' && before.score !== after.score) {
      changes.push({ type: after.score > before.score ? 'score_increased' : 'score_decreased', subject: dimension, before: before.score, after: after.score });
    }
    if (typeof before.confidence === 'number' && typeof after.confidence === 'number' && before.confidence !== after.confidence) {
      changes.push({ type: after.confidence > before.confidence ? 'confidence_increased' : 'confidence_decreased', subject: dimension, before: before.confidence, after: after.confidence });
    }
    const beforeFailed = (before.collectorStatuses || []).some((item: any) => item.state === 'failed');
    const afterFailed = (after.collectorStatuses || []).some((item: any) => item.state === 'failed');
    if (!beforeFailed && afterFailed) changes.push({ type: 'collector_failed', subject: dimension, before: false, after: true });
    if (beforeFailed && !afterFailed) changes.push({ type: 'collector_recovered', subject: dimension, before: true, after: false });
    if (before.freshnessStatus !== after.freshnessStatus && after.freshnessStatus === 'expired') {
      changes.push({ type: 'evidence_expired', subject: dimension, before: before.freshnessStatus, after: after.freshnessStatus });
    }
    const beforeEvidence = new Set((before.observations || []).map((item: any) => item.evidenceId));
    const afterEvidence = new Set((after.observations || []).map((item: any) => item.evidenceId));
    for (const id of afterEvidence) if (!beforeEvidence.has(id)) changes.push({ type: 'evidence_added', subject: String(id), before: null, after: dimension });
    for (const id of beforeEvidence) if (!afterEvidence.has(id)) changes.push({ type: 'evidence_removed', subject: String(id), before: dimension, after: null });
    if (canonicalize(before.limitations || []) !== canonicalize(after.limitations || [])) {
      changes.push({ type: 'limitations_changed', subject: dimension, before: before.limitations || [], after: after.limitations || [] });
    }
  }
  const beforeCompleteness = previous.unknownLayer?.completeness;
  const afterCompleteness = current.unknownLayer?.completeness;
  if (typeof beforeCompleteness === 'number' && typeof afterCompleteness === 'number' && beforeCompleteness !== afterCompleteness) {
    changes.push({ type: afterCompleteness > beforeCompleteness ? 'completeness_increased' : 'completeness_decreased', subject: 'observation', before: beforeCompleteness, after: afterCompleteness });
  }
  const previousFindings = new Map((previous.findings || []).map((item: any) => [item.id, item]));
  const currentFindings = new Map((current.findings || []).map((item: any) => [item.id, item]));
  for (const [id, finding] of currentFindings) {
    if (!previousFindings.has(id)) changes.push({ type: 'finding_created', subject: String(id), before: null, after: finding });
    else if (canonicalize(previousFindings.get(id)) !== canonicalize(finding)) {
      const resolved = ['Resolved', 'Mitigated'].includes((finding as any).status);
      changes.push({ type: resolved ? 'finding_resolved' : 'finding_changed', subject: String(id), before: previousFindings.get(id), after: finding });
    }
  }
  return changes;
}

export function changeDeduplicationKey(passportId: string, change: ObservationChange) {
  return observationHash({ passportId, type: change.type, subject: change.subject, after: change.after });
}

// compareObservationPayloads above expects a {vector, unknownLayer, findings}
// shape that nothing in this codebase actually produces -- it was never wired
// into persistTrustLoop (src/trust/trust-loop.ts), which is the one real
// function that persists every trust_observations row (manual collection,
// the GitHub connector, and the monitoring worker all go through it). This
// is the same change-detection concept adapted to what persistTrustLoop's
// immutable_payload actually contains: score/confidence/completeness/open
// finding count/finding id set.
export type CanonicalObservationChange = { type: 'score_increased' | 'score_decreased' | 'score_became_eligible' | 'score_became_ineligible' | 'confidence_increased' | 'confidence_decreased' | 'completeness_increased' | 'completeness_decreased' | 'finding_created' | 'finding_resolved'; before: unknown; after: unknown; subject?: string };

export function compareCanonicalObservations(
  previous: { score: number | null; confidence: number | null; completenessBasisPoints: number; findingIds: string[] } | null,
  current: { score: number | null; confidence: number | null; completenessBasisPoints: number; findingIds: string[] },
): CanonicalObservationChange[] {
  if (!previous) return [];
  const changes: CanonicalObservationChange[] = [];
  if (previous.score === null && current.score !== null) changes.push({ type: 'score_became_eligible', before: null, after: current.score });
  else if (previous.score !== null && current.score === null) changes.push({ type: 'score_became_ineligible', before: previous.score, after: null });
  else if (previous.score !== null && current.score !== null && previous.score !== current.score) {
    changes.push({ type: current.score > previous.score ? 'score_increased' : 'score_decreased', before: previous.score, after: current.score });
  }
  if (previous.confidence !== null && current.confidence !== null && previous.confidence !== current.confidence) {
    changes.push({ type: current.confidence > previous.confidence ? 'confidence_increased' : 'confidence_decreased', before: previous.confidence, after: current.confidence });
  }
  if (previous.completenessBasisPoints !== current.completenessBasisPoints) {
    changes.push({ type: current.completenessBasisPoints > previous.completenessBasisPoints ? 'completeness_increased' : 'completeness_decreased', before: previous.completenessBasisPoints, after: current.completenessBasisPoints });
  }
  const previousFindings = new Set(previous.findingIds);
  const currentFindings = new Set(current.findingIds);
  for (const id of currentFindings) if (!previousFindings.has(id)) changes.push({ type: 'finding_created', subject: id, before: null, after: id });
  for (const id of previousFindings) if (!currentFindings.has(id)) changes.push({ type: 'finding_resolved', subject: id, before: id, after: null });
  return changes;
}

// Mirrors classifyMateriality's spirit for the shape above: only regressions
// (a score/confidence/completeness drop, a score becoming un-computable, or
// a newly-created open finding) are alert-worthy. Improvements are real
// detected changes but not alerts -- nobody needs to be paged because things
// got better.
export function classifyCanonicalChange(change: CanonicalObservationChange): { alertWorthy: boolean; severity: 'informational' | 'medium' | 'high' } {
  switch (change.type) {
    case 'score_became_ineligible':
      return { alertWorthy: true, severity: 'high' };
    case 'score_decreased': {
      const drop = Number(change.before) - Number(change.after);
      return { alertWorthy: true, severity: drop >= 15 ? 'high' : 'medium' };
    }
    case 'completeness_decreased': {
      const drop = Number(change.before) - Number(change.after);
      return { alertWorthy: drop >= 1000, severity: drop >= 2000 ? 'high' : 'medium' };
    }
    case 'confidence_decreased':
      return { alertWorthy: Number(change.before) - Number(change.after) >= 1500, severity: 'medium' };
    case 'finding_created':
      return { alertWorthy: true, severity: 'medium' };
    default:
      return { alertWorthy: false, severity: 'informational' };
  }
}

export const MATERIALITY_POLICY_VERSION = 'spr.materiality.v1';

export function classifyMateriality(change: ObservationChange) {
  const high = new Set(['dimension_became_unknown', 'dimension_became_unavailable', 'dimension_became_expired', 'score_became_ineligible', 'evidence_expired', 'collector_failed']);
  const alertWorthy = high.has(change.type) ||
    (change.type === 'completeness_decreased' && Number(change.before) - Number(change.after) >= 0.1) ||
    (change.type === 'finding_created' && ['High', 'Critical'].includes(String((change.after as any)?.severity)));
  return {
    alertWorthy,
    severity: high.has(change.type) ? 'high' as const : alertWorthy ? 'medium' as const : 'informational' as const
  };
}
