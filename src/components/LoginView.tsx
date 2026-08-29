import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader, ShieldCheck } from 'lucide-react';
import { auth, googleAuthProvider, firebaseConfigured } from '../lib/firebase';

interface LoginViewProps {
  onLoginSuccess: (user: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => void;
}

const authMessage = (error: any, fallback: string) => {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password': return 'The email or password is incorrect.';
    case 'auth/email-already-in-use': return 'An account already exists for this email. Sign in instead.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/weak-password': return 'Choose a stronger password with at least 6 characters.';
    case 'auth/too-many-requests': return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/unauthorized-domain': return `This site is not authorized for Firebase sign-in (${window.location.hostname}). Add this domain in Firebase Authentication → Settings → Authorized domains.`;
    case 'auth/operation-not-allowed': return 'Google sign-in is not enabled in Firebase Authentication.';
    case 'auth/popup-blocked': return 'Your browser blocked the Google sign-in window. We will retry with a redirect.';
    case 'auth/popup-closed-by-user': return '';
    case 'auth/cancelled-popup-request': return '';
    case 'auth/account-exists-with-different-credential': return 'This email already uses a different sign-in method.';
    case 'auth/network-request-failed': return 'Authentication could not reach Firebase. Check your connection and try again.';
    case 'auth/web-storage-unsupported': return 'Browser storage is unavailable. Enable cookies/site data for this site and try again.';
    case 'auth/argument-error': return 'Firebase authentication is not initialized correctly for this deployment. Check the Vercel VITE_FIREBASE_* production variables and redeploy.';
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
    if (!auth) throw new Error('Firebase authentication is not initialized.');
    await reload(user);
    if (!user.emailVerified) {
      try { await sendEmailVerification(user); } catch { /* Firebase may rate-limit repeated verification emails. */ }
      await signOut(auth);
      setNotice('Verify your email before entering SPR. We sent a fresh verification email. Then sign in again.');
      return;
    }
    const token = await user.getIdToken(true);
    onLoginSuccess({ uid: user.uid, email: user.email, displayName: user.displayName || user.email?.split('@')[0] || 'User', token, emailVerified: true, onboarded: 0 });
  };

