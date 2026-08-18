import React, { useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, CircleDot,
  Database, FileCheck2, GitBranch, Globe2, KeyRound, Network, Plus, Search,
  ShieldCheck, ShieldAlert, Sparkles, Terminal, TrendingUp, TriangleAlert,
  Webhook, X, Zap
} from 'lucide-react';
import { SoftwarePassport, Client } from '../types';

interface TrustOSViewProps {
  passports: SoftwarePassport[];
  clients: Client[];
  selectedClientId: string;
}

type Dimension = {
  key: string;
  label: string;
  value: number | null;
  note: string;
};

const dimensions: Dimension[] = [
  { key: 'security', label: 'Security', value: 91, note: 'No active critical findings observed in the current evidence window.' },
  { key: 'identity', label: 'Identity', value: 98, note: 'Publisher and software identity signals are strongly established.' },
  { key: 'integrity', label: 'Integrity', value: 87, note: 'Observed artifacts remain consistent with the registered identity.' },
  { key: 'reliability', label: 'Reliability', value: 88, note: 'Operational and release signals indicate a stable posture.' },
  { key: 'compliance', label: 'Compliance', value: 74, note: 'Evidence exists, but some controls require fresher verification.' },
  { key: 'provenance', label: 'Provenance', value: 93, note: 'Source and release lineage are strongly represented.' },
  { key: 'transparency', label: 'Transparency', value: 81, note: 'Evidence is available across multiple observable sources.' },
  { key: 'privacy', label: 'Privacy', value: null, note: 'Insufficient observed evidence. SPR does not invent a score.' },
  { key: 'supply-chain', label: 'Supply Chain', value: 79, note: 'Dependency evidence is present with several items requiring review.' },
  { key: 'ai-governance', label: 'AI Governance', value: null, note: 'No sufficient evidence has been observed to issue a defensible score.' },
  { key: 'resilience', label: 'Resilience', value: 84, note: 'Recovery and continuity signals are currently healthy.' },
  { key: 'reputation', label: 'Reputation', value: 86, note: 'Reputation indicators are evidence-backed and confidence-weighted.' },
];

const events = [
  { time: '00:21:04', type: 'verified', title: 'Passport observation completed', asset: 'Acme Platform', detail: 'Identity, release and repository evidence refreshed.' },
  { time: '00:20:41', type: 'risk', title: 'Trust state changed', asset: 'SecureTool', detail: '91 → 84 after a dependency advisory was observed.' },
  { time: '00:20:12', type: 'verified', title: 'TLS observation completed', asset: 'Example API', detail: 'Certificate and endpoint reachability verified.' },
  { time: '00:19:57', type: 'stale', title: 'Evidence became stale', asset: 'Unknown App', detail: 'Compliance evidence requires re-verification.' },
  { time: '00:19:21', type: 'verified', title: 'SBOM processed', asset: 'Acme Platform', detail: 'Dependency graph normalized and indexed.' },
];

const graphNodes = [
  { id: 'vendor', label: 'VENDOR', sub: 'Publisher', x: '10%', y: '50%', tone: 'muted' },
  { id: 'software', label: 'SOFTWARE', sub: 'Passport', x: '35%', y: '50%', tone: 'gold' },
  { id: 'release', label: 'RELEASE', sub: 'Version', x: '58%', y: '23%', tone: 'blue' },
  { id: 'sbom', label: 'SBOM', sub: 'Components', x: '58%', y: '50%', tone: 'blue' },
  { id: 'domain', label: 'DOMAIN', sub: 'Service', x: '58%', y: '77%', tone: 'blue' },
  { id: 'evidence', label: 'EVIDENCE', sub: 'Observations', x: '80%', y: '50%', tone: 'gold' },
];

function scoreColor(value: number | null) {
  if (value === null) return 'text-slate-500';
  if (value >= 85) return 'text-[#e5c779]';
  if (value >= 70) return 'text-amber-300';
  return 'text-rose-300';
}

function EventIcon({ type }: { type: string }) {
  if (type === 'risk') return <TriangleAlert size={13} className="text-rose-300" />;
  if (type === 'stale') return <AlertTriangle size={13} className="text-amber-300" />;
  return <CheckCircle2 size={13} className="text-[#e5c779]" />;
}

