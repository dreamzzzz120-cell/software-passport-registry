import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader, ShieldCheck } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase';

interface LoginViewProps {
  onLoginSuccess: (user: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => void;
}

const authMessage = (error: any, fallback: string) => {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password': return 'The email or password is incorrect.';
    case 'auth/email-already-in-use': return 'An account already exists for this email.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/weak-password': return 'Choose a stronger password with at least 6 characters.';
    case 'auth/unauthorized-domain': return `Google sign-in is blocked for this site (${window.location.hostname}). Add this exact domain to Firebase Authentication → Settings → Authorized domains.`;
    case 'auth/operation-not-allowed': return 'Google sign-in is disabled in Firebase. Enable the Google provider in Authentication → Sign-in method.';
    case 'auth/popup-blocked': return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/popup-closed-by-user': return 'Google sign-in was cancelled.';
    case 'auth/cancelled-popup-request': return 'Another Google sign-in request is already active.';
    case 'auth/account-exists-with-different-credential': return 'This email already uses a different sign-in method. Sign in with that method first.';
    case 'auth/network-request-failed': return 'Authentication could not reach Firebase. Check the network connection and try again.';
    case 'auth/web-storage-unsupported': return 'Browser storage is unavailable. Enable cookies/site data for this site and try again.';
    default: return error?.message ? `${fallback} (${error.code || 'unknown-error'})` : fallback;
  }
};

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const complete = async (user: User) => {
    await reload(user);
    if (!user.emailVerified) {
      setNotice('Your account is authenticated but your email is not verified yet. Verify it, then sign in again.');
      return;
    }
    const token = await user.getIdToken(true);
    onLoginSuccess({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email?.split('@')[0] || 'User',
      token,
      emailVerified: user.emailVerified,
      onboarded: 0,
    });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) return;
      if (currentUser.emailVerified) return;
      setNotice('Verify your email before entering the protected workspace.');
    });
    const onProvisioningFailure = () => {
      setError('Your Firebase account is valid, but SPR has not provisioned this account in its workspace yet. Owner access is granted only through the controlled owner bootstrap.');
      setNotice('Authentication succeeded; workspace authorization is still required.');
    };
    window.addEventListener('auth-provisioning-failed', onProvisioningFailure);
    return () => {
      unsubscribe();
      window.removeEventListener('auth-provisioning-failed', onProvisioningFailure);
    };
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
      await signOut(auth);
    } catch (e) {
      setError(authMessage(e, 'Account creation failed.'));
    } finally { setLoading(false); }
  };

  const google = async () => {
    if (loading || googleLoading) return;
    setGoogleLoading(true); setError(''); setNotice('Opening secure Google sign-in…');
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      await complete(result.user);
    } catch (e: any) {
      setError(authMessage(e, 'Google sign-in failed.'));
      if (e?.code === 'auth/popup-closed-by-user') setNotice('');
    } finally { setGoogleLoading(false); }
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

  const resendVerification = async () => {
    const user = auth.currentUser;
    if (!user || user.emailVerified) return;
    setLoading(true); setError(''); setNotice('');
    try {
      await sendEmailVerification(user);
      setNotice('A fresh verification email has been sent.');
    } catch (e) {
      setError(authMessage(e, 'Could not resend the verification email.'));
    } finally { setLoading(false); }
  };

  const busy = loading || googleLoading;

  return <div className="min-h-screen flex items-center justify-center p-6">
    <form onSubmit={submit} className="w-full max-w-md space-y-5" noValidate>
      <div className="text-center text-xs font-bold uppercase tracking-[.25em] text-cyan-300">Software Passport Registry</div>
      {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="inline mr-2" />{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-100"><CheckCircle2 className="inline mr-2" />{notice}</div>}
      <label htmlFor="spr-email" className="sr-only">Email</label>
      <input id="spr-email" aria-label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <div>
        <label htmlFor="spr-password" className="sr-only">Password</label>
        <input id="spr-password" aria-label="Password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
        <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button>
      </div>
      <button type="submit" disabled={busy}>{loading ? <Loader className="inline animate-spin" /> : <ArrowRight className="inline" />} Sign in</button>
      <button type="button" disabled={busy} onClick={register}><ShieldCheck className="inline" /> Create account</button>
      <button type="button" disabled={busy} onClick={google}>{googleLoading ? <Loader className="inline animate-spin" /> : null} Continue with Google</button>
      <button type="button" disabled={busy} onClick={reset}>Reset password</button>
      {auth.currentUser && !auth.currentUser.emailVerified && <button type="button" disabled={busy} onClick={resendVerification}>Resend verification email</button>}
    </form>
  </div>;
}
