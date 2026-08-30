import { useEffect, useState, type FormEvent } from 'react';
import { Inbox, Loader2, Plus, X } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

type PrivacyRequest = {
  id: string; requestorName: string; requestorEmail: string; requestType: string; scope: string; receivedAt: string;
  status: 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'WITHDRAWN'; response: string; completedAt: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  RECEIVED: 'border-[var(--spr-border)] text-[var(--spr-text-muted)]', IN_PROGRESS: 'border-[var(--spr-amber)]/40 text-[var(--spr-amber)]',
  COMPLETED: 'border-[var(--spr-green)]/40 text-[var(--spr-green)]', REJECTED: 'border-[var(--spr-red)]/40 text-[var(--spr-red)]', WITHDRAWN: 'border-[var(--spr-border)] text-[var(--spr-text-faint)]',
};

export default function PrivacyRequestsTab({ canProcess }: { canProcess: boolean }) {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ requestorName: '', requestorEmail: '', requestType: 'ACCESS', scope: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [response, setResponse] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await apiFetch('/api/privacy/requests');
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You are not authorized to view privacy requests.' : 'Unable to load privacy requests.');
      setRequests(await r.json());
    } catch (e: any) { setError(e?.message || 'Unable to load privacy requests.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const selected = requests.find((r) => r.id === selectedId) || null;
  useEffect(() => { if (selected) { setResponse(selected.response); setSaveError(''); } }, [selectedId]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.requestorName.trim() || creating) return;
    setCreating(true); setCreateError('');
    try {
      const r = await apiFetch('/api/privacy/requests', { method: 'POST', body: JSON.stringify(form) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'Unable to log this request.');
      setShowCreate(false); setForm({ requestorName: '', requestorEmail: '', requestType: 'ACCESS', scope: '' });
      await load(); setSelectedId(data.id);
    } catch (e: any) { setCreateError(e?.message || 'Unable to log this request.'); }
    finally { setCreating(false); }
  };

  const updateStatus = async (status: string) => {
    if (!selected || saving) return;
    setSaving(true); setSaveError('');
    try {
      const r = await apiFetch(`/api/privacy/requests/${encodeURIComponent(selected.id)}`, { method: 'PATCH', body: JSON.stringify({ status, response }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || 'Unable to update this request.');
      setRequests((cur) => cur.map((req) => req.id === data.id ? data : req));
    } catch (e: any) { setSaveError(e?.message || 'Unable to update this request.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--spr-border)] p-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-muted)]">Privacy requests</span>
          {canProcess && <button onClick={() => setShowCreate(true)} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 !text-xs"><Plus className="h-3.5 w-3.5" /> Log request</button>}
        </div>
        {error && <div role="alert" className="m-3 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</div>}
        <div className="max-h-[560px] divide-y divide-[var(--spr-border)] overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-[var(--spr-text-muted)]">Loading…</div> : requests.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--spr-text-muted)]"><Inbox className="mx-auto h-7 w-7 text-[var(--spr-text-faint)]" /><p className="mt-2 font-semibold text-[var(--spr-text)]">No privacy requests logged yet.</p></div>
          ) : requests.map((r) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === r.id ? 'bg-[var(--spr-accent-soft)]/45' : 'hover:bg-[var(--spr-surface-sunken)]'}`}>
              <span className="min-w-0"><span className="block truncate font-semibold text-[var(--spr-text)]">{r.requestorName}</span><span className="block text-xs text-[var(--spr-text-faint)]">{r.requestType}</span></span>
              <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>{r.status.replace('_', ' ')}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[var(--spr-text-muted)]">Select a request to view details.</p> : (
          <div className="space-y-3 text-xs">
            {saveError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2.5 text-xs text-[var(--spr-red)]">{saveError}</div>}
            <h2 className="text-sm font-bold text-[var(--spr-text)]">{selected.requestorName} — {selected.requestType}</h2>
            <p className="text-[var(--spr-text-muted)]">Scope: {selected.scope || 'Not specified'}</p>
            <p className="text-[var(--spr-text-faint)]">Received {new Date(selected.receivedAt).toLocaleString()}</p>
            {canProcess && (
              <>
                <textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={3} placeholder="Response notes" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-2.5 py-1.5 text-xs text-[var(--spr-text)]" />
                <div className="flex flex-wrap gap-2">
                  {['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'WITHDRAWN'].filter((s) => s !== selected.status).map((s) => (
                    <button key={s} disabled={saving} onClick={() => void updateStatus(s)} className="rounded-md border border-[var(--spr-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50">{saving ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} Mark {s.replace('_', ' ')}</button>
                  ))}
                </div>
              </>
            )}
            {selected.completedAt && <p className="text-[var(--spr-green)]">Completed {new Date(selected.completedAt).toLocaleString()}</p>}
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[var(--spr-text)]">Log privacy request</h2><button onClick={() => setShowCreate(false)} aria-label="Close" className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleCreate} className="mt-5 space-y-3">
              {createError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{createError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Requestor name *<input required value={form.requestorName} onChange={(e) => setForm((c) => ({ ...c, requestorName: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Requestor email<input value={form.requestorEmail} onChange={(e) => setForm((c) => ({ ...c, requestorEmail: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Request type<select value={form.requestType} onChange={(e) => setForm((c) => ({ ...c, requestType: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">{['ACCESS', 'CORRECTION', 'DELETION', 'PORTABILITY', 'OBJECTION', 'OTHER'].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Scope<textarea value={form.scope} onChange={(e) => setForm((c) => ({ ...c, scope: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
                <button type="submit" disabled={creating || !form.requestorName.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{creating ? 'Logging…' : 'Log'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
