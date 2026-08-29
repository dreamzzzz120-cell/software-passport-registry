import React, { useMemo, useState } from 'react';
import { CheckCircle2, FileCheck2, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import SoftwareLineageTracker from './SoftwareLineageTracker';
import SoftwareSectorsPanel from './SoftwareSectorsPanel';
import TrustField from './trust/TrustField';
import { trustStateFromVerification } from './trust/TrustStateBadge';
import type { Client, SoftwarePassport, VerificationStatus } from '../types';

// A score is never shown without its verification state -- unverified means
// no evidence was ever resolved (not a trust score of 0), partial means some
// evidence exists but not enough to call the conclusion settled, verified
// means enough evidence was resolved to trust the number as-is.
function verificationBadge(status: VerificationStatus): { label: string; className: string; textClassName: string } {
  if (status === 'verified') return { label: 'Verified', className: 'border-[#3c3c3c] bg-[#2d2d2d] text-[#89d185]', textClassName: 'text-[#89d185]' };
  if (status === 'partial') return { label: 'Partially Verified', className: 'border-[#3c3c3c] bg-[#2d2d2d] text-[#cca700]', textClassName: 'text-[#cca700]' };
  return { label: 'Unverified', className: 'border-[#3c3c3c] bg-[#2d2d2d] text-[#9d9d9d]', textClassName: 'text-[#9d9d9d]' };
}

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

export default function PassportsView({ passports, selectedPassportId, setSelectedPassportId, searchQuery, onNavigateTab, onUpdatePassport, clients = [], assets = [], role = 'Viewer' }: PassportsViewProps) {
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
    <section className="space-y-6">
      <header className="spr-panel p-6 md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[#cca700]"><ShieldCheck className="h-4 w-4" /> Evidence-first registry</div><h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#d4d4d4]">Software passport catalog</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#9d9d9d]">Observed software identities, evidence, findings, lineage and server-backed trust workflows. Missing evidence stays unverified.</p></div>
          <button onClick={() => void runAudit()} disabled={!canRunAudit || !selected || auditBusy} title={!canRunAudit ? `Your ${role} role cannot run audits.` : undefined} className="spr-btn spr-btn-primary disabled:cursor-not-allowed disabled:opacity-50">{auditBusy ? 'Auditing…' : 'Run live audit'}</button>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3"><PassportMetric icon={<FileCheck2 />} label="Passport records" value={passports.length} /><PassportMetric icon={<CheckCircle2 />} label="With evidence" value={evidenceCount} /><PassportMetric icon={<TriangleAlert />} label="Recorded findings" value={findingCount} /></div>
        {auditText && <div className="mt-5 spr-panel-alt p-4 text-sm leading-6 text-[#d4d4d4] whitespace-pre-wrap">{auditText}</div>}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {(['catalog', 'lineage', 'sectors'] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md border px-3 py-2 text-xs font-semibold ${tab === item ? 'border-[#3c3c3c] bg-[#094771] text-white' : 'border-[#3c3c3c] bg-[#2d2d2d] text-[#9d9d9d]'}`}>{item === 'catalog' ? 'Catalog' : item === 'lineage' ? 'Lineage' : 'Sectors'}</button>)}
        {tab === 'catalog' && <><label className="flex min-w-56 items-center gap-2 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2"><Search className="h-4 w-4 text-[#6f6f6f]" /><input value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} placeholder="Search name, publisher, category" aria-label="Search passports" className="min-w-0 flex-1 bg-transparent text-xs text-[#d4d4d4] outline-none placeholder:text-[#6f6f6f]" /></label><select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]"><option value="all">All categories</option>{categories.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select></>}
      </div>

      {tab === 'lineage' ? <SoftwareLineageTracker passports={passports} clients={clients} assets={assets} onUpdatePassport={onUpdatePassport} /> : tab === 'sectors' ? <SoftwareSectorsPanel passports={passports} onFilterCategory={(value) => { setCategory(value); setTab('catalog'); }} onNavigateTab={onNavigateTab} setSelectedPassportId={setSelectedPassportId} /> : <>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((passport) => { const badge = verificationBadge(passport.verificationStatus); return <button key={passport.id} onClick={() => setSelectedPassportId(passport.id)} className={`rounded-md border p-5 text-left transition ${selectedPassportId === passport.id ? 'border-[#3c3c3c] bg-[#094771]' : 'border-[#3c3c3c] bg-[#252526] hover:bg-[#2d2d2d]'}`}><div className="flex items-start justify-between gap-3"><span className="grid h-9 w-9 place-items-center rounded-md border border-[#3c3c3c] bg-[#2d2d2d]"><FileCheck2 className="h-4 w-4 text-[#3794ff]" /></span><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${badge.className}`}>{badge.label}</span></div><div className="mt-4 text-sm font-semibold text-[#d4d4d4]">{passport.name || 'Unnamed software'}</div><div className="mt-1 truncate text-xs text-[#9d9d9d]">{passport.version || 'Version not observed'} · {passport.publisher || 'Publisher not observed'}</div><div className="mt-4 grid grid-cols-2 gap-2 text-[11px]"><span className="rounded border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-2 text-[#9d9d9d]">Overall <strong className="float-right text-[#d4d4d4]">{passport.overallScore ?? '—'}</strong></span><span className="rounded border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-2 text-[#9d9d9d]">Evidence <strong className="float-right text-[#d4d4d4]">{passport.evidenceCompleteness == null ? '—' : `${passport.evidenceCompleteness}%`}</strong></span></div></button>; })}
          {filtered.length === 0 && <div className="rounded-md border border-dashed border-[#3c3c3c] p-12 text-center md:col-span-2 xl:col-span-3"><FileCheck2 className="mx-auto h-8 w-8 text-[#6f6f6f]" /><p className="mt-3 text-sm font-semibold text-[#d4d4d4]">No passport records match this view.</p><p className="mt-1 text-xs text-[#6f6f6f]">Adjust the search or category filter.</p></div>}
        </div>

        {selected && <div className="spr-panel p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><h2 className="text-xl font-semibold text-[#d4d4d4]">{selected.name}</h2><p className="mt-1 text-sm text-[#9d9d9d]">{selected.version || 'Version not observed'} · {selected.publisher || 'Publisher not observed'}</p></div><div className={`rounded-md border px-3 py-2 text-xs ${verificationBadge(selected.verificationStatus).className}`}>Overall: {selected.overallScore == null ? '—' : selected.overallScore} · {verificationBadge(selected.verificationStatus).label}</div></div>

          {/* Trust Field: the real dimensions this passport's own evidence
              actually supports (security/compliance/vendor reputation/
              confidence). No dimension is shown with an invented value --
              anything the scoring engine hasn't computed renders "N/A". */}
          <div className="mt-6 flex justify-center border-b border-[#3c3c3c] pb-6">
            <TrustField
              state={trustStateFromVerification(selected.verificationStatus)}
              centerLabel={selected.name?.slice(0, 12).toUpperCase() || 'PASSPORT'}
              size={300}
              dimensions={[
                { key: 'security', label: 'Security', value: selected.securityScore ?? null },
                { key: 'compliance', label: 'Compliance', value: selected.complianceScore ?? null },
                { key: 'vendor', label: 'Vendor Rep.', value: selected.vendorReputationScore ?? null },
                { key: 'confidence', label: 'Confidence', value: selected.confidenceScore ?? null },
              ]}
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3"><div className="spr-panel-alt p-4"><div className="text-[11px] uppercase tracking-[.06em] text-[#6f6f6f]">Evidence</div><div className="mt-2 text-2xl font-semibold text-[#d4d4d4]">{selected.evidence?.length ?? 0}</div><div className="mt-1 text-xs text-[#9d9d9d]">Recorded entries · {selected.evidenceCompleteness == null ? 'not yet resolved' : `${selected.evidenceCompleteness}% resolved`}</div></div><div className="spr-panel-alt p-4"><div className="text-[11px] uppercase tracking-[.06em] text-[#6f6f6f]">Findings</div><div className="mt-2 text-2xl font-semibold text-[#d4d4d4]">{selected.vulnerabilities?.length ?? 0}</div><div className="mt-1 text-xs text-[#9d9d9d]">Observed or reported findings</div></div><div className="spr-panel-alt p-4"><div className="text-[11px] uppercase tracking-[.06em] text-[#6f6f6f]">Score status</div><div className={`mt-2 text-lg font-semibold ${verificationBadge(selected.verificationStatus).textClassName}`}>{verificationBadge(selected.verificationStatus).label}</div><div className="mt-1 text-xs text-[#9d9d9d]">{selected.confidenceScore == null ? 'No confidence figure without resolved evidence' : `${selected.confidenceScore}% confidence`}</div></div></div>

          {selected.evidence?.length > 0 && <div className="mt-6"><div className="mb-3 text-[11px] uppercase tracking-[.06em] text-[#6f6f6f]">Evidence ledger snapshot</div><div className="grid gap-3 md:grid-cols-2">{selected.evidence.map((item: any) => <div key={String(item.id)} className="spr-panel-alt p-4"><div className="text-sm font-semibold text-[#d4d4d4]">{String(item.name || item.type || 'Evidence item')}</div><div className="mt-1 text-xs text-[#9d9d9d]">Status: {String(item.status || 'Not verified')}</div></div>)}</div></div>}

          {selected.vulnerabilities?.length > 0 && <div className="mt-6"><div className="mb-3 text-[11px] uppercase tracking-[.06em] text-[#6f6f6f]">Trust findings / remediation</div><div className="space-y-2">{selected.vulnerabilities.map((v: any) => { const id = String(v.findingId ?? v.id ?? ''); return <div key={id} className="spr-panel-alt p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="text-sm font-semibold text-[#d4d4d4]">{String(v.title || id)}</div><div className="mt-1 text-xs text-[#9d9d9d]">{String(v.status || 'Open')} · {String(v.severity || 'Unknown severity')}</div></div><button onClick={() => void createRemediation(v)} disabled={!canCreateRemediation || !id || remediationBusy === id} title={!canCreateRemediation ? `Your ${role} role cannot create remediations.` : undefined} className="spr-btn spr-btn-secondary disabled:opacity-50">{remediationBusy === id ? 'Persisting…' : 'Create persisted remediation'}</button></div></div>; })}</div></div>}

          <div className="mt-6 spr-panel-alt p-4 text-xs leading-5 text-[#9d9d9d]">This workflow never upgrades self-submitted data to VERIFIED. Durable evidence and remediation state must come from the Trust Loop backend.</div>
        </div>}
      </>}
    </section>
  );
}

function PassportMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="spr-panel-alt p-4"><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[#6f6f6f]"><span className="h-4 w-4 text-[#3794ff]">{icon}</span>{label}</div><div className="mt-3 text-2xl font-semibold text-[#d4d4d4]">{value}</div></div>;
}
