import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Search, ArrowRight, Award, ShieldAlert, Cpu, FileText, Activity, Zap, Building2, Database } from 'lucide-react';
import { Client, SoftwarePassport, Alert } from '../types';
import { apiFetch } from '../utils/apiClient';

interface InvestorHomeViewProps {
  passports: SoftwarePassport[];
  onShowTelemetry: () => void;
  onNavigateTab?: (tab: string, itemId?: string) => void;
  clients?: Client[];
  alerts?: Alert[];
}

export default function InvestorHomeView({ passports, onShowTelemetry, onNavigateTab, clients = [], alerts = [] }: InvestorHomeViewProps) {
  const vendorProfiles = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; category: string; trustRating: string; publisher: string; passportCount: number }>();
    passports.forEach((passport) => {
      const publisher = passport.publisher || passport.name || 'Unknown Publisher';
      const slug = publisher.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!seen.has(publisher)) {
        seen.set(publisher, { id: `vendor-${slug}`, name: publisher, category: passport.category || 'Software Publisher', trustRating: passport.overallScore == null ? 'Not verified' : passport.overallScore >= 90 ? 'AAA' : passport.overallScore >= 75 ? 'AA' : 'A', publisher, passportCount: 1 });
      } else seen.get(publisher)!.passportCount += 1;
    });
    return Array.from(seen.values());
  }, [passports]);

  const trustHealth = clients.length > 0 && clients.some((client) => typeof client.trustScore === 'number')
    ? Math.round(clients.reduce((sum, client) => sum + (typeof client.trustScore === 'number' ? client.trustScore : 0), 0) / clients.filter((client) => typeof client.trustScore === 'number').length)
    : null;
  const softwareAssets = clients.reduce((sum, client) => sum + (client.passportCount || 0), 0);
  const publishers = new Set(passports.map((passport) => passport.publisher).filter(Boolean)).size;
  const activeRisks = clients.reduce((sum, client) => sum + (client.criticalRisksCount || 0), 0);
  const unknownDependencies = passports.reduce((sum, passport) => {
    try {
      const sbom = Array.isArray(passport.sbom) ? passport.sbom : typeof passport.sbom === 'string' ? JSON.parse(passport.sbom) : [];
      return sum + sbom.filter((component: any) => component && component.trustLevel && component.trustLevel !== 'Trusted').length;
    } catch { return sum; }
  }, 0);
  const hasRegistryData = passports.length > 0 || clients.length > 0;

  const [isRemediationOpen, setIsRemediationOpen] = useState(false);
  const [remediationLogs, setRemediationLogs] = useState<string[]>([]);
  const [isRemediating, setIsRemediating] = useState(false);
  const [remediationCompleted, setRemediationCompleted] = useState(false);
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState('rep-ceo');
  const [showCertificateSeal, setShowCertificateSeal] = useState(false);
  const [passportSearch, setPassportSearch] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');

  const triggerRemediation = async () => {
    setIsRemediating(true); setRemediationLogs([]);
    try {
      const response = await apiFetch('/api/remediation/run', { method: 'POST' });
      const failure = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(failure.message || 'Remediation run failed');
      if (failure.success) {
        if (failure.resolvedCount === 0) {
          setRemediationLogs(['No remediation items were returned by the backend. This is not a claim that the environment is risk-free.']);
        } else {
          const logsResponse = await apiFetch(`/api/agent-jobs/${failure.jobId}/logs`);
          if (logsResponse.ok) {
            const logs = await logsResponse.json();
            setRemediationLogs(Array.isArray(logs) ? logs.map((log: any) => `[${String(log.level || 'info').toLowerCase()}] ${log.message}`) : ['Remediation request accepted; execution logs were not returned.']);
          } else setRemediationLogs([`Remediation request accepted. The backend reported ${failure.resolvedCount} item(s); execution logs were not returned.`]);
          setRemediationCompleted(true);
          window.dispatchEvent(new CustomEvent('refresh-data'));
        }
      }
    } catch { setRemediationLogs(['Bulk remediation is not built into this deployment yet — there is no /api/remediation/run backend. Use per-finding remediation from the Passports or MSP Command Center views instead.']); }
    finally { setIsRemediating(false); }
  };

  const filteredPassports = passports.filter((passport) => passport.name.toLowerCase().includes(passportSearch.toLowerCase()) || passport.category.toLowerCase().includes(passportSearch.toLowerCase()));
  const filteredVendors = vendorProfiles.filter((vendor) => vendor.name.toLowerCase().includes(vendorSearch.toLowerCase()) || vendor.category.toLowerCase().includes(vendorSearch.toLowerCase()));

  return <div className="space-y-8 py-4">
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-8 text-left">
      {!hasRegistryData && <div className="spr-panel-alt border-dashed p-5"><p className="text-sm font-extrabold text-[var(--spr-text)]">No registry records are available yet.</p><p className="mt-1 text-[11px] leading-relaxed text-[var(--spr-text-muted)]">The dashboard is showing current dataset counts only. No absence of records is treated as proof of safety.</p></div>}

      <div className="flex flex-col justify-between gap-4 border-b border-[var(--spr-border)] pb-5 md:flex-row md:items-center"><div><div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-green)]"><Database className="h-4 w-4" /> Current dataset</div><h1 className="text-2xl font-black tracking-tight text-[var(--spr-text)] sm:text-3xl">Investor & Evidence View</h1><p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--spr-text-muted)]">Decision support derived from the records currently returned by SPR. It is not a certification or attestation.</p></div><button onClick={onShowTelemetry} className="spr-btn spr-btn-secondary flex shrink-0 items-center gap-1"><span>View Verification Telemetry</span><ArrowRight className="h-3.5 w-3.5" /></button></div>

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        <div className="relative flex min-h-[300px] flex-col justify-between overflow-hidden spr-panel p-6 text-[var(--spr-text)] lg:col-span-5"><div><span className="block text-[10px] font-semibold uppercase tracking-[.06em] text-[var(--spr-highlight)]">TRUST SCORE OBSERVATION</span><h3 className="text-sm font-black text-[var(--spr-text)]">Client Trust Index</h3></div><div className="flex items-center justify-around gap-6 py-2"><div className="relative flex h-36 w-36 items-center justify-center"><svg className="h-full w-full -rotate-90"><circle cx="72" cy="72" r="60" className="text-[var(--spr-border)]" strokeWidth="8" stroke="currentColor" fill="transparent"/><circle cx="72" cy="72" r="60" className={trustHealth === null ? 'text-[var(--spr-text-faint)]' : 'text-[var(--spr-highlight)]'} strokeWidth="8" strokeDasharray={377} strokeDashoffset={trustHealth === null ? 377 : 377 - (377 * trustHealth) / 100} strokeLinecap="round" stroke="currentColor" fill="transparent"/></svg><div className="absolute flex flex-col items-center justify-center text-center"><span className="text-3xl font-black">{trustHealth === null ? '—' : trustHealth}</span><span className="text-[8px] font-bold uppercase tracking-wider text-[var(--spr-text-muted)]">Observed score</span></div></div><div className="space-y-2 font-mono text-[10px] text-[var(--spr-text-muted)]"><div className="flex justify-between gap-4 border-b border-[var(--spr-border)] pb-1"><span>SCORE STATUS:</span><strong className="text-[var(--spr-text)]">{trustHealth === null ? 'NOT VERIFIED' : 'OBSERVED'}</strong></div><p className="pt-1 text-[9px] leading-normal text-[var(--spr-text-faint)]">{trustHealth === null ? 'No client trust scores were returned by the backend.' : 'Average of returned client trust scores.'}</p></div></div><div className="border-t border-[var(--spr-border)] pt-3 text-[9px] font-mono text-[var(--spr-text-faint)]">External assurance, certifications, and infrastructure claims require separately connected evidence.</div></div>

        <div className="grid grid-cols-2 items-stretch gap-4 lg:col-span-7">
          <Metric label="SOFTWARE ASSETS" value={hasRegistryData ? softwareAssets : null} note={hasRegistryData ? 'Current client passport count' : 'No backend records loaded'} icon={<Database className="h-4 w-4"/>}/>
          <Metric label="PUBLISHERS" value={hasRegistryData ? publishers : null} note={hasRegistryData ? 'Distinct publishers in the current passport set' : 'No backend records loaded'} icon={<Building2 className="h-4 w-4"/>}/>
          <Metric label="RECORDED RISKS" value={hasRegistryData ? activeRisks : null} note={hasRegistryData ? 'Current client risk-count fields' : 'No backend records loaded'} icon={<ShieldAlert className="h-4 w-4"/>}/>
          <Metric label="UNVERIFIED DEPENDENCIES" value={hasRegistryData ? unknownDependencies : null} note={hasRegistryData ? 'Components whose recorded trustLevel is not Trusted' : 'No backend records loaded'} icon={<Cpu className="h-4 w-4"/>}/>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <ActionCard title="Review remediation" description="Open the backend remediation workflow for recorded risks. An accepted task is not a verified fix." button="Open remediation" icon={<Zap className="h-4 w-4"/>} onClick={() => setIsRemediationOpen(true)}/>
        <ActionCard title="Generate evidence report" description="Compile a report from current records. The report is not certified unless separately attested by evidence." button="Open report hub" icon={<FileText className="h-4 w-4"/>} onClick={() => setIsReportsOpen(true)}/>
        <ActionCard title="Review trust graph" description="Navigate to the connected evidence workflow for dependency and relationship review." button="Open trust workflow" icon={<Activity className="h-4 w-4"/>} onClick={() => onNavigateTab?.('/extensions/trust-evidence')}/>
      </div>

      <section className="spr-panel p-6"><div className="flex flex-col justify-between gap-3 border-b border-[var(--spr-border)] pb-4 sm:flex-row sm:items-center"><div><h3 className="text-sm font-extrabold text-[var(--spr-text)]">Software Passports</h3><p className="text-[11px] leading-tight text-[var(--spr-text-muted)]">Current passport records. Scores are shown only when returned by the backend.</p></div><div className="flex items-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5"><Search className="h-3.5 w-3.5 text-[var(--spr-text-faint)]"/><input aria-label="Filter passports" type="text" placeholder="Filter passports..." value={passportSearch} onChange={(e) => setPassportSearch(e.target.value)} className="w-full bg-transparent text-[11px] outline-none text-[var(--spr-text)]"/></div></div><div className="mt-4 overflow-x-auto"><table className="spr-table w-full"><thead><tr><th>Software</th><th>Category</th><th className="text-center">Score</th><th className="text-right">Evidence state</th></tr></thead><tbody>{filteredPassports.map((passport) => <tr key={passport.id}><td><span className="block text-xs font-extrabold text-[var(--spr-text)]">{passport.name}</span><span className="font-mono text-[10px] text-[var(--spr-text-faint)]">v{passport.version} · {passport.publisher}</span></td><td><span className="rounded bg-[var(--spr-surface-sunken)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--spr-text-muted)]">{passport.category}</span></td><td className="text-center font-mono font-bold text-[var(--spr-text)]">{passport.overallScore ?? 'Not verified'}</td><td className="text-right text-[10px] font-mono text-[var(--spr-text-faint)]">{passport.overallScore == null ? 'Score unavailable' : 'Score observed'}</td></tr>)}{filteredPassports.length === 0 && <tr><td colSpan={4} className="py-6 text-center italic text-[var(--spr-text-faint)]">No matching passport records found.</td></tr>}</tbody></table></div></section>

      {isRemediationOpen && <Modal title="Remediation workflow" onClose={() => setIsRemediationOpen(false)}><p className="text-sm text-[var(--spr-text-muted)]">Start the protected backend remediation workflow for this tenant. The UI will only report what the backend returns.</p><button disabled={isRemediating} onClick={() => void triggerRemediation()} className="spr-btn spr-btn-primary mt-5 disabled:opacity-50">{isRemediating ? 'Running…' : 'Run remediation'}</button>{remediationCompleted && <p className="mt-4 text-xs text-[var(--spr-green)]">Remediation request completed; re-check the evidence source before treating any risk as resolved.</p>}{remediationLogs.length > 0 && <pre className="mt-4 max-h-52 overflow-auto spr-panel-alt p-3 text-xs text-[var(--spr-text)]">{remediationLogs.join('\n')}</pre>}</Modal>}
      {isReportsOpen && <Modal title="Evidence report hub" onClose={() => setIsReportsOpen(false)}><p className="text-sm text-[var(--spr-text-muted)]">Reports compile current application records. Certification, external assurance, and attestation status remain unverified unless backed by a connected evidence source.</p><div className="mt-5 space-y-2"><button onClick={() => setSelectedReportId('executive')} className="spr-btn spr-btn-secondary w-full text-left">Executive evidence summary</button><button onClick={() => setSelectedReportId('procurement')} className="spr-btn spr-btn-secondary w-full text-left">Procurement evidence summary</button><button onClick={() => setSelectedReportId('compliance')} className="spr-btn spr-btn-secondary w-full text-left">Compliance evidence summary</button></div><p className="mt-4 text-xs text-[var(--spr-text-muted)]">Selected: {selectedReportId}. No certification seal is implied.</p></Modal>}
    </motion.div>
  </div>;
}

