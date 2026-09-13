import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Loader } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import FreeReviewResultView, { type FreeReviewResultData } from './FreeReviewResultView';

export type { FreeReviewResultData } from './FreeReviewResultView';

function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

const POLL_BASE_MS = 5_000;

function normalizeRepositoryInput(value: string): string {
  const input = value.trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return input;
    if (url.hostname.toLowerCase() !== 'github.com') return input;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return input;
    return parts[1].replace(/\.git$/, '');
  } catch {
    return input.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  }
}

function normalizeOwnerInput(value: string): string {
  const input = value.trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== 'github.com') return input;
    return url.pathname.split('/').filter(Boolean)[0] || '';
  } catch {
    return input.replace(/^https?:\/\/github\.com\//i, '').split('/')[0];
  }
}

function displayRepository(owner: string, repository: string): string {
  const normalizedOwner = normalizeOwnerInput(owner);
  const normalizedRepository = normalizeRepositoryInput(repository);
  return normalizedOwner && normalizedRepository ? `${normalizedOwner}/${normalizedRepository}` : normalizedRepository || normalizedOwner || repository.trim();
}

/** Public, shareable result address. The token remains opaque in the browser. */
export function freeReviewResultPath(passportId: string, token: string): string {
  return `/free-review/result/${encodeURIComponent(passportId)}/${encodeURIComponent(token)}`;
}

/** Signed status API address used after a refresh or shared-link open. */
export function freeReviewStatusApiPath(passportId: string, token: string): string {
  return `/api/free-review/scan/${encodeURIComponent(passportId)}/status/${encodeURIComponent(token)}`;
}

interface FreeReviewViewProps {
  onSignUp: () => void;
  initialResult?: { passportId: string; token: string } | null;
}

