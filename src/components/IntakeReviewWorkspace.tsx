import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleDashed, FileCheck2, FileText, Fingerprint, GitBranch, Loader, PackageCheck, ShieldCheck, Sparkles } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type ReviewItem = {
  id: string;
  name: string;
  size: number;
  contentType?: string;
  kind: string;
  status: string;
  sha256?: string | null;
  createdAt?: string;
  uploadedAt?: string | null;
};

type SessionResponse = {
  session: { id: string; status: string; expiresAt: string };
  items: ReviewItem[];
};

type Props = {
  sessionId: string;
  createdAt: string;
  repo?: string;
  onStartOver: () => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortId(value: string) {
  return value.length > 22 ? `${value.slice(0, 14)}…${value.slice(-6)}` : value;
}

function statusTone(status: string) {
  const normalized = status.toUpperCase();
  if (['UPLOADED', 'QUEUED', 'CLAIMED'].includes(normalized)) return 'complete';
  if (['FAILED', 'ERROR'].includes(normalized)) return 'failed';
  return 'pending';
}

function StatusRow({ label, state, detail, done, failed, icon: Icon }: { label: string; state: string; detail?: string; done?: boolean; failed?: boolean; icon: React.ComponentType<{ className?: string }> }) {
  return <div className="flex items-start gap-3 rounded-2xl border border-[var(--spr-border)] p-4">
    <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--spr-accent-soft)]/25">
      {failed ? <AlertTriangle className="h-4 w-4 text-[var(--spr-text-muted)]"/> : done ? <CheckCircle2 className="h-4 w-4 text-[var(--spr-highlight)]"/> : <Icon className="h-4 w-4 text-[var(--spr-text-muted)]"/>}
    </div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{label}</span><span className="rounded-full border border-[var(--spr-border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.12em] text-[var(--spr-text-faint)]">{state}</span></div>{detail && <p className="mt-1 text-xs leading-5 text-[var(--spr-text-faint)]">{detail}</p>}</div>
  </div>;
}

