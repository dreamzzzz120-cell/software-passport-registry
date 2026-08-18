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
