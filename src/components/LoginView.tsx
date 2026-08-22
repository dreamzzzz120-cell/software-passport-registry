import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, getRedirectResult, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithRedirect, type User } from 'firebase/auth';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader, ShieldCheck } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';

interface LoginViewProps { onLoginSuccess: (user: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => void; }

const authMessage = (error: any, fallback: string) => {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password': return 'The email or password is incorrect.';
    case 'auth/email-already-in-use': return 'An account already exists for this email.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements': return 'Choose a stronger password that meets the account security requirements.';
    case 'auth/unauthorized-domain': return `Authentication is not authorized for ${window.location.hostname}. Add this exact production domain to Firebase Authentication → Settings → Authorized domains.`;
    case 'auth/operation-not-allowed': return 'This authentication method is currently disabled. Please contact the administrator.';
    case 'auth/quota-exceeded':
    case 'auth/too-many-requests': return 'Authentication is temporarily rate-limited. Please wait and try again.';
    case 'auth/network-request-failed': return 'Firebase could not be reached. Check your connection and try again.';
    case 'auth/web-storage-unsupported': return 'Browser storage is unavailable. Enable cookies/site data for this site and try again.';
    case 'auth/popup-closed-by-user': return 'The Google sign-in window was closed before authentication completed.';
    case 'auth/popup-blocked': return 'Google sign-in was blocked by the browser. SPR uses secure redirect sign-in instead.';
    case 'auth/cancelled-popup-request': return 'A Google sign-in request is already in progress. Please wait a moment and try again.';
    case 'auth/internal-error': return 'Firebase returned an internal authentication error. Please try again.';
    default: return fallback;
  }
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const complete = async (user: User) => {
    if (!user.emailVerified) {
      setNotice('Please verify your email before entering the SPR workspace.');
      return;
    }
    const token = await user.getIdToken(true);
    onLoginSuccess({ uid: user.uid, email: user.email, displayName: user.displayName || user.email?.split('@')[0] || 'User', token, emailVerified: user.emailVerified, onboarded: 0 });
  };

  useEffect(() => {
    let active = true;
    void getRedirectResult(auth)
      .then(async (result) => {
        if (!active || !result?.user) return;
        setGoogleLoading(true);
        setError('');
        await complete(result.user);
      })
      .catch((e) => {
        if (active) setError(authMessage(e, 'Google sign-in could not be completed.'));
      })
      .finally(() => { if (active) setGoogleLoading(false); });
    return () => { active = false; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) { setError('Enter your email address.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      await complete(result.user);
    } catch (e) {
      setError(authMessage(e, 'Sign-in failed.'));
    } finally { setLoading(false); }
  };

  const register = async () => {
    if (busy) return;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) { setError('Enter your email address first.'); return; }
    if (password.length < 6) { setError('Choose a password with at least 6 characters.'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      await sendEmailVerification(result.user);
      setNotice('Account created. Check your email, verify it, then sign in.');
      await auth.signOut();
    } catch (e) {
      setError(authMessage(e, 'Account creation failed.'));
    } finally { setLoading(false); }
  };

  const google = async () => {
    if (loading || googleLoading) return;
    setGoogleLoading(true); setError(''); setNotice('');
    try {
      setNotice('Opening secure Google sign-in…');
      await signInWithRedirect(auth, googleAuthProvider);
    } catch (e: any) {
      setGoogleLoading(false);
      setNotice('');
      setError(authMessage(e, 'Google sign-in failed.'));
    }
  };

  const reset = async () => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) { setError('Enter your email first.'); return; }
    if (busy) return;
    setLoading(true); setError(''); setNotice('');
    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      setNotice('If an account exists for that email, a password reset message has been sent.');
    } catch (e) {
      setError(authMessage(e, 'Could not process the password reset request.'));
    } finally { setLoading(false); }
  };

  const busy = loading || googleLoading;
  const passwordAutoComplete = 'current-password';

  return <div className="min-h-screen flex items-center justify-center p-6"><form onSubmit={submit} noValidate className="w-full max-w-md space-y-5" aria-busy={busy}><div className="text-center text-xs font-bold uppercase tracking-[.25em] text-cyan-300">Software Passport Registry</div>{error && <div role="alert" aria-live="assertive"><AlertCircle className="inline mr-2" />{error}</div>}{notice && <div role="status" aria-live="polite"><CheckCircle2 className="inline mr-2" />{notice}</div>}<label className="sr-only" htmlFor="spr-email">Email</label><input id="spr-email" aria-label="Email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /><div><label className="sr-only" htmlFor="spr-password">Password</label><input id="spr-password" aria-label="Password" type={showPassword ? 'text' : 'password'} autoComplete={passwordAutoComplete} value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff /> : <Eye />}</button></div><button type="submit" disabled={busy}>{loading ? <Loader className="inline animate-spin" /> : <ArrowRight className="inline" />} Sign in</button><button type="button" disabled={busy} onClick={register}><ShieldCheck className="inline" /> Create account</button><button type="button" disabled={busy} onClick={google}>{googleLoading ? <Loader className="inline animate-spin" /> : null} Continue with Google</button><button type="button" disabled={busy} onClick={reset}>Reset password</button></form></div>;
}
