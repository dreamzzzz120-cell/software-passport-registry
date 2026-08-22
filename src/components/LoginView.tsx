import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, getRedirectResult, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, type User } from 'firebase/auth';
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
    case 'auth/weak-password': return 'Choose a stronger password with at least 6 characters.';
    case 'auth/unauthorized-domain': return `Google sign-in is blocked for this site (${window.location.hostname}). Add this domain to Firebase Authentication → Settings → Authorized domains.`;
    case 'auth/operation-not-allowed': return 'Google sign-in is disabled in Firebase. Enable the Google provider in Authentication → Sign-in method.';
    case 'auth/popup-closed-by-user': return 'The Google sign-in window was closed before authentication completed.';
    case 'auth/popup-blocked': return 'Your browser blocked the Google sign-in popup. Use the Google button again to continue with secure redirect sign-in.';
    case 'auth/cancelled-popup-request': return 'A Google sign-in request is already in progress. Please wait a moment and try again.';
    case 'auth/network-request-failed': return 'Google sign-in could not reach Firebase. Check the network connection and try again.';
    case 'auth/web-storage-unsupported': return 'Browser storage is unavailable. Enable cookies/site data for this site and try again.';
    case 'auth/internal-error': return 'Google authentication returned an internal Firebase error. The page will retry using secure redirect sign-in.';
    default: return error?.message ? `${fallback} (${error.code || 'unknown-error'})` : fallback;
  }
};

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
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

  // A redirect result is required when popup auth falls back to the browser redirect flow.
  useEffect(() => {
    let active = true;
    void getRedirectResult(auth)
      .then(async (result) => {
        if (!active || !result?.user) return;
        setLoading(true);
        setError('');
        await complete(result.user);
      })
      .catch((e) => {
        if (active) setError(authMessage(e, 'Google sign-in could not be completed.'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      await complete(result.user);
    } catch (e) {
      setError(authMessage(e, 'Sign-in failed.'));
    } finally { setLoading(false); }
  };

  const register = async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await sendEmailVerification(result.user);
      setNotice('Account created. Check your email, verify it, then sign in.');
      await auth.signOut();
    } catch (e) {
      setError(authMessage(e, 'Account creation failed.'));
    } finally { setLoading(false); }
  };

  const google = async () => {
    if (loading) return;
    setLoading(true); setError(''); setNotice('');
    try {
      // Popup is fastest on desktop. If the browser blocks it or Firebase reports
      // a transient popup/internal failure, redirect is the reliable fallback.
      const result = await signInWithPopup(auth, googleAuthProvider);
      await complete(result.user);
    } catch (e: any) {
      const fallbackCodes = new Set(['auth/popup-blocked', 'auth/popup-timeout', 'auth/internal-error', 'auth/cancelled-popup-request']);
      if (fallbackCodes.has(e?.code)) {
        setNotice('Opening secure Google sign-in…');
        try {
          await signInWithRedirect(auth, googleAuthProvider);
          return;
        } catch (redirectError) {
          setError(authMessage(redirectError, 'Google sign-in failed.'));
        }
      } else {
        setError(authMessage(e, 'Google sign-in failed.'));
      }
    } finally {
      // Redirect navigation will unload the page; otherwise restore the button.
      setLoading(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) { setError('Enter your email first.'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('Password reset email sent.');
    } catch (e) {
      setError(authMessage(e, 'Could not send the reset email.'));
    } finally { setLoading(false); }
  };

  return <div className="min-h-screen flex items-center justify-center p-6"><form onSubmit={submit} className="w-full max-w-md space-y-5"><div className="text-center text-xs font-bold uppercase tracking-[.25em] text-cyan-300">Software Passport Registry</div>{error && <div role="alert"><AlertCircle className="inline mr-2" />{error}</div>}{notice && <div role="status"><CheckCircle2 className="inline mr-2" />{notice}</div>}<input aria-label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /><div><input aria-label="Password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div><button type="submit" disabled={loading}>{loading ? <Loader className="inline animate-spin" /> : <ArrowRight className="inline" />} Sign in</button><button type="button" disabled={loading} onClick={register}><ShieldCheck className="inline" /> Create account</button><button type="button" disabled={loading} onClick={google}>Continue with Google</button><button type="button" disabled={loading} onClick={reset}>Reset password</button></form></div>;
}
