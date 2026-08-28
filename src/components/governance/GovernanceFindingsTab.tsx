import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, HelpCircle, Loader2, Search } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';
import GovernanceWhyModal from './GovernanceWhyModal';

type Finding = { id: string; controlId: string; title: string; severity: string; status: 'OPEN' | 'UNKNOWN' | 'RESOLVED'; evidenceIds: string[]; updatedAt: string; resolvedAt: string | null; passportId: string; passportName: string | null };
type Disposition = { id: string; findingId: string; disposition: string; ownerName: string | null; dueDate: string | null; businessImpact: string; technicalImpact: string; rationale: string; decidedBy: string; decidedAt: string };

const STATUS_STYLE: Record<string, string> = { OPEN: 'border-[#f14c4c]/40 text-[#f14c4c]', UNKNOWN: 'border-[#3c3c3c] text-[#9d9d9d]', RESOLVED: 'border-[#89d185]/40 text-[#89d185]' };

export default function GovernanceFindingsTab({ canDispose }: { canDispose: boolean }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [dispLoading, setDispLoading] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  const [form, setForm] = useState({ disposition: 'IN_PROGRESS', ownerName: '', dueDate: '', businessImpact: '', technicalImpact: '', rationale: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const load = async (params?: { status?: string; q?: string }) => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.q) qs.set('q', params.q);
      const r = await apiFetch(`/api/governance/findings${qs.toString() ? `?${qs}` : ''}`);
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'You are not authorized to view findings.' : 'Unable to load findings.');
      setFindings(await r.json());
    } catch (e: any) { setError(e?.message || 'Unable to load findings.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  // Server-side filtering (status/search) is real -- debounce the free-text
  // query slightly so every keystroke doesn't fire a request.
  useEffect(() => {
    const t = setTimeout(() => void load({ status: statusFilter || undefined, q: search.trim() || undefined }), 300);
    return () => clearTimeout(t);
  }, [search, statusFilter]);

  const selected = useMemo(() => findings.find((f) => f.id === selectedId) || null, [findings, selectedId]);
  useEffect(() => {
    if (!selected) return;
    setDispLoading(true); setSubmitError('');
    apiFetch(`/api/governance/findings/${encodeURIComponent(selected.id)}/dispositions`)
      .then((r) => r.ok ? r.json() : [])
      .then(setDispositions)
      .finally(() => setDispLoading(false));
  }, [selectedId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || submitting) return;
    setSubmitting(true); setSubmitError('');
    try {
      const r = await apiFetch(`/api/governance/findings/${encodeURIComponent(selected.id)}/dispositions`, { method: 'POST', body: JSON.stringify(form) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error === 'RATIONALE_REQUIRED_FOR_THIS_DISPOSITION' ? 'A rationale is required for an Accepted Risk or False Positive disposition.' : (data?.issues?.[0]?.message || data?.error || 'Unable to record this disposition.'));
      setDispositions((cur) => [data, ...cur]);
      setForm({ disposition: 'IN_PROGRESS', ownerName: '', dueDate: '', businessImpact: '', technicalImpact: '', rationale: '' });
    } catch (e: any) { setSubmitError(e?.message || 'Unable to record this disposition.'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel overflow-hidden">
        <div className="border-b border-[#3c3c3c] p-3 space-y-2">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f6f6f]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search findings…" className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] py-1.5 pl-8 pr-2 text-xs text-[#d4d4d4]" /></div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-1.5 text-xs text-[#d4d4d4]">
            <option value="">All statuses</option>
            {['OPEN', 'UNKNOWN', 'RESOLVED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {error && <div role="alert" className="m-3 rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2 text-xs text-[#f14c4c]">{error}</div>}
        <div className="max-h-[560px] divide-y divide-[#3c3c3c] overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-[#9d9d9d]">Loading…</div> : findings.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#9d9d9d]"><AlertTriangle className="mx-auto h-7 w-7 text-[#6f6f6f]" /><p className="mt-2 font-semibold text-[#d4d4d4]">No findings match this search/filter.</p></div>
          ) : findings.map((f) => (
            <button key={f.id} onClick={() => setSelectedId(f.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === f.id ? 'bg-[#094771]/45' : 'hover:bg-[#2d2d2d]'}`}>
              <span className="min-w-0"><span className="block truncate font-semibold text-[#d4d4d4]">{f.title}</span><span className="block text-xs text-[#6f6f6f]">{f.passportName || f.passportId} · {f.severity}</span></span>
              <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[f.status]}`}>{f.status}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selected ? <p className="py-16 text-center text-sm text-[#9d9d9d]">Select a finding to view details.</p> : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-sm font-bold text-[#d4d4d4]">{selected.title}</h2><p className="text-xs text-[#6f6f6f]">Control: {selected.controlId} · Evidence-derived status is fixed by the trust engine and never changed here.</p></div>
              <button onClick={() => setWhyOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-[#3c3c3c] px-2.5 py-1 text-xs font-semibold text-[#3794ff] hover:bg-[#2d2d2d]"><HelpCircle className="h-3.5 w-3.5" /> Why?</button>
            </div>
            <span className={`inline-block rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[selected.status]}`}>Evidence status: {selected.status}</span>

            <div className="border-t border-[#3c3c3c] pt-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#d4d4d4]">Governance dispositions</h3>
              <p className="mt-1 text-[10px] text-[#6f6f6f]">A human judgment layered on top of this finding -- it never overrides the evidence-derived status above.</p>
              {canDispose && (
                <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-md border border-[#3c3c3c] bg-[#181818] p-3">
                  {submitError && <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-2.5 py-2 text-xs text-[#f14c4c]">{submitError}</div>}
                  <select value={form.disposition} onChange={(e) => setForm((c) => ({ ...c, disposition: e.target.value }))} className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-2.5 py-1.5 text-xs text-[#d4d4d4]">{['IN_PROGRESS', 'MITIGATED', 'ACCEPTED_RISK', 'FALSE_POSITIVE', 'NEEDS_REVIEW'].map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}</select>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={form.ownerName} onChange={(e) => setForm((c) => ({ ...c, ownerName: e.target.value }))} placeholder="Owner" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-2.5 py-1.5 text-xs text-[#d4d4d4]" />
                    <input type="date" value={form.dueDate} onChange={(e) => setForm((c) => ({ ...c, dueDate: e.target.value }))} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-2.5 py-1.5 text-xs text-[#d4d4d4]" />
                  </div>
                  <textarea value={form.rationale} onChange={(e) => setForm((c) => ({ ...c, rationale: e.target.value }))} placeholder={(form.disposition === 'ACCEPTED_RISK' || form.disposition === 'FALSE_POSITIVE') ? 'Rationale * (required for this disposition)' : 'Rationale'} rows={2} className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-2.5 py-1.5 text-xs text-[#d4d4d4]" />
                  <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-md bg-[#0e639c] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1177bb] disabled:opacity-40">{submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Record disposition</button>
                </form>
              )}
              <div className="mt-3 space-y-2">
                {dispLoading ? <p className="text-xs text-[#9d9d9d]">Loading…</p> : dispositions.length === 0 ? <p className="text-xs italic text-[#6f6f6f]">No governance disposition has been recorded for this finding yet.</p> : dispositions.map((d) => (
                  <div key={d.id} className="rounded-md border border-[#3c3c3c] bg-[#181818] p-2.5 text-xs">
                    <div className="flex items-center justify-between"><span className="font-semibold text-[#d4d4d4]">{d.disposition.replace(/_/g, ' ')}</span><span className="text-[#6f6f6f]">{new Date(d.decidedAt).toLocaleDateString()}</span></div>
                    <p className="mt-1 text-[#9d9d9d]">By {d.decidedBy}{d.ownerName ? ` · Owner: ${d.ownerName}` : ''}</p>
                    {d.rationale && <p className="mt-1 text-[#d4d4d4]">{d.rationale}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {whyOpen && selected && <GovernanceWhyModal kind="finding" id={selected.id} onClose={() => setWhyOpen(false)} />}
    </div>
  );
}
