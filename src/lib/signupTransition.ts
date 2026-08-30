/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Firebase's createUserWithEmailAndPassword() automatically signs the new
// user in. That is a Firebase identity, NOT a completed SPR login: the
// account has no provisioned SPR `users` row yet and its email is not
// verified. Without a guard, that automatic sign-in made App treat the
// half-created account as an authenticated session, which:
//
//   1. swapped LoginView out for the authenticated shell mid-signup,
//      unmounting the very component that was about to report success, and
//   2. kicked off the authenticated batch data load, whose seven requests
//      correctly returned 403 ("not provisioned") - and whose 403 handler
//      then overwrote the signup-success message with a provisioning
//      error, so a successful signup looked like a rejection.
//
// This flag marks the window between "start creating the account" and
// "finished signing that account back out" so the auth layer can ignore
// the transient Firebase session. It deliberately does NOT weaken any
// check: the server still rejects unprovisioned and unverified accounts
// exactly as before, and email verification is still required to sign in.
//
// Module-level in-memory state is the right scope here: the whole
// transition begins and ends inside a single uninterrupted page lifetime.
// (Contrast src/lib/authNotice.ts, which must survive a real remount and
// therefore uses sessionStorage.)
let signupTransitionActive = false;

export function beginSignupTransition(): void {
  signupTransitionActive = true;
}

export function endSignupTransition(): void {
  signupTransitionActive = false;
}

export function isSignupTransitionActive(): boolean {
  return signupTransitionActive;
}
