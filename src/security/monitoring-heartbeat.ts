export type Heartbeat = { jobId: string; tenantId: string; observedAt: number; status: 'running' | 'completed' | 'failed' };

export function isStaleHeartbeat(h: Heartbeat, now = Date.now(), maxAgeMs = 120_000): boolean {
  return !h.tenantId || !h.jobId || !Number.isFinite(h.observedAt) || h.observedAt <= 0 || now - h.observedAt > maxAgeMs;
}

export function nextHeartbeatDeadline(observedAt: number, intervalMs = 60_000): number {
  return observedAt + Math.max(5_000, intervalMs);
}