export default function FreeReviewView({ onSignUp, initialResult }: FreeReviewViewProps) {
  const [owner, setOwner] = useState('');
  const [repository, setRepository] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusUrl, setStatusUrl] = useState(initialResult ? freeReviewStatusApiPath(initialResult.passportId, initialResult.token) : '');
  const [result, setResult] = useState<FreeReviewResultData | null>(null);
  const pollAttempt = useRef(0);

  useEffect(() => {
    if (!statusUrl || ['complete', 'partial', 'failed'].includes(result?.scanStatus ?? '')) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const resolvedStatusUrl = new URL(statusUrl, window.location.origin);
        if (resolvedStatusUrl.origin !== window.location.origin || !resolvedStatusUrl.pathname.startsWith('/api/free-review/scan/')) throw new Error('Invalid Free Review status URL');
        const response = await fetch(resolvedStatusUrl, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
        if (cancelled) return;
        if (response.ok) {
          const data = await response.json() as FreeReviewResultData;
          setResult(data);
          if (['complete','partial','failed'].includes(data.scanStatus)) return;
          pollAttempt.current += 1;
        } else {
          pollAttempt.current += 1;
          if (pollAttempt.current >= 6 && response.status !== 408 && response.status !== 429 && response.status < 500) {
            setError('Could not check the review status. The status link may have expired.');
            return;
          }
        }
      } catch {
        if (cancelled) return;
        pollAttempt.current += 1;
        if (pollAttempt.current >= 6) setError('Network error while checking the review status. Retrying...');
      }
      const delay = POLL_BASE_MS + Math.min(pollAttempt.current * 1000, 10_000) + Math.random() * 1000;
      timer = window.setTimeout(() => { if (!cancelled) void poll(); }, delay);
    };

    void poll();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [statusUrl, result?.scanStatus]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setError(''); setResult(null); setStatusUrl(''); pollAttempt.current = 0;
    try {
      const normalizedOwner = normalizeOwnerInput(owner);
      const normalizedRepository = normalizeRepositoryInput(repository);
      const response = await apiFetch('/api/free-review/scan', { method: 'POST', body: JSON.stringify({ owner: normalizedOwner, repository: normalizedRepository }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data?.error || 'Could not start the review.'); return; }
      if (typeof data?.statusUrl !== 'string' || !data.statusUrl.startsWith('/api/free-review/scan/')) { setError('The review started, but the status link was invalid.'); return; }
      setStatusUrl(data.statusUrl);
      if (typeof data?.passportId === 'string') {
        const token = String(data.statusUrl).split('/status/')[1];
        if (token) window.history.replaceState({}, '', freeReviewResultPath(data.passportId, decodeURIComponent(token)));
      }
    } catch {
      setError('Network error while starting the review.');
    } finally {
      setSubmitting(false);
    }
  };

  const displayName = displayRepository(owner, repository);

  return (
    <div className="min-h-screen bg-[var(--spr-surface)] px-6 py-16 text-[var(--spr-text)]">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <img src="/brand/spr-logo.jpg" alt="Software Passport Registry" className="mx-auto mb-6 h-20 w-auto drop-shadow-[0_4px_20px_rgba(0,0,0,0.35)]" />
          <div className="text-[12px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Software Passport Registry</div>
          <h1 className="mt-3 text-3xl font-semibold">Free software review</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Submit a public GitHub repository. SPR shows the evidence it observed, what it could verify, what remains UNKNOWN, and what you can do next.</p>
        </div>

        {!statusUrl && (
          <form onSubmit={submit} className="mx-auto mt-8 max-w-2xl space-y-4 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
            <div className="flex gap-3">
              <label className="flex-1 text-sm font-semibold">Owner<input className="mt-2 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 outline-none focus:border-[var(--spr-highlight)]/40" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. anthropics" required /></label>
              <label className="flex-1 text-sm font-semibold">Repository<input className="mt-2 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 outline-none focus:border-[var(--spr-highlight)]/40" value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="e.g. claude-code" required /></label>
            </div>
            {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
            <button type="submit" disabled={submitting} className="w-full rounded-xl bg-[var(--spr-accent)] px-4 py-3.5 font-bold text-white disabled:opacity-50">{submitting ? <Loader className="mx-auto h-5 w-5 animate-spin" /> : <>Run free review <ArrowRight className="ml-1 inline h-4 w-4" /></>}</button>
          </form>
        )}

        {statusUrl && !result && (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
            {error && <div role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
            <div className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-3"><Loader className="h-5 w-5 animate-spin" /> Scanning {displayName || 'repository'}…</span><span className="text-xs text-[var(--spr-text-muted)]">Reading evidence</span></div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--spr-surface-deep)]"><div className="h-full rounded-full bg-[var(--spr-highlight)]" style={{ width: '5%' }} /></div>
            <p className="mt-4 text-xs leading-5 text-[var(--spr-text-muted)]">The review link is preserved in the URL. You can leave this page open while SPR processes the repository.</p>
          </div>
        )}

        {statusUrl && result?.scanStatus === 'scanning' && (
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
            <div className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-3"><Loader className="h-5 w-5 animate-spin" /> {result.progress?.latestMessage || 'SPR is processing the repository…'}</span><span className="tabular-nums text-xs text-[var(--spr-text-muted)]">{result.progress?.percent ?? 0}% · {formatElapsed(result.progress?.elapsedSeconds ?? 0)}</span></div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--spr-surface-deep)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={result.progress?.percent ?? 0}><div className="h-full rounded-full bg-[var(--spr-highlight)] transition-all duration-500" style={{ width: `${result.progress?.percent ?? 0}%` }} /></div>
            {result.progress?.steps?.length ? <ul className="mt-4 space-y-2">{result.progress.steps.map((step) => <li key={step.id} className="flex justify-between gap-3 text-xs text-[var(--spr-text-muted)]"><span className="flex gap-2">{step.status === 'Completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--spr-green)]" /> : <Loader className="h-3.5 w-3.5" />}{step.label}</span><span>{step.status === 'Pending' ? 'Queued' : `${step.percent}%`}</span></li>)}</ul> : null}
          </div>
        )}

        {result && result.scanStatus !== 'scanning' && <div className="mt-8"><FreeReviewResultView result={result} statusUrl={statusUrl} repositoryLabel={result.passport?.name || displayName || result.passportId} onSignUp={onSignUp} /></div>}

        <p className="mt-6 text-center text-xs text-[var(--spr-text-faint)]">SPR reports observed evidence only. UNKNOWN means the available evidence did not support a conclusion.</p>
      </div>
    </div>
  );
}
