import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Loader, Lock, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Preview-safe shapes. The API deliberately does not send finding titles,
// descriptions, affected components, evidence records or remediation to a free
// caller, so there is nothing here to accidentally render.
type CategoryId = 'security' | 'licensing' | 'supplyChain' | 'reliability' | 'maintainability';

type CategoryResult =
  | { status: 'scored'; score: number; detail: string; facts: Record<string, number> }
  | { status: 'not_observed'; reason: string };

interface FreeReviewAssessment {
  score: number | null;
  verdict: string | null;
  observedAreas: number;
  totalAreas: number;
  categories: Record<CategoryId, CategoryResult>;
}

interface FreeReviewTeaser {
  category: string;
  severity: string;
  count: number;
}
interface FreeReviewStatus {
  passportId: string;
  scanStatus: 'scanning' | 'complete' | 'partial' | 'failed';
  /** Customer-safe explanation when every engine failed. Null otherwise. */
  failureReason?: string | null;
  passport: { name: string; version: string; publisher: string; verificationStatus: string } | null;
  summary: { openFindings: number; criticalOrHigh: number; evidenceCount: number };
  assessment?: FreeReviewAssessment | null;
  findings?: { total: number; elevated: number; bySeverity: Record<string, number>; teasers: FreeReviewTeaser[] } | null;
  evidence?: { total: number; verified: number; unverified: number; byType: Record<string, number> } | null;
  sbom?: { componentCount: number | null } | null;
  verifiedCapabilities?: string[] | null;
  locked?: { detailedFindings: number; evidenceRecords: number; remediation: boolean; componentLocations: boolean } | null;
  /** Real worker progress. Every value is recorded by the scan, never estimated. */
  progress?: {
    percent: number;
    elapsedSeconds: number;
    steps: { id: string; label: string; status: string; percent: number }[];
    latestMessage: string | null;
  } | null;
}

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
    if (!statusUrl || ['complete','partial','failed'].includes(result?.scanStatus ?? '')) return;
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
          if (['complete','partial','failed'].includes(data.scanStatus)) return;
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
    <div className="min-h-screen bg-[var(--spr-surface)] px-6 py-16 text-[var(--spr-text)]">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          <img src="/brand/spr-logo.jpg" alt="Software Passport Registry" className="mx-auto mb-6 h-20 w-auto drop-shadow-[0_4px_20px_rgba(0,0,0,0.35)]" />
          <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Software Passport Registry</div>
          <h1 className="mt-3 text-3xl font-semibold">Free software review</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--spr-text-muted)]">Enter a public GitHub repository. SPR runs a real dependency and secret scan against it and shows you exactly what it found - no account required.</p>
        </div>

        {!statusUrl && (
          <form onSubmit={submit} className="mt-8 space-y-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
            <div className="flex gap-3">
              <label className="flex-1 text-sm font-semibold">Owner
                <input className="mt-2 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 outline-none focus:border-[var(--spr-highlight)]/40" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. anthropics" required />
              </label>
              <label className="flex-1 text-sm font-semibold">Repository
                <input className="mt-2 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 outline-none focus:border-[var(--spr-highlight)]/40" value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="e.g. claude-code or https://github.com/anthropics/claude-code" required />
              </label>
            </div>
            {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
            <button type="submit" disabled={submitting} className="w-full rounded-xl bg-[var(--spr-accent)] px-4 py-3.5 font-bold text-white disabled:opacity-50">{submitting ? <Loader className="mx-auto h-5 w-5 animate-spin" /> : <>Run free review <ArrowRight className="ml-1 inline h-4 w-4" /></>}</button>
          </form>
        )}

        {statusUrl && (
          <div className="mt-8 space-y-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
            {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div>}
            {/* A real repository can take several minutes. The old state was one
                spinner and the claim that it "usually takes under a minute", so
                a healthy long run looked identical to a hung one and people
                concluded the scan was broken. Everything below is read from the
                job rows: the percentages are the workers' own recorded progress,
                the message is the newest real log line, and the clock is the
                actual elapsed time. Nothing advances on a timer, so a bar that
                stops moving is honestly reporting a job that stopped moving. */}
            {(!result || result.scanStatus === 'scanning') && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 text-sm text-[var(--spr-text)]">
                  <span className="flex items-center gap-3"><Loader className="h-5 w-5 animate-spin" /> Scanning {displayName}…</span>
                  <span className="tabular-nums text-[var(--spr-text-muted)]">
                    {result?.progress ? `${result.progress.percent}% · ${formatElapsed(result.progress.elapsedSeconds)} elapsed` : 'Starting…'}
                  </span>
                </div>

                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-[var(--spr-surface-deep)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={result?.progress?.percent ?? 0}
                  aria-label={`Free Review progress for ${displayName}`}
                >
                  <div className="h-full rounded-full bg-[var(--spr-highlight)] transition-all duration-500" style={{ width: `${result?.progress?.percent ?? 0}%` }} />
                </div>

                {result?.progress?.steps?.length ? (
                  <ul className="space-y-1.5">
                    {result.progress.steps.map((step) => (
                      <li key={step.id} className="flex items-start justify-between gap-3 text-xs text-[var(--spr-text-muted)]">
                        <span className="flex items-start gap-2">
                          {step.status === 'Completed'
                            ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--spr-green)]" />
                            : step.status === 'Failed'
                              ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                              : <Loader className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
                          {step.label}
                        </span>
                        <span className="shrink-0 tabular-nums">{step.status === 'Pending' ? 'Queued' : `${step.percent}%`}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {result?.progress?.latestMessage ? (
                  <p className="text-xs text-[var(--spr-text-muted)]">{result.progress.latestMessage}</p>
                ) : null}

                <p className="text-xs text-[var(--spr-text-muted)]">
                  A large repository can take several minutes. You can leave this page open — the link stays valid.
                </p>
              </div>
            )}
            {result && result.scanStatus !== 'scanning' && (
              <div>
                {/* A run where every engine failed scanned nothing. Showing a
                    green tick, "Review complete", and three zeros told the
                    customer SPR had looked and found nothing clean -- when it had
                    never read the repository at all. Zero findings and zero
                    evidence are only a result if a scan actually ran. */}
                {result.scanStatus === 'failed' ? (
                  <div role="alert">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#f48771]"><AlertCircle className="h-5 w-5" /> We couldn&rsquo;t scan this repository</div>
                    <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{result.failureReason || 'The scan could not be completed. No evidence was collected.'}</p>
                    <p className="mt-3 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-xs leading-5 text-[var(--spr-text-faint)]">
                      No engine ran, so SPR has nothing to report about this repository. This is <strong>not</strong> a clean result &mdash; it means nothing was examined.
                    </p>
                    <button onClick={() => { setResult(null); setStatusUrl(''); setError(''); }} className="mt-5 w-full rounded-xl border border-[var(--spr-border)] px-4 py-3 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">Try another repository</button>
                  </div>
                ) : (
                <>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {result.scanStatus === 'partial'
                    ? <><AlertCircle className="h-5 w-5 text-[var(--spr-amber,#d7ba7d)]" /> Review incomplete &mdash; some engines did not finish</>
                    : <><CheckCircle2 className="h-5 w-5 text-[var(--spr-highlight)]" /> Review complete</>}
                </div>
                {result.scanStatus === 'partial' && (
                  <p className="mt-2 text-xs leading-5 text-[var(--spr-text-faint)]">The counts below cover only the engines that finished. Treat them as incomplete, not as a clean result.</p>
                )}
                {/* SOFTWARE PASSPORT header. The score, the verdict and the
                    observed-area count are whatever the scoring model returned
                    for this scan; when nothing could be observed there is no
                    number and the page says so rather than printing a zero. */}
                <div className="mt-5 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-8 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--spr-text-muted)]">Software Passport</div>
                  {result.assessment?.score !== null && result.assessment?.score !== undefined ? (
                    <>
                      <div className="mt-3 text-6xl font-bold leading-none tracking-tight text-[var(--spr-text)]">
                        {result.assessment.score}<span className="text-2xl font-semibold text-[var(--spr-text-muted)]"> / 100</span>
                      </div>
                      <div className="mt-3 text-lg font-bold tracking-wide text-[var(--spr-text)]">{result.assessment.verdict}</div>
                    </>
                  ) : (
                    <>
                      <div className="mt-3 text-3xl font-bold tracking-tight text-[var(--spr-text)]">No score</div>
                      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--spr-text-faint)]">
                        No trust area could be observed for this repository, so SPR reports no score. That is an absence of evidence, not a poor result.
                      </p>
                    </>
                  )}
                  {result.assessment ? (
                    <div className="mt-3 text-xs text-[var(--spr-text-muted)]">{result.assessment.observedAreas} of {result.assessment.totalAreas} trust areas observed</div>
                  ) : null}

                  <div className="mt-6 grid grid-cols-3 gap-3 text-center text-sm">
                    <div><div className="text-2xl font-bold tabular-nums">{result.findings?.total ?? result.summary.openFindings}</div><div className="text-xs text-[var(--spr-text-muted)]">findings detected</div></div>
                    <div><div className="text-2xl font-bold tabular-nums">{result.findings?.elevated ?? result.summary.criticalOrHigh}</div><div className="text-xs text-[var(--spr-text-muted)]">elevated findings</div></div>
                    <div><div className="text-2xl font-bold tabular-nums">{result.evidence?.total ?? result.summary.evidenceCount}</div><div className="text-xs text-[var(--spr-text-muted)]">evidence items analysed</div></div>
                  </div>
                </div>

                {/* Five trust areas. Two of them have no collector yet and say so
                    in those words -- kept visible so the gap is legible, and
                    worded so "not observed" reads as neither good nor bad. */}
                {result.assessment ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {([
                      ['security', '🔐', 'Security'],
                      ['licensing', '⚖️', 'Licensing'],
                      ['supplyChain', '🏢', 'Buyer readiness'],
                      ['reliability', '🧱', 'Reliability'],
                      ['maintainability', '🔧', 'Maintainability'],
                    ] as [CategoryId, string, string][]).map(([id, icon, label]) => {
                      const category = result.assessment!.categories[id];
                      return (
                        <div key={id} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-[var(--spr-text)]"><span aria-hidden="true">{icon}</span> {label}</span>
                            {category.status === 'scored'
                              ? <span className="text-xl font-bold tabular-nums text-[var(--spr-text)]">{category.score}<span className="text-xs font-semibold text-[var(--spr-text-muted)]"> / 100</span></span>
                              : <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--spr-text-muted)]">Not observed</span>}
                          </div>
                          <p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">
                            {category.status === 'scored' ? category.detail : category.reason}
                          </p>
                          {category.status === 'not_observed' ? (
                            <p className="mt-2 text-[11px] text-[var(--spr-text-faint)]"><Lock className="mr-1 inline h-3 w-3" />Detailed analysis</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* Severity histogram. Real counts, no raw scanner rows. */}
                {result.findings?.bySeverity ? (
                  <div className="mt-4 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--spr-text-muted)]">Scan results</div>
                    <div className="mt-3 space-y-1.5 text-sm">
                      {([['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['info', 'Informational']] as [string, string][]).map(([key, label]) => (
                        <div key={key} className="flex items-center justify-between gap-3">
                          <span className="text-[var(--spr-text-muted)]">{label}</span>
                          <span className="tabular-nums font-semibold text-[var(--spr-text)]">{result.findings!.bySeverity[key] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Teasers: severity and category only. The API sends nothing
                    else, so the report cannot be reconstructed from this page. */}
                {result.findings?.teasers?.length ? (
                  <div className="mt-4 space-y-2">
                    {result.findings.teasers.map((teaser) => (
                      <div key={teaser.category} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-[var(--spr-border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text)]">{teaser.severity}</span>
                          <span className="text-sm font-semibold text-[var(--spr-text)]">{teaser.category}</span>
                          <span className="ml-auto text-xs text-[var(--spr-text-muted)]">{teaser.count} observation{teaser.count === 1 ? '' : 's'}</span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--spr-text-muted)]">
                          <Lock className="mr-1 inline h-3 w-3" />Affected components, exact locations, evidence and remediation are in the full Passport.
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Evidence coverage. Only types actually present get a row, and
                    zero verification is stated as zero verification. */}
                {result.evidence && result.evidence.total > 0 ? (
                  <div className="mt-4 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--spr-text-muted)]">Evidence coverage</div>
                    <div className="mt-3 space-y-1.5 text-sm">
                      {Object.entries(result.evidence.byType).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between gap-3">
                          <span className="text-[var(--spr-text-muted)]">{type}</span>
                          <span className="tabular-nums font-semibold text-[var(--spr-text)]">{count}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 border-t border-[var(--spr-border)] pt-3 text-xs text-[var(--spr-text-muted)]">
                      {result.evidence.verified === 0
                        ? `None of the ${result.evidence.total} evidence items are cryptographically verified.`
                        : `${result.evidence.verified} of ${result.evidence.total} evidence items are cryptographically verified.`}
                    </p>
                  </div>
                ) : null}

                {/* What SPR verified: one line per capability whose evidence exists. */}
                {result.verifiedCapabilities?.length ? (
                  <div className="mt-4 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--spr-text-muted)]">What SPR verified</div>
                    <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                      {result.verifiedCapabilities.map((capability) => (
                        <li key={capability} className="flex items-start gap-2 text-sm text-[var(--spr-text)]">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--spr-green)]" />{capability}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* The gate. Counts of what is withheld, never the content --
                    which is not in this payload to reveal. */}
                <div className="mt-4 rounded-xl border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent)]/10 p-5">
                  <div className="flex items-center gap-2 text-sm font-bold text-[var(--spr-text)]"><Lock className="h-4 w-4" />Unlock the complete Passport</div>
                  <p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">
                    {result.locked ? `${result.locked.detailedFindings} full finding record${result.locked.detailedFindings === 1 ? '' : 's'} and ${result.locked.evidenceRecords} evidence record${result.locked.evidenceRecords === 1 ? '' : 's'} were collected for this repository and are not included in the free preview.` : 'Full finding records and evidence are not included in the free preview.'}
                  </p>
                  <ul className="mt-3 grid gap-1 text-xs text-[var(--spr-text-muted)] sm:grid-cols-2">
                    {['Full finding descriptions', 'Affected components and locations', 'Evidence explorer and records', 'Licence analysis detail', 'Remediation guidance', 'Buyer-ready report', 'Continuous monitoring'].map((entry) => (
                      <li key={entry} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--spr-green)]" />{entry}</li>
                    ))}
                  </ul>
                  <button onClick={onSignUp} className="mt-4 w-full rounded-xl bg-[var(--spr-accent)] px-4 py-3.5 font-bold text-white">
                    <ShieldCheck className="mr-2 inline h-4 w-4" />Claim your Passport
                  </button>
                </div>
                </>
                )}
              </div>
            )}
          </div>
        )}
        {/* This line explains what an empty result means, and is only true when
            a scan actually ran. Shown unconditionally it asserted "no issues were
            found by these engines" for a run in which no engine executed. */}
        <p className="mt-6 text-center text-xs text-[var(--spr-text-faint)]">
          {result?.scanStatus === 'failed'
            ? 'SPR reports observed evidence only. Nothing was scanned here, so there is nothing to report either way.'
            : 'SPR reports observed evidence only. An empty result means no issues were found by these engines, not a guarantee of safety.'}
        </p>
      </div>
    </div>
  );
}
