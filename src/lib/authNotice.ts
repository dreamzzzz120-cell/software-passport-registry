/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Carries a safe, user-facing explanation across a sign-out + navigate-to-
// /login remount. A plain in-memory event (e.g. a window CustomEvent) is not
// enough here: the code that detects the failure (App's batch data load, or
// apiClient's 403-on-/api/user/me check) runs while the authenticated shell
// is still mounted, and by the time signOut()/navigate() finish and a fresh
// LoginView mounts, any listener registered only in that new instance has
// already missed the event. sessionStorage survives the remount; LoginView
// reads and clears it on mount.
const KEY = 'spr_auth_notice';

export function setAuthNotice(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    // Storage unavailable (private browsing, disabled site data) - the
    // notice is best-effort UX, not required for the sign-out itself.
  }
}

/**
 * The single wording for "authenticated, but this address is not a member of
 * any workspace". Naming the rejected address matters: one person can hold
 * several Firebase identities (a Google account and a password account, work
 * and personal), only some of which were ever invited, and the generic
 * message left them re-trying the same unprovisioned address with no way to
 * tell which one SPR actually knows. This states the address that was
 * refused and the one action that resolves it. It grants nothing -- the
 * server's decision is unchanged.
 */
export function notProvisionedMessage(email?: string | null): string {
  const remedy = 'Ask a workspace Owner or Admin to invite this address from Settings > Team, then open the invitation link to finish setting it up.';
  return email
    ? `Signed in as ${email}, but that address is not a member of any SPR workspace. ${remedy}`
    : `Sign-in succeeded, but this account is not a member of any SPR workspace. ${remedy}`;
}

export function consumeAuthNotice(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
