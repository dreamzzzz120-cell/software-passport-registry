import crypto from 'node:crypto';

export const WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

export function signWebhookPayload(secret: string, payload: string, timestampSeconds: number): string {
  if (!secret || !Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    throw new Error('Invalid webhook signing inputs');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestampSeconds}.${payload}`, 'utf8')
    .digest('hex');
}

export function buildWebhookSignatureHeader(secret: string, payload: string, timestampSeconds = Math.floor(Date.now() / 1000)): string {
  const signature = signWebhookPayload(secret, payload, timestampSeconds);
  return `t=${timestampSeconds},v1=${signature}`;
}

export function verifyWebhookSignature(secret: string, payload: string, header: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > WEBHOOK_REPLAY_WINDOW_SECONDS) return false;
  const expected = signWebhookPayload(secret, payload, timestamp);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(match[2], 'hex'));
}
