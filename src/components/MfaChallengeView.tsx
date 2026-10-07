import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase-auth';

export default function MfaChallengeView({ onVerified, onSignOut }: { onVerified: () => void; onSignOut: () => void }) {
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setError(error.message); return; }
      const verified = [...(data?.totp || []), ...(data?.phone || [])].find((factor: any) => factor.status === 'verified');
      if (!verified) { setError('No verified MFA factor is available for this account.'); return; }
      setFactorId(verified.id);
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load MFA factors.'); });
    return () => { cancelled = true; };
  }, []);

  const verify = async () => {
    if (!factorId || code.trim().length < 6 || busy) return;
    setBusy(true); setError('');
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error) throw challenge.error;
      const verification = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() });
      if (verification.error) throw verification.error;
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data.currentLevel !== 'aal2') throw assurance.error || new Error('MFA verification did not produce an AAL2 session.');
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA verification failed.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="grid min-h-screen place-items-center bg-[var(--spr-surface)] px-4 text-[var(--spr-text)]">
    <section className="w-full max-w-md rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--spr-accent)]/40 bg-[var(--spr-accent-soft)]"><ShieldCheck className="h-5 w-5" /></span><div><h1 className="text-xl font-semibold">Multi-factor verification</h1><p className="text-xs text-[var(--spr-text-muted)]">Enter the current code from your authenticator app.</p></div></div>
      <input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }} placeholder="123456" aria-label="Authenticator code" className="mt-6 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-4 py-3 text-center text-xl tracking-[.3em] outline-none focus:border-[var(--spr-accent)]" />
      {error && <p role="alert" className="mt-3 text-xs text-[var(--spr-red)]">{error}</p>}
      <button onClick={() => void verify()} disabled={!factorId || code.trim().length < 6 || busy} className="spr-btn spr-btn-primary mt-4 w-full disabled:opacity-50">{busy ? 'Verifying…' : 'Verify and continue'}</button>
      <button onClick={onSignOut} className="mt-3 w-full text-center text-xs text-[var(--spr-text-muted)] underline">Sign out</button>
    </section>
  </main>;
}
