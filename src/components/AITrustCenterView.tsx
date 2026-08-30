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

const STATUS_STYLES: Record<AiSystem['status'], string> = {
  active: 'border-[var(--spr-green)]/30 bg-[var(--spr-green)]/10 text-[var(--spr-green)]',
  under_review: 'border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/10 text-[var(--spr-amber)]',
  deprecated: 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)] text-[var(--spr-text-muted)]',
  blocked: 'border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 text-[var(--spr-red)]',
};
const CLASSIFICATION_STYLES: Record<AiSystem['data_classification'], string> = {
  unclassified: 'text-[var(--spr-text-muted)]', internal: 'text-[var(--spr-highlight)]', confidential: 'text-[var(--spr-amber)]', regulated: 'text-[var(--spr-red)]',
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
    <section className="space-y-6" aria-labelledby="ai-trust-title">
      <header className="spr-panel p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-highlight)]"><Bot className="h-4 w-4" /> AI Trust Center</div>
            <h1 id="ai-trust-title" className="mt-2 text-3xl font-semibold tracking-tight">Your AI systems, declared and tracked</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">This is a self-reported registry. SPR has no mechanism to auto-discover AI agents or model usage — every field here is what your team declared, not an independently observed fact.</p>
          </div>
          {canManage && <button onClick={() => setShowForm((open) => !open)} className="inline-flex items-center gap-2 spr-btn spr-btn-primary"><Plus size={16} /> Register AI system</button>}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <Metric label="Registered" value={summary.total} />
          <Metric label="Active" value={summary.active} />
          <Metric label="Confidential/regulated data" value={summary.regulated} />
          <Metric label="Under review" value={summary.underReview} />
        </div>
      </header>

      {error && <p role="alert" className="rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 px-4 py-3 text-sm text-[var(--spr-red)]">{error}</p>}

      {showForm && (
        <div className="rounded-md border border-[var(--spr-accent)] bg-[var(--spr-accent-soft)] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--spr-text)]">Register a new AI system</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <Field label="Vendor *" value={form.vendor} onChange={(v) => setForm((f) => ({ ...f, vendor: v }))} />
            <Field label="Model *" value={form.model} onChange={(v) => setForm((f) => ({ ...f, model: v }))} placeholder="e.g. gpt-4o, claude-sonnet-5" />
            <Field label="Version" value={form.version} onChange={(v) => setForm((f) => ({ ...f, version: v }))} />
            <Field label="Owner" value={form.ownerDisplay} onChange={(v) => setForm((f) => ({ ...f, ownerDisplay: v }))} placeholder="Team or person accountable" />
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--spr-text)]">Data classification</label>
              <select value={form.dataClassification} onChange={(e) => setForm((f) => ({ ...f, dataClassification: e.target.value }))} className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]">
                {(['unclassified', 'internal', 'confidential', 'regulated'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--spr-text)]">Status</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]">
                {(['active', 'under_review', 'deprecated', 'blocked'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <Field label="Tool access (comma-separated)" value={form.toolAccess} onChange={(v) => setForm((f) => ({ ...f, toolAccess: v }))} placeholder="repo-read, ticket-create" />
            <Field label="Permissions (comma-separated)" value={form.permissions} onChange={(v) => setForm((f) => ({ ...f, permissions: v }))} placeholder="read-only, no-pii" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--spr-text)]">Purpose</label>
            <textarea value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} rows={2} className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]" />
          </div>
          <button onClick={() => void createSystem()} disabled={creating || !form.name.trim() || !form.vendor.trim() || !form.model.trim()} className="spr-btn spr-btn-primary disabled:opacity-40">{creating ? 'Registering…' : 'Register'}</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="spr-panel p-5">
          <h2 className="text-sm font-semibold text-[var(--spr-text)]">Registered systems ({systems.length})</h2>
          {loading && <p className="mt-4 text-xs text-[var(--spr-text-muted)]">Loading…</p>}
          {!loading && systems.length === 0 && <p className="mt-4 text-xs text-[var(--spr-text-muted)]">No AI systems registered yet.</p>}
          <ul className="mt-4 space-y-2 max-h-[560px] overflow-auto pr-1">
            {systems.map((system) => (
              <li key={system.id}>
                <button onClick={() => setSelectedId(system.id)} className={`w-full rounded-md border px-3 py-3 text-left text-xs transition ${selectedId === system.id ? 'border-[var(--spr-highlight)]/50 bg-[var(--spr-accent-soft)] text-[var(--spr-text)]' : 'border-[var(--spr-border)] bg-[var(--spr-surface-deep)] text-[var(--spr-text)] hover:border-[var(--spr-accent)]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{system.name}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--spr-text-faint)]" />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                    <span className={`rounded-full border px-2 py-0.5 font-semibold ${STATUS_STYLES[system.status]}`}>{system.status}</span>
                    <span className={`font-semibold uppercase ${CLASSIFICATION_STYLES[system.data_classification]}`}>{system.data_classification}</span>
                    <span className="text-[var(--spr-text-muted)]">{system.vendor} · {system.model}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="spr-panel p-5">
          {!selected ? (
            <div className="grid h-full min-h-[300px] place-items-center text-center text-sm text-[var(--spr-text-muted)]"><div><Shield className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]" /><p className="mt-3">Select a system to see its declared permissions, tool access, and observation log.</p></div></div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-text-faint)]">{selected.vendor} · {selected.model} {selected.version && `· v${selected.version}`}</div>
                  <h2 className="mt-1 text-lg font-semibold text-[var(--spr-text)]">{selected.name}</h2>
                  <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Owner: {selected.owner_display || 'Unspecified'} · Registered by {selected.created_by}</p>
                </div>
                {canDelete && <button onClick={() => void deleteSystem(selected.id)} className="rounded-lg border border-[var(--spr-red)]/30 p-2 text-[var(--spr-red)] hover:bg-[var(--spr-red)]/10" aria-label="Remove system"><Trash2 className="h-4 w-4" /></button>}
              </div>
              {selected.purpose && <p className="text-sm leading-6 text-[var(--spr-text)]">{selected.purpose}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--spr-text-faint)]">Tool access</div><div className="mt-2 flex flex-wrap gap-1.5">{selected.tool_access.length ? selected.tool_access.map((t) => <span key={t} className="rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-0.5 text-[10px] text-[var(--spr-text)]">{t}</span>) : <span className="text-xs text-[var(--spr-text-faint)]">None declared</span>}</div></div>
                <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--spr-text-faint)]">Permissions</div><div className="mt-2 flex flex-wrap gap-1.5">{selected.permissions.length ? selected.permissions.map((p) => <span key={p} className="rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-0.5 text-[10px] text-[var(--spr-text)]">{p}</span>) : <span className="text-xs text-[var(--spr-text-faint)]">None declared</span>}</div></div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--spr-text-muted)]">Observation log ({observations.length})</h3>
                {canManage && (
                  <div className="mt-3 space-y-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3">
                    <div className="flex gap-2">
                      <select value={obsForm.observationType} onChange={(e) => setObsForm((f) => ({ ...f, observationType: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]">
                        {OBSERVATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input value={obsForm.summary} onChange={(e) => setObsForm((f) => ({ ...f, summary: e.target.value }))} placeholder="Summary" className="flex-1 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]" />
                    </div>
                    <textarea value={obsForm.detail} onChange={(e) => setObsForm((f) => ({ ...f, detail: e.target.value }))} placeholder="Detail (optional)" rows={2} className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]" />
                    <button onClick={() => void logObservation()} disabled={loggingObservation || !obsForm.summary.trim()} className="spr-btn spr-btn-primary !text-xs disabled:opacity-40">{loggingObservation ? 'Logging…' : 'Log observation'}</button>
                  </div>
                )}
                <ul className="mt-3 space-y-2 max-h-64 overflow-auto pr-1">
                  {observations.map((obs) => (
                    <li key={obs.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3 text-xs">
                      <div className="flex items-center justify-between gap-2"><span className="font-semibold text-[var(--spr-text)] capitalize">{obs.observation_type.replace('_', ' ')}</span><span className="text-[var(--spr-text-muted)]">{new Date(obs.created_at).toLocaleString()}</span></div>
                      <p className="mt-1 text-[var(--spr-text)]">{obs.summary}</p>
                      {obs.detail && <p className="mt-1 text-[var(--spr-text-muted)]">{obs.detail}</p>}
                      <p className="mt-1 text-[10px] text-[var(--spr-text-faint)]">Logged by {obs.observed_by}</p>
                    </li>
                  ))}
                  {observations.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">No observations logged for this system yet.</p>}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md border border-[var(--spr-amber)]/25 bg-[var(--spr-amber)]/10 p-4 text-xs leading-5 text-[var(--spr-amber)]/75 flex gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Capability boundary: registration and observations are manually entered by your team, not detected. There is no vendor risk-scoring feed, model-version-change monitoring, or automated tool-access audit behind this yet.
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">{label}</div><div className="mt-2 text-2xl font-semibold text-[var(--spr-text)]">{value}</div></div>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div><label className="mb-1 block text-xs font-semibold text-[var(--spr-text)]">{label}</label><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]" /></div>;
}
