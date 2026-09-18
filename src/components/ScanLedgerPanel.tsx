/**
 * Scan ledger: the persistent destination for every scan a workspace submits.
 * Answers, from persisted rows only: what was submitted, what SPR inspected,
 * what it could not inspect, what it found, what evidence supports that, which
 * passport the scan updated and what changed since the previous scan.
 *
 * Everything shown here is read from /api/scans/runs*; no count, percentage
 * or status is computed or advanced in the browser. Lists are paginated and
 * filtered server-side because an inventory can hold tens of thousands of rows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, FileSearch, Loader2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Run = {
  id: string; clientId: string | null; passportId: string; sourceKind: string; sourceRef: string; resolvedCommitSha: string | null; status: string; failureCode: string | null;
  passportStatus: string; triggeredBy: string; createdAt: string; startedAt: string | null; completedAt: string | null; passportName: string | null; passportVerificationStatus: string | null; clientName: string | null;
  filesDiscovered: number | null; filesInspected: number | null; filesAnalyzed: number | null; filesUnsupported: number | null; filesSkipped: number | null; filesFailed: number | null; filesInaccessible: number | null; filesUnknown: number | null;
  accountingCoveragePct: string | number | null; inspectionCoveragePct: string | number | null; analysisCoveragePct: string | number | null; evidenceCoveragePct: string | number | null; findingsCount: number; evidenceCount: number;
};
type Coverage = Record<string, any> | null;
type RunDetail = { run: Run & { passportFailure: string | null; intakeSessionId: string | null }; jobs: any[]; coverage: Coverage; coverageDefinitions: Record<string, string>; breakdown: { byDisposition: any[]; byCategory: any[]; byReason: any[] }; findings: { bySeverity: any[]; total: number }; evidence: { byTypeAndEngine: any[]; total: number }; logs: any[]; previousRun: { id: string; createdAt: string; status: string } | null };
type Paged<T> = { items: T[]; page: number; limit: number; total: number; lineage?: { scanId: string; passportId: string; clientId: string | null; tenantId: string } };

const DISPOSITIONS = ['analyzed', 'inspected', 'partially_inspected', 'inventoried', 'unsupported', 'skipped', 'failed', 'inaccessible', 'unknown', 'discovered'];
const CATEGORIES = ['dependency_manifest', 'lockfile', 'source_code', 'sbom', 'configuration', 'ci_cd', 'build_deployment', 'binary', 'package', 'archive', 'documentation', 'license', 'test', 'infrastructure', 'data', 'unknown'];

function pct(value: string | number | null | undefined): string { if (value === null || value === undefined || value === '') return 'n/a'; const n = Number(value); return Number.isFinite(n) ? `${n.toFixed(2)}%` : 'n/a'; }
function num(value: unknown): string { return value === null || value === undefined ? '—' : String(value); }
function when(value: string | null | undefined): string { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(); }
function bytes(value: number | null | undefined): string { if (value === null || value === undefined) return '—'; if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(2)} MB`; }

const STATUS_CLASS: Record<string, string> = { completed: 'text-[var(--spr-green)]', partial: 'text-[var(--spr-amber)]', failed: 'text-red-400', scanning: 'text-[var(--spr-highlight)]', queued: 'text-[var(--spr-text-muted)]' };
const DISPOSITION_CLASS: Record<string, string> = { analyzed: 'text-[var(--spr-green)]', inspected: 'text-[var(--spr-green)]', partially_inspected: 'text-[var(--spr-amber)]', inventoried: 'text-[var(--spr-text-muted)]', unsupported: 'text-[var(--spr-text-muted)]', skipped: 'text-[var(--spr-amber)]', failed: 'text-red-400', inaccessible: 'text-red-400', unknown: 'text-[var(--spr-amber)]', discovered: 'text-red-400' };

async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error || `Request failed (${response.status})`);
  return body as T;
}

function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return <div className="flex items-center justify-between text-[11px] text-[var(--spr-text-muted)]"><span>{total === 0 ? 'No rows' : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`}</span><span className="flex items-center gap-1"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-[var(--spr-border)] p-1 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-3 w-3" /></button><span>{page}/{pages}</span><button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded border border-[var(--spr-border)] p-1 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-3 w-3" /></button></span></div>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">{label}</div><div className="mt-1 text-lg font-bold text-[var(--spr-text)]">{value}</div>{hint && <div className="mt-1 text-[10px] text-[var(--spr-text-muted)]">{hint}</div>}</div>;
}

export default function ScanLedgerPanel({ initialRunId, passportId }: { initialRunId?: string | null; passportId?: string | null }) {
  const [runs, setRuns] = useState<Paged<Run> | null>(null);
  const [runsError, setRunsError] = useState('');
  const [runsPage, setRunsPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialRunId ?? null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [tab, setTab] = useState<'coverage' | 'files' | 'findings' | 'evidence' | 'changes' | 'jobs'>('coverage');
  const [files, setFiles] = useState<Paged<any> | null>(null);
  const [filesPage, setFilesPage] = useState(1);
  const [fileDisposition, setFileDisposition] = useState('');
  const [fileCategory, setFileCategory] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [findings, setFindings] = useState<Paged<any> | null>(null);
  const [findingsPage, setFindingsPage] = useState(1);
  const [evidence, setEvidence] = useState<Paged<any> | null>(null);
  const [evidencePage, setEvidencePage] = useState(1);
  const [changes, setChanges] = useState<any>(null);
  const [tabError, setTabError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      setRunsError('');
      const params = new URLSearchParams({ page: String(runsPage), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      if (query.trim()) params.set('q', query.trim());
      if (passportId) params.set('passportId', passportId);
      setRuns(await getJson<Paged<Run>>(`/api/scans/runs?${params.toString()}`));
    } catch (error) { setRunsError(error instanceof Error ? error.message : 'Could not load scan history.'); }
  }, [runsPage, statusFilter, query, passportId]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const loadDetail = useCallback(async (runId: string) => {
    try { setDetailError(''); setDetail(await getJson<RunDetail>(`/api/scans/runs/${encodeURIComponent(runId)}`)); }
    catch (error) { setDetailError(error instanceof Error ? error.message : 'Could not load this scan.'); }
  }, []);

  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  // A scan still queued or running is re-read from the server every few
  // seconds; the status shown is always the persisted one.
  useEffect(() => {
    if (!detail || !['Queued', 'Scanning', 'Pending'].includes(detail.run.status)) return;
    const timer = setInterval(() => { void loadDetail(detail.run.id); void loadRuns(); }, 5000);
    return () => clearInterval(timer);
  }, [detail, loadDetail, loadRuns]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const run = async () => {
      setTabError(''); setBusy(true);
      try {
        if (tab === 'files') {
          const params = new URLSearchParams({ page: String(filesPage), limit: '100' });
          if (fileDisposition) params.set('disposition', fileDisposition);
          if (fileCategory) params.set('category', fileCategory);
          if (fileQuery.trim()) params.set('q', fileQuery.trim());
          const data = await getJson<Paged<any>>(`/api/scans/runs/${encodeURIComponent(selectedId)}/files?${params.toString()}`);
          if (!cancelled) setFiles(data);
        } else if (tab === 'findings') {
          const data = await getJson<Paged<any>>(`/api/scans/runs/${encodeURIComponent(selectedId)}/findings?page=${findingsPage}&limit=50`);
          if (!cancelled) setFindings(data);
        } else if (tab === 'evidence') {
          const data = await getJson<Paged<any>>(`/api/scans/runs/${encodeURIComponent(selectedId)}/evidence?page=${evidencePage}&limit=50`);
          if (!cancelled) setEvidence(data);
        } else if (tab === 'changes') {
          const data = await getJson<any>(`/api/scans/runs/${encodeURIComponent(selectedId)}/changes`);
          if (!cancelled) setChanges(data);
        }
      } catch (error) { if (!cancelled) setTabError(error instanceof Error ? error.message : 'Could not load.'); }
      finally { if (!cancelled) setBusy(false); }
    };
    void run();
    return () => { cancelled = true; };
  }, [selectedId, tab, filesPage, fileDisposition, fileCategory, fileQuery, findingsPage, evidencePage, detail?.run.status]);

  const select = (runId: string | null) => {
    setSelectedId(runId); setTab('coverage'); setFilesPage(1); setFindingsPage(1); setEvidencePage(1); setFiles(null); setFindings(null); setEvidence(null); setChanges(null);
    const url = new URL(window.location.href);
    if (runId) url.searchParams.set('run', runId); else url.searchParams.delete('run');
    window.history.replaceState({}, '', url.toString());
  };

  const coverage = detail?.coverage ?? null;
  const reasons = useMemo(() => detail?.breakdown.byReason ?? [], [detail]);

  return <section className="spr-panel p-5 md:p-6" aria-label="Scan ledger" id="scan-ledger">
    <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
      <div><div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]"><FileSearch className="h-4 w-4" /> Scan ledger</div><h2 className="text-xl font-bold text-[var(--spr-text)]">Every scan, every file, accounted for</h2><p className="max-w-3xl text-sm text-[var(--spr-text-muted)]">Each scan keeps a permanent record of every file it discovered and what SPR did with it. Counts and coverage are read from that record, never estimated.</p></div>
      <div className="flex items-center gap-2"><input value={query} onChange={(e) => { setQuery(e.target.value); setRunsPage(1); }} placeholder="Search repository, passport or scan id" className="w-56 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs outline-none focus:border-[var(--spr-highlight)]" aria-label="Search scans" /><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setRunsPage(1); }} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-2 text-xs" aria-label="Filter by status"><option value="">All statuses</option><option value="Queued">Queued</option><option value="Scanning">Scanning</option><option value="Completed">Completed</option><option value="Partial">Partial</option><option value="Failed">Failed</option></select><button type="button" onClick={() => { void loadRuns(); if (selectedId) void loadDetail(selectedId); }} className="rounded-lg border border-[var(--spr-border)] p-2" aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button></div>
    </div>
    {runsError && <div role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{runsError}</div>}
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div>
        <div className="overflow-hidden rounded-xl border border-[var(--spr-border)]">
          <table className="w-full text-left text-xs"><thead className="bg-[var(--spr-surface-sunken)] text-[10px] uppercase tracking-[.14em] text-[var(--spr-text-faint)]"><tr><th className="px-3 py-2">Scan</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Files</th><th className="px-3 py-2 text-right">Findings</th></tr></thead>
            <tbody>
              {!runs && !runsError && <tr><td colSpan={4} className="px-3 py-6 text-center text-[var(--spr-text-muted)]"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>}
              {runs && runs.items.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-[var(--spr-text-muted)]">No scans have been submitted in this workspace yet.</td></tr>}
              {runs?.items.map((run) => <tr key={run.id} onClick={() => select(run.id)} className={`cursor-pointer border-t border-[var(--spr-border)] hover:bg-[var(--spr-accent-soft)] ${selectedId === run.id ? 'bg-[var(--spr-accent-soft)]' : ''}`} data-scan-id={run.id}>
                <td className="px-3 py-2"><div className="font-semibold text-[var(--spr-text)]">{run.passportName || run.sourceRef}</div><div className="text-[10px] text-[var(--spr-text-muted)]">{run.sourceKind} · {run.sourceRef}{run.clientName ? ` · ${run.clientName}` : ''}</div><div className="text-[10px] text-[var(--spr-text-faint)]">{when(run.createdAt)}</div></td>
                <td className={`px-3 py-2 font-bold uppercase ${STATUS_CLASS[String(run.status).toLowerCase()] ?? ''}`}>{run.status}{run.failureCode ? <div className="text-[10px] font-normal normal-case text-red-300">{run.failureCode}</div> : null}</td>
                <td className="px-3 py-2 text-right">{run.filesDiscovered === null ? '—' : run.filesDiscovered}</td>
                <td className="px-3 py-2 text-right">{run.findingsCount}</td>
              </tr>)}
            </tbody></table>
        </div>
        {runs && <div className="mt-2"><Pager page={runs.page} limit={runs.limit} total={runs.total} onPage={setRunsPage} /></div>}
      </div>
      <div>
        {!selectedId && <div className="rounded-xl border border-dashed border-[var(--spr-border)] p-6 text-center text-xs text-[var(--spr-text-muted)]">Select a scan to see its files, coverage, findings, evidence and changes.</div>}
        {selectedId && detailError && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{detailError}</div>}
        {selectedId && !detail && !detailError && <div className="p-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
        {detail && <div className="space-y-4" data-testid="scan-run-detail">
          <div className="rounded-xl border border-[var(--spr-border)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Scan {detail.run.id}</div><div className="text-base font-bold text-[var(--spr-text)]">{detail.run.passportName || detail.run.sourceRef}</div><div className="text-[11px] text-[var(--spr-text-muted)]">Submitted {when(detail.run.createdAt)} · source {detail.run.sourceKind} · {detail.run.sourceRef}{detail.run.resolvedCommitSha ? ` · commit ${detail.run.resolvedCommitSha.slice(0, 12)}` : ''}</div></div>
              <div className="text-right"><div className={`text-sm font-bold uppercase ${STATUS_CLASS[String(detail.run.status).toLowerCase()] ?? ''}`}>{detail.run.status}</div>{detail.run.failureCode && <div className="text-[11px] text-red-300">{detail.run.failureCode}</div>}<div className="text-[11px] text-[var(--spr-text-muted)]">Passport: {detail.run.passportStatus === 'associated' ? 'associated' : detail.run.passportStatus === 'failed' ? `association failed — ${detail.run.passportFailure ?? 'unknown'}` : 'pending'}</div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <a href={`/passports?passport=${encodeURIComponent(detail.run.passportId)}`} className="rounded-full border border-[var(--spr-border)] px-3 py-1 text-[var(--spr-highlight)]">Passport {detail.run.passportName || detail.run.passportId} ({detail.run.passportVerificationStatus || 'unverified'})</a>
              {detail.run.clientName && <span className="rounded-full border border-[var(--spr-border)] px-3 py-1">Client {detail.run.clientName}</span>}
              {detail.previousRun && <span className="rounded-full border border-[var(--spr-border)] px-3 py-1">Previous scan {when(detail.previousRun.createdAt)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1 border-b border-[var(--spr-border)]">{(['coverage', 'files', 'findings', 'evidence', 'changes', 'jobs'] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-2 text-xs font-bold uppercase tracking-[.12em] ${tab === t ? 'border-b-2 border-[var(--spr-highlight)] text-[var(--spr-text)]' : 'text-[var(--spr-text-muted)]'}`} data-testid={`scan-tab-${t}`}>{t}{t === 'findings' ? ` (${detail.findings.total})` : t === 'evidence' ? ` (${detail.evidence.total})` : t === 'files' && coverage ? ` (${coverage.filesDiscovered})` : ''}</button>)}</div>
          {tabError && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{tabError}</div>}
          {tab === 'coverage' && <div className="space-y-4" data-testid="scan-coverage">
            {!coverage && <div className="rounded-lg border border-dashed border-[var(--spr-border)] p-4 text-xs text-[var(--spr-text-muted)]">{detail.run.sourceKind === 'sbom' ? 'This scan queried the passport\'s persisted SBOM; it involves no files, so there is no file inventory.' : detail.run.status === 'Queued' || detail.run.status === 'Scanning' ? 'The inventory is written as soon as the source is acquired. Nothing is shown until it exists.' : 'No inventory was persisted for this scan. The failure code above says why the source could not be acquired.'}</div>}
            {coverage && <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Accounting coverage" value={pct(coverage.accountingCoveragePct)} hint={`${num(coverage.filesAccountedFor)} of ${num(coverage.filesDiscovered)} discovered files have a disposition${coverage.inventoryComplete ? '' : ' (inventory truncated)'}`} />
                <Stat label="Inspection coverage" value={pct(coverage.inspectionCoveragePct)} hint={`${num(coverage.filesInspected)} of ${num(coverage.inspectionApplicable)} applicable files were read in full`} />
                <Stat label="Analysis coverage" value={pct(coverage.analysisCoveragePct)} hint={`${num(coverage.filesAnalyzed)} of ${num(coverage.analysisApplicable)} manifests/lockfiles/packages were catalogued`} />
                <Stat label="Evidence coverage" value={pct(coverage.evidenceCoveragePct)} hint={`${num(coverage.filesWithEvidence)} of ${num(coverage.filesDiscovered)} files are referenced by a finding or evidence record`} />
              </div>
              <div className="grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
                {[['Discovered', coverage.filesDiscovered], ['Inspected', coverage.filesInspected], ['Partially inspected', coverage.filesPartiallyInspected], ['Analyzed', coverage.filesAnalyzed], ['Unsupported', coverage.filesUnsupported], ['Skipped', coverage.filesSkipped], ['Failed', coverage.filesFailed], ['Inaccessible', coverage.filesInaccessible], ['Unknown', coverage.filesUnknown], ['With findings', coverage.filesWithFindings], ['Without findings', coverage.filesWithoutFindings], ['Archives found', coverage.archivesDiscovered], ['Archives listed', coverage.archivesEnumerated], ['Archives unreadable', coverage.archivesUnreadable]].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between rounded border border-[var(--spr-border)] px-2 py-1"><span className="text-[var(--spr-text-muted)]">{label}</span><span className="font-bold">{num(value)}</span></div>)}
              </div>
              {Array.isArray(coverage.limitations) && coverage.limitations.length > 0 && <div className="rounded-lg border border-[var(--spr-amber)]/40 bg-[var(--spr-surface-sunken)] p-3 text-[11px]"><div className="font-bold uppercase tracking-[.12em] text-[var(--spr-amber)]">Limitations</div><ul className="mt-1 list-disc pl-4 text-[var(--spr-text-muted)]">{coverage.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></div>}
              {reasons.length > 0 && <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">What SPR could not inspect, and why</div><table className="mt-1 w-full text-left text-xs"><tbody>{reasons.map((r: any) => <tr key={`${r.disposition}-${r.reasonCode}`} className="border-t border-[var(--spr-border)]"><td className={`px-2 py-1 font-bold ${DISPOSITION_CLASS[r.disposition] ?? ''}`}>{r.disposition}</td><td className="px-2 py-1 font-mono text-[11px]">{r.reasonCode}</td><td className="px-2 py-1 text-right">{r.count}</td><td className="px-2 py-1 text-right"><button type="button" className="text-[var(--spr-highlight)]" onClick={() => { setFileDisposition(r.disposition); setFilesPage(1); setTab('files'); }}>view files</button></td></tr>)}</tbody></table></div>}
              {detail.breakdown.byCategory.length > 0 && <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">By category</div><table className="mt-1 w-full text-left text-xs"><thead className="text-[10px] text-[var(--spr-text-faint)]"><tr><th className="px-2 py-1">Category</th><th className="px-2 py-1 text-right">Files</th><th className="px-2 py-1 text-right">Inspected</th><th className="px-2 py-1 text-right">Analyzed</th></tr></thead><tbody>{detail.breakdown.byCategory.map((c: any) => <tr key={c.category} className="border-t border-[var(--spr-border)]"><td className="px-2 py-1">{c.category}</td><td className="px-2 py-1 text-right">{c.count}</td><td className="px-2 py-1 text-right">{c.inspected}</td><td className="px-2 py-1 text-right">{c.analyzed}</td></tr>)}</tbody></table></div>}
              <details className="text-[11px] text-[var(--spr-text-muted)]"><summary className="cursor-pointer font-bold">How these numbers are defined</summary><ul className="mt-1 list-disc pl-4">{Object.entries(detail.coverageDefinitions).map(([k, v]) => <li key={k}><span className="font-bold">{k}:</span> {v}</li>)}</ul></details>
            </>}
          </div>}
          {tab === 'files' && <div className="space-y-2" data-testid="scan-files">
            <div className="flex flex-wrap gap-2"><input value={fileQuery} onChange={(e) => { setFileQuery(e.target.value); setFilesPage(1); }} placeholder="Filter by path" className="min-w-0 flex-1 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-1.5 text-xs" aria-label="Filter files by path" /><select value={fileDisposition} onChange={(e) => { setFileDisposition(e.target.value); setFilesPage(1); }} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs" aria-label="Filter by disposition"><option value="">All dispositions</option>{DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select><select value={fileCategory} onChange={(e) => { setFileCategory(e.target.value); setFilesPage(1); }} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs" aria-label="Filter by category"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            {busy && !files && <div className="p-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
            {files && <div className="overflow-x-auto rounded-xl border border-[var(--spr-border)]"><table className="w-full text-left text-[11px]"><thead className="bg-[var(--spr-surface-sunken)] text-[10px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]"><tr><th className="px-2 py-1">Path</th><th className="px-2 py-1">Category</th><th className="px-2 py-1">Disposition</th><th className="px-2 py-1">Inspection</th><th className="px-2 py-1">Analysis</th><th className="px-2 py-1 text-right">Size</th><th className="px-2 py-1">SHA-256</th><th className="px-2 py-1">Tools / reason</th></tr></thead><tbody>
              {files.items.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-center text-[var(--spr-text-muted)]">No files match these filters.</td></tr>}
              {files.items.map((f: any) => <tr key={f.id} className="border-t border-[var(--spr-border)] align-top" data-file-id={f.id}><td className="max-w-[320px] break-all px-2 py-1 font-mono">{f.depth > 0 ? <span className="text-[var(--spr-text-faint)]">{'  '.repeat(f.depth)}↳ </span> : null}{f.path}{f.isArchive ? <span className="ml-1 rounded bg-[var(--spr-surface-sunken)] px-1 text-[9px]">archive{f.archiveEnumerated === true ? ' · listed' : f.archiveEnumerated === false ? ' · unreadable' : ''}</span> : null}{Array.isArray(f.relatedFindingIds) && f.relatedFindingIds.length > 0 ? <span className="ml-1 rounded bg-red-400/20 px-1 text-[9px] text-red-200">{f.relatedFindingIds.length} finding(s)</span> : null}</td><td className="px-2 py-1">{f.category}<div className="text-[9px] text-[var(--spr-text-faint)]">{f.detectedType ? `${f.detectedType} (${f.detectionMethod})` : 'type not detected'}</div></td><td className={`px-2 py-1 font-bold ${DISPOSITION_CLASS[f.disposition] ?? ''}`}>{f.disposition}</td><td className="px-2 py-1">{f.inspectionStatus}{f.inspectionLevel ? <div className="text-[9px] text-[var(--spr-text-faint)]">{f.inspectionLevel}</div> : null}</td><td className="px-2 py-1">{f.analysisStatus}{Array.isArray(f.relatedComponents) && f.relatedComponents.length > 0 ? <div className="text-[9px] text-[var(--spr-text-faint)]">{f.relatedComponents.length} component(s)</div> : null}</td><td className="px-2 py-1 text-right">{bytes(f.size)}</td><td className="px-2 py-1 font-mono text-[9px]">{f.sha256 ? f.sha256.slice(0, 16) + '…' : '—'}</td><td className="px-2 py-1">{Array.isArray(f.tools) && f.tools.length > 0 ? f.tools.map((t: any) => `${t.name}@${t.version}:${t.action}`).join(', ') : '—'}{f.reasonCode ? <div className="text-[10px] text-[var(--spr-amber)]">{f.reasonCode}{f.reasonDetail ? ` — ${f.reasonDetail}` : ''}</div> : null}</td></tr>)}
            </tbody></table></div>}
            {files && <Pager page={files.page} limit={files.limit} total={files.total} onPage={setFilesPage} />}
          </div>}
          {tab === 'findings' && <div className="space-y-2" data-testid="scan-findings">
            {busy && !findings && <div className="p-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
            {findings && findings.items.length === 0 && <div className="rounded-lg border border-dashed border-[var(--spr-border)] p-4 text-xs text-[var(--spr-text-muted)]">No findings were persisted for this scan. {coverage ? `${num(coverage.filesInspected)} of ${num(coverage.inspectionApplicable)} applicable files were inspected; files that were not inspected can still contain issues.` : 'Nothing was inspected, so this is not a clean result.'}</div>}
            {findings && findings.items.length > 0 && <div className="overflow-x-auto rounded-xl border border-[var(--spr-border)]"><table className="w-full text-left text-[11px]"><thead className="bg-[var(--spr-surface-sunken)] text-[10px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]"><tr><th className="px-2 py-1">Severity</th><th className="px-2 py-1">Finding</th><th className="px-2 py-1">Where</th><th className="px-2 py-1">Engine</th><th className="px-2 py-1">Status</th></tr></thead><tbody>
              {findings.items.map((f: any) => <tr key={f.id} className="border-t border-[var(--spr-border)] align-top" data-finding-id={f.id}><td className="px-2 py-1 font-bold uppercase">{f.severity}</td><td className="px-2 py-1"><div className="font-semibold">{f.title}</div><div className="text-[10px] text-[var(--spr-text-muted)]">{f.description}</div></td><td className="px-2 py-1 font-mono text-[10px]">{f.filePath ? <button type="button" className="text-[var(--spr-highlight)]" onClick={() => { setFileQuery(f.filePath); setFileDisposition(''); setFilesPage(1); setTab('files'); }}>{f.filePath}</button> : f.component || '—'}</td><td className="px-2 py-1">{f.engineId}</td><td className="px-2 py-1">{f.status}</td></tr>)}
            </tbody></table></div>}
            {findings && <Pager page={findings.page} limit={findings.limit} total={findings.total} onPage={setFindingsPage} />}
            {findings && <div className="text-[10px] text-[var(--spr-text-faint)]">Lineage: finding → file → scan {findings.lineage?.scanId} → passport {findings.lineage?.passportId}{findings.lineage?.clientId ? ` → client ${findings.lineage.clientId}` : ''} → tenant {findings.lineage?.tenantId}</div>}
          </div>}
          {tab === 'evidence' && <div className="space-y-2" data-testid="scan-evidence">
            {busy && !evidence && <div className="p-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
            {evidence && evidence.items.length === 0 && <div className="rounded-lg border border-dashed border-[var(--spr-border)] p-4 text-xs text-[var(--spr-text-muted)]">No evidence records were persisted for this scan.</div>}
            {evidence && evidence.items.length > 0 && <div className="overflow-x-auto rounded-xl border border-[var(--spr-border)]"><table className="w-full text-left text-[11px]"><thead className="bg-[var(--spr-surface-sunken)] text-[10px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]"><tr><th className="px-2 py-1">Evidence</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Source</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Hash</th><th className="px-2 py-1 text-right">Files</th></tr></thead><tbody>
              {evidence.items.map((e: any) => <tr key={e.id} className="border-t border-[var(--spr-border)] align-top" data-evidence-id={e.id}><td className="px-2 py-1"><div className="font-semibold">{e.name}</div><div className="text-[10px] text-[var(--spr-text-faint)]">{e.id}</div></td><td className="px-2 py-1">{e.type}<div className="text-[10px] text-[var(--spr-text-faint)]">{e.engineId}</div></td><td className="px-2 py-1">{e.signer}<div className="text-[10px] text-[var(--spr-text-faint)]">{when(e.timestamp)}</div></td><td className="px-2 py-1">{e.status}{e.verified ? ' · verified' : ' · not cryptographically verified'}{e.verificationFailureReason ? <div className="text-[10px] text-[var(--spr-amber)]">{e.verificationFailureReason}</div> : null}</td><td className="px-2 py-1 font-mono text-[9px]">{String(e.hash).slice(0, 23)}…</td><td className="px-2 py-1 text-right">{e.relatedFileCount}</td></tr>)}
            </tbody></table></div>}
            {evidence && <Pager page={evidence.page} limit={evidence.limit} total={evidence.total} onPage={setEvidencePage} />}
          </div>}
          {tab === 'changes' && <div className="space-y-3 text-xs" data-testid="scan-changes">
            {busy && !changes && <div className="p-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
            {changes && !changes.comparable && <div className="rounded-lg border border-dashed border-[var(--spr-border)] p-4 text-[var(--spr-text-muted)]">No earlier settled scan of this passport exists to compare against ({changes.reason}).</div>}
            {changes && changes.comparable && <>
              <div className="text-[11px] text-[var(--spr-text-muted)]">Compared with scan {changes.previous.id} ({when(changes.previous.createdAt)}{changes.previous.resolvedCommitSha ? `, commit ${changes.previous.resolvedCommitSha.slice(0, 12)}` : ''}).</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Files added" value={num(changes.files.added)} /><Stat label="Files removed" value={num(changes.files.removed)} /><Stat label="Files modified" value={num(changes.files.modified)} hint={`${num(changes.files.unchanged)} unchanged · ${num(changes.files.hashUnavailable)} without a hash on one side`} /><Stat label="Findings opened" value={num(changes.findings.opened?.length ?? changes.findings.opened)} hint={`${num(changes.findings.notObservedAgain?.length ?? changes.findings.notObservedAgain)} not observed again · ${num(changes.findings.changed)} changed`} /></div>
              {changes.dependencies?.comparable ? <div className="grid gap-3 sm:grid-cols-2"><Stat label="Dependencies added" value={String(changes.dependencies.added.length)} hint={`${changes.dependencies.previousTotal} → ${changes.dependencies.currentTotal} components`} /><Stat label="Dependencies removed" value={String(changes.dependencies.removed.length)} /></div> : <div className="rounded-lg border border-dashed border-[var(--spr-border)] p-3 text-[var(--spr-text-muted)]">Dependency comparison unavailable: {changes.dependencies?.reason}</div>}
              {changes.coverage?.current && changes.coverage?.previous && <div className="text-[11px] text-[var(--spr-text-muted)]">Inspection coverage {pct(changes.coverage.previous.inspectionCoveragePct)} → {pct(changes.coverage.current.inspectionCoveragePct)} · analysis {pct(changes.coverage.previous.analysisCoveragePct)} → {pct(changes.coverage.current.analysisCoveragePct)} · evidence records {changes.evidence.previous} → {changes.evidence.current}</div>}
              {[['Added files', changes.files.addedPaths], ['Removed files', changes.files.removedPaths], ['Modified files', changes.files.modifiedPaths]].map(([label, list]) => Array.isArray(list) && list.length > 0 ? <details key={String(label)}><summary className="cursor-pointer font-bold">{label} ({list.length}{list.length >= 200 ? '+' : ''})</summary><ul className="mt-1 max-h-48 overflow-auto font-mono text-[10px]">{list.map((p: string) => <li key={p}>{p}</li>)}</ul></details> : null)}
              {Array.isArray(changes.findings.opened) && changes.findings.opened.length > 0 && <details><summary className="cursor-pointer font-bold">Findings opened ({changes.findings.opened.length})</summary><ul className="mt-1 max-h-48 overflow-auto text-[10px]">{changes.findings.opened.map((f: any) => <li key={f.id}><span className="font-bold uppercase">{f.severity}</span> {f.title} {f.filePath ? <span className="font-mono">({f.filePath})</span> : f.component ? <span className="font-mono">({f.component})</span> : null}</li>)}</ul></details>}
              {Array.isArray(changes.findings.notObservedAgain) && changes.findings.notObservedAgain.length > 0 && <details><summary className="cursor-pointer font-bold">Findings not observed again ({changes.findings.notObservedAgain.length})</summary><div className="text-[10px] text-[var(--spr-text-muted)]">{changes.findings.rule}</div><ul className="mt-1 max-h-48 overflow-auto text-[10px]">{changes.findings.notObservedAgain.map((f: any) => <li key={f.id}><span className="font-bold uppercase">{f.severity}</span> {f.title} · status {f.status}</li>)}</ul></details>}
              {changes.dependencies?.comparable && (changes.dependencies.added.length > 0 || changes.dependencies.removed.length > 0) && <details><summary className="cursor-pointer font-bold">Dependency changes</summary><div className="grid gap-2 sm:grid-cols-2 text-[10px] font-mono"><div><div className="font-bold">Added</div><ul className="max-h-48 overflow-auto">{changes.dependencies.added.map((c: string) => <li key={c}>{c}</li>)}</ul></div><div><div className="font-bold">Removed</div><ul className="max-h-48 overflow-auto">{changes.dependencies.removed.map((c: string) => <li key={c}>{c}</li>)}</ul></div></div></details>}
            </>}
          </div>}
          {tab === 'jobs' && <div className="space-y-2 text-xs" data-testid="scan-jobs">
            <table className="w-full text-left text-[11px]"><thead className="text-[10px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]"><tr><th className="px-2 py-1">Job</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Attempts</th><th className="px-2 py-1">Error</th><th className="px-2 py-1">Updated</th></tr></thead><tbody>{detail.jobs.map((j: any) => <tr key={j.id} className="border-t border-[var(--spr-border)]"><td className="px-2 py-1">{j.jobType}<div className="font-mono text-[9px] text-[var(--spr-text-faint)]">{j.id}</div></td><td className="px-2 py-1 font-bold">{j.status} {j.progress}%</td><td className="px-2 py-1">{j.attemptCount}/{j.maxAttempts}</td><td className="px-2 py-1 font-mono text-[10px] text-red-300">{j.error || '—'}</td><td className="px-2 py-1">{when(j.updatedAt)}</td></tr>)}</tbody></table>
            <div className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Latest log lines</div>
            <ul className="max-h-64 overflow-auto rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-2 font-mono text-[10px]">{detail.logs.length === 0 && <li className="text-[var(--spr-text-muted)]">No log lines recorded yet.</li>}{detail.logs.map((l: any, i: number) => <li key={i}><span className="text-[var(--spr-text-faint)]">{when(l.timestamp)}</span> [{l.level}] {l.message}</li>)}</ul>
            {detail.run.passportStatus === 'failed' && <div className="flex items-center gap-2 rounded-lg border border-[var(--spr-amber)]/40 p-3"><AlertCircle className="h-4 w-4 text-[var(--spr-amber)]" /><span>The scan completed but its passport could not be updated ({detail.run.passportFailure}). Evidence and findings are persisted; the passport can be re-associated from the persisted SBOM.</span><button type="button" onClick={async () => { try { const r = await apiFetch(`/api/scans/runs/${encodeURIComponent(detail.run.id)}/associate-passport`, { method: 'POST' }); const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b?.error || 'Retry failed'); await loadDetail(detail.run.id); } catch (error) { setTabError(error instanceof Error ? error.message : 'Retry failed'); } }} className="ml-auto rounded-lg border border-[var(--spr-border)] px-3 py-1 text-[11px] font-bold">Retry passport association</button></div>}
          </div>}
        </div>}
      </div>
    </div>
  </section>;
}
