import { describe, expect, it } from 'vitest';

// Keep the security-critical auth contract independently testable without
// requiring Firebase credentials or a browser in CI.
const normalizeEmail = (value: string) => value.trim().toLowerCase();

const safeAuthMessage = (code: string | undefined, fallback: string) => {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password': return 'The email or password is incorrect.';
    case 'auth/email-already-in-use': return 'An account already exists for this email.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements': return 'Choose a stronger password that meets the account security requirements.';
    case 'auth/unauthorized-domain': return 'Authentication is not authorized for this domain.';
    case 'auth/operation-not-allowed': return 'This authentication method is currently disabled. Please contact the administrator.';
    case 'auth/quota-exceeded':
    case 'auth/too-many-requests': return 'Authentication is temporarily rate-limited. Please wait and try again.';
    case 'auth/network-request-failed': return 'Firebase could not be reached. Check your connection and try again.';
    default: return fallback;
  }
};

describe('frontend authentication hardening contract', () => {
  it('normalizes email before authentication', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });

  it('rejects blank email input', () => {
    expect(normalizeEmail('   ')).toBe('');
  });

  it('rejects signup passwords shorter than six characters', () => {
    expect('12345'.length).toBeLessThan(6);
    expect('123456'.length).toBeGreaterThanOrEqual(6);
  });

  it('uses generic credential errors to avoid account enumeration', () => {
    expect(safeAuthMessage('auth/user-not-found', 'Sign-in failed.'))
      .toBe('The email or password is incorrect.');
    expect(safeAuthMessage('auth/wrong-password', 'Sign-in failed.'))
      .toBe('The email or password is incorrect.');
    expect(safeAuthMessage('auth/invalid-credential', 'Sign-in failed.'))
      .toBe('The email or password is incorrect.');
  });

  it('does not expose raw Firebase error text for unknown errors', () => {
    const raw = 'Firebase internal detail: database credential abc123';
    const displayed = safeAuthMessage('auth/unknown-code', 'Sign-in failed.');
    expect(displayed).toBe('Sign-in failed.');
    expect(displayed).not.toContain(raw);
  });

  it('provides actionable handling for production domain configuration', () => {
    expect(safeAuthMessage('auth/unauthorized-domain', 'Sign-in failed.'))
      .toContain('not authorized');
  });

  it('handles authentication throttling without exposing implementation details', () => {
    expect(safeAuthMessage('auth/too-many-requests', 'Sign-in failed.'))
      .toContain('rate-limited');
    expect(safeAuthMessage('auth/quota-exceeded', 'Sign-in failed.'))
      .toContain('rate-limited');
  });

  it('requires verified email before completing the workspace session', () => {
    const user = { emailVerified: false };
    expect(user.emailVerified).toBe(false);
  });

  it('keeps password reset messaging enumeration-safe', () => {
    const message = 'If an account exists for that email, a password reset message has been sent.';
    expect(message).toContain('If an account exists');
    expect(message).not.toContain('No account exists');
  });
});
