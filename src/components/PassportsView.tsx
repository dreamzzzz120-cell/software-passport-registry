import React, { useMemo, useState } from 'react';
import { FileCheck2, Search } from 'lucide-react';
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
  role?: string;
}

export default function PassportsView({ passports, selectedPassportId, setSelectedPassportId, searchQuery, onNavigateTab, clients = [], assets = [], role = 'Viewer' }: PassportsViewProps) {
  // Matches backend gating exactly: POST /api/agent-jobs requires
  // Owner/Admin/Operator (scans.ts); POST /api/trust-loop/remediations
  // additionally allows Technician (server.ts requireTrustMutationRole).
  const canRunAudit = ['Owner', 'Admin', 'Operator'].includes(role);
  const canCreateRemediation = ['Owner', 'Admin', 'Operator', 'Technician'].includes(role);
  const [tab, setTab] = useState<'catalog' | 'lineage' | 'sectors'>('catalog');
  const [category, setCategory] = useState('all');
  const [localQuery, setLocalQuery] = useState('');
  const [auditText, setAuditText] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [remediationBusy, setRemediationBusy] = useState<string | null>(null);

  const selected = useMemo(() => passports.find((p) => p.id === selectedPassportId) ?? null, [passports, selectedPassportId]);
  const categories = useMemo(() => Array.from(new Set(passports.map((p) => p.category).filter(Boolean))), [passports]);
  const filtered = useMemo(() => passports.filter((p) => {
    const query = (localQuery || searchQuery).trim().toLowerCase();
    const text = `${p.name ?? ''} ${p.publisher ?? ''} ${p.category ?? ''}`.toLowerCase();
    return (!query || text.includes(query)) && (category === 'all' || p.category === category);
  }), [passports, searchQuery, localQuery, category]);
  const evidenceCount = passports.filter((passport) => passport.evidence?.length > 0).length;
  const findingCount = passports.reduce((total, passport) => total + (passport.vulnerabilities?.length || 0), 0);

  const runAudit = async () => {
    if (!selected) return;
    setAuditBusy(true); setAuditText(null);
    try {
      const response = await apiFetch('/api/agent-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passportId: selected.id, agentId: 'comprehensive_scanner', jobType: 'osv_manifest_scan' }) });
      const data = await response.json().catch(() => ({}));
      setAuditText(response.ok
        ? `Live audit queued successfully. Job ${data.id ?? 'created'} is being processed by the background scanner.`
        : data.error?.message || data.error || 'Not verified: audit request was rejected.');
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
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e]">Software passport catalog</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">Observed software identities, evidence, findings, lineage and server-backed trust workflows.</p>
        </div>
        <button
          onClick={() => void runAudit()}
          disabled={!canRunAudit || !selected || auditBusy}
          title={!canRunAudit ? `Your ${role} role cannot run audits.` : undefined}
          className="h-9 shrink-0 rounded bg-[#0f6cbd] px-4 text-[13px] font-semibold text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {auditBusy ? 'Auditing…' : 'Run live audit'}
        </button>
      </div>

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>The passport catalog holds observed software identities, evidence and findings. Missing evidence stays marked unverified rather than assumed safe.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Browse or search the catalog and open a row to see its evidence and findings.</li>
            <li>Run a live audit to queue a background scan for the selected passport (requires Owner, Admin or Operator).</li>
            <li>Create a persisted remediation from a finding to push it into the Trust Loop backend.</li>
          </ol>
        </div>
      </details>

      <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div><div className="text-[11px] text-[#605e5c]">Passport records</div><div className="text-lg font-semibold text-[#201f1e]">{passports.length}</div></div>
        <div><div className="text-[11px] text-[#605e5c]">With evidence</div><div className="text-lg font-semibold text-[#201f1e]">{evidenceCount}</div></div>
        <div><div className="text-[11px] text-[#605e5c]">Recorded findings</div><div className="text-lg font-semibold text-[#201f1e]">{findingCount}</div></div>
      </div>

      {auditText && <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[13px] leading-5 text-[#605e5c] whitespace-pre-wrap">{auditText}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {(['catalog', 'lineage', 'sectors'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`h-8 rounded border px-3 text-[13px] font-medium ${tab === item ? 'border-[#0f6cbd] bg-[#eff6fc] text-[#0f6cbd]' : 'border-[#c8c6c4] text-[#323130] hover:bg-black/[.03]'}`}
          >
            {item === 'catalog' ? 'Catalog' : item === 'lineage' ? 'Lineage' : 'Sectors'}
          </button>
        ))}
        {tab === 'catalog' && (
          <>
            <label className="flex h-9 min-w-56 items-center gap-2 rounded border border-[#c8c6c4] bg-white px-3 focus-within:border-[#0f6cbd] focus-within:ring-1 focus-within:ring-[#0f6cbd]">
              <Search className="h-3.5 w-3.5 text-[#8a8886]" />
              <input value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} placeholder="Search name, publisher, category" aria-label="Search passports" className="min-w-0 flex-1 bg-transparent text-[13px] text-[#201f1e] outline-none placeholder:text-[#8a8886]" />
            </label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]">
              <option value="all">All categories</option>
              {categories.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}
            </select>
          </>
        )}
      </div>

      {tab === 'lineage' ? <SoftwareLineageTracker passports={passports} clients={clients} assets={assets} /> : tab === 'sectors' ? <SoftwareSectorsPanel passports={passports} onFilterCategory={(value) => { setCategory(value); setTab('catalog'); }} onNavigateTab={onNavigateTab} setSelectedPassportId={setSelectedPassportId} /> : <>
        <div className="overflow-x-auto rounded-md border border-[#e1dfdd] bg-white">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-4 py-2.5 font-medium">Software</th>
                <th className="px-4 py-2.5 font-medium">Publisher</th>
                <th className="px-4 py-2.5 font-medium">Evidence</th>
                <th className="px-4 py-2.5 font-medium">Findings</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((passport) => {
                const hasEvidence = passport.evidence?.length > 0;
                return (
                  <tr
                    key={passport.id}
                    onClick={() => setSelectedPassportId(passport.id)}
                    className={`cursor-pointer border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02] ${selectedPassportId === passport.id ? 'bg-[#eff6fc]' : ''}`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#201f1e]">{passport.name || 'Unnamed software'}</div>
                      <div className="text-[11px] text-[#8a8886]">{passport.version || 'Version not observed'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-[#605e5c]">{passport.publisher || 'Publisher not observed'}</td>
                    <td className="px-4 py-2.5 text-[#605e5c]">{passport.evidence?.length || 0}</td>
                    <td className="px-4 py-2.5 text-[#605e5c]">{passport.vulnerabilities?.length || 0}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[13px]">
                        <span className={`h-1.5 w-1.5 rounded-full ${hasEvidence ? 'bg-[#0e700e]' : 'bg-[#8a5700]'}`} />
                        {hasEvidence ? 'Evidence present' : 'Not verified'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center">
                    <FileCheck2 className="mx-auto h-6 w-6 text-[#c8c6c4]" />
                    <p className="mt-2 text-[13px] font-medium text-[#323130]">No passport records match this view.</p>
                    <p className="mt-1 text-[12px] text-[#8a8886]">Adjust the search or category filter.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected && <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-[16px] font-semibold text-[#201f1e]">{selected.name}</h2>
              <p className="mt-1 text-[13px] text-[#605e5c]">{selected.version || 'Version not observed'} · {selected.publisher || 'Publisher not observed'}</p>
            </div>
            <div className="rounded border border-[#f5d7ac] bg-[#fff4ce] px-3 py-1.5 text-[12px] text-[#8a5700]">Overall score: {selected.overallScore == null ? 'Not verified' : String(selected.overallScore)}</div>
          </div>

          <div className="mt-4 flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
            <div><div className="text-[11px] text-[#605e5c]">Evidence</div><div className="text-lg font-semibold text-[#201f1e]">{selected.evidence?.length ?? 0}</div><div className="text-[11px] text-[#8a8886]">Recorded entries</div></div>
            <div><div className="text-[11px] text-[#605e5c]">Findings</div><div className="text-lg font-semibold text-[#201f1e]">{selected.vulnerabilities?.length ?? 0}</div><div className="text-[11px] text-[#8a8886]">Observed or reported findings</div></div>
            <div><div className="text-[11px] text-[#605e5c]">Score status</div><div className="text-[15px] font-semibold text-[#201f1e]">{selected.scoreStatus || 'Not verified'}</div><div className="text-[11px] text-[#8a8886]">Authoritative scoring required</div></div>
          </div>

          {selected.evidence?.length > 0 && <div className="mt-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-[#605e5c]">Evidence ledger snapshot</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {selected.evidence.map((item: any) => (
                <div key={String(item.id)} className="rounded-md border border-[#e1dfdd] p-3">
                  <div className="text-[13px] font-medium text-[#201f1e]">{String(item.name || item.type || 'Evidence item')}</div>
                  <div className="mt-1 text-[11px] text-[#605e5c]">Status: {String(item.status || 'Not verified')}</div>
                </div>
              ))}
            </div>
          </div>}

          {selected.vulnerabilities?.length > 0 && <div className="mt-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-[#605e5c]">Trust findings / remediation</div>
            <div className="space-y-2">
              {selected.vulnerabilities.map((v: any) => {
                const id = String(v.findingId ?? v.id ?? '');
                return (
                  <div key={id} className="rounded-md border border-[#e1dfdd] p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-[13px] font-medium text-[#201f1e]">{String(v.title || id)}</div>
                        <div className="mt-1 text-[11px] text-[#605e5c]">{String(v.status || 'Open')} · {String(v.severity || 'Unknown severity')}</div>
                      </div>
                      <button
                        onClick={() => void createRemediation(v)}
                        disabled={!canCreateRemediation || !id || remediationBusy === id}
                        title={!canCreateRemediation ? `Your ${role} role cannot create remediations.` : undefined}
                        className="h-8 shrink-0 rounded border border-[#c8c6c4] px-3 text-[12px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-50"
                      >
                        {remediationBusy === id ? 'Persisting…' : 'Create persisted remediation'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>}

          <div className="mt-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[12px] leading-5 text-[#605e5c]">This workflow never upgrades self-submitted data to VERIFIED. Durable evidence and remediation state must come from the Trust Loop backend.</div>
        </div>}
      </>}
    </section>
  );
}
