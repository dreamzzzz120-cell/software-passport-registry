import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, ChevronRight, Plus, Shield, Trash2 } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type AiSystem = {
  id: string; name: string; vendor: string; model: string; version: string; purpose: string;
  data_classification: 'unclassified' | 'internal' | 'confidential' | 'regulated';
  status: 'active' | 'under_review' | 'deprecated' | 'blocked';
  tool_access: string[]; permissions: string[]; owner_display: string; created_by: string; created_at: string; updated_at: string;
};
type Observation = { id: string; observation_type: string; summary: string; detail: string; observed_by: string; created_at: string };

const STATUS_DOT: Record<AiSystem['status'], string> = {
  active: 'bg-[#0e700e]',
  under_review: 'bg-[#8a5700]',
  deprecated: 'bg-[#8a8886]',
  blocked: 'bg-[#a4262c]',
};
const CLASSIFICATION_STYLES: Record<AiSystem['data_classification'], string> = {
  unclassified: 'text-[#8a8886]', internal: 'text-[#0f6cbd]', confidential: 'text-[#8a5700]', regulated: 'text-[#a4262c]',
};
const OBSERVATION_TYPES = ['security', 'privacy', 'access_change', 'model_change', 'vendor_assessment', 'other'] as const;

function responseError(data: any, fallback: string) {
  return typeof data?.error === 'string' ? data.error : fallback;
}
function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export default function AITrustCenterView({ role = 'Viewer' }: { role?: string }) {
  const [systems, setSystems] = useState<AiSystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', vendor: '', model: '', version: '', purpose: '', dataClassification: 'unclassified', status: 'under_review', toolAccess: '', permissions: '', ownerDisplay: '' });
  const [creating, setCreating] = useState(false);
  const [obsForm, setObsForm] = useState({ observationType: 'security', summary: '', detail: '' });
  const [loggingObservation, setLoggingObservation] = useState(false);

  const canManage = role === 'Owner' || role === 'Admin' || role === 'Operator';
  const canDelete = role === 'Owner' || role === 'Admin';

  const loadSystems = () => {
    setLoading(true);
    apiFetch('/api/ai-trust/systems').then(async (r) => { const data = await r.json().catch(() => null); if (r.ok && Array.isArray(data?.systems)) setSystems(data.systems); else setError(responseError(data, 'Unable to load AI systems.')); }).finally(() => setLoading(false));
  };
  useEffect(() => { loadSystems(); }, []);

  const selected = systems.find((s) => s.id === selectedId) || null;
  useEffect(() => {
    if (!selectedId) { setObservations([]); return; }
    apiFetch(`/api/ai-trust/systems/${encodeURIComponent(selectedId)}/observations`).then(async (r) => { const data = await r.json().catch(() => null); if (r.ok && Array.isArray(data?.observations)) setObservations(data.observations); }).catch(() => {});
  }, [selectedId]);

  const createSystem = async () => {
    setCreating(true);
    setError('');
    try {
      const response = await apiFetch('/api/ai-trust/systems', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, toolAccess: parseList(form.toolAccess), permissions: parseList(form.permissions) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to register this AI system.'));
      setShowForm(false);
      setForm({ name: '', vendor: '', model: '', version: '', purpose: '', dataClassification: 'unclassified', status: 'under_review', toolAccess: '', permissions: '', ownerDisplay: '' });
      loadSystems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register this AI system.');
    } finally {
      setCreating(false);
    }
  };

  const deleteSystem = async (id: string) => {
    if (!window.confirm('Remove this AI system from the registry? Its observation log will be deleted too.')) return;
    const response = await apiFetch(`/api/ai-trust/systems/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (response.ok) { if (selectedId === id) setSelectedId(null); loadSystems(); }
  };

  const logObservation = async () => {
    if (!selected) return;
    setLoggingObservation(true);
    try {
      const response = await apiFetch(`/api/ai-trust/systems/${encodeURIComponent(selected.id)}/observations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obsForm),
      });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(responseError(data, 'Unable to log observation.')); }
      const created = await response.json();
      setObservations((current) => [created, ...current]);
      setObsForm({ observationType: 'security', summary: '', detail: '' });
    } catch {
      /* surfaced via the observation list simply not growing; kept minimal intentionally */
    } finally {
      setLoggingObservation(false);
    }
  };

  const summary = useMemo(() => ({
    total: systems.length,
    active: systems.filter((s) => s.status === 'active').length,
    regulated: systems.filter((s) => s.data_classification === 'regulated' || s.data_classification === 'confidential').length,
    underReview: systems.filter((s) => s.status === 'under_review').length,
  }), [systems]);

  return (
    <section aria-labelledby="ai-trust-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="ai-trust-title" className="flex items-center gap-1.5 text-[22px] font-semibold text-[#201f1e]"><Bot className="h-4 w-4 text-[#605e5c]" />Your AI systems, declared and tracked</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[#605e5c]">This is a self-reported registry. SPR has no mechanism to auto-discover AI agents or model usage — every field here is what your team declared, not an independently observed fact.</p>
        </div>
        {canManage && <button type="button" onClick={() => setShowForm((open) => !open)} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]"><Plus className="h-3.5 w-3.5" /> Register AI system</button>}
      </div>

      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>A self-reported inventory of AI systems in use, with a manual observation log per system.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Register an AI system with its vendor, model, data classification, and declared access.</li>
            <li>Select a system to see its permissions, tool access, and observation history.</li>
            <li>Log observations (security, privacy, access change, etc.) as your team reviews it.</li>
          </ol>
        </div>
      </details>

      <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <Metric label="Registered" value={summary.total} />
        <Metric label="Active" value={summary.active} />
        <Metric label="Confidential/regulated data" value={summary.regulated} />
        <Metric label="Under review" value={summary.underReview} />
      </div>

      {error && <p role="alert" className="mb-4 rounded-md border border-[#a4262c]/30 bg-[#fdf2f2] px-3 py-2 text-[13px] text-[#a4262c]">{error}</p>}

      {showForm && (
        <div className="mb-4 space-y-3 rounded-md border border-[#e1dfdd] bg-white p-4">
          <h2 className="text-[14px] font-semibold text-[#201f1e]">Register a new AI system</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <Field label="Vendor *" value={form.vendor} onChange={(v) => setForm((f) => ({ ...f, vendor: v }))} />
            <Field label="Model *" value={form.model} onChange={(v) => setForm((f) => ({ ...f, model: v }))} placeholder="e.g. gpt-4o, claude-sonnet-5" />
            <Field label="Version" value={form.version} onChange={(v) => setForm((f) => ({ ...f, version: v }))} />
            <Field label="Owner" value={form.ownerDisplay} onChange={(v) => setForm((f) => ({ ...f, ownerDisplay: v }))} placeholder="Team or person accountable" />
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#323130]">Data classification</label>
              <select value={form.dataClassification} onChange={(e) => setForm((f) => ({ ...f, dataClassification: e.target.value }))} className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]">
                {(['unclassified', 'internal', 'confidential', 'regulated'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-[#323130]">Status</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]">
                {(['active', 'under_review', 'deprecated', 'blocked'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <Field label="Tool access (comma-separated)" value={form.toolAccess} onChange={(v) => setForm((f) => ({ ...f, toolAccess: v }))} placeholder="repo-read, ticket-create" />
            <Field label="Permissions (comma-separated)" value={form.permissions} onChange={(v) => setForm((f) => ({ ...f, permissions: v }))} placeholder="read-only, no-pii" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-[#323130]">Purpose</label>
            <textarea value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} rows={2} className="w-full rounded border border-[#c8c6c4] bg-white px-3 py-2 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]" />
          </div>
          <button type="button" onClick={() => void createSystem()} disabled={creating || !form.name.trim() || !form.vendor.trim() || !form.model.trim()} className="inline-flex h-8 items-center rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50">{creating ? 'Registering…' : 'Register'}</button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <h2 className="text-[14px] font-semibold text-[#201f1e]">Registered systems ({systems.length})</h2>
          {loading && <p className="mt-3 text-[12px] text-[#8a8886]">Loading…</p>}
          {!loading && systems.length === 0 && <p className="mt-3 text-[12px] text-[#8a8886]">No AI systems registered yet.</p>}
          <ul className="mt-3 max-h-[560px] space-y-1.5 overflow-auto pr-1">
            {systems.map((system) => (
              <li key={system.id}>
                <button type="button" onClick={() => setSelectedId(system.id)} className={`w-full rounded border px-3 py-2 text-left text-[12px] transition ${selectedId === system.id ? 'border-[#0f6cbd]/40 bg-[#eff6fc]' : 'border-[#e1dfdd] bg-white hover:bg-black/[.02]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[#201f1e]">{system.name}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#8a8886]" />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[system.status]}`} />{system.status}</span>
                    <span className={`font-medium uppercase ${CLASSIFICATION_STYLES[system.data_classification]}`}>{system.data_classification}</span>
                    <span className="text-[#8a8886]">{system.vendor} · {system.model}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          {!selected ? (
            <div className="grid h-full min-h-[240px] place-items-center text-center text-[13px] text-[#8a8886]"><div><Shield className="mx-auto h-6 w-6 text-[#c8c6c4]" /><p className="mt-2">Select a system to see its declared permissions, tool access, and observation log.</p></div></div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">{selected.vendor} · {selected.model} {selected.version && `· v${selected.version}`}</div>
                  <h2 className="mt-0.5 text-[16px] font-semibold text-[#201f1e]">{selected.name}</h2>
                  <p className="mt-0.5 text-[12px] text-[#8a8886]">Owner: {selected.owner_display || 'Unspecified'} · Registered by {selected.created_by}</p>
                </div>
                {canDelete && <button type="button" onClick={() => void deleteSystem(selected.id)} className="rounded border border-[#a4262c]/30 p-1.5 text-[#a4262c] hover:bg-[#fdf2f2]" aria-label="Remove system"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
              {selected.purpose && <p className="text-[13px] leading-6 text-[#323130]">{selected.purpose}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><div className="text-[11px] uppercase tracking-wide text-[#605e5c]">Tool access</div><div className="mt-1.5 flex flex-wrap gap-1.5">{selected.tool_access.length ? selected.tool_access.map((t) => <span key={t} className="rounded border border-[#e1dfdd] bg-white px-1.5 py-0.5 text-[11px] text-[#323130]">{t}</span>) : <span className="text-[12px] text-[#8a8886]">None declared</span>}</div></div>
                <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><div className="text-[11px] uppercase tracking-wide text-[#605e5c]">Permissions</div><div className="mt-1.5 flex flex-wrap gap-1.5">{selected.permissions.length ? selected.permissions.map((p) => <span key={p} className="rounded border border-[#e1dfdd] bg-white px-1.5 py-0.5 text-[11px] text-[#323130]">{p}</span>) : <span className="text-[12px] text-[#8a8886]">None declared</span>}</div></div>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#605e5c]">Observation log ({observations.length})</h3>
                {canManage && (
                  <div className="mt-2 space-y-2 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
                    <div className="flex gap-2">
                      <select value={obsForm.observationType} onChange={(e) => setObsForm((f) => ({ ...f, observationType: e.target.value }))} className="h-8 rounded border border-[#c8c6c4] bg-white px-2 text-[12px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]">
                        {OBSERVATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input value={obsForm.summary} onChange={(e) => setObsForm((f) => ({ ...f, summary: e.target.value }))} placeholder="Summary" className="h-8 flex-1 rounded border border-[#c8c6c4] bg-white px-2 text-[12px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]" />
                    </div>
                    <textarea value={obsForm.detail} onChange={(e) => setObsForm((f) => ({ ...f, detail: e.target.value }))} placeholder="Detail (optional)" rows={2} className="w-full rounded border border-[#c8c6c4] bg-white px-2 py-1.5 text-[12px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]" />
                    <button type="button" onClick={() => void logObservation()} disabled={loggingObservation || !obsForm.summary.trim()} className="inline-flex h-8 items-center rounded bg-[#0f6cbd] px-3 text-[12px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50">{loggingObservation ? 'Logging…' : 'Log observation'}</button>
                  </div>
                )}
                <ul className="mt-2 max-h-64 space-y-1.5 overflow-auto pr-1">
                  {observations.map((obs) => (
                    <li key={obs.id} className="rounded-md border border-[#e1dfdd] bg-white p-3 text-[12px]">
                      <div className="flex items-center justify-between gap-2"><span className="font-medium capitalize text-[#201f1e]">{obs.observation_type.replace('_', ' ')}</span><span className="text-[11px] text-[#8a8886]">{new Date(obs.created_at).toLocaleString()}</span></div>
                      <p className="mt-1 text-[#323130]">{obs.summary}</p>
                      {obs.detail && <p className="mt-1 text-[#605e5c]">{obs.detail}</p>}
                      <p className="mt-1 text-[11px] text-[#8a8886]">Logged by {obs.observed_by}</p>
                    </li>
                  ))}
                  {observations.length === 0 && <p className="text-[12px] text-[#8a8886]">No observations logged for this system yet.</p>}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-2 rounded-md border border-[#f5dfa0] bg-[#fff4ce] p-3 text-[12px] leading-5 text-[#8a5700]">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        Capability boundary: registration and observations are manually entered by your team, not detected. There is no vendor risk-scoring feed, model-version-change monitoring, or automated tool-access audit behind this yet.
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><div className="text-[11px] text-[#605e5c]">{label}</div><div className="text-lg font-semibold text-[#201f1e]">{value}</div></div>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div><label className="mb-1 block text-[12px] font-medium text-[#323130]">{label}</label><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]" /></div>;
}
