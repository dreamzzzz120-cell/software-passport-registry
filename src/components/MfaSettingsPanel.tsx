import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { AlertCircle, CheckCircle2, KeyRound, Loader, ShieldCheck, Trash2 } from 'lucide-react';
import type { User } from 'firebase/auth';
import { beginTotpEnrollment, enrolledTotpFactors, finishTotpEnrollment, reauthenticatePassword, totpQrUri, unenrollTotp } from '../lib/mfa';

export default function MfaSettingsPanel({ currentUser }: { currentUser: User | null }) {
  const [enrolled, setEnrolled] = useState(false);
  const [secret, setSecret] = useState<Awaited<ReturnType<typeof beginTotpEnrollment>> | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refresh = () => setEnrolled(Boolean(currentUser && enrolledTotpFactors(currentUser).length));
  useEffect(() => { refresh(); }, [currentUser]);

  const start = async () => {
    if (!currentUser) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const next = await beginTotpEnrollment(currentUser);
      setSecret(next);
      setQr(await QRCode.toDataURL(totpQrUri(next, currentUser.email || currentUser.uid), { margin: 1, width: 180 }));
      setCode('');
    } catch (err: any) {
      setError(err?.message || 'Could not start authenticator enrollment.');
    } finally { setBusy(false); }
  };

  const finish = async () => {
    if (!currentUser || !secret) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await finishTotpEnrollment(currentUser, secret, code);
      setSecret(null); setQr(''); setCode(''); refresh(); setSuccess('Authenticator MFA is enrolled on this account.');
    } catch (err: any) {
      setError(err?.code === 'auth/requires-recent-login' ? 'For security, sign in again before enrolling MFA.' : err?.message || 'The authenticator code could not be verified.');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!currentUser) return;
    const factor = enrolledTotpFactors(currentUser)[0];
    if (!factor) return;
    if (!password && currentUser.providerData.some((p) => p.providerId === 'password')) { setError('Enter your account password to remove the authenticator.'); return; }
    if (!window.confirm('Remove the enrolled authenticator from this account?')) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      if (currentUser.providerData.some((p) => p.providerId === 'password')) await reauthenticatePassword(currentUser, password);
      await unenrollTotp(currentUser, factor.uid);
      setPassword(''); refresh(); setSuccess('Authenticator MFA was removed from this account.');
    } catch (err: any) {
      setError(err?.message || 'Could not remove the authenticator.');
    } finally { setBusy(false); }
  };

  if (!currentUser) return null;
  return <div className="spr-panel p-5 space-y-4">
    <div className="flex items-center justify-between border-b border-[var(--spr-border)] pb-2">
      <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-1.5"><KeyRound className="w-4 h-4 text-[var(--spr-highlight)]" />Account Multi-Factor Authentication</h3>
      <span className={`text-[10px] font-mono font-bold ${enrolled ? 'text-[var(--spr-green)]' : 'text-[var(--spr-amber)]'}`}>{enrolled ? 'TOTP ENROLLED' : 'NOT ENROLLED'}</span>
    </div>
    <p className="text-[10px] text-[var(--spr-text-muted)] leading-relaxed">This control uses Firebase Authentication's real TOTP factor. SPR does not store your authenticator secret.</p>
    {error && <div role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-200"><AlertCircle className="mr-1.5 inline h-4 w-4" />{error}</div>}
    {success && <div role="status" className="rounded-lg border border-[var(--spr-green)]/30 bg-[var(--spr-surface-sunken)] p-3 text-xs text-[var(--spr-green)]"><CheckCircle2 className="mr-1.5 inline h-4 w-4" />{success}</div>}
    {!enrolled && !secret && <button type="button" onClick={start} disabled={busy} className="spr-btn spr-btn-primary text-xs">{busy ? <Loader className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Set up authenticator MFA</button>}
    {secret && <div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4 space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-center"><img src={qr} alt="Authenticator enrollment QR code" className="h-44 w-44 rounded-lg bg-white p-2" /><div className="text-xs text-[var(--spr-text-muted)]"><p className="font-semibold text-[var(--spr-text)]">Scan with your authenticator app</p><p className="mt-1">If you cannot scan the QR code, use the manual key below.</p><code className="mt-3 block break-all rounded-md bg-[var(--spr-surface-deep)] p-2 font-mono text-[10px] text-[var(--spr-text)]">{secret.secretKey}</code></div></div>
      <div><label className="block text-[10px] font-semibold uppercase text-[var(--spr-text-muted)]">6-digit verification code</label><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1.5 w-full rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-3 py-3 text-center text-xl tracking-[.4em] text-[var(--spr-text)]" /></div>
      <div className="flex gap-2"><button type="button" onClick={finish} disabled={busy || code.length !== 6} className="spr-btn spr-btn-primary text-xs">{busy ? <Loader className="h-4 w-4 animate-spin" /> : 'Verify & enable MFA'}</button><button type="button" onClick={() => { setSecret(null); setQr(''); setCode(''); }} disabled={busy} className="spr-btn text-xs">Cancel</button></div>
    </div>}
    {enrolled && <div className="space-y-2"><div className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-xs text-[var(--spr-text-muted)]"><CheckCircle2 className="mr-2 inline h-4 w-4 text-[var(--spr-green)]" />An authenticator is enrolled. Firebase will challenge this account for TOTP whenever MFA is required by the Firebase project configuration.</div><div className="flex gap-2"><input type="password" autoComplete="current-password" placeholder="Password to remove MFA" value={password} onChange={(e) => setPassword(e.target.value)} className="flex-1 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-3 py-2 text-xs text-[var(--spr-text)]" /><button type="button" onClick={remove} disabled={busy} className="rounded-lg border border-[var(--spr-red)]/30 px-3 py-2 text-xs font-semibold text-[var(--spr-red)]"><Trash2 className="mr-1.5 inline h-3.5 w-3.5" />Remove</button></div></div>}
  </div>;
}
