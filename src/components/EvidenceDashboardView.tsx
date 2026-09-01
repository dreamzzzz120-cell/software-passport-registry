import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ChevronRight, Command, Database, PlayCircle, Search, ShieldCheck, Terminal, X } from 'lucide-react';
import type { Alert, Client, Scan, SoftwarePassport } from '../types';

interface Props { clients: Client[]; alerts: Alert[]; scans: Scan[]; passports: SoftwarePassport[]; findings?: unknown[]; onNavigateTab: (path: string, itemId?: string) => void; onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void; }

function hasArrayValue(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

const TOUR = [
  ['01', 'Connect your environment', 'Bring repositories, cloud, identity, SBOM, security and runtime evidence into one system.'],
  ['02', 'Discover software reality', 'SPR resolves software into durable identities and maps relationships between assets.'],
  ['03', 'Verify what is known', 'Important statements stay traceable to observed evidence, with uncertainty exposed instead of hidden.'],
  ['04', 'Operate continuously', 'Changes, drift, dependencies and new evidence become events in the same trust system.'],
];

const COMMANDS: [string, string, string][] = [
  ['/passports', 'Software registry', 'Browse software identities'],
  ['/integrations', 'Connectors', 'Connect the ecosystem'],
  ['/scans', 'Evidence', 'Inspect observations'],
  ['/monitoring', 'Monitoring', 'See change over time'],
  ['/security', 'Verification', 'Inspect trust evidence'],
];

function scanStatusDot(status: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'success' || s === 'completed') return 'bg-[#0e700e]';
  if (s === 'failed') return 'bg-[#a4262c]';
  if (s === 'scanning') return 'bg-[#0f6cbd]';
  return 'bg-[#8a8886]';
}

function alertStatusDot(status: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'active') return 'bg-[#a4262c]';
  if (s === 'acknowledged' || s === 'snoozed') return 'bg-[#8a5700]';
  if (s === 'resolved') return 'bg-[#0e700e]';
  return 'bg-[#8a8886]';
}

