import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertOctagon, Loader2, Plus, Search, X } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

type Risk = {
  id: string; title: string; description: string; category: string; likelihood: 'LOW' | 'MEDIUM' | 'HIGH'; impact: 'LOW' | 'MEDIUM' | 'HIGH';
  mitigation: string; residualLikelihood: string | null; residualImpact: string | null; ownerName: string;
  acceptanceStatus: 'OPEN' | 'ACCEPTED' | 'MITIGATED' | 'TRANSFERRED'; acceptedBy: string | null; acceptedAt: string | null;
  acceptanceRationale: string | null; acceptanceScope: string | null; reviewDate: string | null;
  relatedControlIds: string[]; relatedFindingIds: string[]; updatedAt: string;
};

const LEVEL_STYLE: Record<string, string> = { LOW: 'text-[var(--spr-green)]', MEDIUM: 'text-[var(--spr-amber)]', HIGH: 'text-[var(--spr-red)]' };
const STATUS_STYLE: Record<string, string> = { OPEN: 'border-[var(--spr-border)] text-[var(--spr-text-muted)]', ACCEPTED: 'border-[var(--spr-green)]/40 text-[var(--spr-green)]', MITIGATED: 'border-[var(--spr-highlight)]/40 text-[var(--spr-highlight)]', TRANSFERRED: 'border-[var(--spr-amber)]/40 text-[var(--spr-amber)]' };

