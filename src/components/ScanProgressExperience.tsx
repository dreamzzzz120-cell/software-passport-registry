import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CheckCircle2, Circle, Clock3, ExternalLink, Loader2, RefreshCw, ShieldAlert, XCircle, Zap } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

export const SCAN_STAGES = [
  'Accepting scan request', 'Resolving Software Passport', 'Loading persisted evidence',
  'Acquiring repository metadata', 'Querying vulnerability intelligence', 'Normalizing dependency data',
  'Validating SBOM structure', 'Resolving package identities', 'Checking known advisories',
  'Assessing dependency risk', 'Checking dependency freshness', 'Evaluating license signals',
  'Inspecting repository health', 'Assessing maintenance signals', 'Calculating evidence confidence',
  'Building trust observations', 'Recomputing trust dimensions', 'Assembling decision ledger',
  'Persisting Passport evidence', 'Finalizing Software Passport', 'Publishing completion result',
] as const;

type JobStatus = 'Pending' | 'Running' | 'Success' | 'Completed' | 'Failed' | 'Retrying' | string;
export type ScanJob = {
  id: string;
  passportId?: string;
  status: JobStatus;
  progress?: number | null;
  currentStage?: number | null;
  stageName?: string | null;
  result?: unknown;
  error?: string | null;
  attemptCount?: number | null;
  maxAttempts?: number | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
};

type Props = {
  jobId: string;
  targetName?: string;
  onComplete?: (job: ScanJob) => void;
  onOpenPassport?: (passportId: string) => void;
  compact?: boolean;
};

const terminal = new Set(['Success', 'Completed', 'Failed']);
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function stageIndex(job: ScanJob | null) {
  if (!job) return 0;
  if (job.status === 'Success' || job.status === 'Completed') return SCAN_STAGES.length;
  if (typeof job.currentStage === 'number') return Math.max(0, Math.min(SCAN_STAGES.length, job.currentStage));
  const p = clamp(Number(job.progress || 0));
  return Math.max(0, Math.min(SCAN_STAGES.length, Math.ceil((p / 100) * SCAN_STAGES.length)));
}

export default function ScanProgressExperience({ jobId, targetName, onComplete, onOpenPassport, compact = false }: Props) {
  const [job, setJob] = useState<ScanJob | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const completedRef = useRef(false);
  const backoffRef = useRef(1500);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const response = await apiFetch(`/api/agent-jobs/${encodeURIComponent(jobId)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = await response.json() as ScanJob;
        if (cancelled) return;
        setJob(next);
        setConnectionLost(false);
        backoffRef.current = 1500;
        if (terminal.has(next.status)) {
          if (!completedRef.current) {
            completedRef.current = true;
            onComplete?.(next);
          }
          return;
        }
      } catch {
        if (!cancelled) setConnectionLost(true);
        backoffRef.current = Math.min(10000, Math.round(backoffRef.current * 1.6));
      } finally {
        inFlight = false;
        if (!cancelled && !(job && terminal.has(job.status))) {
          timer = window.setTimeout(poll, backoffRef.current);
        }
      }
    };

    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [jobId, onComplete]);

  const progress = clamp(Number(job?.progress || 0));
  const activeStage = stageIndex(job);
  const currentName = job?.stageName || SCAN_STAGES[Math.max(0, Math.min(SCAN_STAGES.length - 1, activeStage - 1))] || 'Preparing scan';
  const isDone = job?.status === 'Success' || job?.status === 'Completed';
  const isFailed = job?.status === 'Failed';
  const retrying = job?.status === 'Retrying';
  const eta = useMemo(() => {
    if (!job?.createdAt || progress <= 0 || progress >= 100) return null;
    const elapsed = Date.now() - new Date(job.createdAt).getTime();
    if (!Number.isFinite(elapsed) || elapsed < 1000) return null;
    const remaining = Math.max(0, Math.round((elapsed / progress) * (100 - progress) / 1000));
    if (remaining < 60) return `~${remaining}s remaining`;
    return `~${Math.ceil(remaining / 60)} min remaining`;
  }, [job?.createdAt, progress]);

  return (
    <section aria-live="polite" aria-busy={!terminal.has(job?.status || 'Pending')} className={`overflow-hidden rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] shadow-lg ${compact ? 'p-4' : 'p-6'}`}>
      <div className="flex items-start gap-4">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${isDone ? 'border-[var(--spr-green)]/40 bg-[var(--spr-green)]/10' : isFailed ? 'border-red-400/40 bg-red-400/10' : 'border-[var(--spr-highlight)]/40 bg-[var(--spr-highlight)]/10'}`}>
          {isDone ? <CheckCircle2 className="h-5 w-5 text-[var(--spr-green)]" /> : isFailed ? <XCircle className="h-5 w-5 text-red-400" /> : <Loader2 className="h-5 w-5 animate-spin text-[var(--spr-highlight)]" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{isDone ? 'Passport ready' : isFailed ? 'Scan needs attention' : retrying ? 'Recovering scan…' : 'Building your Software Passport'}</h2>
            {!isDone && !isFailed && <span className="inline-flex items-center gap-1 rounded-full border border-[var(--spr-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--spr-text-faint)]"><Activity className="h-3 w-3" /> Live</span>}
          </div>
          <p className="mt-1 truncate text-sm text-[var(--spr-text-muted)]">{targetName || 'Software asset'} · {currentName}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">{progress}%</div>
          {eta && <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[var(--spr-text-faint)]"><Clock3 className="h-3 w-3" />{eta}</div>}
        </div>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--spr-surface-sunken)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full rounded-full bg-[var(--spr-highlight)] transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {connectionLost && !isFailed && !isDone && <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-2 text-xs text-[var(--spr-text-muted)]"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Connection interrupted. The scan continues safely in the background; reconnecting automatically.</div>}
      {isFailed && <div className="mt-3 rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-sm text-[var(--spr-text-muted)]">{job?.error || 'The scan could not be completed. Your existing Passport data remains intact.'}</div>}

      {!compact && <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SCAN_STAGES.map((name, index) => {
          const number = index + 1;
          const complete = number < activeStage || isDone;
          const current = !complete && number === activeStage && !isDone && !isFailed;
          return <div key={name} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${current ? 'border-[var(--spr-highlight)]/50 bg-[var(--spr-highlight)]/5' : 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)]'}`}>
            {complete ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--spr-green)]" /> : current ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--spr-highlight)]" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-[var(--spr-text-faint)]" />}
            <span className={complete ? 'text-[var(--spr-text-muted)]' : current ? 'font-medium text-[var(--spr-text)]' : 'text-[var(--spr-text-faint)]'}>{name}</span>
          </div>;
        })}
      </div>}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--spr-border)] pt-4">
        <div className="flex items-center gap-2 text-xs text-[var(--spr-text-faint)]"><Zap className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> You can leave this page. Processing continues in the background.</div>
        {isDone && job?.passportId && onOpenPassport && <button onClick={() => onOpenPassport(job.passportId!)} className="spr-btn spr-btn-primary inline-flex items-center gap-2">Open Passport <ExternalLink className="h-3.5 w-3.5" /></button>}
        {isFailed && <span className="inline-flex items-center gap-1 text-xs text-[var(--spr-text-muted)]"><ShieldAlert className="h-3.5 w-3.5" /> Evidence-safe failure handling</span>}
      </div>
    </section>
  );
}
