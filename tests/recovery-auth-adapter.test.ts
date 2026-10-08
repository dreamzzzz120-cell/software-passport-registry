// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getSession: vi.fn().mockResolvedValue({ data: { session: null } }), onAuthStateChange: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabaseConfigured: true, supabase: { auth: mock } }));
import { onAuthStateChanged, getRedirectResult, auth } from '../src/lib/supabase-auth';
import { setPasswordRecoveryPending } from '../src/lib/authRecovery';
const session = { user: { id: 'recovery-user', email: 'test@example.test', user_metadata: {} } };
let emit: (event: string, session: any) => void;
beforeEach(() => {
  setPasswordRecoveryPending(false);
  mock.getSession.mockResolvedValue({ data: { session } });
  mock.onAuthStateChange.mockImplementation(callback => { emit = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
});
afterEach(() => setPasswordRecoveryPending(false));
it('blocks session hydration and redirect restoration while password recovery is pending', async () => {
  setPasswordRecoveryPending(true);
  const callback = vi.fn(); const unsubscribe = onAuthStateChanged(auth, callback);
  await Promise.resolve();
  expect(callback).toHaveBeenCalledWith(null);
  expect(auth.currentUser).toBeNull();
  expect(await getRedirectResult(auth)).toBeNull();
  unsubscribe();
});
it('revokes workspace identity on recovery and blocks refresh until a fresh sign-in', async () => {
  const callback = vi.fn(); const unsubscribe = onAuthStateChanged(auth, callback);
  await Promise.resolve(); callback.mockClear();
  emit('PASSWORD_RECOVERY', session); emit('TOKEN_REFRESHED', session);
  expect(callback.mock.calls).toEqual([[null], [null]]);
  expect(auth.currentUser).toBeNull();
  emit('SIGNED_OUT', null); setPasswordRecoveryPending(false);
  emit('SIGNED_IN', session);
  expect(callback.mock.lastCall?.[0].uid).toBe('recovery-user');
  unsubscribe();
});
