import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { HelpCircle, Loader2, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';
import GovernanceWhyModal from './GovernanceWhyModal';

type Control = {
  id: string; controlKey: string; name: string; objective: string; description: string; ownerName: string; frequency: string;
  implementationStatus: 'NOT_IMPLEMENTED' | 'IMPLEMENTED' | 'TESTING' | 'VERIFIED' | 'FAILED' | 'NEEDS_REVIEW' | 'NOT_APPLICABLE';
  evidenceRequirements: string; testingMethod: string; lastTestedAt: string | null; nextTestDueAt: string | null;
  relatedPolicyIds: string[]; relatedRiskIds: string[]; createdAt: string; updatedAt: string;
};
type ControlTest = { id: string; controlId: string; testerName: string; testedAt: string; methodology: string; expectedResult: string; actualResult: string; evidenceIds: string[]; notes: string; result: string };

const STATUS_STYLE: Record<string, string> = {
  NOT_IMPLEMENTED: 'text-[var(--spr-text-muted)] border-[var(--spr-border)]', IMPLEMENTED: 'text-[var(--spr-highlight)] border-[var(--spr-highlight)]/40',
  TESTING: 'text-[var(--spr-amber)] border-[var(--spr-amber)]/40', VERIFIED: 'text-[var(--spr-green)] border-[var(--spr-green)]/40',
  FAILED: 'text-[var(--spr-red)] border-[var(--spr-red)]/40', NEEDS_REVIEW: 'text-[var(--spr-amber)] border-[var(--spr-amber)]/40', NOT_APPLICABLE: 'text-[var(--spr-text-faint)] border-[var(--spr-border)]',
};

export default function GovernanceControlsTab({ canWrite, canTest, onNavigatePolicy, selectIdOnLoad }: { canWrite: boolean; canTest: boolean; onNavigatePolicy: (id: string) => void; selectIdOnLoad?: string | null }) {
  const [controls, setControls] = useState<Control[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tests, setTests] = useState<ControlTest[]>([]);
  const [testsLoading, setTestsLoading] = useState(false);
  const [whyOpenFor, setWhyOpenFor] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ controlKey: '', name: '', objective: '', ownerName: '', frequency: '', evidenceRequirements: '', testingMethod: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editForm, setEditForm] = useState<Partial<Control>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [testForm, setTestForm] = useState({ testerName: '', methodology: '', expectedResult: '', actualResult: '', evidenceIds: '', notes: '', result: 'UNKNOWN' });
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await apiFetch('/api/governance/controls');
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You are not authorized to view controls.' : 'Unable to load controls.');
      setControls(await r.json());
    } catch (e: any) { setError(e?.message || 'Unable to load controls.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (selectIdOnLoad && controls.some((c) => c.id === selectIdOnLoad)) setSelectedId(selectIdOnLoad); }, [selectIdOnLoad, controls]);

  const selected = controls.find((c) => c.id === selectedId) || null;
  useEffect(() => {
    if (!selected) return;
    setEditForm(selected); setSaveError(''); setTestError('');
    setTestsLoading(true);
    apiFetch(`/api/governance/controls/${encodeURIComponent(selected.id)}/tests`)
      .then((r) => r.ok ? r.json() : [])
      .then(setTests)
      .finally(() => setTestsLoading(false));
  }, [selectedId]);

  const filtered = useMemo(() => controls.filter((c) =>
    (!statusFilter || c.implementationStatus === statusFilter) &&
    (!search.trim() || c.name.toLowerCase().includes(search.toLowerCase()) || c.controlKey.toLowerCase().includes(search.toLowerCase()) || c.ownerName.toLowerCase().includes(search.toLowerCase()))
  ), [controls, search, statusFilter]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.controlKey.trim() || !form.name.trim() || creating) return;
    setCreating(true); setCreateError('');
    try {
      const r = await apiFetch('/api/governance/controls', { method: 'POST', body: JSON.stringify(form) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error === 'CONTROL_KEY_ALREADY_EXISTS' ? 'A control with this key already exists.' : (data?.issues?.[0]?.message || data?.error || 'Unable to create this control.'));
      setShowCreate(false); setForm({ controlKey: '', name: '', objective: '', ownerName: '', frequency: '', evidenceRequirements: '', testingMethod: '' });
      await load(); setSelectedId(data.id);
    } catch (e: any) { setCreateError(e?.message || 'Unable to create this control.'); }
    finally { setCreating(false); }
  };

  const handleSave = async () => {
    if (!selected || saving) return;
    setSaving(true); setSaveError('');
    try {
      const r = await apiFetch(`/api/governance/controls/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editForm.name, objective: editForm.objective, description: editForm.description, ownerName: editForm.ownerName, frequency: editForm.frequency, implementationStatus: editForm.implementationStatus, evidenceRequirements: editForm.evidenceRequirements, testingMethod: editForm.testingMethod }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.issues?.[0]?.message || data?.error || 'Unable to save this control.');
      setControls((cur) => cur.map((c) => c.id === data.id ? data : c));
    } catch (e: any) { setSaveError(e?.message || 'Unable to save this control.'); }
    finally { setSaving(false); }
  };

  const handleRunTest = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !testForm.testerName.trim() || testing) return;
    setTesting(true); setTestError('');
    try {
      const evidenceIds = testForm.evidenceIds.split(',').map((s) => s.trim()).filter(Boolean);
      const r = await apiFetch(`/api/governance/controls/${encodeURIComponent(selected.id)}/tests`, { method: 'POST', body: JSON.stringify({ ...testForm, evidenceIds }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error === 'PASS_REQUIRES_EVIDENCE' ? 'A PASS result requires at least one evidence ID -- SPR will not record a passing test with no supporting evidence.' : (data?.issues?.[0]?.message || data?.error || 'Unable to record this test.'));
      setTests((cur) => [data, ...cur]);
      setTestForm({ testerName: '', methodology: '', expectedResult: '', actualResult: '', evidenceIds: '', notes: '', result: 'UNKNOWN' });
      await load();
    } catch (e: any) { setTestError(e?.message || 'Unable to record this test.'); }
    finally { setTesting(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel overflow-hidden">
        <div className="border-b border-[var(--spr-border)] p-3 space-y-2">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--spr-text-faint)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search controls…" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] py-1.5 pl-8 pr-2 text-xs text-[var(--spr-text)]" /></div>
          <div className="flex items-center justify-between gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]">
              <option value="">All statuses</option>
              {Object.keys(STATUS_STYLE).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            {canWrite && <button onClick={() => setShowCreate(true)} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 !text-xs"><Plus className="h-3.5 w-3.5" /> New</button>}
          </div>
        </div>
        {error && <div role="alert" className="m-3 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</div>}
        <div className="max-h-[560px] divide-y divide-[var(--spr-border)] overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-[var(--spr-text-muted)]">Loading…</div> : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--spr-text-muted)]"><ShieldCheck className="mx-auto h-7 w-7 text-[var(--spr-text-faint)]" /><p className="mt-2 font-semibold text-[var(--spr-text)]">{controls.length === 0 ? 'No controls exist yet.' : 'No controls match this search/filter.'}</p></div>
          ) : filtered.map((c) => (
            <button key={c.id} onClick={() => setSelectedId(c.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === c.id ? 'bg-[var(--spr-accent-soft)]/45' : 'hover:bg-[var(--spr-surface-sunken)]'}`}>
              <span className="min-w-0"><span className="block truncate font-semibold text-[var(--spr-text)]">{c.name}</span><span className="block text-xs text-[var(--spr-text-faint)]">{c.ownerName || 'No owner set'}</span></span>
              <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[c.implementationStatus]}`}>{c.implementationStatus.replace('_', ' ')}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[var(--spr-text-muted)]">Select a control to view details.</p> : (
          <div className="space-y-4">
            {saveError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2.5 text-xs text-[var(--spr-red)]">{saveError}</div>}
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-sm font-bold text-[var(--spr-text)]">{selected.name}</h2><p className="text-xs text-[var(--spr-text-faint)]">Key: {selected.controlKey}</p></div>
              <button onClick={() => setWhyOpenFor(selected.id)} className="inline-flex items-center gap-1 rounded-md border border-[var(--spr-border)] px-2.5 py-1 text-xs font-semibold text-[var(--spr-highlight)] hover:bg-[var(--spr-surface-sunken)]"><HelpCircle className="h-3.5 w-3.5" /> Why?</button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Name<input disabled={!canWrite} value={editForm.name ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, name: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Owner<input disabled={!canWrite} value={editForm.ownerName ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, ownerName: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Implementation status<select disabled={!canWrite} value={editForm.implementationStatus ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, implementationStatus: e.target.value as Control['implementationStatus'] }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60">{Object.keys(STATUS_STYLE).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Test frequency<input disabled={!canWrite} value={editForm.frequency ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, frequency: e.target.value }))} placeholder="e.g. Quarterly" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
            </div>
            <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Objective<textarea disabled={!canWrite} value={editForm.objective ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, objective: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>
            <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Evidence requirements<textarea disabled={!canWrite} value={editForm.evidenceRequirements ?? ''} onChange={(e) => setEditForm((c) => ({ ...c, evidenceRequirements: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)] disabled:opacity-60" /></label>

            {selected.relatedPolicyIds.length > 0 && (
              <div><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Related policies</div><div className="mt-1 flex flex-wrap gap-1.5">{selected.relatedPolicyIds.map((id) => <button key={id} onClick={() => onNavigatePolicy(id)} className="rounded-sm border border-[var(--spr-border)] px-2 py-0.5 text-[10px] text-[var(--spr-highlight)] hover:underline">{id}</button>)}</div></div>
            )}

            {canWrite && <button onClick={() => void handleSave()} disabled={saving} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 !text-xs disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save changes</button>}

            <div className="border-t border-[var(--spr-border)] pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text)]">Control tests</h3>
              {canTest && (
                <form onSubmit={handleRunTest} className="mt-2 space-y-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3">
                  {testError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-2.5 py-2 text-xs text-[var(--spr-red)]">{testError}</div>}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input required value={testForm.testerName} onChange={(e) => setTestForm((c) => ({ ...c, testerName: e.target.value }))} placeholder="Tester name *" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)]" />
                    <select value={testForm.result} onChange={(e) => setTestForm((c) => ({ ...c, result: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)]">{['PASS', 'FAIL', 'PARTIAL', 'UNKNOWN', 'NEEDS_REVIEW'].map((r) => <option key={r} value={r}>{r}</option>)}</select>
                  </div>
                  <input value={testForm.methodology} onChange={(e) => setTestForm((c) => ({ ...c, methodology: e.target.value }))} placeholder="Methodology" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)]" />
                  <input value={testForm.evidenceIds} onChange={(e) => setTestForm((c) => ({ ...c, evidenceIds: e.target.value }))} placeholder="Evidence IDs (comma-separated) -- required for a PASS result" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs text-[var(--spr-text)]" />
                  <button type="submit" disabled={!testForm.testerName.trim() || testing} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Record test</button>
                </form>
              )}
              <div className="mt-3 space-y-2">
                {testsLoading ? <p className="text-xs text-[var(--spr-text-muted)]">Loading tests…</p> : tests.length === 0 ? <p className="text-xs italic text-[var(--spr-text-faint)]">No tests recorded yet.</p> : tests.map((t) => (
                  <div key={t.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-2.5 text-xs">
                    <div className="flex items-center justify-between"><span className="font-semibold text-[var(--spr-text)]">{t.testerName}</span><span className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold ${t.result === 'PASS' ? 'border-[var(--spr-green)]/40 text-[var(--spr-green)]' : t.result === 'FAIL' ? 'border-[var(--spr-red)]/40 text-[var(--spr-red)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{t.result}</span></div>
                    <p className="mt-1 text-[var(--spr-text-faint)]">{new Date(t.testedAt).toLocaleString()} · {t.evidenceIds.length} evidence item{t.evidenceIds.length === 1 ? '' : 's'}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[var(--spr-text)]">New control</h2><button onClick={() => setShowCreate(false)} aria-label="Close" className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleCreate} className="mt-5 space-y-3">
              {createError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{createError}</div>}
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Control key * (unique)<input required value={form.controlKey} onChange={(e) => setForm((c) => ({ ...c, controlKey: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Name *<input required value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Objective<textarea value={form.objective} onChange={(e) => setForm((c) => ({ ...c, objective: e.target.value }))} rows={2} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <label className="flex flex-col gap-1 text-[10px] font-bold text-[var(--spr-text-muted)]">Owner<input value={form.ownerName} onChange={(e) => setForm((c) => ({ ...c, ownerName: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
                <button type="submit" disabled={creating || !form.controlKey.trim() || !form.name.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{creating ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {whyOpenFor && <GovernanceWhyModal kind="control" id={whyOpenFor} onClose={() => setWhyOpenFor(null)} />}
    </div>
  );
}
