export type MonitoringChange = 'NEW' | 'CHANGED' | 'RESOLVED' | 'STALE' | 'UNKNOWN';
export type MonitoringItem = { id: string; fingerprint: string; observedAt: string | null; status: string | null };
export type MonitoringInput = { passport: { id: string; name: string }; previous: MonitoringItem[]; current: MonitoringItem[]; evaluatedAt: number; staleAfterDays?: number };
export type MonitoringResult = { agent: 'monitoring'; schemaVersion: 'spr-monitoring-agent-v1'; passport: MonitoringInput['passport']; changes: Array<{ id: string; type: MonitoringChange; reason: string; previousFingerprint?: string; currentFingerprint?: string; observedAt: string | null }>; summary: { materialChanges: number; stale: number; unknown: number }; policy: { rule: string; evaluatedAt: string } };

function isStale(timestamp: string | null, evaluatedAt: number, days: number) {
  if (!timestamp) return true;
  const parsed = Date.parse(timestamp);
  return !Number.isFinite(parsed) || evaluatedAt - parsed > days * 86400000;
}

export function evaluateMonitoring(input: MonitoringInput): MonitoringResult {
  const days = Math.max(1, Math.min(3650, Math.floor(input.staleAfterDays ?? 30)));
  const previous = new Map(input.previous.map(item => [item.id, item]));
  const current = new Map(input.current.map(item => [item.id, item]));
  const ids = [...new Set([...previous.keys(), ...current.keys()])].sort();
  const changes = ids.map(id => {
    const before = previous.get(id);
    const after = current.get(id);
    if (!after) return { id, type: 'RESOLVED' as const, reason: 'Observed item existed previously but is absent from the current observation.', observedAt: before?.observedAt ?? null, previousFingerprint: before?.fingerprint };
    if (!before) return { id, type: 'NEW' as const, reason: 'Item is present in the current observation but was not present previously.', observedAt: after.observedAt, currentFingerprint: after.fingerprint };
    if (before.fingerprint !== after.fingerprint || before.status !== after.status) return { id, type: 'CHANGED' as const, reason: 'Observed fingerprint or status changed between observations.', observedAt: after.observedAt, previousFingerprint: before.fingerprint, currentFingerprint: after.fingerprint };
    if (isStale(after.observedAt, input.evaluatedAt, days)) return { id, type: 'STALE' as const, reason: `Current observation is older than ${days} days or has no valid timestamp.`, observedAt: after.observedAt, currentFingerprint: after.fingerprint };
    return { id, type: 'UNKNOWN' as const, reason: 'No material change can be established from the observed inputs.', observedAt: after.observedAt, currentFingerprint: after.fingerprint };
  });
  const materialChanges = changes.filter(c => ['NEW', 'CHANGED', 'RESOLVED'].includes(c.type)).length;
  const stale = changes.filter(c => c.type === 'STALE').length;
  const unknown = changes.filter(c => c.type === 'UNKNOWN').length;
  return { agent: 'monitoring', schemaVersion: 'spr-monitoring-agent-v1', passport: input.passport, changes, summary: { materialChanges, stale, unknown }, policy: { rule: 'Monitoring reports only deterministic changes in observed SPR items. Repeated identical observations are UNKNOWN/no-op rather than false alerts; missing or stale timestamps are never treated as fresh.', evaluatedAt: new Date(input.evaluatedAt).toISOString() } };
}
