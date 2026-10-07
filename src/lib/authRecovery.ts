// Capture recovery intent before Supabase consumes the URL fragment.
// Presentation only: Supabase still authorizes the password update.
export function isRecoveryRedirect(hash: string, search = ''): boolean {
  return new URLSearchParams(hash.replace(/^#/, '')).get('type') === 'recovery'
    || new URLSearchParams(search).get('recovery') === '1';
}
let pending = typeof window !== 'undefined' && isRecoveryRedirect(window.location.hash, window.location.search);
export function passwordRecoveryPending(): boolean { return pending; }
export function setPasswordRecoveryPending(value: boolean): void { pending = value; }
