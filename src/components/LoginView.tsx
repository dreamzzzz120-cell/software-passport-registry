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
      try {
        const result = await signInWithPopup(auth, googleAuthProvider);
        await complete(result.user);
      } catch (err: any) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err?.code)) {
          await signInWithRedirect(auth, googleAuthProvider);
          return;
        }
        throw err;
      }
    } catch (err: any) {
      const message = authMessage(err, 'Google sign-in failed.');
      if (message) setError(message); else setNotice('');
    } finally { setGoogleLoading(false); }
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
    <div className="flex min-h-screen items-center justify-center bg-[#faf9f8] p-6 text-[#201f1e]">
      <form onSubmit={submit} className="w-full max-w-[360px] space-y-4 rounded-md border border-[#e1dfdd] bg-white p-6" noValidate>
        <div className="mb-1 text-center">
          <div className="mx-auto mb-2 grid h-8 w-8 place-items-center rounded bg-[#0f6cbd] text-xs font-bold text-white">S</div>
          <div className="text-[13px] font-semibold">SPR</div>
          <p className="mt-0.5 text-[12px] text-[#605e5c]">Software Trust Infrastructure</p>
        </div>
        {error && <div role="alert" className="flex items-start gap-2 rounded border border-[#a4262c]/20 bg-[#fdf2f2] p-2.5 text-[12px] text-[#a4262c]"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
        {notice && <div role="status" className="flex items-start gap-2 rounded border border-[#0f6cbd]/20 bg-[#eff6fc] p-2.5 text-[12px] text-[#004578]"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />{notice}</div>}
        <label className="block text-[12px] font-semibold text-[#323130]">Email
          <input className="mt-1 h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] outline-none focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-[12px] font-semibold text-[#323130]">Password
          <span className="relative mt-1 block">
            <input className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 pr-10 text-[13px] text-[#201f1e] outline-none focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 px-3 text-[#605e5c]">{showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
          </span>
        </label>
        <button type="submit" disabled={busy} className="flex h-9 w-full items-center justify-center gap-1.5 rounded bg-[#0f6cbd] text-[13px] font-semibold text-white hover:bg-[#004578] disabled:opacity-50">{loading ? <Loader className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-3.5 w-3.5" /></>}</button>
        <button type="button" disabled={busy} onClick={register} className="flex h-9 w-full items-center justify-center gap-1.5 rounded border border-[#c8c6c4] text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-50"><ShieldCheck className="h-3.5 w-3.5" />Create account</button>
        <div className="flex items-center gap-2 py-1 text-[11px] text-[#8a8886]"><span className="h-px flex-1 bg-[#e1dfdd]" />or<span className="h-px flex-1 bg-[#e1dfdd]" /></div>
        <button type="button" disabled={busy} onClick={google} className="flex h-9 w-full items-center justify-center gap-1.5 rounded border border-[#c8c6c4] bg-white text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-50">{googleLoading ? <Loader className="h-4 w-4 animate-spin" /> : 'Continue with Google'}</button>
        <div className="flex justify-between pt-1 text-[11px]"><button type="button" disabled={busy} onClick={reset} className="text-[#0f6cbd] hover:text-[#004578]">Forgot password?</button><button type="button" disabled={busy} onClick={resendVerification} className="text-[#605e5c] hover:text-[#323130]">Resend verification</button></div>
      </form>
    </div>
  );
}
