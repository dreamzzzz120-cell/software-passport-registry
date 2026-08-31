import { describe, expect, it } from 'vitest';
import { hashAuditEvent } from './audit-chain';

const event = {
  eventId: 'evt-1', timestamp: '2026-08-17T00:00:00.000Z', tenantId: 'tenant-a',
  action: 'AUTH_FAILURE', result: 'denied' as const, requestId: 'req-1',
};

describe('tamper-evident audit chain', () => {
  it('is deterministic for identical event and predecessor', () => {
    expect(hashAuditEvent(event, null)).toBe(hashAuditEvent(event, null));
  });

  it('changes when the predecessor changes', () => {
    expect(hashAuditEvent(event, null)).not.toBe(hashAuditEvent(event, 'different'));
  });

  it('changes when security-relevant event data changes', () => {
    expect(hashAuditEvent(event, null)).not.toBe(hashAuditEvent({ ...event, result: 'success' }, null));
  });

  it('canonicalizes equivalent ISO timestamps', () => {
    expect(hashAuditEvent(event, null)).toBe(
      hashAuditEvent({ ...event, timestamp: '2026-08-17T00:00:00+00:00' }, null),
    );
  });

  it('changes when tenant identity changes', () => {
    expect(hashAuditEvent(event, null)).not.toBe(
      hashAuditEvent({ ...event, tenantId: 'tenant-b' }, null),
    );
  });
});
