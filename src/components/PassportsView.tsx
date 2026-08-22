import React, { useMemo, useState } from 'react';
import { apiFetch } from '../utils/apiClient';
import SoftwareLineageTracker from './SoftwareLineageTracker';
import SoftwareSectorsPanel from './SoftwareSectorsPanel';
import type { Client, SoftwarePassport } from '../types';

interface PassportsViewProps {
  passports: SoftwarePassport[];
  selectedPassportId: string | null;
  setSelectedPassportId: (id: string | null) => void;
  searchQuery: string;
  onUpdatePassport?: (updatedPassport: SoftwarePassport) => void;
  onNavigateTab?: (tab: string, itemId?: string) => void;
  clients?: Client[];
  assets?: any[];
}

export default function PassportsView({ passports, selectedPassportId, setSelectedPassportId, searchQuery, onNavigateTab, clients = [], assets = [] }: PassportsViewProps) {
  const [tab, setTab] = useState<'catalog' | 'lineage' | 'sectors'>('catalog');
  const [category, setCategory] = useState('all');
  const [auditText, setAuditText] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [remediationBusy, setRemediationBusy] = useState<string | null>(null);

  const selected = useMemo(() => passports.find((p) => p.id === selectedPassportId) ?? null, [passports, selectedPassportId]);
  const categories = useMemo(() => Array.from(new Set(passports.map((p) => p.category).filter(Boolean))), [passports]);
  const filtered = useMemo(() => passports.filter((p) => {
    const query = searchQuery.trim().toLowerCase();
    const text = `${p.name ?? ''} ${p.publisher ?? ''} ${p.category ?? ''}`.toLowerCase();
    return (!query || text.includes(query)) && (category === 'all' || p.category === category);
  }), [passports, searchQuery, category]);

  const runAudit = async () => {
    if (!selected) return;
    setAuditBusy(true); setAuditText(null);
    try {
      const response = await apiFetch('/api/ai/analyze-passport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passportId: selected.id }) });
      const data = await response.json().catch(() => ({}));
      setAuditText(data.analysis || data.error || 'Not verified.');
    } catch {
      setAuditText('Not verified: audit request failed.');
    } finally { setAuditBusy(false); }
  };

  const createRemediation = async (vulnerability: any) => {
    if (!selected) return;
    const findingId = String(vulnerability.findingId ?? vulnerability.id ?? '');
    if (!findingId) return;
    setRemediationBusy(findingId);
    try {
      const response = await apiFetch('/api/trust-loop/remediations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findingId,
          title: `Remediation: ${String(vulnerability.title || findingId)}`,
          description: String(vulnerability.remediation || vulnerability.description || 'Remediation requested from the Passport workflow.'),
          priority: String(vulnerability.severity || 'HIGH').toUpperCase(),
        }),
      });
      if (!response.ok) {
        setAuditText('Remediation was not persisted: the vulnerability does not map to a server-side trust finding.');
      } else {
        setAuditText('Remediation persisted to the Trust Loop. Refresh the Passport to read the server-backed state.');
      }
    } catch {
      setAuditText('Not verified: remediation persistence request failed.');
    } finally { setRemediationBusy(null); }
  };

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-white/10 bg-white/[.035] p-6 backdrop-blur-2xl text-white">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div><div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">Evidence-first registry</div><h1 className="mt-2 text-2xl font-semibold">Software Passport Catalog</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Observed passport records, evidence, findings, lineage and server-backed trust workflows. Missing evidence is shown as unverified.</p></div>
          <button onClick={() => void runAudit()} disabled={!selected || auditBusy} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{auditBusy ? 'Auditing…' : 'Run live audit'}</button>
        </div>
        {auditText && <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-black/20 p-4 text-sm leading-6 text-slate-300 whitespace-pre-wrap">{auditText}</div>}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {(['catalog', 'lineage', 'sectors'] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${tab === item ? 'border-cyan-300/25 bg-cyan-300/10 text-cyan-200' : 'border-white/10 bg-white/[.025] text-slate-400'}`}>{item === 'catalog' ? 'Catalog' : item === 'lineage' ? 'Lineage' : 'Sectors'}</button>)}
        {tab === 'catalog' && <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-300"><option value="all">All categories</option>{categories.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select>}
      </div>

      {tab === 'lineage' ? <SoftwareLineageTracker passports={passports} clients={clients} assets={assets} /> : tab === 'sectors' ? <SoftwareSectorsPanel passports={passports} onFilterCategory={(value) => { setCategory(value); setTab('catalog'); }} onNavigateTab={onNavigateTab} setSelectedPassportId={setSelectedPassportId} /> : <>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((passport) => <button key={passport.id} onClick={() => setSelectedPassportId(passport.id)} className={`rounded-2xl border p-5 text-left transition ${selectedPassportId === passport.id ? 'border-cyan-300/30 bg-cyan-300/[.06]' : 'border-white/10 bg-white/[.025] hover:bg-white/[.045]'}`}><div className="text-sm font-semibold text-white">{passport.name || 'Unnamed software'}</div><div className="mt-1 text-xs text-slate-500">{passport.version || 'Version not observed'} · {passport.publisher || 'Publisher not observed'}</div><div className="mt-4 flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-[.18em] text-slate-600">Trust status</span><span className="text-xs text-slate-300">{passport.overallScore == null ? 'Not verified' : String(passport.overallScore)}</span></div></button>)}
        </div>

        {selected && <div className="rounded-3xl border border-white/10 bg-white/[.035] p-6 text-white">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><h2 className="text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-sm text-slate-400">{selected.version || 'Version not observed'} · {selected.publisher || 'Publisher not observed'}</p></div><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.05] px-3 py-2 text-xs text-amber-200">Overall score: {selected.overallScore == null ? 'Not verified' : String(selected.overallScore)}</div></div>
          <div className="mt-6 grid gap-4 md:grid-cols-3"><div className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-[10px] uppercase tracking-[.18em] text-slate-600">Evidence</div><div className="mt-2 text-2xl font-semibold">{selected.evidence?.length ?? 0}</div><div className="mt-1 text-xs text-slate-500">Recorded entries</div></div><div className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-[10px] uppercase tracking-[.18em] text-slate-600">Findings</div><div className="mt-2 text-2xl font-semibold">{selected.vulnerabilities?.length ?? 0}</div><div className="mt-1 text-xs text-slate-500">Observed or reported findings</div></div><div className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-[10px] uppercase tracking-[.18em] text-slate-600">Score status</div><div className="mt-2 text-lg font-semibold">{selected.scoreStatus || 'Not verified'}</div><div className="mt-1 text-xs text-slate-500">Authoritative scoring required</div></div></div>

          {selected.evidence?.length > 0 && <div className="mt-6"><div className="mb-3 text-[10px] uppercase tracking-[.18em] text-slate-600">Evidence ledger snapshot</div><div className="grid gap-3 md:grid-cols-2">{selected.evidence.map((item: any) => <div key={String(item.id)} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-sm font-semibold text-slate-200">{String(item.name || item.type || 'Evidence item')}</div><div className="mt-1 text-xs text-slate-500">Status: {String(item.status || 'Not verified')}</div></div>)}</div></div>}

          {selected.vulnerabilities?.length > 0 && <div className="mt-6"><div className="mb-3 text-[10px] uppercase tracking-[.18em] text-slate-600">Trust findings / remediation</div><div className="space-y-2">{selected.vulnerabilities.map((v: any) => { const id = String(v.findingId ?? v.id ?? ''); return <div key={id} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="text-sm font-semibold text-slate-200">{String(v.title || id)}</div><div className="mt-1 text-xs text-slate-500">{String(v.status || 'Open')} · {String(v.severity || 'Unknown severity')}</div></div><button onClick={() => void createRemediation(v)} disabled={!id || remediationBusy === id} className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-50">{remediationBusy === id ? 'Persisting…' : 'Create persisted remediation'}</button></div></div>; })}</div></div>}

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-slate-400">This workflow never upgrades self-submitted data to VERIFIED. Durable evidence and remediation state must come from the Trust Loop backend.</div>
        </div>}
      </>}
    </section>
  );
}
