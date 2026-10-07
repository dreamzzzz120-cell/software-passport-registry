import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase-auth';

type Factor = { id: string; status?: string; friendly_name?: string | null; factor_type?: string };

export default function MfaSettingsPanel() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const result = await supabase.auth.mfa.listFactors();
    if (result.error) throw result.error;
    setFactors([...(result.data?.totp || []), ...(result.data?.phone || [])] as Factor[]);
  };

  useEffect(() => { void load().catch((err) => setError(err instanceof Error ? err.message : 'Unable to load MFA factors.')); }, []);

  const beginEnrollment = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SPR authenticator' });
      if (result.error) throw result.error;
      setFactorId(result.data.id);
      setQr(result.data.totp.qr_code);
      setSecret(result.data.totp.secret);
      setMessage('Scan the QR code, then enter the current six-digit code to finish enrollment.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to begin MFA enrollment.');
    } finally { setBusy(false); }
  };

  const verifyEnrollment = async () => {
    if (!factorId || code.trim().length < 6 || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() });
      if (verified.error) throw verified.error;
      setQr(''); setSecret(''); setCode(''); setFactorId('');
      await load();
      setMessage('MFA is enabled. Future sessions must complete the second factor before SPR opens the workspace.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify the authenticator code.');
    } finally { setBusy(false); }
  };

  const unenroll = async (id: string) => {
    if (!window.confirm('Remove this MFA factor?')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await supabase.auth.mfa.unenroll({ factorId: id });
      if (result.error) throw result.error;
      await supabase.auth.refreshSession();
      await load();
      setMessage('MFA factor removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove MFA factor. You may need to verify MFA for this session first.');
    } finally { setBusy(false); }
  };

  const verifiedFactors = factors.filter((factor) => factor.status === 'verified');

  return <section className="spr-panel p-5" aria-labelledby="mfa-settings-title">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--spr-green)]" /><h3 id="mfa-settings-title" className="text-sm font-semibold text-[var(--spr-text)]">Multi-factor authentication</h3></div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--spr-text-muted)]">TOTP authenticator factors are enforced by the Supabase session assurance level. Once a verified factor exists, SPR requires an AAL2 session before opening the authenticated workspace.</p>
      </div>
      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${verifiedFactors.length ? 'border-[var(--spr-green)]/30 bg-[var(--spr-green)]/10 text-[var(--spr-green)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{verifiedFactors.length ? 'Enabled' : 'Not enabled'}</span>
    </div>

    {verifiedFactors.length > 0 && <div className="mt-4 space-y-2">{verifiedFactors.map((factor) => <div key={factor.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-xs"><span><span className="font-semibold text-[var(--spr-text)]">{factor.friendly_name || 'Authenticator app'}</span><span className="ml-2 text-[var(--spr-text-faint)]">TOTP · verified</span></span><button onClick={() => void unenroll(factor.id)} disabled={busy} className="inline-flex items-center gap-1 text-[var(--spr-red)] disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Remove</button></div>)}</div>}

    {!qr && <button onClick={() => void beginEnrollment()} disabled={busy} className="spr-btn spr-btn-secondary mt-4 inline-flex items-center gap-2 disabled:opacity-50"><KeyRound className="h-4 w-4" />{verifiedFactors.length ? 'Add another authenticator' : 'Enable authenticator MFA'}</button>}

    {qr && <div className="mt-4 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4">
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <img src={qr} alt="Authenticator enrollment QR code" className="h-[180px] w-[180px] rounded-lg bg-white p-2" />
        <div>
          <p className="text-xs text-[var(--spr-text-muted)]">Scan with an authenticator app. If scanning is unavailable, enter this setup key manually:</p>
          <code className="mt-2 block break-all rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-2 text-xs text-[var(--spr-text)]">{secret}</code>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="123456" className="mt-3 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-center tracking-[.2em]" />
          <div className="mt-3 flex gap-2"><button onClick={() => void verifyEnrollment()} disabled={busy || code.length < 6} className="spr-btn spr-btn-primary disabled:opacity-50">{busy ? 'Verifying…' : 'Verify and enable'}</button><button onClick={() => { setQr(''); setSecret(''); setCode(''); setFactorId(''); }} disabled={busy} className="spr-btn spr-btn-secondary">Cancel</button></div>
        </div>
      </div>
    </div>}
    {message && <p className="mt-3 text-xs text-[var(--spr-green)]">{message}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-[var(--spr-red)]">{error}</p>}
  </section>;
}
