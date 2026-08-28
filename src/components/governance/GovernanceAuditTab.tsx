import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Loader2, Search } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

type AuditRow = { id: number; action: string; timestamp: string; actor: string; payload: string };

export default function GovernanceAuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [governanceOnly, setGovernanceOnly] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const load = async (before?: number) => {
    if (before) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const r = await apiFetch(`/api/auth/audit-chain${before ? `?before=${before}` : ''}`);
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You are not authorized to view the audit trail.' : 'Unable to load the audit trail.');
      const data: AuditRow[] = await r.json();
      setHasMore(data.length === 50);
      setRows((cur) => before ? [...cur, ...data] : data);
    } catch (e: any) { setError(e?.message || 'Unable to load the audit trail.'); }
    finally { setLoading(false); setLoadingMore(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (governanceOnly && !r.action.startsWith('governance.')) return false;
    if (!search.trim()) return true;
    const haystack = `${r.action} ${r.actor} ${r.payload}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [rows, search, governanceOnly]);

  return (
    <div className="spr-panel">
      <div className="flex flex-col gap-2 border-b border-[#3c3c3c] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f6f6f]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search action, actor, or details… (searches records already loaded)" className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] py-1.5 pl-8 pr-2 text-xs text-[#d4d4d4]" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[#9d9d9d]"><input type="checkbox" checked={governanceOnly} onChange={(e) => setGovernanceOnly(e.target.checked)} /> Governance actions only</label>
      </div>
      {error && <div role="alert" className="m-3 rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2 text-xs text-[#f14c4c]">{error}</div>}
      {loading ? <div className="p-6 text-sm text-[#9d9d9d]">Loading…</div> : filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#9d9d9d]"><ClipboardList className="mx-auto h-7 w-7 text-[#6f6f6f]" /><p className="mt-2 font-semibold text-[#d4d4d4]">No audit entries match this search.</p></div>
      ) : (
        <div className="max-h-[560px] divide-y divide-[#3c3c3c] overflow-y-auto">
          {filtered.map((r) => {
            let payload: any = null;
            try { payload = JSON.parse(r.payload); } catch { /* payload stays raw text below */ }
            return (
              <div key={r.id} className="px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-[#d4d4d4]">{r.action}</span>
                  <span className="shrink-0 text-[#6f6f6f]">{new Date(r.timestamp).toLocaleString()}</span>
                </div>
                <p className="mt-0.5 text-[#9d9d9d]">Actor: {r.actor}</p>
                {payload && Object.keys(payload).length > 0 && <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-sm bg-[#181818] p-2 text-[10px] text-[#6f6f6f]">{JSON.stringify(payload, null, 2)}</pre>}
              </div>
            );
          })}
        </div>
      )}
      {hasMore && !loading && (
        <div className="border-t border-[#3c3c3c] p-3 text-center">
          <button onClick={() => void load(rows[rows.length - 1]?.id)} disabled={loadingMore} className="spr-btn spr-btn-secondary inline-flex items-center gap-1.5 !text-xs disabled:opacity-50">{loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Load older entries</button>
        </div>
      )}
    </div>
  );
}
