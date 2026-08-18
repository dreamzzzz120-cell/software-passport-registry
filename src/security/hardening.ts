/**
 * Production security primitives for SPR.
 * Keep security decisions deterministic, explicit, and fail-closed.
 */
import crypto from 'node:crypto';
import net from 'node:net';

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

export function safeErrorMessage(error: unknown, fallback = 'Internal server error'): string {
  if (process.env.NODE_ENV === 'production') return fallback;
  return error instanceof Error ? error.message : String(error);
}

export function redactSecret(value: string | undefined | null): string {
  if (!value) return '';
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length || a.length % 2 !== 0) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return crypto.timingSafeEqual(left, right);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function verifySha256Secret(secret: string, expectedHash: string): boolean {
  if (!secret || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  return timingSafeEqualHex(sha256Hex(secret), expectedHash.toLowerCase());
}

/** Reject direct requests to loopback/private/link-local destinations.
 * DNS resolution must still be performed by the caller and rechecked before connect.
 */
export function isPrivateIp(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === 'ip6-localhost' || normalized === '0.0.0.0' || normalized === '::') return true;
  const family = net.isIP(normalized);
  if (family === 4) return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(normalized));
  if (family === 6) return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  return false;
}

export function validateExternalHttpsUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Only HTTPS URLs are permitted');
  if (url.username || url.password) throw new Error('Credential-bearing URLs are not permitted');
  if (isPrivateIp(url.hostname)) throw new Error('Private or local network destinations are not permitted');
  return url;
}

export function requestId(): string {
  return crypto.randomUUID();
}