function severityDot(severity: string) {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical' || s === 'high') return 'bg-[#a4262c]';
  if (s === 'medium') return 'bg-[#8a5700]';
  return 'bg-[#0f6cbd]';
}

export default function EvidenceDashboardView({ clients, alerts, scans, passports, findings = [], onNavigateTab, onOpenQuickAction }: Props) {
  const [tourOpen, setTourOpen] = useState(() => localStorage.getItem('spr-infrastructure-tour') !== 'complete');
  const [tourStep, setTourStep] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState('');
  const activeAlerts = alerts.filter((item) => item.status !== 'Resolved').length;

  // Every figure below is computed directly from already-loaded tenant records —
  // no score is inferred and no metric is shown without a real, checkable source.
  const portfolio = useMemo(() => {
    const verifiedPassports = passports.filter((p) => hasArrayValue(p.evidence) && p.evidence.every((e: any) => e.status === 'VERIFIED')).length;
    const openVulnerabilities = passports.reduce((total, p) => total + (p.vulnerabilities || []).filter((v: any) => v.status === 'Open').length, 0);
    const criticalFindings = (findings as any[]).filter((f) => String(f?.severity || '').toLowerCase() === 'critical' && !['resolved', 'closed', 'verified'].includes(String(f?.status || '').toLowerCase())).length;
    const evidenceBearing = passports.filter((p) => hasArrayValue(p.evidence) || hasArrayValue((p as any).sbom) || hasArrayValue(p.timeline)).length;
    const evidenceCoveragePercent = passports.length === 0 ? 0 : Math.round((evidenceBearing / passports.length) * 100);
    const complianceAverage = clients.length === 0 ? null : Math.round(clients.reduce((total, c: any) => total + (Number(c.complianceProgress) || 0), 0) / clients.length);
    return { verifiedPassports, openVulnerabilities, criticalFindings, evidenceCoveragePercent, complianceAverage };
  }, [passports, findings, clients]);

  const filteredPassports = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q ? passports : passports.filter((p: any) => `${p.name} ${p.version} ${p.publisher}`.toLowerCase().includes(q));
    return base.slice(0, 8);
  }, [passports, query]);

  const recentScans = useMemo(() => [...scans].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 8), [scans]);
  const recentAlerts = useMemo(() => [...alerts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 8), [alerts]);

  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen(true); } if (e.key === 'Escape') { setCommandOpen(false); setTourOpen(false); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const finishTour = () => { localStorage.setItem('spr-infrastructure-tour', 'complete'); setTourOpen(false); };

  return <div className="space-y-4 pb-8">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold text-[#201f1e]">Dashboard</h1>
        <p className="mt-1 text-[13px] text-[#605e5c]">Software passports, evidence, findings, and client coverage observed from connected systems.</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setCommandOpen(true)} className="hidden h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] text-[#323130] hover:bg-black/[.03] sm:inline-flex">
          <Command className="h-3.5 w-3.5" /> Search <kbd className="ml-1 rounded border border-[#c8c6c4] px-1 text-[10px] text-[#605e5c]">Ctrl K</kbd>
        </button>
        <button onClick={() => setTourOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] text-[#323130] hover:bg-black/[.03]">
          <PlayCircle className="h-3.5 w-3.5" /> Guided tour
        </button>
        <button onClick={() => onOpenQuickAction('register-passport')} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]">
          Register passport
        </button>
      </div>
    </div>

    <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
      <div className="px-3 pb-3 text-[#605e5c]">
        <p>SPR turns the systems that build, ship, run and govern your software into one observable, evidence-first record. Every figure on this page is computed directly from records already loaded for this tenant — nothing is inferred or estimated.</p>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
          <li>Connect repositories, cloud, identity, SBOM and security systems as evidence sources.</li>
          <li>SPR resolves software into durable identities and maps relationships between assets.</li>
          <li>Claims stay traceable to observed evidence, with uncertainty exposed rather than hidden.</li>
          <li>Changes, drift and new evidence appear here as they happen.</li>
        </ol>
      </div>
    </details>

    <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
      <MetricItem label="Software Passports" value={passports.length} onClick={() => onNavigateTab('/passports')} />
      <MetricItem label="Evidence Records" value={scans.length} onClick={() => onNavigateTab('/evidence-explorer')} />
      <MetricItem label="Open Findings" value={activeAlerts} onClick={() => onNavigateTab('/alerts')} />
      <MetricItem label="Clients" value={clients.length} onClick={() => onNavigateTab('/clients')} />
    </div>

    <SectionCard
      icon={Activity}
      title="Recent Activity"
      description="Most recent scan and evidence-collection activity observed for this tenant."
      action={<button onClick={() => onNavigateTab('/scans')} className="text-[13px] font-medium text-[#0f6cbd] hover:underline">View all {scans.length} scans</button>}
    >
      {recentScans.length === 0 ? (
        <EmptyState icon={Activity} text="No scan activity has been observed yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Triggered by</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentScans.map((scan) => (
                <tr key={scan.id} className="border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02]">
                  <td className="px-4 py-2.5 font-medium text-[#201f1e]">{scan.targetName}</td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{scan.scanType}</td>
                  <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${scanStatusDot(scan.status)}`} />{scan.status}</span></td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{scan.triggeredBy}</td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{scan.clientName || 'Not observed'}</td>
                  <td className="px-4 py-2.5 text-[#8a8886]">{new Date(scan.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>

    <SectionCard
      icon={Database}
      title="Software Systems"
      description="Software passports registered for this tenant."
      action={<button onClick={() => onNavigateTab('/passports')} className="text-[13px] font-medium text-[#0f6cbd] hover:underline">View all {passports.length} passports</button>}
    >
      <div className="border-b border-[#e1dfdd] px-4 py-2">
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8886]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search software, publisher, version…" className="h-8 w-full rounded border border-[#c8c6c4] pl-8 pr-3 text-[13px] outline-none focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
        </div>
      </div>
      {filteredPassports.length === 0 ? (
        <EmptyState icon={Database} text="No software passports match this view." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Publisher</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Evidence</th>
                <th className="px-4 py-2 font-medium">Open vulns</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filteredPassports.map((p: any) => {
                const verified = hasArrayValue(p.evidence) && p.evidence.every((e: any) => e.status === 'VERIFIED');
                const partial = !verified && hasArrayValue(p.evidence);
                const openVulns = (p.vulnerabilities || []).filter((v: any) => v.status === 'Open').length;
                return (
                  <tr key={p.id} onClick={() => onNavigateTab('/passports', String(p.id))} className="cursor-pointer border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02]">
                    <td className="px-4 py-2.5 font-medium text-[#201f1e]">{p.name} <span className="text-[#8a8886]">· {p.version || 'unknown version'}</span></td>
                    <td className="px-4 py-2.5 text-[#605e5c]">{p.publisher || 'Unknown publisher'}</td>
                    <td className="px-4 py-2.5 text-[#605e5c]">{p.category || 'Not observed'}</td>
                    <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${verified ? 'bg-[#0e700e]' : partial ? 'bg-[#8a5700]' : 'bg-[#8a8886]'}`} />{verified ? 'Verified' : partial ? 'Partial' : 'Not observed'}</span></td>
                    <td className="px-4 py-2.5 text-[#605e5c]">{openVulns}</td>
                    <td className="px-4 py-2.5 text-right"><ChevronRight className="ml-auto h-3.5 w-3.5 text-[#8a8886]" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>

    <SectionCard
      icon={ShieldCheck}
      title="Trust / Security Status"
      description={`${portfolio.verifiedPassports} of ${passports.length} passports fully verified · ${portfolio.evidenceCoveragePercent}% evidence coverage · ${portfolio.openVulnerabilities} open vulnerabilities · ${portfolio.complianceAverage === null ? 'no client compliance data' : `${portfolio.complianceAverage}% avg. compliance`}`}
      action={<button onClick={() => onNavigateTab('/alerts')} className="text-[13px] font-medium text-[#0f6cbd] hover:underline">View all {alerts.length} findings</button>}
    >
      {recentAlerts.length === 0 ? (
        <EmptyState icon={ShieldCheck} text="No findings have been recorded for this tenant." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-4 py-2 font-medium">Finding</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Severity</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentAlerts.map((alert) => (
                <tr key={alert.id} className="border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02]">
                  <td className="px-4 py-2.5 font-medium text-[#201f1e]">{alert.title}</td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{alert.category}</td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{alert.clientName || 'Not observed'}</td>
                  <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${severityDot(alert.severity)}`} />{alert.severity}</span></td>
                  <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${alertStatusDot(alert.status)}`} />{alert.status}</span></td>
                  <td className="px-4 py-2.5 text-[#8a8886]">{new Date(alert.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>

    {tourOpen && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-md border border-[#e1dfdd] bg-white p-6">
      <div className="flex items-center justify-between"><div className="text-[11px] font-semibold uppercase tracking-wide text-[#605e5c]">SPR guided tour</div><button onClick={finishTour} className="rounded p-1 text-[#605e5c] hover:bg-black/[.04] hover:text-[#201f1e]"><X className="h-4 w-4" /></button></div>
      <div className="mt-4 flex items-center gap-2">{TOUR.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= tourStep ? 'bg-[#0f6cbd]' : 'bg-[#e1dfdd]'}`} />)}</div>
      <div className="mt-5 text-[11px] font-semibold text-[#8a8886]">{TOUR[tourStep][0]}</div>
      <h2 className="mt-1 text-lg font-semibold text-[#201f1e]">{TOUR[tourStep][1]}</h2>
      <p className="mt-2 text-[13px] leading-6 text-[#605e5c]">{TOUR[tourStep][2]}</p>
      <div className="mt-6 flex justify-between">
        <button onClick={() => setTourStep((s) => Math.max(0, s - 1))} disabled={tourStep === 0} className="h-8 rounded border border-[#c8c6c4] px-3 text-[13px] text-[#323130] disabled:opacity-40">Back</button>
        {tourStep === TOUR.length - 1
          ? <button onClick={finishTour} className="h-8 rounded bg-[#0f6cbd] px-4 text-[13px] font-medium text-white hover:bg-[#004578]">Enter SPR</button>
          : <button onClick={() => setTourStep((s) => s + 1)} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-4 text-[13px] font-medium text-white hover:bg-[#004578]">Next <ChevronRight className="h-3.5 w-3.5" /></button>}
      </div>
    </div></div>}

    {commandOpen && <div className="fixed inset-0 z-[90] bg-black/40 p-4" onMouseDown={() => setCommandOpen(false)}>
      <div className="mx-auto mt-[12vh] max-w-lg overflow-hidden rounded-md border border-[#e1dfdd] bg-white" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[#e1dfdd] px-3">
          <Command className="h-4 w-4 text-[#605e5c]" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Go to software, evidence, monitoring…" className="flex-1 bg-transparent py-3 text-[13px] outline-none placeholder:text-[#8a8886]" />
          <button onClick={() => setCommandOpen(false)}><X className="h-4 w-4 text-[#8a8886]" /></button>
        </div>
        <div className="p-1.5">
          {COMMANDS.map(([path, label, desc]) => (
            <button key={path} onClick={() => { setCommandOpen(false); onNavigateTab(path); }} className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left hover:bg-black/[.03]">
              <Terminal className="h-3.5 w-3.5 text-[#8a8886]" />
              <span className="flex-1"><span className="block text-[13px] font-medium text-[#201f1e]">{label}</span><span className="block text-[11px] text-[#8a8886]">{desc}</span></span>
              <ChevronRight className="h-3.5 w-3.5 text-[#c8c6c4]" />
            </button>
          ))}
        </div>
      </div>
    </div>}
  </div>;
}

function MetricItem({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left">
      <div className="text-[11px] text-[#605e5c]">{label}</div>
      <div className="text-lg font-semibold text-[#201f1e]">{value}</div>
    </button>
  );
}

function SectionCard({ icon: Icon, title, description, action, children }: { icon: any; title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-[#e1dfdd] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e1dfdd] px-4 py-3">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 text-[#605e5c]" />
          <div>
            <h2 className="text-[14px] font-semibold text-[#201f1e]">{title}</h2>
            {description && <p className="mt-0.5 text-[12px] text-[#605e5c]">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <Icon className="mx-auto h-6 w-6 text-[#c8c6c4]" />
      <p className="mt-2 text-[13px] text-[#605e5c]">{text}</p>
    </div>
  );
}
