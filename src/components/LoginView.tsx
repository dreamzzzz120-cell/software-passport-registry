import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from 'firebase/auth';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';
import SPRLogo from './SPRLogo';

interface LoginViewProps {
  onLoginSuccess: (user: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => void;
}

const authMessage = (error: any, fallback: string) => {
  switch (error?.code) {
    case 'auth/invalid-credential': case 'auth/user-not-found': case 'auth/wrong-password': return 'The email or password is incorrect.';
    case 'auth/email-already-in-use': return 'An account already exists for this email.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/weak-password': return 'Choose a stronger password with at least 6 characters.';
    case 'auth/too-many-requests': return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed': return 'We could not reach Firebase. Check your connection and try again.';
    case 'auth/unauthorized-domain': return 'This site is not authorized for Google sign-in in Firebase yet.';
    case 'auth/operation-not-allowed': return 'This sign-in method is disabled in Firebase Authentication.';
    case 'auth/configuration-not-found': case 'auth/app-not-authorized': case 'auth/invalid-api-key': return 'Firebase Authentication is not configured for this environment.';
    default: return fallback;
  }
};

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const useMockAuth = import.meta.env.DEV === true || import.meta.env.VITE_FIREBASE_USE_MOCK_AUTH === 'true';
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const completeSignIn = async (user: User | null) => {
    if (useMockAuth) {
      onLoginSuccess({ uid: 'dev-user-1', email: email || 'dev@example.com', displayName: email ? email.split('@')[0] : 'dev-user', token: 'mock-token-dev', emailVerified: true, onboarded: 0 });
      return;
    }
    if (!user) return;
    onLoginSuccess({ uid: user.uid, email: user.email, displayName: user.displayName || user.email?.split('@')[0] || 'SPR user', token: await user.getIdToken(true), emailVerified: user.emailVerified, onboarded: 0 });
  };

