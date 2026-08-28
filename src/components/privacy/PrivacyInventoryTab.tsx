import { useEffect, useState, type FormEvent } from 'react';
import { Database, Loader2, Plus, X } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

type InventoryItem = {
  id: string; clientId: string | null; informationType: string; category: string; source: string; purpose: string;
  useDescription: string; disclosureRecipients: string; geography: string; retention: string; disposal: string;
  accessRoles: string; ownerName: string; createdAt: string; updatedAt: string;
};

export default function PrivacyInventoryTab({ canWrite }: { canWrite: boolean }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ informationType: '', category: '', source: '', purpose: '', retention: '', geography: '', ownerName: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await apiFetch('/api/privacy/inventory');
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You are not authorized to view the privacy inventory.' : 'Unable to load the personal information inventory.');
      setItems(await r.json());
    } catch (e: any) { setError(e?.message || 'Unable to load the inventory.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const selected = items.find((i) => i.id === selectedId) || null;

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.informationType.trim() || creating) return;
    setCreating(true); setCreateError('');
    try {
      const r = await apiFetch('/api/privacy/inventory', { method: 'POST', body: JSON.stringify(form) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'Unable to add this inventory item.');
      setShowCreate(false); setForm({ informationType: '', category: '', source: '', purpose: '', retention: '', geography: '', ownerName: '' });
      await load(); setSelectedId(data.id);
    } catch (e: any) { setCreateError(e?.message || 'Unable to add this inventory item.'); }
    finally { setCreating(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#3c3c3c] p-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[#9d9d9d]">Personal information inventory</span>
          {canWrite && <button onClick={() => setShowCreate(true)} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 !text-xs"><Plus className="h-3.5 w-3.5" /> New</button>}
        </div>
        {error && <div role="alert" className="m-3 rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2 text-xs text-[#f14c4c]">{error}</div>}
        <div className="max-h-[560px] divide-y divide-[#3c3c3c] overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-[#9d9d9d]">Loading…</div> : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#9d9d9d]"><Database className="mx-auto h-7 w-7 text-[#6f6f6f]" /><p className="mt-2 font-semibold text-[#d4d4d4]">No inventory items exist yet.</p></div>
          ) : items.map((i) => (
            <button key={i.id} onClick={() => setSelectedId(i.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === i.id ? 'bg-[#094771]/45' : 'hover:bg-[#2d2d2d]'}`}>
              <span className="min-w-0"><span className="block truncate font-semibold text-[#d4d4d4]">{i.informationType}</span><span className="block text-xs text-[#6f6f6f]">{i.category || 'Uncategorized'}</span></span>
            </button>
          ))}
        </div>
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[#9d9d9d]">Select an inventory item to view details.</p> : (
          <div className="space-y-3 text-xs">
            <h2 className="text-sm font-bold text-[#d4d4d4]">{selected.informationType}</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Purpose</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.purpose || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Source</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.source || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Use</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.useDescription || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Disclosure recipients</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.disclosureRecipients || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Geography</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.geography || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Retention</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.retention || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Disposal</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.disposal || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Access roles</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.accessRoles || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[#6f6f6f]">Owner</dt><dd className="mt-0.5 text-[#9d9d9d]">{selected.ownerName || '—'}</dd></div>
            </dl>
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-[#3c3c3c] bg-[#252526] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[#d4d4d4]">New inventory item</h2><button onClick={() => setShowCreate(false)} aria-label="Close" className="rounded-md p-1.5 text-[#9d9d9d] hover:bg-[#383838]"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleCreate} className="mt-5 space-y-3">
              {createError && <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2 text-xs text-[#f14c4c]">{createError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Information type * (e.g. Client contact details)<input required value={form.informationType} onChange={(e) => setForm((c) => ({ ...c, informationType: e.target.value }))} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Category<input value={form.category} onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Purpose<textarea value={form.purpose} onChange={(e) => setForm((c) => ({ ...c, purpose: e.target.value }))} rows={2} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Retention<input value={form.retention} onChange={(e) => setForm((c) => ({ ...c, retention: e.target.value }))} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Owner<input value={form.ownerName} onChange={(e) => setForm((c) => ({ ...c, ownerName: e.target.value }))} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-[#3c3c3c] px-3.5 py-2 text-xs font-semibold text-[#9d9d9d] hover:bg-[#383838]">Cancel</button>
                <button type="submit" disabled={creating || !form.informationType.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[#0e639c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1177bb] disabled:opacity-40">{creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{creating ? 'Adding…' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
