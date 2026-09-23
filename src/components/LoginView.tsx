import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, EyeOff, Loader, MailCheck, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { consumeAuthNotice } from '../lib/authNotice';
import { describeAuthRedirectError, parseAuthRedirectError } from '../lib/authRedirectError';

interface LoginViewProps {
  onLoginSuccess: (user: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => void;
  brand?: { productName: string; logoDataUrl: string | null } | null;
}

const PRODUCTION_AUTH_REDIRECT = 'https://www.softwarepassportregistry.com/login';
function getAuthRedirect() {
  if (typeof window === 'undefined') return PRODUCTION_AUTH_REDIRECT;
  return `${window.location.origin}/login`;
}

export default function LoginView({ onLoginSuccess, brand }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // The address whose confirmation email can be re-sent. Set only when Supabase
  // itself established that the account is unconfirmed: a signup that returned
  // no session, an email_not_confirmed sign-in rejection, or an expired-link
  // redirect (for which the address is unknown and taken from the form).
  const [unconfirmedEmail, setUnconfirmedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const productName = brand?.productName || 'Software Passport Registry';
  const brandedSignInTitle = brand ? `Sign in to ${brand.productName}` : 'Sign in';
  const finishSession = async (session: { access_token: string; user: any }) => {
    const user = session.user;
    const token = session.access_token;
    if (!user?.id || !token) throw new Error('Supabase returned an invalid session.');
    const emailVerified = Boolean(user.email_confirmed_at);\n    if (!emailVerified) {\n      const address = user.email?.trim().toLowerCase() || '';\n      setUnconfirmedEmail(address);\n      setNotice(address ? `Your account exists, but the email address is not confirmed yet. Open the confirmation link sent to ${address}, or request a new one below.` : 'Your account exists, but the email address is not confirmed yet. Open the confirmation link to activate it.');\n      return;\n    }\n    onLoginSuccess({ uid: user.id, email: user.email ?? null, displayName: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User', token, emailVerified, onboarded: 0 });
  };
  useEffect(() => {
    const pending = consumeAuthNotice();
    if (pending) setNotice(pending);
    const redirectError = parseAuthRedirectError(window.location.hash);
    if (redirectError) {
      setError(describeAuthRedirectError(redirectError));
      if (redirectError.code === 'otp_expired') setUnconfirmedEmail(' ');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted || !data.session) return;
      try { await finishSession(data.session); } catch (e) { if (mounted) setError(e instanceof Error ? e.message : 'Unable to restore your session.'); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted || !session) return;
      try { await finishSession(session); } catch (e) { if (mounted) setError(e instanceof Error ? e.message : 'Authentication failed.'); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: getAuthRedirect() });
        if (error) throw error;
        setNotice('Password reset instructions sent if that email has an account.'); return;
      }
      if (mode === 'signup') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { full_name: email.trim().split('@')[0] }, emailRedirectTo: getAuthRedirect() } });
        // Observed live 2026-09-18: a second signup within a minute was refused with
        // 429 over_email_send_rate_limit, after which sign-in reported invalid
        // credentials, i.e. no account exists. Say that plainly; the bare
        // "email rate limit exceeded" reads as if the account was made.
        if (error && (error as { code?: string }).code === 'over_email_send_rate_limit') throw new Error(`Supabase refused to send a confirmation email right now (${error.message}). The account was not created; wait a while and try again.`);
        if (error) throw error;
        // With email enumeration protection on, Supabase answers a signup for an
        // address that already exists with a placeholder user carrying no
        // identities and sends nothing. Say so instead of promising an email.
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
  const resendConfirmation = async () => {
    const address = (unconfirmedEmail.trim() || email.trim()).toLowerCase();
    if (!address) { setError('Enter the email address you signed up with, then request a new confirmation link.'); return; }
    setResending(true); setError(''); setNotice('');
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: address, options: { emailRedirectTo: getAuthRedirect() } });
      // Supabase's own message is shown verbatim: it is the only party that
      // knows whether the send was rate-limited, rejected, or accepted.
      if (error) throw error;
      setUnconfirmedEmail(address);
      // A 200 here does not confirm a send: Supabase answers 200 for unknown
      // addresses too (email enumeration protection, observed 2026-09-18).
      setNotice(`Request accepted. If an unconfirmed account exists for ${address}, Supabase will email it a new confirmation link; open that link as soon as it arrives.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not request a new confirmation link.'); } finally { setResending(false); }
  };
  const title = mode === 'login' ? brandedSignInTitle : mode === 'signup' ? 'Create your SPR account' : 'Reset your password';
  return <main className="min-h-screen flex items-center justify-center px-6 py-12 bg-background text-foreground"><section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-xl">
    <div className="mb-7 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck size={24} /></div><div><h1 className="text-xl font-semibold">{productName}</h1><p className="text-sm text-muted-foreground">Verify software before you trust it.</p></div></div>
    <h2 className="mb-5 text-2xl font-semibold">{title}</h2>
    {error && <div className="mb-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"><AlertCircle size={18} />{error}</div>}
    {notice && <div className="mb-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm"><CheckCircle2 size={18} />{notice}</div>}
    {unconfirmedEmail && mode !== 'reset' && <button type="button" onClick={resendConfirmation} disabled={resending} className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium disabled:opacity-50">{resending ? <Loader className="animate-spin" size={16} /> : <MailCheck size={16} />}Resend confirmation email</button>}
    <form onSubmit={submit} className="space-y-4"><label className="block text-sm font-medium">Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" required autoComplete="email" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 outline-none focus:ring-2 focus:ring-primary" /></label>
      {mode !== 'reset' && <label className="block text-sm font-medium">Password<div className="relative mt-1"><input value={password} onChange={e => setPassword(e.target.value)} type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className="w-full rounded-lg border border-border bg-background px-3 py-3 pr-11 outline-none focus:ring-2 focus:ring-primary" /><EyeOff size={18} className="absolute right-3 top-3 text-muted-foreground" /></div></label>}
      <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? <Loader className="animate-spin" size={18} /> : <ArrowRight size={18} />}{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset email'}</button></form>
    <div className="mt-5 flex justify-center gap-4 text-sm text-muted-foreground">{mode === 'login' ? <><button onClick={() => setMode('signup')}>Create account</button><button onClick={() => setMode('reset')}>Forgot password?</button></> : <button onClick={() => { setMode('login'); setError(''); setNotice(''); setUnconfirmedEmail(''); }}>Back to sign in</button>}</div>
    <footer className="mt-7 flex justify-center gap-4 text-xs text-muted-foreground"><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a></footer>
  </section></main>;
}
