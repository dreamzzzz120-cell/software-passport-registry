/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Loader, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface FreeReviewFinding {
  id: string; severity: string; title: string; component: string | null; status: string;
}
interface FreeReviewStatus {
  passportId: string;
  scanStatus: 'scanning' | 'complete' | 'partial';
  passport: { name: string; version: string; publisher: string; verificationStatus: string } | null;
  summary: { openFindings: number; criticalOrHigh: number; evidenceCount: number };
  findings: FreeReviewFinding[];
}

// Polls at >=5s with jittered backoff, never faster. The backing scan
// (GitHub acquisition + Syft SBOM + OSV lookups) can take 30-90s, and the
// status route shares the same 20-req/60s "expensive" rate-limit bucket as
// the submit route (src/middleware/security.ts) -- a tighter poll interval
// would let a single legitimate visitor exhaust their own budget.
const POLL_BASE_MS = 5_000;

export default function FreeReviewView({ onSignUp }: { onSignUp: () => void }) {
  const [owner, setOwner] = useState('');
  const [repository, setRepository] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusUrl, setStatusUrl] = useState('');
  const [result, setResult] = useState<FreeReviewStatus | null>(null);
  const pollAttempt = useRef(0);

  useEffect(() => {
    if (!statusUrl || result?.scanStatus === 'complete' || result?.scanStatus === 'partial') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await apiFetch(statusUrl);
        if (cancelled) return;
        if (!response.ok) { setError('Could not check the review status. It may have expired.'); return; }
        const data = await response.json();
        setResult(data);
        if (data.scanStatus === 'scanning') {
          pollAttempt.current += 1;
          const delay = POLL_BASE_MS + Math.min(pollAttempt.current * 1000, 10_000) + Math.random() * 1000;
          window.setTimeout(() => { if (!cancelled) void poll(); }, delay);
        }
      } catch {
        if (!cancelled) setError('Network error while checking the review status.');
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [statusUrl]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setError(''); setResult(null); pollAttempt.current = 0;
    try {
      const response = await apiFetch('/api/free-review/scan', { method: 'POST', body: JSON.stringify({ owner: owner.trim(), repository: repository.trim() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data?.error || 'Could not start the review.'); return; }
      setStatusUrl(data.statusUrl);
    } catch {
      setError('Network error while starting the review.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1e1e1e] px-6 py-16 text-[#d4d4d4]">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#3794ff]">Software Passport Registry</div>
          <h1 className="mt-3 text-3xl font-semibold">Free software review</h1>
          <p className="mt-3 text-sm leading-6 text-[#9d9d9d]">
            Enter a public GitHub repository. SPR runs a real dependency and secret scan
            against it and shows you exactly what it found - no account required.
          </p>
        </div>

        {!statusUrl && (
          <form onSubmit={submit} className="mt-8 space-y-4 rounded-md border border-[#3c3c3c] bg-[#252526] p-6">
            <div className="flex gap-3">
              <label className="flex-1 text-sm font-semibold">Owner
                <input className="mt-2 w-full rounded-xl border border-[#3c3c3c] bg-[#181818] px-4 py-3 outline-none focus:border-[#3794ff]/40" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. anthropics" required />
              </label>
              <label className="flex-1 text-sm font-semibold">Repository
                <input className="mt-2 w-full rounded-xl border border-[#3c3c3c] bg-[#181818] px-4 py-3 outline-none focus:border-[#3794ff]/40" value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="e.g. claude-code" required />
              </label>
            </div>
            {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
            <button type="submit" disabled={submitting} className="w-full rounded-xl bg-[#0e639c] px-4 py-3.5 font-bold text-white disabled:opacity-50">{submitting ? <Loader className="mx-auto h-5 w-5 animate-spin" /> : <>Run free review <ArrowRight className="ml-1 inline h-4 w-4" /></>}</button>
          </form>
        )}

        {statusUrl && (
          <div className="mt-8 space-y-4 rounded-md border border-[#3c3c3c] bg-[#252526] p-6">
            {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
            {(!result || result.scanStatus === 'scanning') && (
              <div className="flex items-center gap-3 text-sm text-[#9d9d9d]"><Loader className="h-5 w-5 animate-spin" /> Scanning {owner}/{repository}... this usually takes under a minute.</div>
            )}
            {result && result.scanStatus !== 'scanning' && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-5 w-5 text-[#3794ff]" /> Review complete{result.scanStatus === 'partial' ? ' (one scan engine did not finish)' : ''}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
                  <div className="rounded-xl border border-[#3c3c3c] p-3"><div className="text-2xl font-bold">{result.summary.openFindings}</div><div className="text-[#9d9d9d]">Open findings</div></div>
                  <div className="rounded-xl border border-[#3c3c3c] p-3"><div className="text-2xl font-bold">{result.summary.criticalOrHigh}</div><div className="text-[#9d9d9d]">Critical/High</div></div>
                  <div className="rounded-xl border border-[#3c3c3c] p-3"><div className="text-2xl font-bold">{result.summary.evidenceCount}</div><div className="text-[#9d9d9d]">Evidence items</div></div>
                </div>
                {result.findings.length > 0 && (
                  <ul className="mt-4 space-y-2 text-sm">
                    {result.findings.slice(0, 20).map((f) => (
                      <li key={f.id} className="rounded-lg border border-[#3c3c3c] p-3"><span className="font-semibold uppercase text-[#f48771]">{f.severity}</span> {f.title}{f.component ? ` — ${f.component}` : ''}</li>
                    ))}
                  </ul>
                )}
                <button onClick={onSignUp} className="mt-6 w-full rounded-xl bg-[#0e639c] px-4 py-3.5 font-bold text-white"><ShieldCheck className="mr-2 inline h-4 w-4" />Sign up to claim this Passport &amp; get continuous monitoring</button>
              </div>
            )}
          </div>
        )}
        <p className="mt-6 text-center text-xs text-[#6f6f6f]">SPR reports observed evidence only. An empty result means no issues were found by these engines, not a guarantee of safety.</p>
      </div>
    </div>
  );
}
