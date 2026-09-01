import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Search, ArrowRight, ShieldAlert, Cpu, FileText, Activity, Zap, Building2, Database } from 'lucide-react';
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

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} aria-labelledby="investor-home-title">
      {!hasRegistryData && <div className="mb-4 rounded-md border border-dashed border-[#c8c6c4] bg-[#faf9f8] p-3"><p className="text-[13px] font-semibold text-[#201f1e]">No registry records are available yet.</p><p className="mt-0.5 text-[12px] text-[#605e5c]">The dashboard is showing current dataset counts only. No absence of records is treated as proof of safety.</p></div>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="investor-home-title" className="text-[22px] font-semibold text-[#201f1e]">Investor & Evidence View</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[#605e5c]">Decision support derived from the records currently returned by SPR. It is not a certification or attestation.</p>
        </div>
        <button type="button" onClick={onShowTelemetry} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]"><span>View Verification Telemetry</span><ArrowRight className="h-3.5 w-3.5" /></button>
      </div>

      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>A decision-support summary of the current dataset for investors and evidence reviewers. Every figure below is either directly observed or clearly marked "Not verified".</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>The trust index and asset counts reflect only records currently returned by the backend.</li>
            <li>Use "Review remediation" or "Generate evidence report" to act on recorded risks.</li>
            <li>No certification, external assurance, or infrastructure claim is implied anywhere on this page.</li>
          </ol>
        </div>
      </details>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4 lg:col-span-5">
          <div className="mb-3"><span className="block text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">Trust score observation</span><h3 className="text-[14px] font-semibold text-[#201f1e]">Client Trust Index</h3></div>
          <div className="flex items-center justify-around gap-4 py-1">
            <div className="relative flex h-28 w-28 items-center justify-center">
              <svg className="h-full w-full -rotate-90">
                <circle cx="56" cy="56" r="46" className="text-[#e1dfdd]" strokeWidth="7" stroke="currentColor" fill="transparent" />
                <circle cx="56" cy="56" r="46" className={trustHealth === null ? 'text-[#c8c6c4]' : 'text-[#0f6cbd]'} strokeWidth="7" strokeDasharray={289} strokeDashoffset={trustHealth === null ? 289 : 289 - (289 * trustHealth) / 100} strokeLinecap="round" stroke="currentColor" fill="transparent" />
              </svg>
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-[22px] font-semibold text-[#201f1e]">{trustHealth === null ? '—' : trustHealth}</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-[#8a8886]">Observed score</span>
              </div>
            </div>
            <div className="space-y-1.5 text-[11px] text-[#605e5c]">
              <div className="flex justify-between gap-4 border-b border-[#e1dfdd] pb-1"><span>Score status</span><strong className="font-semibold text-[#323130]">{trustHealth === null ? 'Not verified' : 'Observed'}</strong></div>
              <p className="pt-0.5 leading-normal text-[#8a8886]">{trustHealth === null ? 'No client trust scores were returned by the backend.' : 'Average of returned client trust scores.'}</p>
            </div>
          </div>
          <div className="mt-2 border-t border-[#e1dfdd] pt-2 text-[11px] text-[#8a8886]">External assurance, certifications, and infrastructure claims require separately connected evidence.</div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:col-span-7">
          <Metric label="Software assets" value={hasRegistryData ? softwareAssets : null} note={hasRegistryData ? 'Current client passport count' : 'No backend records loaded'} icon={<Database className="h-3.5 w-3.5" />} />
          <Metric label="Publishers" value={hasRegistryData ? publishers : null} note={hasRegistryData ? 'Distinct publishers in the current passport set' : 'No backend records loaded'} icon={<Building2 className="h-3.5 w-3.5" />} />
          <Metric label="Recorded risks" value={hasRegistryData ? activeRisks : null} note={hasRegistryData ? 'Current client risk-count fields' : 'No backend records loaded'} icon={<ShieldAlert className="h-3.5 w-3.5" />} />
          <Metric label="Unverified dependencies" value={hasRegistryData ? unknownDependencies : null} note={hasRegistryData ? 'Components whose recorded trustLevel is not Trusted' : 'No backend records loaded'} icon={<Cpu className="h-3.5 w-3.5" />} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ActionCard title="Review remediation" description="Open the backend remediation workflow for recorded risks. An accepted task is not a verified fix." button="Open remediation" icon={<Zap className="h-3.5 w-3.5" />} onClick={() => setIsRemediationOpen(true)} />
        <ActionCard title="Generate evidence report" description="Compile a report from current records. The report is not certified unless separately attested by evidence." button="Open report hub" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => setIsReportsOpen(true)} />
        <ActionCard title="Review trust graph" description="Navigate to the connected evidence workflow for dependency and relationship review." button="Open trust workflow" icon={<Activity className="h-3.5 w-3.5" />} onClick={() => onNavigateTab?.('/extensions/trust-evidence')} />
      </div>

      <section className="rounded-md border border-[#e1dfdd] bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="text-[14px] font-semibold text-[#201f1e]">Software Passports</h3><p className="text-[12px] text-[#605e5c]">Current passport records. Scores are shown only when returned by the backend.</p></div>
          <div className="flex h-9 items-center gap-2 rounded border border-[#c8c6c4] bg-white px-2.5"><Search className="h-3.5 w-3.5 text-[#8a8886]" /><input aria-label="Filter passports" type="text" placeholder="Filter passports..." value={passportSearch} onChange={(e) => setPassportSearch(e.target.value)} className="w-full bg-transparent text-[12px] text-[#201f1e] outline-none placeholder:text-[#8a8886]" /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]"><tr><th className="px-3 py-2">Software</th><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-center">Score</th><th className="px-3 py-2 text-right">Evidence state</th></tr></thead>
            <tbody>
              {filteredPassports.map((passport) => (
                <tr key={passport.id} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                  <td className="px-3 py-2.5"><span className="block font-medium text-[#201f1e]">{passport.name}</span><span className="font-mono text-[11px] text-[#8a8886]">v{passport.version} · {passport.publisher}</span></td>
                  <td className="px-3 py-2.5"><span className="rounded bg-[#f3f2f1] px-1.5 py-0.5 text-[11px] font-medium text-[#323130]">{passport.category}</span></td>
                  <td className="px-3 py-2.5 text-center font-medium text-[#323130]">{passport.overallScore ?? 'Not verified'}</td>
                  <td className="px-3 py-2.5 text-right text-[11px] text-[#8a8886]">{passport.overallScore == null ? 'Score unavailable' : 'Score observed'}</td>
                </tr>
              ))}
              {filteredPassports.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[13px] italic text-[#8a8886]">No matching passport records found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {isRemediationOpen && (
        <Modal title="Remediation workflow" onClose={() => setIsRemediationOpen(false)}>
          <p className="text-[13px] text-[#605e5c]">Start the protected backend remediation workflow for this tenant. The UI will only report what the backend returns.</p>
          <button type="button" disabled={isRemediating} onClick={() => void triggerRemediation()} className="mt-4 inline-flex h-9 items-center rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50">{isRemediating ? 'Running…' : 'Run remediation'}</button>
          {remediationCompleted && <p className="mt-3 text-[12px] text-[#0e700e]">Remediation request completed; re-check the evidence source before treating any risk as resolved.</p>}
          {remediationLogs.length > 0 && <pre className="mt-3 max-h-52 overflow-auto rounded border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[11px] text-[#323130]">{remediationLogs.join('\n')}</pre>}
        </Modal>
      )}
      {isReportsOpen && (
        <Modal title="Evidence report hub" onClose={() => setIsReportsOpen(false)}>
          <p className="text-[13px] text-[#605e5c]">Reports compile current application records. Certification, external assurance, and attestation status remain unverified unless backed by a connected evidence source.</p>
          <div className="mt-4 space-y-1.5">
            <button type="button" onClick={() => setSelectedReportId('executive')} className="w-full rounded border border-[#c8c6c4] p-2.5 text-left text-[13px] text-[#323130] hover:bg-black/[.03]">Executive evidence summary</button>
            <button type="button" onClick={() => setSelectedReportId('procurement')} className="w-full rounded border border-[#c8c6c4] p-2.5 text-left text-[13px] text-[#323130] hover:bg-black/[.03]">Procurement evidence summary</button>
            <button type="button" onClick={() => setSelectedReportId('compliance')} className="w-full rounded border border-[#c8c6c4] p-2.5 text-left text-[13px] text-[#323130] hover:bg-black/[.03]">Compliance evidence summary</button>
          </div>
          <p className="mt-3 text-[12px] text-[#8a8886]">Selected: {selectedReportId}. No certification seal is implied.</p>
        </Modal>
      )}
    </motion.section>
  );
}

