import { describe, expect, it } from 'vitest';

function publicPassportAllowed(token: string, isRevoked: boolean, isPrivate: boolean): boolean {
  return Boolean(token) && token.length >= 32 && !isRevoked && !isPrivate;
}

describe('public passport security contract', () => {
  it('rejects short/empty tokens and private or revoked passports', () => {
    expect(publicPassportAllowed('', false, false)).toBe(false);
    expect(publicPassportAllowed('short', false, false)).toBe(false);
    expect(publicPassportAllowed('a'.repeat(32), true, false)).toBe(false);
    expect(publicPassportAllowed('a'.repeat(32), false, true)).toBe(false);
  });

  it('allows only sufficiently long public tokens', () => {
    expect(publicPassportAllowed('a'.repeat(32), false, false)).toBe(true);
  });
});
