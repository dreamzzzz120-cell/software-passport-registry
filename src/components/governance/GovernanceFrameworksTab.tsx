import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, BookOpen, Loader2, Plus, X } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

type Framework = { id: string; frameworkKey: string; name: string; version: string; publishedBy: string; sourceUrl: string | null; status: string };
type Requirement = {
  id: string; requirementKey: string; requirementText: string; authoritativeSource: string | null; jurisdiction: string;
  applicability: string; status: 'REQUIRES_SOURCE_VERIFICATION' | 'VERIFIED_SOURCE'; reviewDate: string | null;
  tenantStatus: 'SUPPORTED' | 'PARTIAL' | 'NOT_SUPPORTED' | 'UNKNOWN' | 'NEEDS_REVIEW'; tenantNotes: string; tenantRelatedControlIds: string[];
};

const MAPPING_STYLE: Record<string, string> = {
  SUPPORTED: 'text-[var(--spr-green)] border-[var(--spr-green)]/40', PARTIAL: 'text-[var(--spr-amber)] border-[var(--spr-amber)]/40',
  NOT_SUPPORTED: 'text-[var(--spr-red)] border-[var(--spr-red)]/40', UNKNOWN: 'text-[var(--spr-text-muted)] border-[var(--spr-border)]', NEEDS_REVIEW: 'text-[var(--spr-amber)] border-[var(--spr-amber)]/40',
};