function Metric({ label, value, note, icon }: { label: string; value: number | null; note: string; icon: React.ReactNode }) { return <div className="relative flex flex-col justify-between overflow-hidden spr-panel p-5"><div className="flex items-center gap-2 text-[var(--spr-text-faint)]">{icon}<span className="text-[10px] font-mono font-extrabold uppercase tracking-widest">{label}</span></div><h4 className="mt-2 text-3xl font-black text-[var(--spr-text)]">{value ?? 'Not verified'}</h4><p className="mt-1 text-[10px] font-mono leading-none text-[var(--spr-text-faint)]">{note}</p></div>; }
function ActionCard({ title, description, button, icon, onClick }: { title: string; description: string; button: string; icon: React.ReactNode; onClick: () => void }) { return <div className="flex flex-col justify-between spr-panel p-5"><div><div className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--spr-border)] bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]">{icon}</div><h4 className="mt-3 text-sm font-extrabold text-[var(--spr-text)]">{title}</h4><p className="mt-2 text-[11px] leading-relaxed text-[var(--spr-text-muted)]">{description}</p></div><button onClick={onClick} className="spr-btn spr-btn-primary mt-4 flex items-center justify-center gap-1.5">{button}<ArrowRight className="h-3.5 w-3.5"/></button></div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" role="dialog" aria-modal="true"><div className="w-full max-w-xl spr-panel p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-[var(--spr-text)]">{title}</h2><button onClick={onClose} className="rounded-md border border-[var(--spr-border)] px-2 py-1 text-[var(--spr-text-muted)]">×</button></div>{children}</div></div>; }
