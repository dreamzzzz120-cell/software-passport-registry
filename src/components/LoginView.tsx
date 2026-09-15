import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../utils/apiClient';

interface LoginViewProps {
  onLoginSuccess: (user: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => void;
  brand?: { productName: string; logoDataUrl: string | null } | null;
}

export default function LoginView({ onLoginSuccess, brand }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const productName = brand?.productName || 'Software Passport Registry';

  const finishSession = async (session: { access_token: string; user: any }) => {
    const user = session.user;
    const token = session.access_token;
    if (!user?.id || !token) throw new Error('Supabase returned an invalid session.');
    const emailVerified = Boolean(user.email_confirmed_at);
    if (!emailVerified) {
      setNotice('Check your email and confirm your account before signing in.');
      await supabase.auth.signOut();
      return;
    }

    // Provision the SPR tenant on first verified sign-in. The backend verifies
    // the Supabase token before creating or returning the workspace.
    const response = await fetch('/api/auth/workspace', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok && response.status !== 409) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || 'Your account could not be provisioned.');
    }

    onLoginSuccess({
      uid: user.id,
      email: user.email ?? null,
      displayName: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User',
      token,
      emailVerified: true,
      onboarded: 0,
    });
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!mounted || sessionError || !data.session) return;
      try { await finishSession(data.session); } catch (e) { if (mounted) setError(e instanceof Error ? e.message : 'Unable to restore your session.'); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted || !session) return;
      try { await finishSession(session); } catch (e) { if (mounted) setError(e instanceof Error ? e.message : 'Authentication failed.'); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'reset') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` });
        if (resetError) throw resetError;
        setNotice('Password reset instructions sent if that email has an account.');
        return;
      }
      if (mode === 'signup') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        const { data, error: signupError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: email.trim().split('@')[0] }, emailRedirectTo: `${window.location.origin}/login` },
        });
        if (signupError) throw signupError;
        if (data.session) await finishSession(data.session);
        else setNotice('Account created. Check your email to verify it, then sign in.');
        return;
      }
      const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (loginError) throw loginError;
      if (!data.session) throw new Error('Login succeeded but no session was returned.');
      await finishSession(data.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed.');
    } finally { setBusy(false); }
  };

  const google = async () => {
    setBusy(true); setError('');
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/login` } });
      if (oauthError) throw oauthError;
    } catch (e) { setError(e instanceof Error ? e.message : 'Google sign-in failed.'); setBusy(false); }
  };

  const title = mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create your SPR account' : 'Reset your password';

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12 bg-background text-foreground">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-xl">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck size={24} /></div>
          <div><h1 className="text-xl font-semibold">{productName}</h1><p className="text-sm text-muted-foreground">Verify software before you trust it.</p></div>
        </div>
        <h2 className="mb-5 text-2xl font-semibold">{title}</h2>
        {error && <div className="mb-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"><AlertCircle size={18} className="shrink-0" />{error}</div>}
        {notice && <div className="mb-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm"><CheckCircle2 size={18} className="shrink-0" />{notice}</div>}
        {mode !== 'reset' && <button type="button" onClick={google} disabled={busy} className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-3 font-medium hover:bg-muted disabled:opacity-50">Continue with Google</button>}
        {mode !== 'reset' && <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />OR<span className="h-px flex-1 bg-border" /></div>}
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" required autoComplete="email" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          {mode !== 'reset' && <label className="block text-sm font-medium">Password<div className="relative mt-1"><input value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className="w-full rounded-lg border border-border bg-background px-3 py-3 pr-11 outline-none focus:ring-2 focus:ring-primary" /><button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-3 text-muted-foreground"><EyeOff size={18} /></button></div></label>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{busy ? <Loader className="animate-spin" size={18} /> : <ArrowRight size={18} />}{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset email'}</button>
        </form>
        <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {mode === 'login' && <><button onClick={() => setMode('signup')} className="hover:text-foreground">Create account</button><button onClick={() => setMode('reset')} className="hover:text-foreground">Forgot password?</button></>}
          {mode !== 'login' && <button onClick={() => { setMode('login'); setError(''); setNotice(''); }} className="hover:text-foreground">Back to sign in</button>}
        </div>
      </section>
    </main>
  );
}
