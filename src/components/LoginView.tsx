import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, EyeOff, Loader, MailCheck, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { consumeAuthNotice } from '../lib/authNotice';
import { describeAuthRedirectError, parseAuthRedirectError } from '../lib/authRedirectError';
import { passwordRecoveryPending, setPasswordRecoveryPending } from '../lib/authRecovery';

interface LoginViewProps {
  onLoginSuccess: (user: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => void;
  brand?: { productName: string; logoDataUrl: string | null } | null;
}

const PRODUCTION_AUTH_REDIRECT = 'https://www.softwarepassportregistry.com/login';
function getAuthRedirect() {
  return typeof window === 'undefined' ? PRODUCTION_AUTH_REDIRECT : `${window.location.origin}/login`;
}

function preserveRecoveryIntent() {
  const url = new URL(window.location.href);
  url.searchParams.set('recovery', '1');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export default function LoginView({ onLoginSuccess, brand }: LoginViewProps) {
  const recoveryRequested = useRef(passwordRecoveryPending());
  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'recovery'>(() => recoveryRequested.current ? 'recovery' : 'login');
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unconfirmedEmail, setUnconfirmedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const productName = brand?.productName || 'Software Passport Registry';
  const brandedSignInTitle = brand ? `Sign in to ${brand.productName}` : 'Sign in';
  const finishSession = async (session: { access_token: string; user: any }) => {
    if (recoveryRequested.current) return;
    const user = session.user;
    const token = session.access_token;
    if (!user?.id || !token) throw new Error('Supabase returned an invalid session.');
    const emailVerified = Boolean(user.email_confirmed_at);
    if (!emailVerified) {
      const address = user.email?.trim().toLowerCase() || '';
      setUnconfirmedEmail(address);
      setNotice(address ? `Your account exists, but the email address is not confirmed yet. Open the confirmation link sent to ${address}, or request a new one below.` : 'Your account exists, but the email address is not confirmed yet. Open the confirmation link to activate it.');
      return;
    }

    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) throw assurance.error;
    if (assurance.data?.nextLevel === 'aal2' && assurance.data?.currentLevel !== 'aal2') {
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const factor = (factors.data?.totp || []).find((item: any) => item.status === 'verified');
      if (!factor?.id) throw new Error('This account requires multi-factor authentication, but no verified authenticator factor is available.');
      setMfaFactorId(String(factor.id));
      setMfaCode('');
      setNotice('Enter the current code from your authenticator app to complete sign-in.');
      return;
    }

    setMfaFactorId(null);
    setMfaCode('');
    onLoginSuccess({ uid: user.id, email: user.email ?? null, displayName: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User', token, emailVerified, onboarded: 0 });
  };
  useEffect(() => {
    if (recoveryRequested.current) preserveRecoveryIntent();
    const pending = consumeAuthNotice();
    if (pending) setNotice(pending);
    const redirectError = parseAuthRedirectError(window.location.hash);
    if (redirectError) {
      setError(describeAuthRedirectError(redirectError));
      if (redirectError.code === 'otp_expired') setUnconfirmedEmail(' ');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    let mounted = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return;
      if (error) { setError(error.message); return; }
      if (recoveryRequested.current) {
        setRecoveryReady(Boolean(data.session));
        if (!data.session) setError('This reset link has no active session. Request a new password reset link.');
        return;
      }
      if (!data.session) return;
      try { await finishSession(data.session); } catch (e) { if (mounted) setError(e instanceof Error ? e.message : 'Unable to restore your session.'); }
    }).catch((e) => { if (mounted) setError(e instanceof Error ? e.message : 'Unable to restore your session.'); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        recoveryRequested.current = true;
        setPasswordRecoveryPending(true);
        preserveRecoveryIntent();
        setMode('recovery');
      }
      if (recoveryRequested.current) { setRecoveryReady(Boolean(session)); return; }
      if (!session) return;
      // Do not wait for application work inside Supabase's auth lock.
      setTimeout(() => { if (mounted) void finishSession(session).catch((e) => { if (mounted) setError(e instanceof Error ? e.message : 'Authentication failed.'); }); }, 0);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'recovery') {
        if (!recoveryReady) throw new Error('Request a new password reset link before changing your password.');
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        const { data, error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session || !data.user) throw sessionError || new Error('Password updated. Sign in with your new password.');
        recoveryRequested.current = false;
        setPasswordRecoveryPending(false);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('recovery');
        window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search);
        setPassword(''); setConfirmPassword(''); setMode('login');
        await finishSession({ ...sessionData.session, user: data.user });
        return;
      }
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: getAuthRedirect() });
        if (error) throw error;
        setNotice('Password reset instructions sent if that email has an account.'); return;
      }
      if (mode === 'signup') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { full_name: email.trim().split('@')[0] }, emailRedirectTo: getAuthRedirect() } });
        if (error && (error as { code?: string }).code === 'over_email_send_rate_limit') throw new Error(`Supabase refused to send a confirmation email right now (${error.message}). The account was not created; wait a while and try again.`);
        if (error) throw error;
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError('An account with this email already exists. Sign in, or use "Forgot password?" to reset it.');
          return;
        }
        if (data.session) { await finishSession(data.session); return; }
        const address = email.trim().toLowerCase();
        setUnconfirmedEmail(address);
        setNotice(`Account created. Supabase has sent a confirmation link to ${address}. Open it to activate the account. The link is only valid for a limited time; if it has expired by the time you use it, request a new one below.`);
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
          setUnconfirmedEmail(email.trim().toLowerCase());
          throw new Error('This account has not been confirmed yet. Open the confirmation link that was emailed to you, or request a new one below.');
        }
        throw error;
      }
      if (!data.session) throw new Error('Login succeeded but no session was returned.');
      await finishSession(data.session);
    } catch (e) { setError(e instanceof Error ? e.message : 'Authentication failed.'); } finally { setBusy(false); }
  };
  const verifyMfa = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mfaFactorId || !/^\d{6}$/.test(mfaCode.trim())) {
      setError('Enter the current 6-digit code from your authenticator app.');
      return;
    }
    setMfaBusy(true);
    setError('');
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (challenge.error) throw challenge.error;
      if (!challenge.data?.id) throw new Error('Could not create an MFA challenge.');
      const verified = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.data.id,
        code: mfaCode.trim(),
      });
      if (verified.error) throw verified.error;
      const session = await supabase.auth.getSession();
      if (session.error || !session.data.session) throw session.error || new Error('MFA verification succeeded but no session was returned.');
      await finishSession(session.data.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authenticator verification failed.');
    } finally {
      setMfaBusy(false);
    }
  };

  const cancelMfa = async () => {
    await supabase.auth.signOut().catch(() => undefined);
    setMfaFactorId(null);
    setMfaCode('');
    setPassword('');
    setNotice('');
    setError('');
  };

  const resendConfirmation = async () => {
    const address = (unconfirmedEmail.trim() || email.trim()).toLowerCase();
    if (!address) { setError('Enter the email address you signed up with, then request a new confirmation link.'); return; }
    setResending(true); setError(''); setNotice('');
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: address, options: { emailRedirectTo: getAuthRedirect() } });
      if (error) throw error;
      setUnconfirmedEmail(address);
      setNotice(`Request accepted. If an unconfirmed account exists for ${address}, Supabase will email it a new confirmation link; open that link as soon as it arrives.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not request a new confirmation link.'); } finally { setResending(false); }
  };
  const title = mode === 'login' ? brandedSignInTitle : mode === 'signup' ? 'Create your SPR account' : mode === 'recovery' ? 'Set your new password' : 'Reset your password';
  return <main className="min-h-screen flex items-center justify-center px-6 py-12 bg-background text-foreground"><section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-xl">
    <div className="mb-7 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck size={24} /></div><div><h1 className="text-xl font-semibold">{productName}</h1><p className="text-sm text-muted-foreground">Verify software before you trust it.</p></div></div>
    <h2 className="mb-5 text-2xl font-semibold">{title}</h2>
    {error && <div className="mb-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"><AlertCircle size={18} />{error}</div>}
    {notice && <div className="mb-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm"><CheckCircle2 size={18} />{notice}</div>}
    {unconfirmedEmail && mode !== 'reset' && mode !== 'recovery' && <button type="button" onClick={resendConfirmation} disabled={resending} className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium disabled:opacity-50">{resending ? <Loader className="animate-spin" size={16} /> : <MailCheck size={16} />}Resend confirmation email</button>}
    {mfaFactorId ? (
      <form onSubmit={verifyMfa} className="space-y-4">
        <label className="block text-sm font-medium">Authenticator code
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required aria-label="Authenticator code" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 font-mono text-lg tracking-[.25em] outline-none focus:ring-2 focus:ring-primary" />
        </label>
        <button disabled={mfaBusy || mfaCode.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{mfaBusy ? <Loader className="animate-spin" size={18} /> : <ShieldCheck size={18} />}Verify and continue</button>
        <button type="button" onClick={() => void cancelMfa()} disabled={mfaBusy} className="w-full rounded-lg border border-border px-4 py-3 text-sm font-medium disabled:opacity-50">Sign out and use another account</button>
      </form>
    ) : (
      <>
        <form onSubmit={submit} className="space-y-4">{mode !== 'recovery' && <label className="block text-sm font-medium">Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" required autoComplete="email" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 outline-none focus:ring-2 focus:ring-primary" /></label>}
          {mode !== 'reset' && <label className="block text-sm font-medium">{mode === 'recovery' ? 'New password' : 'Password'}<div className="relative mt-1"><input value={password} onChange={e => setPassword(e.target.value)} type="password" required minLength={8} autoComplete={mode === 'signup' || mode === 'recovery' ? 'new-password' : 'current-password'} className="w-full rounded-lg border border-border bg-background px-3 py-3 pr-11 outline-none focus:ring-2 focus:ring-primary" /><EyeOff size={18} className="absolute right-3 top-3 text-muted-foreground" /></div></label>}
          {mode === 'recovery' && <label className="block text-sm font-medium">Confirm new password<input value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} type="password" required minLength={8} autoComplete="new-password" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 outline-none focus:ring-2 focus:ring-primary" /></label>}
          <button disabled={busy || (mode === 'recovery' && !recoveryReady)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? <Loader className="animate-spin" size={18} /> : <ArrowRight size={18} />}{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'recovery' ? 'Update password' : 'Send reset email'}</button></form>
        <div className="mt-5 flex justify-center gap-4 text-sm text-muted-foreground">{mode === 'recovery' ? <button onClick={() => { setMode('reset'); setPassword(''); setConfirmPassword(''); setError(''); }}>Request a new reset link</button> : mode === 'login' ? <><button onClick={() => setMode('signup')}>Create account</button><button onClick={() => setMode('reset')}>Forgot password?</button></> : <button onClick={() => { recoveryRequested.current = false; setPasswordRecoveryPending(false); const cleanUrl = new URL(window.location.href); cleanUrl.searchParams.delete('recovery'); window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search); setMode('login'); setError(''); setNotice(''); setUnconfirmedEmail(''); }}>Back to sign in</button>}</div>
      </>
    )}
    <footer className="mt-7 flex justify-center gap-4 text-xs text-muted-foreground"><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a></footer>
  </section></main>;
}
