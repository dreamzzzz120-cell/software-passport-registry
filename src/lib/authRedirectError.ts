/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// When a Supabase email link (signup confirmation, password reset) cannot be
// honoured, GoTrue redirects to the configured emailRedirectTo with the reason
// in the URL fragment, e.g.
//   /login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
// Nothing read that fragment, so a person whose confirmation link had expired
// landed on a blank sign-in form, then got "Email not confirmed" on every
// attempt with no way forward (observed in the Supabase auth log on
// 2026-09-18: four /verify "email link has expired" hits followed by ~25
// email_not_confirmed sign-in rejections from the same address).
export interface AuthRedirectError { code: string; description: string; }

export function parseAuthRedirectError(fragment: string): AuthRedirectError | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const code = params.get('error_code') || params.get('error');
  if (!code) return null;
  return { code, description: params.get('error_description') || '' };
}

// Wording is limited to what the error code establishes. otp_expired means the
// link's one-time token is no longer valid; a fresh link is the only remedy.
export function describeAuthRedirectError(error: AuthRedirectError): string {
  if (error.code === 'otp_expired') return 'That confirmation link has expired. Request a new one below and open it as soon as it arrives.';
  if (error.code === 'access_denied') return `The link could not be used${error.description ? `: ${error.description}` : '.'}`;
  return `Sign-in link error (${error.code})${error.description ? `: ${error.description}` : ''}`;
}
