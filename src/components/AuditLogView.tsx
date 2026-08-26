/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Download, FileClock, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type AuditEntry = {
  id: number;
  action: string;
  timestamp: string;
  actor: string;
  payload?: string | Record<string, unknown>;
  previousHash: string;
  currentHash: string;
};

type Verification = {
  isValid: boolean;
  verifiedAt: string;
  totalBlocksVerified: number;
  error?: string;
};

function responseError(data: any, fallback: string) {
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.error?.message === 'string') return data.error.message;
  return fallback;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

function parsedPayload(payload: AuditEntry['payload']): Record<string, unknown> {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try { return JSON.parse(payload); } catch { return {}; }
  }
  return payload;
}

function payloadText(payload: AuditEntry['payload']) {
  if (!payload) return 'No payload';
  if (typeof payload === 'string') {
    try { return JSON.stringify(JSON.parse(payload)); } catch { return payload; }
  }
  return JSON.stringify(payload);
}

// The audit trail never stores a dedicated "object affected" column — it's
// implicit in each action's payload shape. Surface it explicitly instead of
// making readers parse raw JSON, using the same priority every writer uses.
function objectAffected(entry: AuditEntry): string {
  const payload = parsedPayload(entry.payload);
  const candidates: Array<[string, unknown]> = [
    ['Member', payload.targetEmail], ['Invitee', payload.invitedEmail],
    ['User #', payload.targetUserId], ['User #', payload.userId],
    ['Session', payload.sessionId], ['Passport', payload.passportId],
  ];
  for (const [label, value] of candidates) {
    if (value !== undefined && value !== null && value !== '') return `${label}${label.endsWith('#') ? '' : ' '}${value}`.trim();
  }
  return 'Workspace';
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [verification, setVerification] = useState<Verification | null>(null);
  const [verifying, setVerifying] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/auth/audit-chain');
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to load the audit log.'));
      const rows = Array.isArray(data) ? data : [];
      setEntries(rows);
      setHasMore(rows.length === 50);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the audit log.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const oldestId = entries.length ? entries[entries.length - 1].id : null;
    if (!oldestId) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/auth/audit-chain?before=${encodeURIComponent(String(oldestId))}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to load older audit events.'));
      const rows = Array.isArray(data) ? data : [];
      setEntries((current) => [...current, ...rows]);
      setHasMore(rows.length === 50);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load older audit events.');
    } finally {
      setLoadingMore(false);
    }
  }, [entries]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const exportCsv = () => {
    const rows = [
      ['id', 'action', 'objectAffected', 'actor', 'timestamp', 'payload', 'currentHash', 'previousHash'],
      ...entries.map((entry) => [entry.id, entry.action, objectAffected(entry), entry.actor, entry.timestamp, payloadText(entry.payload), entry.currentHash, entry.previousHash]),
    ];
    download('spr-audit-log.csv', rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  const verifyChain = async () => {
    setVerifying(true);
    setVerification(null);
    setError(null);
    try {
      const response = await apiFetch('/api/auth/audit-chain/verify');
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to verify audit chain integrity.'));
      setVerification(data as Verification);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Unable to verify audit chain integrity.');
    } finally {
      setVerifying(false);
    }
  };

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return entries;
    return entries.filter((entry) => [entry.action, entry.actor, payloadText(entry.payload)].some((value) => value.toLowerCase().includes(normalized)));
  }, [entries, query]);

  return (
    <section className="space-y-6" aria-labelledby="audit-log-title">
      <div className="flex flex-col gap-4 border-b border-white/[.07] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">Governance ledger</div>
          <h1 id="audit-log-title" className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight"><FileClock className="h-6 w-6 text-cyan-200" />Audit log</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Tenant-scoped administrative events from the persisted hash-chained audit trail. No events are synthesized in this view.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadEntries()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Refresh audit log"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button type="button" onClick={exportCsv} disabled={!entries.length} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-3.5 w-3.5" />Export CSV</button>
          <button type="button" onClick={() => void verifyChain()} disabled={verifying} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"><ClipboardCheck className="h-3.5 w-3.5" />{verifying ? 'Verifying…' : 'Verify chain'}</button>
        </div>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-300/20 bg-rose-300/[.06] px-4 py-3 text-sm text-rose-100"><span>{error}</span><button type="button" onClick={() => void loadEntries()} className="rounded-lg border border-rose-200/20 px-3 py-1.5 text-xs font-semibold hover:bg-rose-200/10">Try again</button></div>}
      {verification && <div role="status" className={`flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${verification.isValid ? 'border-emerald-300/20 bg-emerald-300/[.06] text-emerald-100' : 'border-rose-300/20 bg-rose-300/[.06] text-rose-100'}`}>{verification.isValid ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}<span>{verification.isValid ? `Chain verified across ${verification.totalBlocksVerified} block${verification.totalBlocksVerified === 1 ? '' : 's'}.` : verification.error || 'Audit chain integrity verification failed.'}</span><span className="text-xs opacity-70">Checked {formatDate(verification.verifiedAt)}</span></div>}

      <div className="rounded-3xl border border-white/[.07] bg-white/[.035] p-5 backdrop-blur-2xl">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-semibold text-white">Persisted events</h2><p className="mt-1 text-xs text-slate-500">Showing the latest {entries.length} records returned by the API.</p></div>
          <div className="relative w-full sm:max-w-xs"><label htmlFor="audit-log-search" className="sr-only">Search audit events</label><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" /><input id="audit-log-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions or actors" className="w-full rounded-xl border border-white/10 bg-slate-950/70 py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20" /></div>
        </div>
        {loading ? <div className="space-y-3" aria-live="polite" aria-label="Loading audit events"><div className="h-16 animate-pulse rounded-xl bg-white/[.05]" /><div className="h-16 animate-pulse rounded-xl bg-white/[.05]" /><div className="h-16 animate-pulse rounded-xl bg-white/[.05]" /></div> : entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-5 py-12 text-center"><FileClock className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-sm font-semibold text-slate-300">No audit events recorded</p><p className="mt-1 text-xs text-slate-500">Events will appear here after authenticated workspace activity is persisted.</p></div>
        ) : filteredEntries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-slate-400">No events match “{query}”.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Persisted tenant audit events</caption>
              <thead className="border-b border-white/[.07] text-[10px] uppercase tracking-[.16em] text-slate-600"><tr><th scope="col" className="px-3 py-3">Event</th><th scope="col" className="px-3 py-3">Object affected</th><th scope="col" className="px-3 py-3">Actor</th><th scope="col" className="px-3 py-3">Time</th><th scope="col" className="px-3 py-3">Payload</th><th scope="col" className="px-3 py-3">Chain hash</th></tr></thead>
              <tbody className="divide-y divide-white/[.06]">
                {filteredEntries.map((entry) => <tr key={entry.id} className="align-top">
                  <td className="px-3 py-4"><div className="font-semibold text-slate-200">{entry.action}</div><div className="mt-1 text-[10px] text-slate-600">Block #{entry.id}</div></td>
                  <td className="px-3 py-4 text-slate-300">{objectAffected(entry)}</td>
                  <td className="px-3 py-4 text-slate-400">{entry.actor || 'Actor unavailable'}</td>
                  <td className="whitespace-nowrap px-3 py-4 text-xs text-slate-500">{formatDate(entry.timestamp)}</td>
                  <td className="max-w-[300px] px-3 py-4"><code className="block max-h-16 overflow-auto break-words rounded-lg bg-black/20 p-2 text-[11px] text-slate-400">{payloadText(entry.payload)}</code></td>
                  <td className="px-3 py-4"><div className="max-w-[180px] truncate font-mono text-[10px] text-cyan-200/80" title={entry.currentHash}>{entry.currentHash}</div><div className="mt-1 max-w-[180px] truncate font-mono text-[10px] text-slate-600" title={entry.previousHash}>prev {entry.previousHash}</div></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
        {!loading && entries.length > 0 && !query && (
          <div className="mt-5 flex justify-center">
            <button type="button" onClick={() => void loadMore()} disabled={!hasMore || loadingMore} className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
              {loadingMore ? 'Loading…' : hasMore ? 'Load older events' : 'No older events'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
