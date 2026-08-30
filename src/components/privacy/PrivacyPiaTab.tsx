import { useEffect, useState, type FormEvent } from 'react';
import { ClipboardCheck, Loader2, Plus, X } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

type Pia = {
  id: string; processingDescription: string; personalInformationDescription: string; purpose: string; risks: string;
  safeguards: string; residualRisk: string | null; reviewerName: string | null;
  decision: 'PENDING' | 'APPROVED' | 'REQUIRES_CHANGES' | 'REJECTED'; decidedAt: string | null;
};

const DECISION_STYLE: Record<string, string> = {
  PENDING: 'border-[var(--spr-border)] text-[var(--spr-text-muted)]', APPROVED: 'border-[var(--spr-green)]/40 text-[var(--spr-green)]',
  REQUIRES_CHANGES: 'border-[var(--spr-amber)]/40 text-[var(--spr-amber)]', REJECTED: 'border-[var(--spr-red)]/40 text-[var(--spr-red)]',
};

export default function PrivacyPiaTab({ canWrite }: { canWrite: boolean }) {
  const [pias, setPias] = useState<Pia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ processingDescription: '', personalInformationDescription: '', purpose: '', risks: '', safeguards: '', residualRisk: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await apiFetch('/api/privacy/pias');
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You are not authorized to view privacy impact assessments.' : 'Unable to load PIAs.');
      setPias(await r.json());
    } catch (e: any) { setError(e?.message || 'Unable to load PIAs.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const selected = pias.find((p) => p.id === selectedId) || null;
  useEffect(() => { setReviewerName(''); setDecideError(''); }, [selectedId]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.processingDescription.trim() || creating) return;
    setCreating(true); setCreateError('');
    try {
      const r = await apiFetch('/api/privacy/pias', { method: 'POST', body: JSON.stringify({ ...form, residualRisk: form.residualRisk || null }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'Unable to create this assessment.');
      setShowCreate(false); setForm({ processingDescription: '', personalInformationDescription: '', purpose: '', risks: '', safeguards: '', residualRisk: '' });
      await load(); setSelectedId(data.id);
    } catch (e: any) { setCreateError(e?.message || 'Unable to create this assessment.'); }
    finally { setCreating(false); }
  };

  const handleDecide = async (decision: string) => {
    if (!selected || !reviewerName.trim() || deciding) return;
    setDeciding(true); setDecideError('');
    try {
      const r = await apiFetch(`/api/privacy/pias/${encodeURIComponent(selected.id)}/decide`, { method: 'POST', body: JSON.stringify({ reviewerName: reviewerName.trim(), decision }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'Unable to record this decision.');
      await load();
    } catch (e: any) { setDecideError(e?.message || 'Unable to record this decision.'); }
    finally { setDeciding(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--spr-border)] p-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-muted)]">Privacy impact assessments</span>
          {canWrite && <button onClick={() => setShowCreate(true)} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 !text-xs"><Plus className="h-3.5 w-3.5" /> New</button>}
        </div>
        {error && <div role="alert" className="m-3 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</div>}
        <div className="max-h-[560px] divide-y divide-[var(--spr-border)] overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-[var(--spr-text-muted)]">Loading…</div> : pias.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--spr-text-muted)]"><ClipboardCheck className="mx-auto h-7 w-7 text-[var(--spr-text-faint)]" /><p className="mt-2 font-semibold text-[var(--spr-text)]">No assessments exist yet.</p></div>
          ) : pias.map((p) => (
            <button key={p.id} onClick={() => setSelectedId(p.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === p.id ? 'bg-[var(--spr-accent-soft)]/45' : 'hover:bg-[var(--spr-surface-sunken)]'}`}>
              <span className="min-w-0 truncate font-semibold text-[var(--spr-text)]">{p.processingDescription || '(no description)'}</span>
              <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${DECISION_STYLE[p.decision]}`}>{p.decision.replace('_', ' ')}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[var(--spr-text-muted)]">Select an assessment to view details.</p> : (
          <div className="space-y-3 text-xs">
            {decideError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2.5 text-xs text-[var(--spr-red)]">{decideError}</div>}
            <h2 className="text-sm font-bold text-[var(--spr-text)]">{selected.processingDescription}</h2>
            <dl className="space-y-2">
              <div><dt className="font-bold uppercase text-[var(--spr-text-faint)]">Personal information involved</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{selected.personalInformationDescription || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[var(--spr-text-faint)]">Purpose</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{selected.purpose || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[var(--spr-text-faint)]">Risks</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{selected.risks || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[var(--spr-text-faint)]">Safeguards</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{selected.safeguards || '—'}</dd></div>
              <div><dt className="font-bold uppercase text-[var(--spr-text-faint)]">Residual risk</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{selected.residualRisk || 'Not yet assessed'}</dd></div>
            </dl>
            {selected.decision === 'PENDING' ? (
              canWrite && (
                <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3">
                  <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Reviewer name * (required to record a decision)<input value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)]" /></label>
                  <div className="mt-2 flex gap-2">
                    {['APPROVED', 'REQUIRES_CHANGES', 'REJECTED'].map((d) => (
                      <button key={d} disabled={!reviewerName.trim() || deciding} onClick={() => void handleDecide(d)} className="rounded-md border border-[var(--spr-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-40">{deciding ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} {d.replace('_', ' ')}</button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <p className={DECISION_STYLE[selected.decision].includes('89d185') ? 'text-[var(--spr-green)]' : 'text-[var(--spr-text)]'}>{selected.decision.replace('_', ' ')} by {selected.reviewerName} on {selected.decidedAt ? new Date(selected.decidedAt).toLocaleDateString() : ''}</p>
            )}
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[var(--spr-text)]">New privacy impact assessment</h2><button onClick={() => setShowCreate(false)} aria-label="Close" className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleCreate} className="mt-5 space-y-3">
              {createError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{createError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Processing description *<textarea required value={form.processingDescription} onChange={(e) => setForm((c) => ({ ...c, processingDescription: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Personal information involved<textarea value={form.personalInformationDescription} onChange={(e) => setForm((c) => ({ ...c, personalInformationDescription: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Risks<textarea value={form.risks} onChange={(e) => setForm((c) => ({ ...c, risks: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Safeguards<textarea value={form.safeguards} onChange={(e) => setForm((c) => ({ ...c, safeguards: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
                <button type="submit" disabled={creating || !form.processingDescription.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{creating ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