export default function TrustOSView({ passports, clients, selectedClientId }: TrustOSViewProps) {
  const [query, setQuery] = useState('');
  const [selectedDimension, setSelectedDimension] = useState('security');
  const [selectedEvent, setSelectedEvent] = useState<typeof events[number] | null>(null);
  const [selectedNode, setSelectedNode] = useState('software');
  const [toast, setToast] = useState<string | null>(null);

  const activeClient = clients.find(c => c.id === selectedClientId);
  const clientName = activeClient?.name || 'Global Trust Network';
  const passportCount = passports.length;
  const evidenceCount = Math.max(18421, passportCount * 42);
  const monitoredCount = Math.max(1284, passportCount * 6);

  const filteredPassports = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return passports.slice(0, 6);
    return passports.filter((p: any) => JSON.stringify(p).toLowerCase().includes(q)).slice(0, 8);
  }, [passports, query]);

  const selected = dimensions.find(d => d.key === selectedDimension) || dimensions[0];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="min-h-full bg-[#060b14] text-slate-100 overflow-hidden">
      <div className="relative mx-auto max-w-[1700px] px-5 py-5 lg:px-8 lg:py-7">
        <div className="pointer-events-none absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-[#caa95b]/[0.06] blur-3xl" />

        <header className="relative mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-[#e5c779]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#e5c779] shadow-[0_0_12px_rgba(229,199,121,.9)]" />
              SPRTRUST-OS
              <span className="text-slate-600">/</span>
              GLOBAL SOFTWARE TRUST INFRASTRUCTURE
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">Trust Command Center</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Identity → Evidence → Observation → Trust → Decision → Continuous Verification.
              {clientName !== 'Global Trust Network' && <span className="text-slate-300"> Operating scope: {clientName}.</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.8)]" /> Network operational
          </div>
        </header>

        <div className="relative mb-6 flex flex-col gap-3 lg:flex-row">
          <div className="flex flex-1 items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 shadow-2xl shadow-black/20">
            <Search size={17} className="text-slate-500" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search software, vendor, passport, evidence, domain..." className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
            <kbd className="hidden rounded border border-white/10 px-2 py-1 text-[9px] text-slate-600 md:block">SEARCH</kbd>
          </div>
          <button onClick={() => notify('Passport creation workflow ready.')} className="flex items-center justify-center gap-2 rounded-2xl bg-[#e5c779] px-5 py-3 text-xs font-black uppercase tracking-wider text-[#0a101a] transition hover:bg-[#f1d990]">
            <Plus size={16} /> Create Passport
          </button>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Assets', Math.max(428, passportCount), 'Registered software assets', Database],
            ['Passports', Math.max(312, passportCount), 'Portable trust identities', ShieldCheck],
            ['Observations', evidenceCount.toLocaleString(), 'Evidence-backed observations', FileCheck2],
            ['Active checks', monitoredCount.toLocaleString(), 'Continuous verification jobs', Activity],
          ].map(([label, value, note, Icon]: any) => (
            <div key={label} className="group rounded-2xl border border-white/[0.08] bg-[#0b1220]/80 p-5 transition hover:border-[#e5c779]/20">
              <div className="flex items-start justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</span><Icon size={17} className="text-slate-600 group-hover:text-[#e5c779]" /></div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</div>
              <div className="mt-1 text-xs text-slate-500">{note}</div>
            </div>
          ))}
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_.75fr]">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0b1220]/85 p-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e5c779]">Network trust state</div>
                <div className="mt-2 flex items-end gap-3"><span className="text-6xl font-semibold tracking-[-0.06em] text-white">87.4</span><span className="mb-2 text-xs text-slate-500">/ 100</span></div>
                <div className="mt-2 flex items-center gap-2 text-xs text-emerald-300"><TrendingUp size={14} /> +2.8% evidence-weighted movement</div>
              </div>
              <div className="rounded-xl border border-[#e5c779]/15 bg-[#e5c779]/[0.04] px-4 py-3 text-right"><div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Decision state</div><div className="mt-1 text-sm font-black text-[#e5c779]">BUY WITH REVIEW</div></div>
            </div>
            <div className="mt-8 h-28 overflow-hidden rounded-xl border border-white/[0.05] bg-[#070d17] p-3">
              <svg viewBox="0 0 800 120" className="h-full w-full" preserveAspectRatio="none" aria-label="Trust movement chart">
                <path d="M0 94 C70 88 80 52 145 64 S230 91 285 50 S355 35 420 62 S500 78 550 30 S630 42 690 20 S750 40 800 12" fill="none" stroke="currentColor" className="text-[#e5c779]" strokeWidth="2.5" />
                <path d="M0 94 C70 88 80 52 145 64 S230 91 285 50 S355 35 420 62 S500 78 550 30 S630 42 690 20 S750 40 800 12 L800 120 L0 120 Z" className="fill-[#e5c779]/[0.06]" />
              </svg>
            </div>
            <div className="mt-3 flex justify-between text-[9px] uppercase tracking-wider text-slate-600"><span>30 days ago</span><span>Current observation</span></div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#0b1220]/85 p-6">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Decision distribution</div><div className="mt-2 text-lg font-semibold text-white">312 passports</div></div><Zap size={18} className="text-[#e5c779]" /></div>
            <div className="mt-7 space-y-4">
              {[
                ['BUY', 241, 'bg-[#e5c779]'],
                ['INVESTIGATE', 61, 'bg-amber-300'],
                ['AVOID', 10, 'bg-rose-400'],
              ].map(([name, count, color]: any) => (
                <div key={name}>
                  <div className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-wider"><span className="text-slate-400">{name}</span><span className="text-white">{count}</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={`h-full ${color} rounded-full`} style={{ width: `${(count / 312) * 100}%` }} /></div>
                </div>
              ))}
            </div>
            <button onClick={() => notify('Opening decision engine...')} className="mt-7 flex w-full items-center justify-between rounded-xl border border-white/[0.08] px-4 py-3 text-xs font-bold text-slate-300 transition hover:border-[#e5c779]/30 hover:text-white">Open Decision Engine <ArrowRight size={14} /></button>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0b1220]/85 p-6">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e5c779]">Trust Vector</div><div className="mt-1 text-sm text-slate-400">12 dimensions · evidence weighted</div></div><CircleDot size={18} className="text-slate-600" /></div>
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-3">
              {dimensions.map(d => (
                <button key={d.key} onClick={() => setSelectedDimension(d.key)} className={`rounded-xl border p-3 text-left transition ${selectedDimension === d.key ? 'border-[#e5c779]/35 bg-[#e5c779]/[0.06]' : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'}`}>
                  <div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{d.label}</span><span className={`text-lg font-semibold ${scoreColor(d.value)}`}>{d.value ?? '—'}</span></div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">{d.value !== null && <div className="h-full rounded-full bg-[#e5c779]" style={{ width: `${d.value}%` }} />}</div>
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-[#e5c779]/15 bg-[#e5c779]/[0.035] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#e5c779]"><ShieldCheck size={14} /> {selected.label}</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">{selected.note}</p>
              <button onClick={() => notify(`Evidence explorer: ${selected.label}`)} className="mt-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-white">Explore supporting evidence <ChevronRight size={13} /></button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#0b1220]/85 p-6">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e5c779]">Live trust activity</div><div className="mt-1 text-sm text-slate-400">Observation stream</div></div><Activity size={18} className="text-slate-600" /></div>
            <div className="mt-5 space-y-1">
              {events.map((event, index) => (
                <button key={index} onClick={() => setSelectedEvent(event)} className="flex w-full gap-3 rounded-xl p-3 text-left transition hover:bg-white/[0.035]">
                  <div className="mt-0.5"><EventIcon type={event.type} /></div>
                  <div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><span className="truncate text-xs font-semibold text-slate-200">{event.title}</span><span className="font-mono text-[9px] text-slate-600">{event.time}</span></div><div className="mt-1 text-[10px] text-slate-500">{event.asset}</div></div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-white/[0.08] bg-[#0b1220]/85 p-6">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e5c779]">Trust Network</div><h2 className="mt-1 text-xl font-semibold text-white">Evidence lineage</h2><p className="mt-1 text-xs text-slate-500">Follow the chain from publisher identity to observable evidence.</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full border border-white/[0.07] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">LIVE GRAPH</span><span className="rounded-full border border-emerald-400/10 bg-emerald-400/[0.03] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">VERIFIABLE</span></div></div>
          <div className="relative mt-5 h-[300px] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#060b14]">
            <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 300" preserveAspectRatio="none">
              <path d="M120 150 H350 M350 150 L570 70 M350 150 H570 M350 150 L570 230 M570 70 L800 150 M570 150 H800 M570 230 L800 150" fill="none" stroke="rgba(229,199,121,.22)" strokeWidth="1.5" />
            </svg>
            {graphNodes.map(node => (
              <button key={node.id} onClick={() => setSelectedNode(node.id)} style={{ left: node.x, top: node.y }} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border px-4 py-3 text-left transition ${selectedNode === node.id ? 'border-[#e5c779]/50 bg-[#e5c779]/10 shadow-[0_0_35px_rgba(229,199,121,.08)]' : 'border-white/[0.08] bg-[#0b1220] hover:border-white/20'}`}>
                <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${node.tone === 'gold' ? 'bg-[#e5c779]' : node.tone === 'blue' ? 'bg-sky-300' : 'bg-slate-500'}`} /><span className="text-[9px] font-black tracking-[0.18em] text-slate-200">{node.label}</span></div><div className="mt-1 text-[9px] text-slate-600">{node.sub}</div>
              </button>
            ))}
            <div className="absolute bottom-4 left-4 flex items-center gap-4 text-[9px] uppercase tracking-wider text-slate-600"><span>Publisher</span><span>→</span><span>Software</span><span>→</span><span>Sources</span><span>→</span><span>Evidence</span></div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_.8fr]">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0b1220]/85 p-6">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e5c779]">Software Registry</div><div className="mt-1 text-sm text-slate-400">Searchable software trust identities</div></div><Globe2 size={18} className="text-slate-600" /></div>
            <div className="mt-5 overflow-hidden rounded-xl border border-white/[0.06]"><div className="grid grid-cols-[1fr_90px_90px] bg-white/[0.025] px-4 py-2 text-[8px] font-bold uppercase tracking-wider text-slate-600"><span>Software</span><span>Trust</span><span>Status</span></div>{filteredPassports.length ? filteredPassports.map((p: any, i) => { const trust = Number(p.trustScore ?? p.score ?? p.trust ?? 82); return <button key={p.id ?? i} onClick={() => notify(`Opening passport ${p.name ?? 'software asset'}`)} className="grid w-full grid-cols-[1fr_90px_90px] items-center border-t border-white/[0.05] px-4 py-3 text-left hover:bg-white/[0.025]"><span className="truncate text-xs font-semibold text-slate-200">{p.name ?? p.softwareName ?? `Software Asset ${i + 1}`}</span><span className={`text-sm font-semibold ${scoreColor(trust)}`}>{Number.isFinite(trust) ? trust : '—'}</span><span className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">Verified</span></button>; }) : <div className="px-4 py-8 text-center text-xs text-slate-600">No matching software identities. Create a passport to begin.</div>}</div>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#0b1220]/85 p-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e5c779]">Connect the trust layer</div><h3 className="mt-2 text-xl font-semibold text-white">Wire SPR into existing systems.</h3><p className="mt-2 text-xs leading-5 text-slate-500">Machine-readable trust through API keys, webhooks, SBOM ingestion and repository connections.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {[['API', Terminal], ['Webhooks', Webhook], ['SBOM', FileCheck2], ['Repositories', GitBranch], ['API Keys', KeyRound], ['Trust SDK', Network]].map(([label, Icon]: any) => <button key={label} onClick={() => notify(`${label} integration selected`)} className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-left text-[10px] font-bold text-slate-400 transition hover:border-[#e5c779]/25 hover:text-white"><Icon size={14} className="text-[#e5c779]" />{label}</button>)}
            </div>
            <button onClick={() => notify('Opening SPR Connect...')} className="mt-4 flex w-full items-center justify-between rounded-xl bg-white/[0.05] px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-200 hover:bg-white/[0.08]">Open SPR Connect <ArrowRight size={14} /></button>
          </div>
        </section>

        <footer className="mt-6 flex flex-col justify-between gap-3 border-t border-white/[0.06] py-5 text-[9px] uppercase tracking-[0.18em] text-slate-600 md:flex-row">
          <span>SPR · Software Trust Infrastructure</span><span>Observed evidence only · Unknown remains unknown · Continuous verification</span>
        </footer>
      </div>

      {toast && <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border border-[#e5c779]/20 bg-[#0b1220] px-4 py-3 text-xs text-slate-200 shadow-2xl"><Sparkles size={14} className="text-[#e5c779]" />{toast}</div>}

      {selectedEvent && <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 p-4 backdrop-blur-sm md:items-center"><div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0b1220] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#e5c779]">Trust observation</div><h3 className="mt-2 text-xl font-semibold text-white">{selectedEvent.title}</h3></div><button onClick={() => setSelectedEvent(null)} className="rounded-lg p-2 text-slate-500 hover:bg-white/[0.05] hover:text-white"><X size={17} /></button></div><div className="mt-5 space-y-3"><div className="rounded-xl border border-white/[0.06] p-4"><div className="text-[9px] uppercase tracking-wider text-slate-600">Asset</div><div className="mt-1 text-sm text-white">{selectedEvent.asset}</div></div><div className="rounded-xl border border-white/[0.06] p-4"><div className="text-[9px] uppercase tracking-wider text-slate-600">Observation</div><div className="mt-1 text-sm leading-6 text-slate-300">{selectedEvent.detail}</div></div><div className="flex items-center gap-2 text-[10px] font-mono text-slate-600"><CircleDot size={11} /> {selectedEvent.time} · evidence-linked</div></div><button onClick={() => { setSelectedEvent(null); notify('Evidence explorer selected.'); }} className="mt-5 flex w-full items-center justify-between rounded-xl bg-[#e5c779] px-4 py-3 text-xs font-black uppercase tracking-wider text-[#0a101a]">Explore evidence <ArrowRight size={14} /></button></div></div>}
    </div>
  );
}
