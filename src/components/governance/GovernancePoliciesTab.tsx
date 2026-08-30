import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, FileText, Loader2, Plus, Search, X } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

type Policy = {
  id: string; policyKey: string; name: string; description: string; content: string; ownerName: string;
  version: string; status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
  effectiveDate: string | null; reviewDate: string | null; approvalStatus: 'NOT_APPROVED' | 'APPROVED';
  approverName: string | null; approvedAt: string | null; relatedControlIds: string[]; relatedRequirementIds: string[];
  createdBy: string; createdAt: string; updatedAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'text-[var(--spr-text-muted)] border-[var(--spr-border)]', IN_REVIEW: 'text-[var(--spr-amber)] border-[var(--spr-amber)]/40',
  APPROVED: 'text-[var(--spr-highlight)] border-[var(--spr-highlight)]/40', ACTIVE: 'text-[var(--spr-green)] border-[var(--spr-green)]/40', RETIRED: 'text-[var(--spr-text-faint)] border-[var(--spr-border)]',
};

export default function GovernancePoliciesTab({ canWrite, onNavigateControl, selectIdOnLoad }: { canWrite: boolean; onNavigateControl: (id: string) => void; selectIdOnLoad?: string | null }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ policyKey: '', name: '', description: '', ownerName: '', content: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editForm, setEditForm] = useState<Partial<Policy>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [approverName, setApproverName] = useState('');
  const [approving, setApproving] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await apiFetch('/api/governance/policies');
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You are not authorized to view policies.' : 'Unable to load policies.');
      setPolicies(await r.json());
    } catch (e: any) { setError(e?.message || 'Unable to load policies.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (selectIdOnLoad && policies.some((p) => p.id === selectIdOnLoad)) setSelectedId(selectIdOnLoad); }, [selectIdOnLoad, policies]);

  const selected = policies.find((p) => p.id === selectedId) || null;
  useEffect(() => { if (selected) { setEditForm(selected); setApproverName(''); setSaveError(''); } }, [selectedId]);

  const filtered = useMemo(() => policies.filter((p) =>
    (!statusFilter || p.status === statusFilter) &&
    (!search.trim() || p.name.toLowerCase().includes(search.toLowerCase()) || p.policyKey.toLowerCase().includes(search.toLowerCase()) || p.ownerName.toLowerCase().includes(search.toLowerCase()))
  ), [policies, search, statusFilter]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.policyKey.trim() || !form.name.trim() || creating) return;
    setCreating(true); setCreateError('');
    try {
      const r = await apiFetch('/api/governance/policies', { method: 'POST', body: JSON.stringify(form) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error === 'POLICY_KEY_ALREADY_EXISTS' ? 'A policy with this key already exists.' : (data?.issues?.[0]?.message || data?.error || 'Unable to create this policy.'));
      setShowCreate(false); setForm({ policyKey: '', name: '', description: '', ownerName: '', content: '' });
      await load(); setSelectedId(data.id);
    } catch (e: any) { setCreateError(e?.message || 'Unable to create this policy.'); }
    finally { setCreating(false); }
  };

  const handleSave = async () => {
    if (!selected || saving) return;
    setSaving(true); setSaveError('');
    try {
      const r = await apiFetch(`/api/governance/policies/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editForm.name, description: editForm.description, content: editForm.content, ownerName: editForm.ownerName, version: editForm.version, status: editForm.status, effectiveDate: editForm.effectiveDate || null, reviewDate: editForm.reviewDate || null }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'Unable to save this policy.');
      setPolicies((cur) => cur.map((p) => p.id === data.id ? data : p));
    } catch (e: any) { setSaveError(e?.message || 'Unable to save this policy.'); }
    finally { setSaving(false); }
  };

  const handleApprove = async () => {
    if (!selected || !approverName.trim() || approving) return;
    setApproving(true); setSaveError('');
    try {
      const r = await apiFetch(`/api/governance/policies/${encodeURIComponent(selected.id)}/approve`, { method: 'POST', body: JSON.stringify({ approverName: approverName.trim() }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'Unable to approve this policy.');
      setPolicies((cur) => cur.map((p) => p.id === data.id ? data : p));
      setApproverName('');
    } catch (e: any) { setSaveError(e?.message || 'Unable to approve this policy.'); }
    finally { setApproving(false); }
  };

  const handleRetire = async () => {
    if (!selected) return;
    setConfirmRetire(false); setSaving(true); setSaveError('');
    try {
      const r = await apiFetch(`/api/governance/policies/${encodeURIComponent(selected.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'RETIRED' }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || 'Unable to retire this policy.');
      setPolicies((cur) => cur.map((p) => p.id === data.id ? data : p));
      setEditForm(data);
    } catch (e: any) { setSaveError(e?.message || 'Unable to retire this policy.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel overflow-hidden">
        <div className="border-b border-[var(--spr-border)] p-3 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--spr-text-faint)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search policies…" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] py-1.5 pl-8 pr-2 text-xs text-[var(--spr-text)]" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]">
              <option value="">All statuses</option>
              {['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            {canWrite && <button onClick={() => setShowCreate(true)} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 !text-xs"><Plus className="h-3.5 w-3.5" /> New</button>}
          </div>
        </div>
        {error && <div role="alert" className="m-3 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</div>}
        <div className="max-h-[560px] divide-y divide-[var(--spr-border)] overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-[var(--spr-text-muted)]">Loading…</div> : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--spr-text-muted)]"><FileText className="mx-auto h-7 w-7 text-[var(--spr-text-faint)]" /><p className="mt-2 font-semibold text-[var(--spr-text)]">{policies.length === 0 ? 'No policies exist yet.' : 'No policies match this search/filter.'}</p></div>
          ) : filtered.map((p) => (
            <button key={p.id} onClick={() => setSelectedId(p.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === p.id ? 'bg-[var(--spr-accent-soft)]/45' : 'hover:bg-[var(--spr-surface-sunken)]'}`}>
              <span className="min-w-0"><span className="block truncate font-semibold text-[var(--spr-text)]">{p.name}</span><span className="block text-xs text-[var(--spr-text-faint)]">v{p.version} · {p.ownerName || 'No owner set'}</span></span>
              <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[p.status]}`}>{p.status.replace('_', ' ')}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[var(--spr-text-muted)]">Select a policy to view details.</p> : (
          <div className="space-y-4">
            {saveError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2.5 text-xs text-[var(--spr-red)]">{saveError}</div>}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--spr-text)]">{selected.name}</h2>
                <p className="text-xs text-[var(--spr-text-faint)]">Key: {selected.policyKey}</p>
              </div>
              <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${selected.approvalStatus === 'APPROVED' ? 'border-[var(--spr-green)]/40 text-[var(--spr-green)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{selected.approvalStatus === 'APPROVED' ? `Approved by ${selected.approverName}` : 'Not approved'}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Name<input disabled={!canWrite} value={editForm.name ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Owner<input disabled={!canWrite} value={editForm.ownerName ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, ownerName: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Version<input disabled={!canWrite} value={editForm.version ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, version: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Lifecycle status<select disabled={!canWrite} value={editForm.status ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, status: e.target.value as Policy['status'] }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60">{['DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Effective date<input disabled={!canWrite} type="date" value={editForm.effectiveDate?.slice(0, 10) ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, effectiveDate: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Review date<input disabled={!canWrite} type="date" value={editForm.reviewDate?.slice(0, 10) ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, reviewDate: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
            </div>
            <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Description<textarea disabled={!canWrite} value={editForm.description ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, description: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
            <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Policy content (draft/template — {selected.approvalStatus === 'APPROVED' ? 'approved' : 'not yet approved'})<textarea disabled={!canWrite} value={editForm.content ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, content: e.target.value }))} rows={6} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>

            {selected.relatedControlIds.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Related controls</div>
                <div className="mt-1 flex flex-wrap gap-1.5">{selected.relatedControlIds.map((id) => <button key={id} onClick={() => onNavigateControl(id)} className="rounded-sm border border-[var(--spr-border)] px-2 py-0.5 text-[10px] text-[var(--spr-highlight)] hover:underline">{id}</button>)}</div>
              </div>
            )}

            {canWrite && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--spr-border)] pt-4">
                <button onClick={() => void handleSave()} disabled={saving} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 !text-xs disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save changes</button>
                {selected.approvalStatus !== 'APPROVED' && (
                  <div className="flex items-center gap-1.5">
                    <input value={approverName} onChange={(e) => setApproverName(e.target.value)} placeholder="Approver name" className="w-40 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]" />
                    <button onClick={() => void handleApprove()} disabled={!approverName.trim() || approving} className="spr-btn spr-btn-secondary inline-flex items-center gap-1.5 !text-xs disabled:opacity-40"><CheckCircle2 className="h-3.5 w-3.5" /> Approve</button>
                  </div>
                )}
                {selected.status !== 'RETIRED' && (
                  confirmRetire ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--spr-amber)]">Retire this policy? <button onClick={() => void handleRetire()} className="font-bold underline">Confirm</button> <button onClick={() => setConfirmRetire(false)} className="underline">Cancel</button></span>
                  ) : <button onClick={() => setConfirmRetire(true)} className="rounded-md border border-[var(--spr-border)] px-3 py-1.5 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Retire</button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[var(--spr-text)]">New policy</h2><button onClick={() => setShowCreate(false)} aria-label="Close" className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleCreate} className="mt-5 space-y-3">
              {createError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{createError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Policy key * (unique, e.g. information_security)<input required value={form.policyKey} onChange={(e) => setForm((c) => ({ ...c, policyKey: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Name *<input required value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Owner<input value={form.ownerName} onChange={(e) => setForm((c) => ({ ...c, ownerName: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Description<textarea value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
                <button type="submit" disabled={creating || !form.policyKey.trim() || !form.name.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{creating ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