export default function GovernanceRisksTab({ canWrite }: { canWrite: boolean }) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: '', likelihood: 'MEDIUM', impact: 'MEDIUM', mitigation: '', ownerName: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [showAccept, setShowAccept] = useState(false);
  const [acceptForm, setAcceptForm] = useState({ status: 'ACCEPTED', acceptedBy: '', acceptanceRationale: '', acceptanceScope: '', reviewDate: '' });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await apiFetch('/api/governance/risks');
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You are not authorized to view the risk register.' : 'Unable to load risks.');
      setRisks(await r.json());
    } catch (e: any) { setError(e?.message || 'Unable to load risks.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const selected = risks.find((r) => r.id === selectedId) || null;

  const filtered = useMemo(() => risks.filter((r) =>
    (!statusFilter || r.acceptanceStatus === statusFilter) &&
    (!search.trim() || r.title.toLowerCase().includes(search.toLowerCase()) || r.category.toLowerCase().includes(search.toLowerCase()))
  ), [risks, search, statusFilter]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || creating) return;
    setCreating(true); setCreateError('');
    try {
      const r = await apiFetch('/api/governance/risks', { method: 'POST', body: JSON.stringify(form) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'Unable to create this risk.');
      setShowCreate(false); setForm({ title: '', description: '', category: '', likelihood: 'MEDIUM', impact: 'MEDIUM', mitigation: '', ownerName: '' });
      await load(); setSelectedId(data.id);
    } catch (e: any) { setCreateError(e?.message || 'Unable to create this risk.'); }
    finally { setCreating(false); }
  };

  const handleAccept = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || accepting) return;
    setAccepting(true); setAcceptError('');
    try {
      const r = await apiFetch(`/api/governance/risks/${encodeURIComponent(selected.id)}/accept`, { method: 'POST', body: JSON.stringify(acceptForm) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'This risk decision could not be recorded -- every field (authorized person, date, scope, rationale, review date) is required.');
      setShowAccept(false);
      await load();
    } catch (e: any) { setAcceptError(e?.message || 'Unable to record this decision.'); }
    finally { setAccepting(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel overflow-hidden">
        <div className="border-b border-[var(--spr-border)] p-3 space-y-2">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--spr-text-faint)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search risks…" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] py-1.5 pl-8 pr-2 text-xs text-[var(--spr-text)]" /></div>
          <div className="flex items-center justify-between gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]">
              <option value="">All statuses</option>
              {Object.keys(STATUS_STYLE).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {canWrite && <button onClick={() => setShowCreate(true)} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 !text-xs"><Plus className="h-3.5 w-3.5" /> New</button>}
          </div>
        </div>
        {error && <div role="alert" className="m-3 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</div>}
        <div className="max-h-[560px] divide-y divide-[var(--spr-border)] overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-[var(--spr-text-muted)]">Loading…</div> : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--spr-text-muted)]"><AlertOctagon className="mx-auto h-7 w-7 text-[var(--spr-text-faint)]" /><p className="mt-2 font-semibold text-[var(--spr-text)]">{risks.length === 0 ? 'No risks exist yet.' : 'No risks match this search/filter.'}</p></div>
          ) : filtered.map((r) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === r.id ? 'bg-[var(--spr-accent-soft)]/45' : 'hover:bg-[var(--spr-surface-sunken)]'}`}>
              <span className="min-w-0"><span className="block truncate font-semibold text-[var(--spr-text)]">{r.title}</span><span className="block text-xs"><span className={LEVEL_STYLE[r.likelihood]}>{r.likelihood}</span> likelihood · <span className={LEVEL_STYLE[r.impact]}>{r.impact}</span> impact</span></span>
              <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[r.acceptanceStatus]}`}>{r.acceptanceStatus}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[var(--spr-text-muted)]">Select a risk to view details.</p> : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-sm font-bold text-[var(--spr-text)]">{selected.title}</h2><p className="text-xs text-[var(--spr-text-faint)]">{selected.category || 'Uncategorized'} · Owner: {selected.ownerName || 'unassigned'}</p></div>
              <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[selected.acceptanceStatus]}`}>{selected.acceptanceStatus}</span>
            </div>
            <p className="text-xs text-[var(--spr-text-muted)]">{selected.description || 'No description provided.'}</p>
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><div className="text-[10px] font-bold uppercase text-[var(--spr-text-faint)]">Inherent risk</div><p className="mt-1"><span className={LEVEL_STYLE[selected.likelihood]}>{selected.likelihood}</span> likelihood × <span className={LEVEL_STYLE[selected.impact]}>{selected.impact}</span> impact</p></div>
              <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><div className="text-[10px] font-bold uppercase text-[var(--spr-text-faint)]">Residual risk</div><p className="mt-1">{selected.residualLikelihood && selected.residualImpact ? <>{selected.residualLikelihood} × {selected.residualImpact}</> : <span className="italic text-[var(--spr-text-faint)]">Not yet assessed</span>}</p></div>
            </div>
            {selected.mitigation && <div><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Mitigation</div><p className="mt-1 text-xs text-[var(--spr-text-muted)]">{selected.mitigation}</p></div>}

            {selected.acceptanceStatus !== 'OPEN' ? (
              <div className="rounded-md border border-[var(--spr-green)]/40 bg-[var(--spr-green)]/10 p-3.5 text-xs">
                <p className="font-bold text-[var(--spr-green)]">{selected.acceptanceStatus} by {selected.acceptedBy} on {selected.acceptedAt ? new Date(selected.acceptedAt).toLocaleDateString() : ''}</p>
                <p className="mt-1 text-[var(--spr-text)]">Rationale: {selected.acceptanceRationale}</p>
                <p className="mt-1 text-[var(--spr-text)]">Scope: {selected.acceptanceScope}</p>
                <p className="mt-1 text-[var(--spr-text-faint)]">Review by: {selected.reviewDate}</p>
              </div>
            ) : canWrite && (
              <button onClick={() => { setShowAccept(true); setAcceptForm({ status: 'ACCEPTED', acceptedBy: '', acceptanceRationale: '', acceptanceScope: '', reviewDate: '' }); setAcceptError(''); }} className="spr-btn spr-btn-primary !text-xs">Record risk decision</button>
            )}
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[var(--spr-text)]">New risk</h2><button onClick={() => setShowCreate(false)} aria-label="Close" className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleCreate} className="mt-5 space-y-3">
              {createError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{createError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Title *<input required value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Likelihood<select value={form.likelihood} onChange={(e) => setForm((c) => ({ ...c, likelihood: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">{['LOW', 'MEDIUM', 'HIGH'].map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
                <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Impact<select value={form.impact} onChange={(e) => setForm((c) => ({ ...c, impact: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">{['LOW', 'MEDIUM', 'HIGH'].map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
              </div>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Description<textarea value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Owner<input value={form.ownerName} onChange={(e) => setForm((c) => ({ ...c, ownerName: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
                <button type="submit" disabled={creating || !form.title.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{creating ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAccept && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[var(--spr-text)]">Record decision: {selected.title}</h2><button onClick={() => setShowAccept(false)} aria-label="Close" className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]"><X className="h-4 w-4" /></button></div>
            <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Every field below is required -- SPR will not record this decision otherwise.</p>
            <form onSubmit={handleAccept} className="mt-4 space-y-3">
              {acceptError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{acceptError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Decision<select value={acceptForm.status} onChange={(e) => setAcceptForm((c) => ({ ...c, status: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">{['ACCEPTED', 'MITIGATED', 'TRANSFERRED'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Authorized by *<input required value={acceptForm.acceptedBy} onChange={(e) => setAcceptForm((c) => ({ ...c, acceptedBy: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Rationale *<textarea required value={acceptForm.acceptanceRationale} onChange={(e) => setAcceptForm((c) => ({ ...c, acceptanceRationale: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Scope *<input required value={acceptForm.acceptanceScope} onChange={(e) => setAcceptForm((c) => ({ ...c, acceptanceScope: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Review date *<input required type="date" value={acceptForm.reviewDate} onChange={(e) => setAcceptForm((c) => ({ ...c, reviewDate: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAccept(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
                <button type="submit" disabled={accepting} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{accepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{accepting ? 'Recording…' : 'Confirm'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
