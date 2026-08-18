import { describe, expect, it } from 'vitest';
import { buildWebhookSignatureHeader, signWebhookPayload, verifyWebhookSignature } from './webhook-signing';

describe('webhook signing', () => {
  it('signs and verifies a payload', () => {
    const payload = JSON.stringify({ event: 'passport.updated', id: 'p_123' });
    const timestamp = 1_800_000_000;
    const header = buildWebhookSignatureHeader('test-secret', payload, timestamp);
    expect(verifyWebhookSignature('test-secret', payload, header, timestamp)).toBe(true);
  });

  it('rejects tampering and wrong secrets', () => {
    const payload = 'original';
    const timestamp = 1_800_000_000;
    const signature = signWebhookPayload('test-secret', payload, timestamp);
    const header = `t=${timestamp},v1=${signature}`;
    expect(verifyWebhookSignature('test-secret', 'tampered', header, timestamp)).toBe(false);
    expect(verifyWebhookSignature('wrong-secret', payload, header, timestamp)).toBe(false);
  });

  it('rejects replay outside the clock-skew window', () => {
    const timestamp = 1_800_000_000;
    const header = buildWebhookSignatureHeader('test-secret', 'payload', timestamp);
    expect(verifyWebhookSignature('test-secret', 'payload', header, timestamp + 301)).toBe(false);
  });

  it('rejects malformed headers', () => {
    expect(verifyWebhookSignature('test-secret', 'payload', 'invalid', 1_800_000_000)).toBe(false);
  });
});
