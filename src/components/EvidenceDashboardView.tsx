import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertOctagon, ArrowUpRight, Box, Bug, CheckCircle2, ChevronRight, Cloud, Code2, Command, Database, FileCheck2, Layers3, Link2, LockKeyhole, Network, PlayCircle, Radio, Rocket, Scale, Search, ShieldCheck, Sparkles, Terminal, UserPlus, X } from 'lucide-react';
import type { Alert, Client, Scan, SoftwarePassport } from '../types';

interface Props { clients: Client[]; alerts: Alert[]; scans: Scan[]; passports: SoftwarePassport[]; findings?: unknown[]; onNavigateTab: (path: string, itemId?: string) => void; onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void; }

function hasArrayValue(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

const CONNECTOR_GROUPS = [
  { title: 'Code & supply chain', icon: Code2, items: ['GitHub', 'GitLab', 'Bitbucket', 'Package registries', 'SBOMs'] },
  { title: 'Cloud & runtime', icon: Cloud, items: ['AWS', 'Azure', 'Google Cloud', 'Kubernetes', 'Containers'] },
  { title: 'Identity & enterprise', icon: LockKeyhole, items: ['Microsoft', 'Google', 'Okta', 'ServiceNow', 'SaaS'] },
  { title: 'Security & evidence', icon: ShieldCheck, items: ['Advisory feeds', 'Scanners', 'Certificates', 'Attestations', 'Provenance'] },
];
const TOUR = [
  ['01', 'Connect your environment', 'Bring repositories, cloud, identity, SBOM, security and runtime evidence into one system.'],
  ['02', 'Discover software reality', 'SPR resolves software into durable identities and maps relationships between assets.'],
  ['03', 'Verify what is known', 'Important statements stay traceable to observed evidence, with uncertainty exposed instead of hidden.'],
  ['04', 'Operate continuously', 'Changes, drift, dependencies and new evidence become events in the same trust system.'],
];

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
    const complianceAverage = clients.length === 0 ? null : Math.round(clients.reduce((total, c: any) => total + (Number(c.complianceProgress) || 0), 0) / clients.length);
    return { verifiedPassports, openVulnerabilities, criticalFindings, evidenceBearing, totalPassports: passports.length, complianceAverage };
  }, [passports, findings, clients]);
  const results = useMemo(() => { const q = query.trim().toLowerCase(); if (!q) return []; return passports.filter((p: any) => `${p.name} ${p.version} ${p.publisher}`.toLowerCase().includes(q)).slice(0, 6); }, [passports, query]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen(true); } if (e.key === 'Escape') { setCommandOpen(false); setTourOpen(false); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const finishTour = () => { localStorage.setItem('spr-infrastructure-tour', 'complete'); setTourOpen(false); };

  return <div className="space-y-6 pb-10">
    {clients.length === 0 && (
      <section className="spr-panel border-[#3794ff]/40 bg-[#094771]/15 p-6 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[#3794ff]/40 bg-[#094771]"><Rocket className="h-5 w-5 text-[#3794ff]" /></div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[.18em] text-[#3794ff]">Get started</div>
              <h2 className="mt-1 text-lg font-semibold text-[#d4d4d4]">Add your first client to start building software passports.</h2>
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-[#9d9d9d]">No clients yet — this workspace has no software, evidence, or trust data to show. Add a client, then register the software they run to begin evidence-first trust scoring.</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2.5 md:flex-col">
            <button onClick={() => onOpenQuickAction('add-client')} className="spr-btn spr-btn-primary inline-flex items-center justify-center gap-2 !text-xs"><UserPlus className="h-4 w-4" /> Add first client</button>
            <button onClick={() => onNavigateTab('/integrations')} className="spr-btn spr-btn-secondary inline-flex items-center justify-center gap-2 !text-xs"><Link2 className="h-4 w-4" /> Connect systems</button>
          </div>
        </div>
      </section>
    )}
    <section className="spr-panel p-6 md:p-9">
      <div className="grid gap-8 xl:grid-cols-[1.35fr_.65fr] xl:items-end"><div>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#3794ff]"><span className="rounded-sm border border-[#3c3c3c] bg-[#094771] px-3 py-1.5">SPR infrastructure</span><span className="rounded-sm border border-[#3c3c3c] px-3 py-1.5 text-[#6f6f6f]">Evidence-first</span></div>
        <h1 className="max-w-4xl text-4xl font-semibold tracking-[-.045em] text-[#d4d4d4] md:text-6xl">The trust layer for the software world.</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-[#9d9d9d] md:text-lg">Connect the systems that build, ship, run and govern software. SPR turns them into one observable software reality—identity, evidence, relationships, verification and change.</p>
        <div className="mt-7 flex flex-wrap gap-3"><button onClick={() => onNavigateTab('/integrations')} className="spr-btn spr-btn-primary inline-flex items-center gap-2"><Link2 className="h-4 w-4" /> Connect systems</button><button onClick={() => setTourOpen(true)} className="spr-btn spr-btn-secondary inline-flex items-center gap-2"><PlayCircle className="h-4 w-4" /> Guided tour</button><button onClick={() => setCommandOpen(true)} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 !text-xs"><Command className="h-4 w-4" /> Command <kbd className="rounded-sm border border-[#3c3c3c] px-1.5 py-0.5 text-[9px]">⌘K</kbd></button></div>
      </div><div className="spr-panel-alt p-5"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#6f6f6f]"><Radio className="h-3.5 w-3.5 text-[#3794ff]" /> Workspace state</div><div className="mt-5 flex items-end justify-between"><div><div className="text-3xl font-semibold text-[#d4d4d4]">Observed</div><div className="mt-1 text-xs text-[#6f6f6f]">State reflects records loaded from the workspace</div></div><div className="grid h-12 w-12 place-items-center rounded-md border border-[#3c3c3c] bg-[#094771]"><CheckCircle2 className="h-6 w-6 text-[#3794ff]" /></div></div><div className="mt-5 grid grid-cols-3 gap-2 text-center"><Metric value={passports.length} label="software" /><Metric value={clients.length} label="organizations" /><Metric value={activeAlerts} label="attention" /></div></div></div>
    </section>

    <section className="spr-panel p-6">
      <div className="flex items-center justify-between"><div className="text-xs font-semibold text-[#d4d4d4]">Portfolio health</div><div className="text-[11px] text-[#6f6f6f]">Computed from loaded passport, finding, and client records</div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <HealthTile icon={FileCheck2} label="Verified passports" value={`${portfolio.verifiedPassports} / ${passports.length}`} onClick={() => onNavigateTab('/passports')} accent="text-[#89d185]" />
        {/* Reported as a fraction, not a percentage. This counts passports
            carrying ANY evidence at all - it says nothing about whether that
            evidence is complete. Rendered as "100%" next to a passport marked
            "Evidence Incomplete" it read as a completeness/safety claim, which
            is precisely the overclaim SPR exists to avoid. "1 of 1" is
            self-evidently a weak signal; "100%" is not. */}
        <HealthTile icon={Database} label="Passports carrying evidence" value={`${portfolio.evidenceBearing} of ${portfolio.totalPassports}`} onClick={() => onNavigateTab('/coverage')} accent="text-[#3794ff]" />
        <HealthTile icon={AlertOctagon} label="Critical findings" value={String(portfolio.criticalFindings)} onClick={() => onNavigateTab('/security')} accent={portfolio.criticalFindings > 0 ? 'text-[#f14c4c]' : 'text-[#d4d4d4]'} />
        <HealthTile icon={Bug} label="Open vulnerabilities" value={String(portfolio.openVulnerabilities)} onClick={() => onNavigateTab('/passports')} accent={portfolio.openVulnerabilities > 0 ? 'text-[#cca700]' : 'text-[#d4d4d4]'} />
        <HealthTile icon={Scale} label="Compliance posture" value={portfolio.complianceAverage === null ? 'No clients' : `${portfolio.complianceAverage}%`} onClick={() => onNavigateTab('/compliance')} accent="text-[#3794ff]" />
      </div>
    </section>

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Surface icon={Network} title="Software graph" value={`${passports.length} identities`} text="Persistent software objects and their relationships." onClick={() => onNavigateTab('/passports')} /><Surface icon={Database} title="Evidence fabric" value={`${scans.length} observations`} text="Trace every claim to its source, timestamp, and hash." onClick={() => onNavigateTab('/evidence-explorer')} /><Surface icon={Activity} title="Change stream" value={`${activeAlerts} active`} text="Events that can alter trust state." onClick={() => onNavigateTab('/monitoring')} /><Surface icon={ShieldCheck} title="Verification" value="Evidence-first" text="Observed, derived, stale and unknown stay distinct." onClick={() => onNavigateTab('/security')} /></section>

    <section className="grid gap-6 xl:grid-cols-[1fr_1.1fr]"><div className="spr-panel p-6"><div className="flex items-center justify-between"><div><div className="text-xs font-semibold text-[#d4d4d4]">Connect the ecosystem</div><div className="mt-1 text-xs text-[#6f6f6f]">SPR is designed to sit across the stack.</div></div><button onClick={() => onNavigateTab('/integrations')} className="text-xs font-semibold text-[#3794ff]">View connectors →</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{CONNECTOR_GROUPS.map(({ title, icon: Icon, items }) => <div key={title} className="rounded-md border border-[#3c3c3c] bg-[#252526] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#d4d4d4]"><Icon className="h-4 w-4 text-[#3794ff]" />{title}</div><div className="mt-3 flex flex-wrap gap-1.5">{items.map(item => <span key={item} className="rounded-sm border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-1 text-[10px] text-[#9d9d9d]">{item}</span>)}</div></div>)}</div></div>
      <div className="spr-panel p-6"><div className="flex items-center justify-between"><div><div className="text-xs font-semibold text-[#d4d4d4]">Software reality</div><div className="mt-1 text-xs text-[#6f6f6f]">Search the objects SPR knows about.</div></div><button onClick={() => onNavigateTab('/passports')} className="text-xs font-semibold text-[#3794ff]">Open registry →</button></div><div className="relative mt-5"><Search className="absolute left-3 top-3 h-4 w-4 text-[#6f6f6f]" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search software, publisher, version…" className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] py-3 pl-10 pr-4 text-sm text-[#d4d4d4] outline-none placeholder:text-[#6f6f6f] focus:border-[#3794ff]" />{results.length > 0 && <div className="absolute left-0 right-0 top-14 z-20 spr-panel-alt overflow-hidden p-2">{results.map((p: any) => <button key={p.id} onClick={() => onNavigateTab('/passports', String(p.id))} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-[#383838]"><span className="grid h-8 w-8 place-items-center rounded-md border border-[#3c3c3c] bg-[#094771]"><Box className="h-4 w-4 text-[#3794ff]" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-[#d4d4d4]">{p.name}</span><span className="block truncate text-[10px] text-[#6f6f6f]">{p.publisher || 'Unknown publisher'} · {p.version || 'unknown version'}</span></span><ArrowUpRight className="h-4 w-4 text-[#6f6f6f]" /></button>)}</div>}</div><div className="mt-6 rounded-md border border-[#3c3c3c] bg-[#252526] p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-[#094771]"><Sparkles className="h-4 w-4 text-[#3794ff]" /></div><div><div className="text-xs font-semibold text-[#d4d4d4]">AI explains. Evidence decides.</div><div className="mt-1 text-[11px] leading-5 text-[#6f6f6f]">SPR can explain the system without turning an inference into a fact.</div></div></div></div></div></section>

    <section className="spr-panel p-6 md:p-7"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2 text-xs font-semibold text-[#d4d4d4]"><Layers3 className="h-4 w-4 text-[#3794ff]" /> One system. Many depths.</div><p className="mt-2 max-w-2xl text-sm leading-6 text-[#9d9d9d]">Executives see state. Engineers see relationships. Security sees evidence. Agents can query the same underlying trust fabric.</p></div><button onClick={() => onNavigateTab('/agent-trust')} className="spr-btn spr-btn-secondary inline-flex shrink-0 items-center gap-2">Explore agent trust <ArrowUpRight className="h-4 w-4" /></button></div></section>

    {tourOpen && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4"><div className="w-full max-w-xl spr-panel p-6 md:p-8"><div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[.22em] text-[#3794ff]">SPR guided tour</div><button onClick={finishTour} className="rounded-sm p-2 text-[#6f6f6f] hover:bg-[#383838] hover:text-[#d4d4d4]"><X className="h-4 w-4" /></button></div><div className="mt-6 flex items-center gap-2">{TOUR.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= tourStep ? 'bg-[#3794ff]' : 'bg-[#3c3c3c]'}`} />)}</div><div className="mt-8 text-4xl font-semibold tracking-tight text-[#d4d4d4]">{TOUR[tourStep][0]}</div><h2 className="mt-3 text-2xl font-semibold text-[#d4d4d4]">{TOUR[tourStep][1]}</h2><p className="mt-3 text-sm leading-7 text-[#9d9d9d]">{TOUR[tourStep][2]}</p><div className="mt-8 flex justify-between"><button onClick={() => setTourStep(s => Math.max(0, s - 1))} disabled={tourStep === 0} className="rounded-md border border-[#3c3c3c] px-4 py-2.5 text-xs text-[#9d9d9d] disabled:opacity-30">Back</button>{tourStep === TOUR.length - 1 ? <button onClick={finishTour} className="spr-btn spr-btn-primary !text-xs">Enter SPR</button> : <button onClick={() => setTourStep(s => s + 1)} className="spr-btn spr-btn-primary inline-flex items-center gap-2 !text-xs">Next <ChevronRight className="h-4 w-4" /></button>}</div></div></div>}
    {commandOpen && <div className="fixed inset-0 z-[90] bg-black/60 p-4" onMouseDown={() => setCommandOpen(false)}><div className="mx-auto mt-[12vh] max-w-2xl spr-panel overflow-hidden" onMouseDown={e => e.stopPropagation()}><div className="flex items-center gap-3 border-b border-[#3c3c3c] px-4"><Command className="h-4 w-4 text-[#3794ff]" /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Go to software, evidence, monitoring…" className="flex-1 bg-transparent py-4 text-sm text-[#d4d4d4] outline-none placeholder:text-[#6f6f6f]" /><button onClick={() => setCommandOpen(false)}><X className="h-4 w-4 text-[#6f6f6f]" /></button></div><div className="p-2">{[['/passports','Software registry','Browse software identities'],['/integrations','Connectors','Connect the ecosystem'],['/scans','Evidence','Inspect observations'],['/monitoring','Monitoring','See change over time'],['/security','Verification','Inspect trust evidence']].map(([path,label,desc]) => <button key={path} onClick={() => { setCommandOpen(false); onNavigateTab(path); }} className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-[#383838]"><Terminal className="h-4 w-4 text-[#6f6f6f]" /><span className="flex-1"><span className="block text-xs font-semibold text-[#d4d4d4]">{label}</span><span className="block text-[10px] text-[#6f6f6f]">{desc}</span></span><ChevronRight className="h-4 w-4 text-[#6f6f6f]" /></button>)}</div></div></div>}
  </div>;
}

function Metric({ value, label }: { value: number; label: string }) { return <div className="rounded-md border border-[#3c3c3c] bg-[#252526] px-2 py-2"><div className="text-sm font-semibold text-[#d4d4d4]">{value}</div><div className="text-[9px] uppercase tracking-[.15em] text-[#6f6f6f]">{label}</div></div>; }
function HealthTile({ icon: Icon, label, value, onClick, accent }: { icon: any; label: string; value: string; onClick: () => void; accent: string }) { return <button onClick={onClick} className="group rounded-md border border-[#3c3c3c] bg-[#252526] p-4 text-left transition hover:bg-[#383838]"><div className="flex items-center justify-between"><Icon className={`h-4 w-4 ${accent}`} /><ArrowUpRight className="h-3.5 w-3.5 text-[#6f6f6f] transition group-hover:text-[#3794ff]" /></div><div className={`mt-3 text-xl font-semibold ${accent}`}>{value}</div><div className="mt-1 text-[10px] uppercase tracking-[.14em] text-[#6f6f6f]">{label}</div></button>; }
function Surface({ icon: Icon, title, value, text, onClick }: { icon: any; title: string; value: string; text: string; onClick: () => void }) { return <button onClick={onClick} className="group rounded-md border border-[#3c3c3c] bg-[#252526] p-5 text-left transition hover:bg-[#383838]"><div className="flex items-start justify-between"><span className="grid h-10 w-10 place-items-center rounded-md border border-[#3c3c3c] bg-[#2d2d2d]"><Icon className="h-4 w-4 text-[#3794ff]" /></span><ArrowUpRight className="h-4 w-4 text-[#6f6f6f] transition group-hover:text-[#3794ff]" /></div><div className="mt-5 text-xs font-semibold text-[#d4d4d4]">{title}</div><div className="mt-1 text-lg font-semibold text-[#3794ff]">{value}</div><p className="mt-2 text-[11px] leading-5 text-[#9d9d9d]">{text}</p></button>; }
