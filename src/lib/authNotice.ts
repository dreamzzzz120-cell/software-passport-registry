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

export function consumeAuthNotice(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value;
  } catch {
    return null;
  }
}
