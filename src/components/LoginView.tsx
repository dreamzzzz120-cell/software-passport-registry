import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader, ShieldCheck, Upload } from 'lucide-react';
import { auth, googleAuthProvider, firebaseConfigured } from '../lib/firebase';
import { consumeAuthNotice, notProvisionedMessage } from '../lib/authNotice';
import { beginSignupTransition, endSignupTransition } from '../lib/signupTransition';

interface LoginViewProps { onLoginSuccess: (user: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => void; }
const STAGED_KEY = 'spr-universal-intake-v1';
const authMessage = (error: any, fallback: string) => {
  switch (error?.code) {
    case 'auth/invalid-credential': case 'auth/user-not-found': case 'auth/wrong-password': return 'The email or password is incorrect.';
    case 'auth/email-already-in-use': return 'An account already exists for this email. Sign in instead.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/weak-password': return 'Choose a stronger password with at least 6 characters.';
    case 'auth/too-many-requests': return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/unauthorized-domain': return `This site is not authorized for Firebase sign-in (${window.location.hostname}). Add this domain in Firebase Authentication → Settings → Authorized domains.`;
    case 'auth/operation-not-allowed': return 'Google sign-in is not enabled in Firebase Authentication.';
    case 'auth/popup-blocked': return 'Your browser blocked the Google sign-in window. We will retry with a redirect.';
    case 'auth/popup-closed-by-user': case 'auth/cancelled-popup-request': return '';
    case 'auth/account-exists-with-different-credential': return 'This email already uses a different sign-in method.';
    case 'auth/network-request-failed': return 'Authentication could not reach Firebase. Check your connection and try again.';
    case 'auth/web-storage-unsupported': return 'Browser storage is unavailable. Enable cookies/site data for this site and try again.';
    case 'auth/argument-error': return 'Firebase authentication is not initialized correctly for this deployment. Check the Vercel VITE_FIREBASE_* production variables and redeploy.';
    default: return error?.message ? `${fallback} (${error.code || 'unknown-error'})` : fallback;
  }
};

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false); const [googleLoading, setGoogleLoading] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [stagedCount, setStagedCount] = useState(0); const [stagedRepo, setStagedRepo] = useState('');

  useEffect(() => {
    const refreshStaged = () => { try { const raw = sessionStorage.getItem(STAGED_KEY); if (!raw) return; const data = JSON.parse(raw); setStagedCount(Array.isArray(data?.items) ? data.items.length : 0); setStagedRepo(typeof data?.repo === 'string' ? data.repo : ''); } catch { setStagedCount(0); setStagedRepo(''); } };
    refreshStaged(); window.addEventListener('storage', refreshStaged); return () => window.removeEventListener('storage', refreshStaged);
  }, []);

  const complete = async (user: User) => {
    if (!auth) throw new Error('Firebase authentication is not initialized.'); await reload(user);
    if (!user.emailVerified) { try { await sendEmailVerification(user); } catch {} await signOut(auth); setNotice('Verify your email before entering SPR. We sent a fresh verification email. Then sign in again.'); return; }
    const token = await user.getIdToken(true); onLoginSuccess({ uid: user.uid, email: user.email, displayName: user.displayName || user.email?.split('@')[0] || 'User', token, emailVerified: true, onboarded: 0 });
  };

  useEffect(() => {
    const pendingNotice = consumeAuthNotice(); if (pendingNotice) setError(pendingNotice);
    if (!auth) { setNotice('Authentication is temporarily unavailable. The frontend loaded, but Firebase browser configuration is missing from this deployment.'); return; }
    const unsubscribe = onAuthStateChanged(auth, currentUser => { if (!currentUser || currentUser.emailVerified) return; setNotice('Verify your email before entering the protected workspace.'); });
    const onProvisioningFailure = (event: Event) => { const email = (event as CustomEvent<{ email?: string | null }>).detail?.email ?? null; setError(notProvisionedMessage(email)); setNotice('Authentication succeeded; workspace authorization is still required.'); };
    window.addEventListener('auth-provisioning-failed', onProvisioningFailure); return () => { unsubscribe(); window.removeEventListener('auth-provisioning-failed', onProvisioningFailure); };
  }, []);

  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (loading || googleLoading) return; if (!auth || !firebaseConfigured) { setError('Firebase browser configuration is missing. Add the VITE_FIREBASE_* Production variables in Vercel and redeploy.'); return; } setLoading(true); setError(''); setNotice(''); try { const result = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password); await complete(result.user); } catch (err: any) { const message = authMessage(err, 'Sign-in failed.'); if (message) setError(message); } finally { setLoading(false); } };
  const register = async () => { if (loading || googleLoading) return; if (!auth || !firebaseConfigured) { setError('Firebase browser configuration is missing. Add the VITE_FIREBASE_* Production variables in Vercel and redeploy.'); return; } setLoading(true); setError(''); setNotice(''); beginSignupTransition(); try { const result = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password); await sendEmailVerification(result.user); await signOut(auth); setNotice('Account created. Check your email, verify it, then sign in. Your staged intake will remain available in this browser.'); } catch (err: any) { setError(authMessage(err, 'Account creation failed.')); } finally { endSignupTransition(); setLoading(false); } };
  const google = async () => { if (loading || googleLoading) return; if (!auth || !firebaseConfigured) { setError('Firebase browser configuration is missing. Add the VITE_FIREBASE_* Production variables in Vercel and redeploy.'); return; } setGoogleLoading(true); setError(''); setNotice('Opening secure Google sign-in…'); try { const result = await signInWithPopup(auth, googleAuthProvider); await complete(result.user); } catch (err: any) { if (['auth/popup-blocked','auth/operation-not-supported-in-this-environment'].includes(err?.code)) { try { await signInWithRedirect(auth, googleAuthProvider); return; } catch (redirectError: any) { const message = authMessage(redirectError, 'Google sign-in failed.'); if (message) setError(message); else setNotice(''); setGoogleLoading(false); return; } } const message = authMessage(err, 'Google sign-in failed.'); if (message) setError(message); else setNotice(''); setGoogleLoading(false); } };
  const reset = async () => { if (!email.trim()) { setError('Enter your email first.'); return; } if (!auth || !firebaseConfigured) { setError('Firebase browser configuration is missing.'); return; } setLoading(true); setError(''); setNotice(''); try { await sendPasswordResetEmail(auth, email.trim().toLowerCase()); setNotice('Password reset email sent.'); } catch (err: any) { setError(authMessage(err, 'Could not send the reset email.')); } finally { setLoading(false); } };
  const resendVerification = async () => { const currentUser = auth?.currentUser; if (!currentUser || currentUser.emailVerified) return; setLoading(true); setError(''); setNotice(''); try { await sendEmailVerification(currentUser); setNotice('A fresh verification email has been sent.'); } catch (err: any) { setError(authMessage(err, 'Could not resend the verification email.')); } finally { setLoading(false); } };
  const busy = loading || googleLoading;

  return <div className="min-h-screen flex items-center justify-center bg-[var(--spr-surface)] p-6 text-[var(--spr-text)]"><form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-7 shadow-2xl" noValidate>
    <div className="text-center"><img src="/brand/spr-logo.jpg" alt="Software Passport Registry" className="mx-auto h-12 w-auto" /><h1 className="mt-5 text-3xl font-semibold">Sign in to SPR</h1><p className="mt-2 text-sm text-[var(--spr-text-muted)]">Use your work email or continue with Google.</p></div>
    {stagedCount > 0 || stagedRepo ? <div className="rounded-xl border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent-soft)]/10 p-4"><div className="flex gap-3"><Upload className="h-5 w-5 shrink-0 text-[var(--spr-highlight)]" /><div><div className="text-sm font-semibold">Your intake is waiting</div><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">{stagedCount > 0 ? `${stagedCount} file(s)` : 'No files'}{stagedRepo ? ` + repository ${stagedRepo}` : ''} staged in this browser. Sign in or create your account to continue.</p></div></div></div> : null}
    {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)] p-3 text-sm text-cyan-100"><CheckCircle2 className="mr-2 inline h-4 w-4" />{notice}</div>}
    <label className="block text-sm font-semibold">Email<input className="mt-2 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]/40" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
    <label className="block text-sm font-semibold">Password<span className="relative mt-2 block"><input className="w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 pr-12 text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]/40" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /><button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 px-4 text-[var(--spr-text-muted)]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
    <button type="submit" disabled={busy} className="w-full rounded-xl bg-[var(--spr-accent)] px-4 py-3.5 font-bold text-white disabled:opacity-50">{loading ? <Loader className="mx-auto h-5 w-5 animate-spin" /> : <>Sign in <ArrowRight className="ml-1 inline h-4 w-4" /></>}</button>
    <button type="button" disabled={busy} onClick={register} className="w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-4 py-3 font-semibold"><ShieldCheck className="mr-2 inline h-4 w-4" />Create account</button>
    <button type="button" disabled={busy} onClick={google} className="w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-4 py-3 font-semibold">{googleLoading ? <Loader className="mx-auto h-5 w-5 animate-spin" /> : 'Continue with Google'}</button>
    <div className="flex justify-between text-xs"><button type="button" disabled={busy} onClick={reset} className="text-[var(--spr-highlight)]">Forgot password?</button><button type="button" disabled={busy} onClick={resendVerification} className="text-[var(--spr-text-muted)]">Resend verification</button></div>
    <div className="flex justify-center gap-4 border-t border-[var(--spr-border)] pt-4 text-[11px] text-[var(--spr-text-faint)]"><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a></div>
  </form></div>;
}
