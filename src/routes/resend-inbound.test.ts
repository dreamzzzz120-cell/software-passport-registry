import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyResendInbound, inboundReplySender } from './resend-inbound.ts';

const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
const t = 1800000000;
const id = 'msg_123456789';
const body = Buffer.from(JSON.stringify({ type: 'email.received', data: { from: 'support@example.com', to: ['replies@replies.softwarepassportregistry.com'] } }));
const signature = (payload: Buffer) => 'v1,' + createHmac('sha256', Buffer.alloc(32, 7)).update(id + '.' + t + '.' + payload.toString('utf8')).digest('base64');
describe('Resend inbound verification', () => {
  it('requires genuine unmodified signed raw body', () => {
    const headers = { 'svix-id': id, 'svix-timestamp': String(t), 'svix-signature': signature(body) };
    expect(verifyResendInbound(body, headers, secret, t * 1000)).toBe(true);
    expect(verifyResendInbound(Buffer.from('{}'), headers, secret, t * 1000)).toBe(false);
    expect(verifyResendInbound(body, headers, secret, t * 1000 + 360000)).toBe(false);
    expect(verifyResendInbound(body, { ...headers, 'svix-signature': 'v1,abc' }, secret, t * 1000)).toBe(false);
  });
  it('only accepts a direct reply routed to the outreach inbox', () => {
    expect(inboundReplySender({ from: 'hello@example.org', to: ['replies@replies.softwarepassportregistry.com'] })).toBe('hello@example.org');
    expect(inboundReplySender({ from: 'hello@example.org', to: ['other@example.org'] })).toBeNull();
    expect(inboundReplySender({ from: 'Hello <hello@example.org>', to: ['replies@replies.softwarepassportregistry.com'] })).toBeNull();
  });
});