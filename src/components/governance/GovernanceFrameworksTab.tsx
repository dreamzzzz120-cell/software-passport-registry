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
  SUPPORTED: 'text-[#89d185] border-[#89d185]/40', PARTIAL: 'text-[#cca700] border-[#cca700]/40',
  NOT_SUPPORTED: 'text-[#f14c4c] border-[#f14c4c]/40', UNKNOWN: 'text-[#9d9d9d] border-[#3c3c3c]', NEEDS_REVIEW: 'text-[#cca700] border-[#cca700]/40',
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
      <section className="lg:col-span-2 spr-panel divide-y divide-[#3c3c3c] overflow-hidden">
        {error && <div role="alert" className="m-3 rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2 text-xs text-[#f14c4c]">{error}</div>}
        {loading ? <div className="p-6 text-sm text-[#9d9d9d]">Loading…</div> : frameworks.map((f) => (
          <button key={f.id} onClick={() => void loadRequirements(f.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === f.id ? 'bg-[#094771]/45' : 'hover:bg-[#2d2d2d]'}`}>
            <span className="min-w-0"><span className="block truncate font-semibold text-[#d4d4d4]">{f.name}</span><span className="block text-xs text-[#6f6f6f]">{f.version} · {f.publishedBy}</span></span>
            <span className="shrink-0 rounded-sm border border-[#3c3c3c] px-2 py-0.5 text-[9px] font-bold uppercase text-[#9d9d9d]">{f.status.replace(/_/g, ' ')}</span>
          </button>
        ))}
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[#9d9d9d]">Select a framework to view its requirements.</p> : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#d4d4d4]">{selected.name}</h2>
                <p className="text-xs text-[#6f6f6f]">{selected.publishedBy} · {selected.version}</p>
              </div>
              {canWrite && <button onClick={() => setShowAddReq(true)} className="spr-btn spr-btn-secondary inline-flex items-center gap-1.5 !text-xs"><Plus className="h-3.5 w-3.5" /> Add requirement</button>}
            </div>

            <div className="flex items-start gap-2 rounded-md border border-[#cca700]/40 bg-[#cca700]/10 px-3 py-2.5 text-xs text-[#cca700]">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>SPR does not supply requirement text for this framework on its own. Every requirement here was entered by an authorized admin and requires a real, citable authoritative source before it can be marked as a verified source.</span>
            </div>

            {reqLoading ? <p className="text-xs text-[#9d9d9d]">Loading requirements…</p> : requirements.length === 0 ? (
              <div className="rounded-md border border-[#3c3c3c] bg-[#181818] p-6 text-center text-sm text-[#9d9d9d]"><BookOpen className="mx-auto h-6 w-6 text-[#6f6f6f]" /><p className="mt-2">No requirements have been added for this framework yet.</p></div>
            ) : (
              <div className="space-y-2.5">
                {requirements.map((req) => (
                  <div key={req.id} className="rounded-md border border-[#3c3c3c] bg-[#181818] p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-semibold text-[#d4d4d4]">{req.requirementKey}</p>
                      <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase ${req.status === 'VERIFIED_SOURCE' ? 'border-[#89d185]/40 text-[#89d185]' : 'border-[#3c3c3c] text-[#9d9d9d]'}`}>{req.status.replace(/_/g, ' ')}</span>
                    </div>
                    {req.requirementText && <p className="mt-1.5 text-xs text-[#9d9d9d]">{req.requirementText}</p>}
                    {req.authoritativeSource && <p className="mt-1 text-[10px] text-[#6f6f6f]">Source: {req.authoritativeSource}</p>}
                    {canMap && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-[#6f6f6f]">Our status:</span>
                        <select disabled={mappingSaving === req.id} value={req.tenantStatus} onChange={(e) => void handleMappingChange(req.id, e.target.value)} className={`rounded-sm border bg-[#2d2d2d] px-1.5 py-0.5 text-[10px] font-bold uppercase ${MAPPING_STYLE[req.tenantStatus]}`}>
                          {['SUPPORTED', 'PARTIAL', 'NOT_SUPPORTED', 'UNKNOWN', 'NEEDS_REVIEW'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                        </select>
                        {mappingSaving === req.id && <Loader2 className="h-3 w-3 animate-spin text-[#6f6f6f]" />}
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
          <div className="w-full max-w-lg rounded-md border border-[#3c3c3c] bg-[#252526] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[#d4d4d4]">Add requirement to {selected.name}</h2><button onClick={() => setShowAddReq(false)} aria-label="Close" className="rounded-md p-1.5 text-[#9d9d9d] hover:bg-[#383838]"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleAddRequirement} className="mt-5 space-y-3">
              {addReqError && <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2 text-xs text-[#f14c4c]">{addReqError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Requirement key * (unique within this framework)<input required value={reqForm.requirementKey} onChange={(e) => setReqForm((c) => ({ ...c, requirementKey: e.target.value }))} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Requirement text<textarea value={reqForm.requirementText} onChange={(e) => setReqForm((c) => ({ ...c, requirementText: e.target.value }))} rows={3} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Authoritative source (a real citation -- required to mark this as a verified source)<input value={reqForm.authoritativeSource} onChange={(e) => setReqForm((c) => ({ ...c, authoritativeSource: e.target.value }))} placeholder="e.g. NIST SP 800-53 Rev 5, Section AC-2" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[#9d9d9d]">Jurisdiction<input value={reqForm.jurisdiction} onChange={(e) => setReqForm((c) => ({ ...c, jurisdiction: e.target.value }))} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddReq(false)} className="rounded-md border border-[#3c3c3c] px-3.5 py-2 text-xs font-semibold text-[#9d9d9d] hover:bg-[#383838]">Cancel</button>
                <button type="submit" disabled={addingReq || !reqForm.requirementKey.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[#0e639c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1177bb] disabled:opacity-40">{addingReq ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{addingReq ? 'Adding…' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