export default function GovernanceFrameworksTab({ canWrite, canMap }: { canWrite: boolean; canMap: boolean }) {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [showAddReq, setShowAddReq] = useState(false);
  const [reqForm, setReqForm] = useState({ requirementKey: '', requirementText: '', authoritativeSource: '', jurisdiction: '', applicability: '' });
  const [addingReq, setAddingReq] = useState(false);
  const [addReqError, setAddReqError] = useState('');
  const [mappingSaving, setMappingSaving] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/governance/frameworks')
      .then((r) => { if (!r.ok) throw new Error('Unable to load compliance frameworks.'); return r.json(); })
      .then(setFrameworks).catch((e) => setError(e?.message || 'Unable to load frameworks.')).finally(() => setLoading(false));
  }, []);

  const loadRequirements = async (frameworkId: string) => {
    setSelectedId(frameworkId); setReqLoading(true);
    try {
      const r = await apiFetch(`/api/governance/frameworks/${encodeURIComponent(frameworkId)}/requirements`);
      setRequirements(r.ok ? await r.json() : []);
    } finally { setReqLoading(false); }
  };

  const selected = frameworks.find((f) => f.id === selectedId) || null;

  const handleAddRequirement = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !reqForm.requirementKey.trim() || addingReq) return;
    setAddingReq(true); setAddReqError('');
    try {
      const status = reqForm.authoritativeSource.trim() ? 'VERIFIED_SOURCE' : 'REQUIRES_SOURCE_VERIFICATION';
      const r = await apiFetch(`/api/governance/frameworks/${encodeURIComponent(selected.id)}/requirements`, { method: 'POST', body: JSON.stringify({ ...reqForm, status }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error === 'REQUIREMENT_KEY_ALREADY_EXISTS' ? 'A requirement with this key already exists in this framework.' : (data?.issues?.[0]?.message || data?.error || 'Unable to add this requirement.'));
      setShowAddReq(false); setReqForm({ requirementKey: '', requirementText: '', authoritativeSource: '', jurisdiction: '', applicability: '' });
      await loadRequirements(selected.id);
    } catch (e: any) { setAddReqError(e?.message || 'Unable to add this requirement.'); }
    finally { setAddingReq(false); }
  };

  const handleMappingChange = async (requirementId: string, status: string) => {
    setMappingSaving(requirementId);
    try {
      const r = await apiFetch(`/api/governance/requirement-mappings/${encodeURIComponent(requirementId)}`, { method: 'PUT', body: JSON.stringify({ status, relatedControlIds: [] }) });
      if (r.ok) setRequirements((cur) => cur.map((req) => req.id === requirementId ? { ...req, tenantStatus: status as Requirement['tenantStatus'] } : req));
    } finally { setMappingSaving(null); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel divide-y divide-[var(--spr-border)] overflow-hidden">
        {error && <div role="alert" className="m-3 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</div>}
        {loading ? <div className="p-6 text-sm text-[var(--spr-text-muted)]">Loading…</div> : frameworks.map((f) => (
          <button key={f.id} onClick={() => void loadRequirements(f.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === f.id ? 'bg-[var(--spr-accent-soft)]/45' : 'hover:bg-[var(--spr-surface-sunken)]'}`}>
            <span className="min-w-0"><span className="block truncate font-semibold text-[var(--spr-text)]">{f.name}</span><span className="block text-xs text-[var(--spr-text-faint)]">{f.version} · {f.publishedBy}</span></span>
            <span className="shrink-0 rounded-sm border border-[var(--spr-border)] px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--spr-text-muted)]">{f.status.replace(/_/g, ' ')}</span>
          </button>
        ))}
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[var(--spr-text-muted)]">Select a framework to view its requirements.</p> : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--spr-text)]">{selected.name}</h2>
                <p className="text-xs text-[var(--spr-text-faint)]">{selected.publishedBy} · {selected.version}</p>
              </div>
              {canWrite && <button onClick={() => setShowAddReq(true)} className="spr-btn spr-btn-secondary inline-flex items-center gap-1.5 !text-xs"><Plus className="h-3.5 w-3.5" /> Add requirement</button>}
            </div>

            <div className="flex items-start gap-2 rounded-md border border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10 px-3 py-2.5 text-xs text-[var(--spr-amber)]">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>SPR does not supply requirement text for this framework on its own. Every requirement here was entered by an authorized admin and requires a real, citable authoritative source before it can be marked as a verified source.</span>
            </div>

            {reqLoading ? <p className="text-xs text-[var(--spr-text-muted)]">Loading requirements…</p> : requirements.length === 0 ? (
              <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-6 text-center text-sm text-[var(--spr-text-muted)]"><BookOpen className="mx-auto h-6 w-6 text-[var(--spr-text-faint)]" /><p className="mt-2">No requirements have been added for this framework yet.</p></div>
            ) : (
              <div className="space-y-2.5">
                {requirements.map((req) => (
                  <div key={req.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-semibold text-[var(--spr-text)]">{req.requirementKey}</p>
                      <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase ${req.status === 'VERIFIED_SOURCE' ? 'border-[var(--spr-green)]/40 text-[var(--spr-green)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{req.status.replace(/_/g, ' ')}</span>
                    </div>
                    {req.requirementText && <p className="mt-1.5 text-xs text-[var(--spr-text-muted)]">{req.requirementText}</p>}
                    {req.authoritativeSource && <p className="mt-1 text-[10px] text-[var(--spr-text-faint)]">Source: {req.authoritativeSource}</p>}
                    {canMap && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-[var(--spr-text-faint)]">Our status:</span>
                        <select disabled={mappingSaving === req.id} value={req.tenantStatus} onChange={(e) => void handleMappingChange(req.id, e.target.value)} className={`rounded-sm border bg-[var(--spr-surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold uppercase ${MAPPING_STYLE[req.tenantStatus]}`}>
                          {['SUPPORTED', 'PARTIAL', 'NOT_SUPPORTED', 'UNKNOWN', 'NEEDS_REVIEW'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                        </select>
                        {mappingSaving === req.id && <Loader2 className="h-3 w-3 animate-spin text-[var(--spr-text-faint)]" />}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {showAddReq && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[var(--spr-text)]">Add requirement to {selected.name}</h2><button onClick={() => setShowAddReq(false)} aria-label="Close" className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleAddRequirement} className="mt-5 space-y-3">
              {addReqError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{addReqError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Requirement key * (unique within this framework)<input required value={reqForm.requirementKey} onChange={(e) => setReqForm((c) => ({ ...c, requirementKey: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Requirement text<textarea value={reqForm.requirementText} onChange={(e) => setReqForm((c) => ({ ...c, requirementText: e.target.value }))} rows={3} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Authoritative source (a real citation -- required to mark this as a verified source)<input value={reqForm.authoritativeSource} onChange={(e) => setReqForm((c) => ({ ...c, authoritativeSource: e.target.value }))} placeholder="e.g. NIST SP 800-53 Rev 5, Section AC-2" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Jurisdiction<input value={reqForm.jurisdiction} onChange={(e) => setReqForm((c) => ({ ...c, jurisdiction: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddReq(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
                <button type="submit" disabled={addingReq || !reqForm.requirementKey.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{addingReq ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{addingReq ? 'Adding…' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
