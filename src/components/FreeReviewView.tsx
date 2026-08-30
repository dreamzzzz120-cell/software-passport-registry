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
  return normalizedOwner && normalizedRepository
    ? `${normalizedOwner}/${normalizedRepository}`
    : normalizedRepository || normalizedOwner || repository.trim();
}

/** The public, shareable address of a completed review. */
export function freeReviewResultPath(passportId: string, token: string): string {
  return `/free-review/result/${encodeURIComponent(passportId)}/${encodeURIComponent(token)}`;
}

/** The signed status API the result page reads. Mirrors what POST /scan returns. */
export function freeReviewStatusApiPath(passportId: string, token: string): string {
  return `/api/free-review/scan/${encodeURIComponent(passportId)}/status/${encodeURIComponent(token)}`;
}

interface FreeReviewViewProps {
  onSignUp: () => void;
  /**
   * Parsed from /free-review/result/<passportId>/<token>. The URL is the
   * source of truth for a result - nothing is written to localStorage or
   * sessionStorage - so a result survives navigation and refresh and can be
   * reopened from a copied link. The token stays opaque here and is
   * validated only server-side.
   */
  initialResult?: { passportId: string; token: string } | null;
}

export default function FreeReviewView({ onSignUp, initialResult }: FreeReviewViewProps) {
  const [owner, setOwner] = useState('');
  const [repository, setRepository] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusUrl, setStatusUrl] = useState(
    initialResult ? freeReviewStatusApiPath(initialResult.passportId, initialResult.token) : '',
  );
  const [result, setResult] = useState<FreeReviewStatus | null>(null);
  const pollAttempt = useRef(0);

  useEffect(() => {
    if (!statusUrl || result?.scanStatus === 'complete' || result?.scanStatus === 'partial') return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        // Free Review status links are signed, anonymous bearer URLs. Keep
        // this public read same-origin and deliberately bypass the
        // authenticated API client so Firebase credentials are never involved
        // in the anonymous polling path.
        const resolvedStatusUrl = new URL(statusUrl, window.location.origin);
        if (resolvedStatusUrl.origin !== window.location.origin || !resolvedStatusUrl.pathname.startsWith('/api/free-review/scan/')) {
          throw new Error('Invalid Free Review status URL');
        }
        const response = await fetch(resolvedStatusUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!response.ok) {
          // Keep polling transient gateway/upstream failures instead of
          // converting a temporary production routing failure into a dead
          // review. A real 401/404 is surfaced only after retries are exhausted.
          pollAttempt.current += 1;
          if (pollAttempt.current >= 6 && response.status !== 408 && response.status !== 429 && response.status < 500) {
            setError('Could not check the review status. The status link may have expired.');
            return;
          }
        } else {
          const data = await response.json() as FreeReviewStatus;
          setResult(data);
          if (data.scanStatus === 'complete' || data.scanStatus === 'partial') return;
          pollAttempt.current += 1;
        }
        const delay = POLL_BASE_MS + Math.min(pollAttempt.current * 1000, 10_000) + Math.random() * 1000;
        timer = window.setTimeout(() => { if (!cancelled) void poll(); }, delay);
      } catch {
        if (cancelled) return;
        pollAttempt.current += 1;
        if (pollAttempt.current >= 6) setError('Network error while checking the review status. Retrying...');
        const delay = POLL_BASE_MS + Math.min(pollAttempt.current * 1000, 10_000) + Math.random() * 1000;
        timer = window.setTimeout(() => { if (!cancelled) void poll(); }, delay);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
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
      if (typeof data?.statusUrl !== 'string' || !data.statusUrl.startsWith('/api/free-review/scan/')) {
        setError('The review started, but the status link was invalid.');
        return;
      }
      setStatusUrl(data.statusUrl);
      // Put the result on the URL immediately, so leaving the page and coming
      // back - or refreshing, or sharing the link - reaches the same review
      // instead of losing it. Uses the passport id and signed token the API
      // just returned; nothing is decoded or re-signed here.
      if (typeof data?.passportId === 'string') {
        const token = String(data.statusUrl).split('/status/')[1];
        if (token) {
          window.history.replaceState({}, '', freeReviewResultPath(data.passportId, decodeURIComponent(token)));
        }
      }
    } catch {
      setError('Network error while starting the review.');
    } finally {
      setSubmitting(false);
    }
  };

  const displayName = displayRepository(owner, repository);

  return (
    <div className="min-h-screen bg-[#1e1e1e] px-6 py-16 text-[#d4d4d4]">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#3794ff]">Software Passport Registry</div>
          <h1 className="mt-3 text-3xl font-semibold">Free software review</h1>
          <p className="mt-3 text-sm leading-6 text-[#9d9d9d]">Enter a public GitHub repository. SPR runs a real dependency and secret scan against it and shows you exactly what it found - no account required.</p>
        </div>

        {!statusUrl && (
          <form onSubmit={submit} className="mt-8 space-y-4 rounded-md border border-[#3c3c3c] bg-[#252526] p-6">
            <div className="flex gap-3">
              <label className="flex-1 text-sm font-semibold">Owner
                <input className="mt-2 w-full rounded-xl border border-[#3c3c3c] bg-[#181818] px-4 py-3 outline-none focus:border-[#3794ff]/40" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. anthropics" required />
              </label>
              <label className="flex-1 text-sm font-semibold">Repository
                <input className="mt-2 w-full rounded-xl border border-[#3c3c3c] bg-[#181818] px-4 py-3 outline-none focus:border-[#3794ff]/40" value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="e.g. claude-code or https://github.com/anthropics/claude-code" required />
              </label>
            </div>
            {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
            <button type="submit" disabled={submitting} className="w-full rounded-xl bg-[#0e639c] px-4 py-3.5 font-bold text-white disabled:opacity-50">{submitting ? <Loader className="mx-auto h-5 w-5 animate-spin" /> : <>Run free review <ArrowRight className="ml-1 inline h-4 w-4" /></>}</button>
          </form>
        )}

        {statusUrl && (
          <div className="mt-8 space-y-4 rounded-md border border-[#3c3c3c] bg-[#252526] p-6">
            {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
            {(!result || result.scanStatus === 'scanning') && (<div className="flex items-center gap-3 text-sm text-[#9d9d9d]"><Loader className="h-5 w-5 animate-spin" /> Scanning {displayName}... this usually takes under a minute.</div>)}
            {result && result.scanStatus !== 'scanning' && (
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-5 w-5 text-[#3794ff]" /> Review complete{result.scanStatus === 'partial' ? ' (one scan engine did not finish)' : ''}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
                  <div className="rounded-xl border border-[#3c3c3c] p-3"><div className="text-2xl font-bold">{result.summary.openFindings}</div><div className="text-[#9d9d9d]">Open findings</div></div>
                  <div className="rounded-xl border border-[#3c3c3c] p-3"><div className="text-2xl font-bold">{result.summary.criticalOrHigh}</div><div className="text-[#9d9d9d]">Critical/High</div></div>
                  <div className="rounded-xl border border-[#3c3c3c] p-3"><div className="text-2xl font-bold">{result.summary.evidenceCount}</div><div className="text-[#9d9d9d]">Evidence items</div></div>
                </div>
                {result.findings.length > 0 && (<ul className="mt-4 space-y-2 text-sm">{result.findings.slice(0, 20).map((f) => (<li key={f.id} className="rounded-lg border border-[#3c3c3c] p-3"><span className="font-semibold uppercase text-[#f48771]">{f.severity}</span> {f.title}{f.component ? ` — ${f.component}` : ''}</li>))}</ul>)}
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