function Metric({ label, value, note, icon }: { label: string; value: number | null; note: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[#e1dfdd] bg-white p-3">
      <div className="flex items-center gap-1.5 text-[#605e5c]">{icon}<span className="text-[11px] font-medium uppercase tracking-wide">{label}</span></div>
      <h4 className="mt-1.5 text-lg font-semibold text-[#201f1e]">{value ?? 'Not verified'}</h4>
      <p className="mt-0.5 text-[11px] text-[#8a8886]">{note}</p>
    </div>
  );
}
function ActionCard({ title, description, button, icon, onClick }: { title: string; description: string; button: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <div className="flex flex-col justify-between rounded-md border border-[#e1dfdd] bg-white p-3">
      <div>
        <div className="flex h-7 w-7 items-center justify-center rounded border border-[#0f6cbd]/25 bg-[#eff6fc] text-[#0f6cbd]">{icon}</div>
        <h4 className="mt-2 text-[13px] font-semibold text-[#201f1e]">{title}</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-[#605e5c]">{description}</p>
      </div>
      <button type="button" onClick={onClick} className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 rounded bg-[#0f6cbd] text-[12px] font-medium text-white hover:bg-[#004578]">{button}<ArrowRight className="h-3.5 w-3.5" /></button>
    </div>
  );
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-md border border-[#e1dfdd] bg-white p-5">
        <div className="flex items-center justify-between"><h2 className="text-[16px] font-semibold text-[#201f1e]">{title}</h2><button type="button" onClick={onClose} className="rounded border border-[#c8c6c4] px-2 py-1 text-[#605e5c] hover:bg-black/[.03]">×</button></div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
