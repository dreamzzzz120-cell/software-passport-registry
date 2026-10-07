// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(),
    listFactors: vi.fn(),
    challenge: vi.fn(),
    verify: vi.fn(),
  },
}));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth } }));
import LoginView from '../src/components/LoginView';
import { isRecoveryRedirect, setPasswordRecoveryPending } from '../src/lib/authRecovery';
const session = { access_token: 'test-token', user: { id: 'test-user', email: 'user@example.test', email_confirmed_at: '2026-10-01', user_metadata: {} } };
let listener: (event: string, currentSession: typeof session | null) => unknown;
const complete = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); setPasswordRecoveryPending(true);
  window.history.replaceState(null, '', '/login?recovery=1');
  auth.getSession.mockResolvedValue({ data: { session }, error: null });
  auth.updateUser.mockResolvedValue({ data: { user: session.user }, error: null });
  auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
  auth.mfa.listFactors.mockResolvedValue({ data: { totp: [], phone: [] }, error: null });
  auth.onAuthStateChange.mockImplementation(callback => { listener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
});
afterEach(() => { cleanup(); setPasswordRecoveryPending(false); });
async function enterPasswords(first = 'new-password', second = first) {
  await waitFor(() => expect((screen.getByRole('button', { name: 'Update password' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: first } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: second } });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
}
it('recognizes old fragment links and new redirects without treating signup as recovery', () => {
  expect(isRecoveryRedirect('#type=recovery&access_token=test')).toBe(true);
  expect(isRecoveryRedirect('', '?recovery=1')).toBe(true);
  expect(isRecoveryRedirect('#type=signup')).toBe(false);
});
it('keeps a restored recovery session on the password form instead of entering the workspace', async () => {
  render(<LoginView onLoginSuccess={complete} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Update password' }) as HTMLButtonElement).disabled).toBe(false));
  expect(complete).not.toHaveBeenCalled();
  act(() => { expect(listener('TOKEN_REFRESHED', session)).toBeUndefined(); });
  expect(complete).not.toHaveBeenCalled();
});
it('updates through Supabase before entering the workspace and removes recovery intent', async () => {
  render(<LoginView onLoginSuccess={complete} />);
  await enterPasswords();
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
  expect(window.location.search).toBe('');
});
it('does not update mismatched passwords', async () => {
  render(<LoginView onLoginSuccess={complete} />);
  await enterPasswords('new-password', 'other-password');
  await screen.findByText('Passwords do not match.');
  expect(auth.updateUser).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
});
it('keeps provider failures on the recovery form without claiming success', async () => {
  auth.updateUser.mockResolvedValue({ data: { user: null }, error: new Error('Password update rejected') });
  render(<LoginView onLoginSuccess={complete} />);
  await enterPasswords();
  await screen.findByText('Password update rejected'); expect(complete).not.toHaveBeenCalled();
});
it('requires an active session and offers a fresh reset link when the old one is unusable', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  render(<LoginView onLoginSuccess={complete} />);
  await screen.findByText(/reset link has no active session/);
  expect((screen.getByRole('button', { name: 'Update password' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Request a new reset link' }));
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }));
  await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.test', { redirectTo: `${window.location.origin}/login` }));
});
it('switches to recovery for a live auth event before any login callback runs', async () => {
  setPasswordRecoveryPending(false); auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  render(<LoginView onLoginSuccess={complete} />);
  act(() => { expect(listener('PASSWORD_RECOVERY', session)).toBeUndefined(); });
  await screen.findByRole('heading', { name: 'Set your new password' });
  expect(complete).not.toHaveBeenCalled();
});
it('disables password submission if the recovery session signs out', async () => {
  render(<LoginView onLoginSuccess={complete} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Update password' }) as HTMLButtonElement).disabled).toBe(false));
  act(() => { listener('SIGNED_OUT', null); });
  expect((screen.getByRole('button', { name: 'Update password' }) as HTMLButtonElement).disabled).toBe(true);
});
