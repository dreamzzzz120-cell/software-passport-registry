import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Box, CheckCircle2, ChevronRight, Cloud, Code2, Command, Database, GitBranch, Globe2, Layers3, Link2, LockKeyhole, Network, Package, PlayCircle, Radio, Search, ShieldCheck, Sparkles, Terminal, X } from 'lucide-react';

type Props = {
  passports: any[];
  scans: any[];
  alerts: any[];
  integrations: any[];
  onNavigateTab: (path: string, id?: string) => void;
};

const CONNECTOR_GROUPS = [
  { title: 'Code & supply chain', icon: Code2, items: ['GitHub', 'GitLab', 'Bitbucket', 'Package registries', 'SBOMs'] },
  { title: 'Cloud & runtime', icon: Cloud, items: ['AWS', 'Azure', 'Google Cloud', 'Kubernetes', 'Containers'] },
  { title: 'Identity & enterprise', icon: LockKeyhole, items: ['Microsoft', 'Google', 'Okta', 'ServiceNow', 'SaaS'] },
  { title: 'Security & evidence', icon: ShieldCheck, items: ['Advisory feeds', 'Scanners', 'Certificates', 'Attestations', 'Provenance'] },
];

const TOUR = [
  ['01', 'Connect your environment', 'Bring repositories, cloud, identity, SBOM, security and runtime evidence into one system.'],
  ['02', 'Discover software reality', 'SPR resolves software into durable identities and maps the relationships between assets.'],
  ['03', 'Verify what is known', 'Every important statement stays traceable to observed evidence, with uncertainty exposed instead of hidden.'],
  ['04', 'Operate continuously', 'Changes, drift, new dependencies and new evidence become events in the same trust system.'],
];

