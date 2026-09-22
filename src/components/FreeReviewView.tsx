import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Loader,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import FreeReviewPdfGate from './FreeReviewPdfGate';

type CategoryId =
  | 'security'
  | 'licensing'
  | 'supplyChain'
  | 'reliability'
  | 'maintainability';

type CategoryResult =
  | {
      status: 'scored';
      score: number;
      detail: string;
      facts: Record<string, number>;
    }
  | {
      status: 'not_observed';
      reason: string;
    };

interface FreeReviewAssessment {
  score: number | null;
  verdict: string | null;
  observedAreas: number;
  totalAreas: number;
  categories: Record<CategoryId, CategoryResult>;
}

interface FreeReviewStatus {
  passportId: string;
  scanStatus: 'scanning' | 'complete' | 'partial' | 'failed';
  failureReason?: string | null;
  passport: {
    name: string;
    version: string;
    publisher: string;
    verificationStatus: string;
  } | null;
  summary: {
    openFindings: number;
    criticalOrHigh: number;
    evidenceCount: number;
  };
  assessment?: FreeReviewAssessment | null;
  findings?: {
    total: number;
    elevated: number;
    bySeverity: Record<string, number>;
    teasers: { category: string; severity: string; count: number }[];
  } | null;
  evidence?: {
    total: number;
    verified: number;
    unverified: number;
    byType: Record<string, number>;
  } | null;
  sbom?: { componentCount: number | null } | null;
  verifiedCapabilities?: string[] | null;
  locked?: {
    detailedFindings: number;
    evidenceRecords: number;
    remediation: boolean;
    componentLocations: boolean;
  } | null;
  progress?: {
    percent: number;
    elapsedSeconds: number;
    steps: {
      id: string;
      label: string;
      status: string;
      percent: number;
    }[];
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
    return input
      .replace(/^https?:\/\/github\.com\//i, '')
      .split('/')[0];
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

/** The signed status API the result page reads. */
export function freeReviewStatusApiPath(
  passportId: string,
  token: string,
): string {
  return `/api/free-review/scan/${encodeURIComponent(passportId)}/status/${encodeURIComponent(token)}`;
}

interface FreeReviewViewProps {
  onSignUp: () => void;
  initialResult?: { passportId: string; token: string } | null;
}

function loginTarget(path: string): void {
  window.location.assign(`/login?next=${encodeURIComponent(path)}`);
}

function ActionButton({
  label,
  icon,
  onClick,
  primary = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? 'rounded-xl bg-[var(--spr-accent)] px-4 py-3 text-sm font-bold text-white hover:opacity-90'
          : 'rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-4 py-3 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]'
      }
    >
      {icon}
      <span className="ml-2">{label}</span>
    </button>
  );
}

export default function FreeReviewView({
  onSignUp,
  initialResult,
}: FreeReviewViewProps) {
  const [owner, setOwner] = useState('');
  const [repository, setRepository] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusUrl, setStatusUrl] = useState(
    initialResult
      ? freeReviewStatusApiPath(initialResult.passportId, initialResult.token)
      : '',
  );
  const [result, setResult] = useState<FreeReviewStatus | null>(null);
  const pollAttempt = useRef(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (
      !statusUrl ||
      ['complete', 'partial', 'failed'].includes(result?.scanStatus ?? '')
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const resolvedStatusUrl = new URL(statusUrl, window.location.origin);

        if (
          resolvedStatusUrl.origin !== window.location.origin ||
          !resolvedStatusUrl.pathname.startsWith('/api/free-review/scan/')
        ) {
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
          pollAttempt.current += 1;

          if (
            pollAttempt.current >= 6 &&
            response.status !== 408 &&
            response.status !== 429 &&
            response.status < 500
          ) {
            setError(
              'Could not check the review status. The status link may have expired.',
            );
            return;
          }
        } else {
          const data = (await response.json()) as FreeReviewStatus;
          setResult(data);

          if (['complete', 'partial', 'failed'].includes(data.scanStatus)) {
            return;
          }

          pollAttempt.current += 1;
        }

        const delay =
          POLL_BASE_MS +
          Math.min(pollAttempt.current * 1000, 10_000) +
          Math.random() * 1000;

        timer = window.setTimeout(() => {
          if (!cancelled) void poll();
        }, delay);
      } catch {
        if (cancelled) return;

        pollAttempt.current += 1;

        if (pollAttempt.current >= 6) {
          setError('Network error while checking the review status. Retrying...');
        }

        const delay =
          POLL_BASE_MS + Math.min(pollAttempt.current * 1000, 10_000);

        timer = window.setTimeout(() => {
          if (!cancelled) void poll();
        }, delay);
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

    setSubmitting(true);
    setError('');
    setResult(null);
    setStatusUrl('');
    pollAttempt.current = 0;

    try {
      const normalizedOwner = normalizeOwnerInput(owner);
      const normalizedRepository = normalizeRepositoryInput(repository);
      const response = await apiFetch('/api/free-review/scan', {
        method: 'POST',
        body: JSON.stringify({
          owner: normalizedOwner,
          repository: normalizedRepository,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.error || 'Could not start the review.');
        return;
      }

      if (
        typeof data?.statusUrl !== 'string' ||
        !data.statusUrl.startsWith('/api/free-review/scan/')
      ) {
        setError('The review started, but the status link was invalid.');
        return;
      }

      setStatusUrl(data.statusUrl);

      if (typeof data?.passportId === 'string') {
        const token = String(data.statusUrl).split('/status/')[1];

        if (token) {
          window.history.replaceState(
            {},
            '',
            freeReviewResultPath(data.passportId, decodeURIComponent(token)),
          );
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      }
    } catch {
      setError('Network error while starting the review.');
    } finally {
      setSubmitting(false);
    }
  };

  const displayName = displayRepository(owner, repository);
  const reviewedName =
    result?.passport?.name || displayName || result?.passportId || 'Repository review';

  const shareReview = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy the review link. Copy the browser address instead.');
    }
  };

  return (
    <div className="min-h-screen bg-[var(--spr-surface)] px-6 py-12 text-[var(--spr-text)]">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <img
            src="/brand/spr-logo.jpg"
            alt="Software Passport Registry"
            className="mx-auto mb-5 h-16 w-auto"
          />
          <div className="text-[12px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">
            Software Passport Registry
          </div>
          <h1 className="mt-3 text-3xl font-semibold">Free software review</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">
            SPR turns a public repository into an evidence-led software trust review.
            You see what was observed, what was verified, and where evidence is still missing.
          </p>
        </div>

        {!statusUrl && (
          <form
            onSubmit={submit}
            className="mx-auto mt-8 max-w-2xl space-y-4 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"
          >
            <div className="flex gap-3">
              <label className="flex-1 text-sm font-semibold">
                Owner
                <input
                  className="mt-2 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3"
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder="e.g. anthropics"
                  required
                />
              </label>
              <label className="flex-1 text-sm font-semibold">
                Repository
                <input
                  className="mt-2 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3"
                  value={repository}
                  onChange={(event) => setRepository(event.target.value)}
                  placeholder="e.g. claude-code or GitHub URL"
                  required
                />
              </label>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"
              >
                <AlertCircle className="mr-2 inline h-4 w-4" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-[var(--spr-accent)] px-4 py-3.5 font-bold text-white disabled:opacity-50"
            >
              {submitting ? (
                <Loader className="mx-auto h-5 w-5 animate-spin" />
              ) : (
                <>
                  Run free review
                  <ArrowRight className="ml-1 inline h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}

        {statusUrl && (
          <div className="mt-8 space-y-5">
            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200"
              >
                <AlertCircle className="mr-2 inline h-4 w-4" />
                {error}
              </div>
            )}

            {(!result || result.scanStatus === 'scanning') && (
              <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-3 font-semibold">
                    <Loader className="h-5 w-5 animate-spin" />
                    Scanning {displayName}…
                  </span>
                  <span className="tabular-nums text-[var(--spr-text-muted)]">
                    {result?.progress
                      ? `${result.progress.percent}% · ${formatElapsed(result.progress.elapsedSeconds)}`
                      : 'Starting…'}
                  </span>
                </div>

                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--spr-surface-deep)]">
                  <div
                    className="h-full rounded-full bg-[var(--spr-highlight)] transition-all duration-500"
                    style={{ width: `${result?.progress?.percent ?? 0}%` }}
                  />
                </div>

                {result?.progress?.steps?.length ? (
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {result.progress.steps.map((step) => (
                      <div
                        key={step.id}
                        className="rounded-lg border border-[var(--spr-border)] p-3 text-xs"
                      >
                        <div className="flex justify-between gap-3">
                          <span>{step.label}</span>
                          <span>
                            {step.status === 'Pending' ? 'Queued' : `${step.percent}%`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {result?.progress?.latestMessage && (
                  <p className="mt-4 text-xs text-[var(--spr-text-muted)]">
                    {result.progress.latestMessage}
                  </p>
                )}

                <p className="mt-3 text-xs text-[var(--spr-text-faint)]">
                  Progress is read from the scan job. SPR does not invent movement or a result.
                </p>
              </section>
            )}

            {result && result.scanStatus !== 'scanning' &&
              (result.scanStatus === 'failed' ? (
                <section
                  role="alert"
                  className="rounded-2xl border border-red-400/20 bg-[var(--spr-surface-alt)] p-6"
                >
                  <div className="font-semibold text-[#f48771]">
                    We couldn’t scan this repository
                  </div>
                  <p className="mt-2 text-sm text-[var(--spr-text-muted)]">
                    {result.failureReason ||
                      'The scan could not be completed. No evidence was collected.'}
                  </p>
                  <p className="mt-3 text-xs text-[var(--spr-text-faint)]">
                    This is not a clean result. It means SPR did not obtain enough evidence to report a review.
                  </p>
                </section>
              ) : (
                <>
                  <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[.18em] text-[var(--spr-highlight)]">
                          {result.scanStatus === 'partial'
                            ? 'Review incomplete'
                            : 'Review complete'}
                        </div>
                        <h2 className="mt-1 text-2xl font-semibold">
                          What SPR discovered in {reviewedName}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">
                          This is an evidence summary, not a generic scan badge.
                        </p>
                      </div>
                      <span className="rounded-full border border-[var(--spr-border)] px-3 py-1 text-xs font-semibold">
                        {result.scanStatus.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-4">
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="text-xs text-[var(--spr-text-muted)]">Repository</div>
                        <div className="mt-1 break-all text-sm font-bold">{reviewedName}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="text-xs text-[var(--spr-text-muted)]">Version</div>
                        <div className="mt-1 text-sm font-bold">
                          {result.passport?.version || 'UNKNOWN'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="text-xs text-[var(--spr-text-muted)]">Publisher</div>
                        <div className="mt-1 text-sm font-bold">
                          {result.passport?.publisher || 'UNKNOWN'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="text-xs text-[var(--spr-text-muted)]">Commit / ref</div>
                        <div className="mt-1 text-sm font-bold">UNKNOWN</div>
                        <div className="mt-1 text-[10px] text-[var(--spr-text-faint)]">
                          Not exposed in free preview
                        </div>
                      </div>
                    </div>
                  </section>

                  {result.assessment && (
                    <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
                      <div className="text-[11px] font-semibold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">
                        Executive result
                      </div>
                      <div className="mt-4 grid gap-5 lg:grid-cols-[220px_1fr] lg:items-center">
                        <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-6 text-center">
                          <div className="text-5xl font-bold">
                            {result.assessment.score ?? '—'}
                            {result.assessment.score !== null && (
                              <span className="text-xl text-[var(--spr-text-muted)]"> / 100</span>
                            )}
                          </div>
                          <div className="mt-2 text-sm font-bold">
                            {result.assessment.verdict || 'Not measured'}
                          </div>
                          <div className="mt-1 text-xs text-[var(--spr-text-muted)]">
                            {result.assessment.observedAreas} of {result.assessment.totalAreas} areas observed
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-[var(--spr-border)] p-4">
                            <div className="text-xs text-[var(--spr-text-muted)]">Observed</div>
                            <div className="mt-2 text-2xl font-bold">
                              {result.evidence?.total ?? result.summary.evidenceCount}
                            </div>
                            <div className="text-xs text-[var(--spr-text-muted)]">
                              evidence items + {result.sbom?.componentCount ?? 'UNKNOWN'} SBOM components
                            </div>
                          </div>
                          <div className="rounded-xl border border-[var(--spr-border)] p-4">
                            <div className="text-xs text-[var(--spr-text-muted)]">Verified</div>
                            <div className="mt-2 text-2xl font-bold">
                              {result.verifiedCapabilities ? result.verifiedCapabilities.length : 'UNKNOWN'}
                            </div>
                            <div className="text-xs text-[var(--spr-text-muted)]">
                              capabilities with evidence
                            </div>
                          </div>
                          <div className="rounded-xl border border-[var(--spr-border)] p-4">
                            <div className="text-xs text-[var(--spr-text-muted)]">Unknown</div>
                            <div className="mt-2 text-2xl font-bold">
                              {result.assessment.totalAreas - result.assessment.observedAreas}
                            </div>
                            <div className="text-xs text-[var(--spr-text-muted)]">
                              areas without enough evidence
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  <section className="grid gap-5 lg:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
                      <div className="text-[11px] font-semibold uppercase tracking-[.18em]">
                        What SPR verified
                      </div>
                      {result.verifiedCapabilities?.length ? (
                        <ul className="mt-4 space-y-2">
                          {result.verifiedCapabilities.map((item) => (
                            <li key={item} className="flex gap-2 text-sm">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-green)]" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-[var(--spr-text-muted)]">
                          No capability is presented as verified without supporting evidence.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
                      <div className="text-[11px] font-semibold uppercase tracking-[.18em]">
                        What SPR could not verify
                      </div>
                      <div className="mt-4 space-y-2">
                        {result.assessment ? (
                          Object.entries(result.assessment.categories)
                            .filter(([, value]) => value.status === 'not_observed')
                            .map(([key, value]) => (
                              <div
                                key={key}
                                className="rounded-lg border border-[var(--spr-border)] p-3"
                              >
                                <div className="text-sm font-semibold">{key}</div>
                                <div className="mt-1 text-xs text-[var(--spr-text-muted)]">
                                  {value.status === 'not_observed' ? value.reason : ''}
                                </div>
                              </div>
                            ))
                        ) : (
                          <p className="text-sm text-[var(--spr-text-muted)]">
                            UNKNOWN — no assessment returned.
                          </p>
                        )}

                        {result.assessment &&
                          !Object.values(result.assessment.categories).some(
                            (value) => value.status === 'not_observed',
                          ) && (
                            <p className="text-sm text-[var(--spr-text-muted)]">
                              No trust area was marked not observed.
                            </p>
                          )}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
                    <div className="text-[11px] font-semibold uppercase tracking-[.18em]">
                      Evidence breakdown
                    </div>
                    <p className="mt-1 text-xs text-[var(--spr-text-faint)]">
                      Source, SBOM, vulnerability evidence and freshness are represented only where the result payload contains supporting data.
                    </p>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {Object.entries(result.evidence?.byType || {}).map(([type, count]) => (
                        <div key={type} className="rounded-xl border border-[var(--spr-border)] p-4">
                          <div className="text-xs text-[var(--spr-text-muted)]">{type}</div>
                          <div className="mt-1 text-2xl font-bold">{count}</div>
                        </div>
                      ))}
                      {!Object.keys(result.evidence?.byType || {}).length && (
                        <div className="rounded-xl border border-[var(--spr-border)] p-4 text-sm text-[var(--spr-text-muted)]">
                          UNKNOWN — no evidence types returned.
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="text-xs text-[var(--spr-text-muted)]">Source</div>
                        <div className="mt-1 text-sm font-semibold">
                          {result.verifiedCapabilities?.some((item) =>
                            item.toLowerCase().includes('repository'),
                          )
                            ? 'GitHub repository observed'
                            : 'UNKNOWN'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="text-xs text-[var(--spr-text-muted)]">SBOM</div>
                        <div className="mt-1 text-sm font-semibold">
                          {result.sbom?.componentCount !== null && result.sbom?.componentCount !== undefined ? `${result.sbom.componentCount} components` : 'UNKNOWN — SBOM component count not observed'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="text-xs text-[var(--spr-text-muted)]">Freshness</div>
                        <div className="mt-1 text-sm font-semibold">
                          UNKNOWN — exact evidence timestamps are not exposed in the free preview
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
                    <div className="text-[11px] font-semibold uppercase tracking-[.18em] text-[var(--spr-highlight)]">
                      One-click outputs
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <ActionButton
                        label="Open Passport"
                        icon={<ExternalLink className="inline h-4 w-4" />}
                        onClick={() => loginTarget('/passports')}
                        primary
                      />
                      <ActionButton
                        label="Evidence Explorer"
                        icon={<ExternalLink className="inline h-4 w-4" />}
                        onClick={() => loginTarget('/evidence-explorer')}
                      />
                      <ActionButton
                        label="Findings"
                        icon={<ExternalLink className="inline h-4 w-4" />}
                        onClick={() => loginTarget('/dashboard')}
                      />
                      <ActionButton
                        label={copied ? 'Link copied' : 'Share review'}
                        icon={<Clipboard className="inline h-4 w-4" />}
                        onClick={() => void shareReview()}
                      />
                      <ActionButton
                        label="Start monitoring"
                        icon={<Monitor className="inline h-4 w-4" />}
                        onClick={() => loginTarget('/monitoring')}
                      />
                    </div>
                  </section>

                  <FreeReviewPdfGate
                    passportId={result.passportId}
                    statusUrl={statusUrl}
                    result={result}
                    repositoryLabel={reviewedName}
                  />

                  <section className="rounded-2xl border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent)]/10 p-6">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <div className="text-lg font-bold">
                          Turn this one-time review into continuous verification
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">
                          A review gives you the current evidence. Continuous verification keeps watching as evidence changes, so an MSP can reuse the same trust workflow instead of starting from zero.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={onSignUp}
                            className="rounded-xl bg-[var(--spr-accent)] px-4 py-3 text-sm font-bold text-white"
                          >
                            Claim this Passport
                            <ArrowRight className="ml-1 inline h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => loginTarget('/monitoring')}
                            className="rounded-xl border border-[var(--spr-border)] px-4 py-3 text-sm font-semibold"
                          >
                            Start monitoring
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
                    <div className="text-[11px] font-semibold uppercase tracking-[.18em]">
                      MSP business value
                    </div>
                    <h3 className="mt-2 text-lg font-semibold">
                      Turn evidence into a repeatable client workflow
                    </h3>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="font-semibold">Standardize reviews</div>
                        <p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">
                          Use one evidence-first process instead of ad-hoc screenshots and spreadsheets.
                        </p>
                      </div>
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="font-semibold">Reuse outputs</div>
                        <p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">
                          Passport, evidence and report workflows can be repeated across clients and software.
                        </p>
                      </div>
                      <div className="rounded-xl border border-[var(--spr-border)] p-4">
                        <div className="font-semibold">Keep evidence current</div>
                        <p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">
                          Monitoring turns a point-in-time review into an ongoing verification workflow.
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 text-xs text-[var(--spr-text-faint)]">
                      No dollar savings are claimed here. The value statement is limited to the workflow and outputs SPR actually provides.
                    </p>
                  </section>
                </>
              ))}
          </div>
        )}

        <p className="mt-7 text-center text-xs text-[var(--spr-text-faint)]">
          SPR reports observed evidence only. An empty result is not a guarantee of safety.
        </p>
      </div>
    </div>
  );
}
