import crypto from 'node:crypto';

export type SecurityAuditEvent = {
  eventId: string;
  timestamp: string;
  tenantId: string;
  actorId?: string;
  action: string;
  result: 'success' | 'denied' | 'failure';
  requestId?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

function normalizeIsoTimestamp(timestamp: string): string {
  // Parse ISO 8601 timestamp and normalize to UTC with milliseconds
  // Handles: 2026-08-17T00:00:00.000Z, 2026-08-17T00:00:00Z, 2026-08-17T00:00:00+00:00, etc.
  const date = new Date(timestamp);
  return date.toISOString();
}

export function canonicalAuditEvent(event: SecurityAuditEvent): string {
  return JSON.stringify({
    eventId: event.eventId,
    timestamp: normalizeIsoTimestamp(event.timestamp),
    tenantId: event.tenantId,
    actorId: event.actorId ?? null,
    action: event.action,
    result: event.result,
    requestId: event.requestId ?? null,
    resourceId: event.resourceId ?? null,
    metadata: event.metadata ?? {},
  });
}

export function hashAuditEvent(event: SecurityAuditEvent, previousHash: string | null): string {
  return crypto.createHash('sha256').update(`${previousHash ?? 'GENESIS'}\n${canonicalAuditEvent(event)}`, 'utf8').digest('hex');
}

