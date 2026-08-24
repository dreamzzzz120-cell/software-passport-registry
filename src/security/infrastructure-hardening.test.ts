import { describe, expect, it } from 'vitest';
import { assertRuntime, assertSafeOutboundUrl, redactCredentialFields, sha256Evidence } from './infrastructure-hardening';

describe('SPR infrastructure hardening', () => {
  it('requires the supported Node runtime', () => expect(() => assertRuntime()).not.toThrow());
  it('blocks plaintext outbound destinations', async () => await expect(assertSafeOutboundUrl('http://example.com')).rejects.toThrow('SECURITY_HTTPS_REQUIRED'));
  it('blocks localhost and cloud metadata', async () => {
    await expect(assertSafeOutboundUrl('https://localhost/')).rejects.toThrow('SECURITY_PRIVATE_DESTINATION_BLOCKED');
    await expect(assertSafeOutboundUrl('https://169.254.169.254/')).rejects.toThrow('SECURITY_PRIVATE_DESTINATION_BLOCKED');
  });
  it('does not leak credential-shaped fields', () => expect(redactCredentialFields({ token: 'x', nested: { password: 'y', safe: 'z' } })).toEqual({ token: '[REDACTED]', nested: { password: '[REDACTED]', safe: 'z' } }));
  it('produces deterministic evidence hashes', () => expect(sha256Evidence({ b: 2, a: 1 })).toBe(sha256Evidence({ a: 1, b: 2 })));
});