  useEffect(() => {
    if (!auth) {
      setNotice('Authentication is temporarily unavailable. The frontend loaded, but Firebase browser configuration is missing from this deployment.');
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser || currentUser.emailVerified) return;
      setNotice('Verify your email before entering the protected workspace.');
    });
    const onProvisioningFailure = () => {
      setError('Your Firebase account is valid, but SPR has not provisioned this account in its workspace yet.');
      setNotice('Authentication succeeded; workspace authorization is still required.');
    };
    window.addEventListener('auth-provisioning-failed', onProvisioningFailure);
    return () => { unsubscribe(); window.removeEventListener('auth-provisioning-failed', onProvisioningFailure); };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || googleLoading) return;
    if (!auth || !firebaseConfigured) { setError('Firebase browser configuration is missing. Add the VITE_FIREBASE_* Production variables in Vercel and redeploy.'); return; }
    setLoading(true); setError(''); setNotice('');
    try { const result = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password); await complete(result.user); }
    catch (err: any) { const message = authMessage(err, 'Sign-in failed.'); if (message) setError(message); }
    finally { setLoading(false); }
  };

  const register = async () => {
    if (loading || googleLoading) return;
    if (!auth || !firebaseConfigured) { setError('Firebase browser configuration is missing. Add the VITE_FIREBASE_* Production variables in Vercel and redeploy.'); return; }
    setLoading(true); setError(''); setNotice('');
    try { const result = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password); await sendEmailVerification(result.user); await signOut(auth); setNotice('Account created. Check your email, verify it, then sign in.'); }
    catch (err: any) { setError(authMessage(err, 'Account creation failed.')); }
    finally { setLoading(false); }
  };

  const google = async () => {
    if (loading || googleLoading) return;
    if (!auth || !firebaseConfigured) { setError('Firebase browser configuration is missing. Add the VITE_FIREBASE_* Production variables in Vercel and redeploy.'); return; }
    setGoogleLoading(true); setError(''); setNotice('Opening secure Google sign-in…');
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      await complete(result.user);
    } catch (err: any) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err?.code)) {
        try {
          await signInWithRedirect(auth, googleAuthProvider);
          return;
        } catch (redirectError: any) {
          const message = authMessage(redirectError, 'Google sign-in failed.');
          if (message) setError(message); else setNotice('');
          setGoogleLoading(false);
          return;
        }
      }
      const message = authMessage(err, 'Google sign-in failed.');
      if (message) setError(message); else setNotice('');
      setGoogleLoading(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) { setError('Enter your email first.'); return; }
    if (!auth || !firebaseConfigured) { setError('Firebase browser configuration is missing.'); return; }
    setLoading(true); setError(''); setNotice('');
    try { await sendPasswordResetEmail(auth, email.trim().toLowerCase()); setNotice('Password reset email sent.'); }
    catch (err: any) { setError(authMessage(err, 'Could not send the reset email.')); }
    finally { setLoading(false); }
  };

  const resendVerification = async () => {
    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.emailVerified) return;
    setLoading(true); setError(''); setNotice('');
    try { await sendEmailVerification(currentUser); setNotice('A fresh verification email has been sent.'); }
    catch (err: any) { setError(authMessage(err, 'Could not resend the verification email.')); }
    finally { setLoading(false); }
  };

  const busy = loading || googleLoading;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e1e1e] p-6 text-[#d4d4d4]">
      <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-md border border-[#3c3c3c] bg-[#252526] p-7 shadow-2xl" noValidate>
        <div className="text-center"><img src="/brand/spr-logo.jpg" alt="Software Passport Registry" className="mx-auto h-12 w-auto" /><h1 className="mt-5 text-3xl font-semibold">Sign in to SPR</h1><p className="mt-2 text-sm text-[#9d9d9d]">Use your work email or continue with Google.</p></div>
        {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-[#3794ff]/40 bg-[#094771] p-3 text-sm text-cyan-100"><CheckCircle2 className="mr-2 inline h-4 w-4" />{notice}</div>}
        <label className="block text-sm font-semibold text-[#d4d4d4]">Email<input className="mt-2 w-full rounded-xl border border-[#3c3c3c] bg-[#181818] px-4 py-3 text-[#d4d4d4] outline-none focus:border-[#3794ff]/40" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="block text-sm font-semibold text-[#d4d4d4]">Password<span className="relative mt-2 block"><input className="w-full rounded-xl border border-[#3c3c3c] bg-[#181818] px-4 py-3 pr-12 text-[#d4d4d4] outline-none focus:border-[#3794ff]/40" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /><button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 px-4 text-[#9d9d9d]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-[#0e639c] px-4 py-3.5 font-bold text-white disabled:opacity-50">{loading ? <Loader className="mx-auto h-5 w-5 animate-spin" /> : <>Sign in <ArrowRight className="ml-1 inline h-4 w-4" /></>}</button>
        <button type="button" disabled={busy} onClick={register} className="w-full rounded-xl border border-[#3c3c3c] bg-[#252526] px-4 py-3 font-semibold text-[#d4d4d4] disabled:opacity-50"><ShieldCheck className="mr-2 inline h-4 w-4" />Create account</button>
        <button type="button" disabled={busy} onClick={google} className="w-full rounded-xl border border-[#3c3c3c] bg-[#2d2d2d] px-4 py-3 font-semibold text-[#d4d4d4] disabled:opacity-50">{googleLoading ? <Loader className="mx-auto h-5 w-5 animate-spin" /> : 'Continue with Google'}</button>
        <div className="flex justify-between text-xs"><button type="button" disabled={busy} onClick={reset} className="text-[#3794ff] hover:text-[#3794ff]">Forgot password?</button><button type="button" disabled={busy} onClick={resendVerification} className="text-[#9d9d9d] hover:text-[#d4d4d4]">Resend verification</button></div>
        <div className="flex justify-center gap-4 border-t border-[#3c3c3c] pt-4 text-[11px] text-[#6f6f6f]"><a href="/terms" className="hover:text-[#3794ff] hover:underline">Terms of Service</a><a href="/privacy" className="hover:text-[#3794ff] hover:underline">Privacy Policy</a></div>
      </form>
    </div>
  );
}
