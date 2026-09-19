import { describe, expect, it } from 'vitest';
import { describeAuthRedirectError, parseAuthRedirectError } from '../src/lib/authRedirectError';

describe('Supabase email-link redirect errors', () => {
  it('parses the fragment GoTrue appends when a confirmation link has expired', () => {
    const parsed = parseAuthRedirectError('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(parsed).toEqual({ code: 'otp_expired', description: 'Email link is invalid or has expired' });
    expect(describeAuthRedirectError(parsed!)).toMatch(/expired/i);
  });

  it('returns null for an empty or unrelated fragment', () => {
    expect(parseAuthRedirectError('')).toBeNull();
    expect(parseAuthRedirectError('#access_token=abc&type=signup')).toBeNull();
  });

  it('falls back to the bare error when no error_code is present', () => {
    expect(parseAuthRedirectError('#error=server_error&error_description=Something')).toEqual({ code: 'server_error', description: 'Something' });
  });
});