  useEffect(() => {
    let active = true;
    getRedirectResult(auth).then((result) => { if (active && result?.user) return completeSignIn(result.user); }).catch((err) => { if (active) setError(authMessage(err, 'Google sign-in could not be completed.')); });
    return () => { active = false; };
  }, []);

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setNotice(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return setError('Enter your email address.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (mode === 'signup' && password !== confirmPassword) return setError('Passwords do not match.');
    setLoading(true);
    try {
      if (useMockAuth) { await new Promise((r) => setTimeout(r, 250)); await completeSignIn(null); return; }
      const credential = mode === 'login' ? await signInWithEmailAndPassword(auth, normalizedEmail, password) : await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      if (mode === 'signup' && !credential.user.emailVerified) await sendEmailVerification(credential.user);
      await completeSignIn(credential.user);
    } catch (err: any) {
      console.error('[Firebase Auth] Email authentication failed:', err);
      setError(authMessage(err, mode === 'login' ? 'Sign-in failed. Please try again.' : 'Account creation failed. Please try again.'));
    } finally { setLoading(false); }
  };

  const signInWithGoogle = async () => {
    setLoading(true); setError(null); setNotice(null);
    try {
      if (useMockAuth) { await new Promise((r) => setTimeout(r, 250)); await completeSignIn(null); return; }
      await completeSignIn((await signInWithPopup(auth, googleAuthProvider)).user);
    } catch (err: any) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err?.code)) { await signInWithRedirect(auth, googleAuthProvider); return; }
      if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err?.code)) setError(authMessage(err, 'Google sign-in failed. Please try again.'));
    } finally { setLoading(false); }
  };

  const resetPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase(); setError(null); setNotice(null);
    if (!normalizedEmail) return setError('Enter your email address first.');
    setLoading(true);
    try {
      if (useMockAuth) { setNotice('Password reset is disabled in local demo mode.'); return; }
      await sendPasswordResetEmail(auth, normalizedEmail); setNotice('If an account exists for that email, reset instructions have been sent.');
    } catch (err: any) { setError(authMessage(err, 'Password reset could not be started. Please try again.')); }
    finally { setLoading(false); }
  };

  const switchMode = (nextMode: 'login' | 'signup') => { setMode(nextMode); setError(null); setNotice(null); setConfirmPassword(''); };

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950 lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden min-h-screen overflow-hidden bg-slate-950 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-48 -left-32 h-[28rem] w-[28rem] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative z-10"><SPRLogo /></div>
        <div className="relative z-10 max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-300"><ShieldCheck className="h-4 w-4 text-indigo-300" />Global Trust Infrastructure</div>
          <h1 className="text-5xl font-semibold tracking-[-0.04em] text-white xl:text-6xl">Software trust, organized.</h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-400">Manage software passports, evidence, risk, and compliance from one secure workspace.</p>
          <div className="mt-8 grid max-w-lg grid-cols-3 gap-3">{['Passports', 'Evidence', 'Risk'].map((item) => <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.05] p-4"><div className="text-sm font-semibold text-white">{item}</div><div className="mt-1 text-xs text-slate-500">Built into SPR</div></div>)}</div>
        </div>
        <p className="relative z-10 text-xs text-slate-600">SPR Trust OS · Software Passport Registry</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[430px]">
          <div className="mb-10 lg:hidden"><SPRLogo /></div>
          <div className="mb-8"><p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">SPR Trust OS</p><h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{mode === 'login' ? 'Sign in to your software trust workspace.' : 'Create an account to start managing software trust.'}</p></div>
          <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100/80 p-1">{(['login', 'signup'] as const).map((item) => <button key={item} type="button" onClick={() => switchMode(item)} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${mode === item ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{item === 'login' ? 'Sign in' : 'Create account'}</button>)}</div>
          {(error || notice) && <div role={error ? 'alert' : 'status'} className={`mt-5 flex gap-3 rounded-xl border p-3.5 text-sm leading-5 ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || notice}</span></div>}
          <form onSubmit={submitEmail} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold text-slate-700">Email address<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} placeholder="you@example.com" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" /></label>
            <label className="block text-sm font-semibold text-slate-700"><span className="flex items-center justify-between">Password{mode === 'login' && <button type="button" onClick={resetPassword} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Forgot password?</button>}</span><span className="relative mt-2 block"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} placeholder="At least 6 characters" className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 px-4 text-slate-400 hover:text-slate-700">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
            {mode === 'signup' && <label className="block text-sm font-semibold text-slate-700">Confirm password<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={loading} placeholder="Repeat your password" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" /></label>}
            <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">{loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <>{mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight className="h-4 w-4" /></>}</button>
          </form>
          <div className="my-6 flex items-center gap-4 text-xs font-medium text-slate-400 before:h-px before:flex-1 before:bg-slate-200 after:h-px after:flex-1 after:bg-slate-200">OR</div>
          <button type="button" onClick={signInWithGoogle} disabled={loading} className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"><svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.52h3.26c1.91-1.76 3.01-4.35 3.01-7.39Z"/><path fill="#34A853" d="M12 22c2.73 0 5.02-.9 6.69-2.44l-3.26-2.52c-.9.6-2.05.96-3.43.96-2.64 0-4.88-1.78-5.68-4.18H2.95v2.6A10.1 10.1 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.32 13.82A6.07 6.07 0 0 1 6 12c0-.63.11-1.24.32-1.82v-2.6H2.95A10.01 10.01 0 0 0 1.9 12c0 1.61.38 3.13 1.05 4.42l3.37-2.6Z"/><path fill="#EA4335" d="M12 6c1.49 0 2.83.51 3.88 1.5l2.91-2.91C17.02 2.98 14.73 2 12 2a10.1 10.1 0 0 0-9.05 5.58l3.37 2.6C7.12 7.78 9.36 6 12 6Z"/></svg>Continue with Google</button>
          <p className="mt-7 text-center text-xs leading-5 text-slate-400">By continuing, you agree to your organization’s access and security policies.</p>
        </div>
      </section>
    </main>
  );
}
