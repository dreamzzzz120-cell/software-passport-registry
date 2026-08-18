import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPrivateIp, timingSafeEqualHex, validateExternalHttpsUrl, verifySha256Secret } from './hardening.ts';

const SECRET = 'spr-production-bootstrap-secret';

describe('production hardening primitives', () => {
  it('verifies SHA-256 bootstrap secrets without plain-text comparison', () => {
    const hash = createHash('sha256').update(SECRET, 'utf8').digest('hex');
    expect(verifySha256Secret(SECRET, hash)).toBe(true);
    expect(verifySha256Secret('wrong-secret', hash)).toBe(false);
  });

  it('uses constant-time equality for equal-length hex values', () => {
    expect(timingSafeEqualHex('aabbccdd', 'aabbccdd')).toBe(true);
    expect(timingSafeEqualHex('aabbccdd', 'aabbccde')).toBe(false);
    expect(timingSafeEqualHex('aa', 'aabb')).toBe(false);
  });

  it('rejects local/private network targets', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1']) {
      expect(isPrivateIp(host)).toBe(true);
    }
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('requires HTTPS and rejects credential-bearing URLs', () => {
    expect(() => validateExternalHttpsUrl('http://example.com')).toThrow();
    expect(() => validateExternalHttpsUrl('https://user:pass@example.com')).toThrow();
    expect(() => validateExternalHttpsUrl('https://127.0.0.1')).toThrow();
    expect(validateExternalHttpsUrl('https://example.com/path').hostname).toBe('example.com');
  });
});