export default function IntakeReviewWorkspace({ sessionId, createdAt, repo, onStartOver }: Props) {
  const [data, setData] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/intake/session/${encodeURIComponent(sessionId)}`, { method: 'GET' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'The review session could not be loaded.');
      setData(payload as SessionResponse);
      setError('');
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The review session could not be loaded.');
    } finally { setLoading(false); }
  }, [sessionId]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer); }, [refresh]);

  const items = data?.items ?? [];
  const counts = useMemo(() => items.reduce((acc, item) => { acc[item.kind] = (acc[item.kind] || 0) + 1; return acc; }, {} as Record<string, number>), [items]);
  const totalSize = useMemo(() => items.reduce((sum, item) => sum + Number(item.size || 0), 0), [items]);
  const integrityComplete = items.length > 0 && items.every(item => Boolean(item.sha256));
  const allUploaded = items.length > 0 && items.every(item => ['UPLOADED', 'QUEUED'].includes(item.status.toUpperCase()));
  const analysisState = items.some(item => ['FAILED', 'ERROR'].includes(item.status.toUpperCase())) ? 'Attention required' : allUploaded ? 'Queued / awaiting analysis' : 'Pending intake completion';

  return <div className="min-h-screen bg-[var(--spr-surface)] px-5 py-10 text-[var(--spr-text)]"><div className="mx-auto max-w-7xl">
    <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
      <div><div className="inline-flex items-center gap-2 rounded-full border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent-soft)]/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><Sparkles className="h-3.5 w-3.5"/> SPR Evidence Review</div><h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">Review the evidence package.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">This workspace separates what SPR has actually observed from what still requires analysis or verification. Status refreshes from the intake session every five seconds.</p></div>
      <button onClick={onStartOver} className="text-xs font-semibold text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Start another intake</button>
    </div>

    {error && <div role="alert" className="mb-5 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm text-[var(--spr-text-muted)]">{error}</div>}

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ['Review ID', shortId(sessionId), Fingerprint],
        ['Evidence files', String(items.length), FileText],
        ['Package size', formatBytes(totalSize), PackageCheck],
        ['Live state', loading ? 'Refreshing…' : analysisState, Loader],
      ].map(([label, value, Icon]) => <div key={String(label)} className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><Icon className="h-4 w-4 text-[var(--spr-highlight)]"/><div className="mt-4 text-[10px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">{label}</div><div className="mt-1 break-all text-sm font-semibold">{value}</div></div>)}
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
      <section className="rounded-3xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 md:p-7">
        <div className="flex items-start justify-between gap-4"><div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Evidence inventory</div><h2 className="mt-2 text-xl font-semibold">What SPR received</h2></div><div className="text-right text-xs text-[var(--spr-text-faint)]">{lastUpdated ? `Updated ${lastUpdated}` : 'Loading'}</div></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">{['software','document','sbom','archive','unknown'].map(kind => <div key={kind} className="rounded-xl border border-[var(--spr-border)] p-3"><div className="text-lg font-semibold">{counts[kind] || 0}</div><div className="text-[10px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]">{kind}</div></div>)}</div>
        <div className="mt-5 space-y-2">{items.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--spr-border)] p-8 text-center text-sm text-[var(--spr-text-muted)]">No evidence items are visible yet.</div>}{items.map(item => { const open = expanded === item.id; const tone = statusTone(item.status); return <div key={item.id} className="rounded-2xl border border-[var(--spr-border)]"><button onClick={() => setExpanded(open ? null : item.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left"><FileText className="h-4 w-4 shrink-0 text-[var(--spr-text-muted)]"/><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span><span className="text-[10px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]">{item.kind}</span><span className={`text-[10px] font-bold uppercase tracking-[.12em] ${tone === 'failed' ? 'text-[var(--spr-text)]' : 'text-[var(--spr-text-faint)]'}`}>{item.status}</span>{open ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}</button>{open && <div className="border-t border-[var(--spr-border)] px-4 py-4 text-xs"><div className="grid gap-3 sm:grid-cols-2"><div><span className="text-[var(--spr-text-faint)]">Size</span><div className="mt-1 font-semibold">{formatBytes(Number(item.size || 0))}</div></div><div><span className="text-[var(--spr-text-faint)]">Content type</span><div className="mt-1 break-all font-mono">{item.contentType || 'unknown'}</div></div><div className="sm:col-span-2"><span className="text-[var(--spr-text-faint)]">SHA-256</span><div className="mt-1 break-all font-mono text-[11px]">{item.sha256 || 'Not recorded yet'}</div></div></div></div>}</div>; })}</div>
      </section>

      <section className="rounded-3xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 md:p-7"><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Analysis pipeline</div><h2 className="mt-2 text-xl font-semibold">Evidence state</h2><div className="mt-5 space-y-2">
        <StatusRow label="Files received" state={items.length ? 'Complete' : 'Pending'} detail={items.length ? `${items.length} item(s) recorded in the session.` : 'Waiting for intake items.'} done={items.length > 0} icon={FileCheck2}/>
        <StatusRow label="Integrity" state={integrityComplete ? 'Verified' : 'Pending'} detail={integrityComplete ? 'Server-computed SHA-256 hashes are present.' : 'SPR will not treat client-side hashes as authoritative.'} done={integrityComplete} icon={Fingerprint}/>
        <StatusRow label="Evidence classification" state={items.length ? 'Recorded' : 'Pending'} detail={items.length ? 'Initial intake classification is visible; deeper classification may still be pending.' : undefined} done={items.length > 0} icon={CircleDashed}/>
        <StatusRow label="Evidence analysis" state={analysisState} detail="No completion is asserted until an analysis worker produces evidence-backed results." icon={Loader}/>
        <StatusRow label="Trust findings" state="Pending analysis" detail="Contradictions, unsupported claims, missing evidence and other findings will appear here when produced." icon={AlertTriangle}/>
        <StatusRow label="Software Passport" state="Pending verification" detail="A passport is not marked verified from intake alone." icon={ShieldCheck}/>
      </div></section>
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-3">
      <section className="rounded-3xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Observed evidence</div><h2 className="mt-2 text-lg font-semibold">Facts available now</h2><ul className="mt-4 space-y-3 text-sm text-[var(--spr-text-muted)]"><li>• Original file metadata is recorded.</li><li>• Server-computed SHA-256 is displayed per completed item.</li><li>• Intake classification is preserved as submitted.</li><li>• Session lifecycle is tracked separately from analysis.</li></ul></section>
      <section className="rounded-3xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Findings</div><h2 className="mt-2 text-lg font-semibold">No findings asserted yet</h2><p className="mt-4 text-sm leading-6 text-[var(--spr-text-muted)]">This is an empty state, not a clean result. When analysis produces verified claims, contradictions, missing evidence or unsupported claims, they should be attached to their source evidence here.</p></section>
      <section className="rounded-3xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="text-[11px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Passport preparation</div><h2 className="mt-2 text-lg font-semibold">Not ready for verification</h2><p className="mt-4 text-sm leading-6 text-[var(--spr-text-muted)]">The passport stage stays pending until the underlying evidence analysis has produced enough verified state to support a passport.</p>{repo && <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--spr-border)] p-3 text-xs"><GitBranch className="h-4 w-4"/><span className="truncate font-mono">{repo}</span></div>}</section>
    </div>

    <div className="mt-6 flex flex-col gap-2 text-xs text-[var(--spr-text-faint)] sm:flex-row sm:items-center sm:justify-between"><span>Submitted {new Date(createdAt).toLocaleString()}</span><span>Review data is refreshed from the intake API; no analysis progress is fabricated.</span></div>
  </div></div>;
}