export default function InfrastructureHomeView({ passports, scans, alerts, integrations, onNavigateTab }: Props) {
  const [tourOpen, setTourOpen] = useState(() => localStorage.getItem('spr-infrastructure-tour') !== 'complete');
  const [tourStep, setTourStep] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); }
      if (event.key === 'Escape') { setCommandOpen(false); setTourOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const connected = integrations.filter((item: any) => Boolean(item.connected)).length;
  const activeAlerts = alerts.filter((item: any) => item.status !== 'Resolved').length;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return passports.filter((p: any) => `${p.name} ${p.version} ${p.publisher}`.toLowerCase().includes(q)).slice(0, 6);
  }, [passports, query]);

  const finishTour = () => { localStorage.setItem('spr-infrastructure-tour', 'complete'); setTourOpen(false); };

  return <div className="space-y-6 pb-10">
    <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[.035] p-6 shadow-2xl backdrop-blur-2xl md:p-9">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-300/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl" />
      <div className="relative grid gap-8 xl:grid-cols-[1.35fr_.65fr] xl:items-end">
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200"><span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5">SPR infrastructure</span><span className="rounded-full border border-white/10 bg-white/[.035] px-3 py-1.5 text-slate-500">Evidence-first</span></div>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-[-.045em] text-white md:text-6xl">The trust layer for the software world.</h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-400 md:text-lg">Connect the systems that build, ship, run and govern software. SPR turns them into one observable software reality—identity, evidence, relationships, verification and change.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={() => onNavigateTab('/integrations')} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 shadow-[0_10px_40px_rgba(34,211,238,.15)]"><Link2 className="h-4 w-4" /> Connect systems</button>
            <button onClick={() => setTourOpen(true)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] px-5 py-3 text-sm font-semibold text-slate-200"><PlayCircle className="h-4 w-4" /> Guided tour</button>
            <button onClick={() => setCommandOpen(true)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3 text-xs text-slate-400"><Command className="h-4 w-4" /> Command <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[9px]">⌘K</kbd></button>
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-black/20 p-5 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500"><Radio className="h-3.5 w-3.5 text-emerald-300" /> System state</div>
          <div className="mt-5 flex items-end justify-between"><div><div className="text-3xl font-semibold text-white">Operational</div><div className="mt-1 text-xs text-slate-500">Observing connected surfaces</div></div><div className="grid h-12 w-12 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10"><CheckCircle2 className="h-6 w-6 text-emerald-300" /></div></div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center"><Metric value={passports.length} label="software" /><Metric value={connected} label="connected" /><Metric value={activeAlerts} label="attention" /></div>
        </div>
      </div>
    </section>

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Surface icon={Network} title="Software graph" value={`${passports.length || 0} identities`} text="Persistent software objects and their relationships." onClick={() => onNavigateTab('/passports')} />
      <Surface icon={Database} title="Evidence fabric" value={`${scans.length || 0} observations`} text="Evidence collected from connected systems." onClick={() => onNavigateTab('/scans')} />
      <Surface icon={Activity} title="Change stream" value={`${activeAlerts} active`} text="Events that can alter trust state." onClick={() => onNavigateTab('/monitoring')} />
      <Surface icon={ShieldCheck} title="Verification" value="Evidence-first" text="Observed, derived, stale and unknown stay distinct." onClick={() => onNavigateTab('/security')} />
    </section>

    <section className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
      <div className="rounded-3xl border border-white/10 bg-white/[.025] p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between"><div><div className="text-xs font-semibold text-white">Connect the ecosystem</div><div className="mt-1 text-xs text-slate-500">SPR is designed to sit across the stack.</div></div><button onClick={() => onNavigateTab('/integrations')} className="text-xs font-semibold text-cyan-200">View connectors →</button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{CONNECTOR_GROUPS.map(({ title, icon: Icon, items }) => <div key={title} className="rounded-2xl border border-white/[.07] bg-black/15 p-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-200"><Icon className="h-4 w-4 text-cyan-200" />{title}</div><div className="mt-3 flex flex-wrap gap-1.5">{items.map(item => <span key={item} className="rounded-full border border-white/[.07] bg-white/[.025] px-2 py-1 text-[10px] text-slate-500">{item}</span>)}</div></div>)}</div>
      </div>
      <div className="rounded-3xl border border-white/10 bg-white/[.025] p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between"><div><div className="text-xs font-semibold text-white">Software reality</div><div className="mt-1 text-xs text-slate-500">Search the objects SPR knows about.</div></div><button onClick={() => onNavigateTab('/passports')} className="text-xs font-semibold text-cyan-200">Open registry →</button></div>
        <div className="relative mt-5"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-600" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search software, publisher, version…" className="w-full rounded-2xl border border-white/10 bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/30" />{results.length > 0 && <div className="absolute left-0 right-0 top-14 z-20 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f18]/95 p-2 shadow-2xl backdrop-blur-2xl">{results.map((p: any) => <button key={p.id} onClick={() => onNavigateTab('/passports', String(p.id))} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[.05]"><span className="grid h-8 w-8 place-items-center rounded-lg border border-cyan-300/15 bg-cyan-300/10"><Box className="h-4 w-4 text-cyan-200" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-white">{p.name}</span><span className="block truncate text-[10px] text-slate-500">{p.publisher || 'Unknown publisher'} · {p.version || 'unknown version'}</span></span><ArrowUpRight className="h-4 w-4 text-slate-600" /></button>)}</div>}</div>
        <div className="mt-6 rounded-2xl border border-white/[.07] bg-black/15 p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-300/10"><Sparkles className="h-4 w-4 text-violet-200" /></div><div><div className="text-xs font-semibold text-slate-200">AI explains. Evidence decides.</div><div className="mt-1 text-[11px] leading-5 text-slate-500">SPR can explain the system without turning an inference into a fact.</div></div></div></div>
      </div>
    </section>

    <section className="rounded-3xl border border-white/10 bg-gradient-to-r from-white/[.035] to-transparent p-6 backdrop-blur-xl md:p-7"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2 text-xs font-semibold text-white"><Layers3 className="h-4 w-4 text-cyan-200" /> One system. Many depths.</div><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Executives see state. Engineers see relationships. Security sees evidence. Agents can query the same underlying trust fabric.</p></div><button onClick={() => onNavigateTab('/agent-trust')} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-xs font-semibold text-slate-200">Explore agent trust <ArrowUpRight className="h-4 w-4" /></button></div></section>

    {tourOpen && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-md"><div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-[#0a0f18] p-6 shadow-2xl md:p-8"><div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">SPR guided tour</div><button onClick={finishTour} className="rounded-lg p-2 text-slate-500 hover:bg-white/[.05] hover:text-white"><X className="h-4 w-4" /></button></div><div className="mt-6 flex items-center gap-2">{TOUR.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= tourStep ? 'bg-cyan-300' : 'bg-white/10'}`} />)}</div><div className="mt-8 text-4xl font-semibold tracking-tight text-white">{TOUR[tourStep][0]}</div><h2 className="mt-3 text-2xl font-semibold text-white">{TOUR[tourStep][1]}</h2><p className="mt-3 text-sm leading-7 text-slate-400">{TOUR[tourStep][2]}</p><div className="mt-8 flex justify-between"><button onClick={() => setTourStep(s => Math.max(0, s - 1))} disabled={tourStep === 0} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-400 disabled:opacity-30">Back</button>{tourStep === TOUR.length - 1 ? <button onClick={finishTour} className="rounded-xl bg-cyan-300 px-5 py-2.5 text-xs font-bold text-slate-950">Enter SPR</button> : <button onClick={() => setTourStep(s => s + 1)} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-xs font-bold text-slate-950">Next <ChevronRight className="h-4 w-4" /></button>}</div></div></div>}

    {commandOpen && <div className="fixed inset-0 z-[90] bg-black/60 p-4 backdrop-blur-sm" onMouseDown={() => setCommandOpen(false)}><div className="mx-auto mt-[12vh] max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-[#0a0f18] shadow-2xl" onMouseDown={e => e.stopPropagation()}><div className="flex items-center gap-3 border-b border-white/[.07] px-4"><Command className="h-4 w-4 text-cyan-200" /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Go to software, evidence, monitoring…" className="flex-1 bg-transparent py-4 text-sm text-white outline-none placeholder:text-slate-600" /><button onClick={() => setCommandOpen(false)}><X className="h-4 w-4 text-slate-600" /></button></div><div className="p-2">{[['/passports','Software registry','Browse software identities'],['/integrations','Connectors','Connect the ecosystem'],['/scans','Evidence','Inspect observations'],['/monitoring','Monitoring','See change over time'],['/security','Verification','Inspect trust evidence']].map(([path,label,desc]) => <button key={path} onClick={() => { setCommandOpen(false); onNavigateTab(path); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/[.05]"><Terminal className="h-4 w-4 text-slate-600" /><span className="flex-1"><span className="block text-xs font-semibold text-white">{label}</span><span className="block text-[10px] text-slate-500">{desc}</span></span><ChevronRight className="h-4 w-4 text-slate-700" /></button>)}</div></div></div>}
  </div>;
}

function Metric({ value, label }: { value: number; label: string }) { return <div className="rounded-xl border border-white/[.07] bg-white/[.025] px-2 py-2"><div className="text-sm font-semibold text-white">{value}</div><div className="text-[9px] uppercase tracking-[.15em] text-slate-600">{label}</div></div>; }
function Surface({ icon: Icon, title, value, text, onClick }: { icon: any; title: string; value: string; text: string; onClick: () => void }) { return <button onClick={onClick} className="group rounded-3xl border border-white/[.08] bg-white/[.025] p-5 text-left backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/20 hover:bg-white/[.04]"><div className="flex items-start justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/20"><Icon className="h-4 w-4 text-cyan-200" /></span><ArrowUpRight className="h-4 w-4 text-slate-700 transition group-hover:text-cyan-200" /></div><div className="mt-5 text-xs font-semibold text-white">{title}</div><div className="mt-1 text-lg font-semibold text-cyan-100">{value}</div><p className="mt-2 text-[11px] leading-5 text-slate-500">{text}</p></button>; }
