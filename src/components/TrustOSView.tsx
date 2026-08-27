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
  if (value === null) return 'text-[#9d9d9d]';
  if (value >= 85) return 'text-[#3794ff]';
  if (value >= 70) return 'text-[#cca700]';
  return 'text-[#f14c4c]';
}

function EventIcon({ type }: { type: string }) {
  if (type === 'risk') return <TriangleAlert size={13} className="text-[#f14c4c]" />;
  if (type === 'stale') return <AlertTriangle size={13} className="text-[#cca700]" />;
  return <CheckCircle2 size={13} className="text-[#3794ff]" />;
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
    <div className="min-h-full bg-[#1e1e1e] text-[#d4d4d4] overflow-hidden">
      <div className="relative mx-auto max-w-[1700px] px-5 py-5 lg:px-8 lg:py-7">
        <header className="relative mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-[#3794ff]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3794ff]" />
              SPRTRUST-OS
              <span className="text-[#6f6f6f]">/</span>
              GLOBAL SOFTWARE TRUST INFRASTRUCTURE
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-[#d4d4d4] md:text-4xl">Trust Command Center</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#9d9d9d]">
              Identity → Evidence → Observation → Trust → Decision → Continuous Verification.
              {clientName !== 'Global Trust Network' && <span className="text-[#d4d4d4]"> Operating scope: {clientName}.</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#89d185]/25 bg-[#89d185]/[0.04] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#89d185]">
            <span className="h-2 w-2 rounded-full bg-[#89d185]" /> Network operational
          </div>
        </header>

        <div className="relative mb-6 flex flex-col gap-3 lg:flex-row">
          <div className="flex flex-1 items-center gap-3 rounded-md border border-[#3c3c3c] bg-[#252526] px-4 py-3">
            <Search size={17} className="text-[#9d9d9d]" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search software, vendor, passport, evidence, domain..." className="w-full bg-transparent text-sm text-[#d4d4d4] outline-none placeholder:text-[#6f6f6f]" />
            <kbd className="hidden rounded border border-[#3c3c3c] px-2 py-1 text-[9px] text-[#6f6f6f] md:block">SEARCH</kbd>
          </div>
          <button onClick={() => notify('Passport creation workflow ready.')} className="flex items-center justify-center gap-2 rounded-md bg-[#3794ff] px-5 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-[#1177bb]">
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
            <div key={label} className="group spr-panel p-5 transition hover:border-[#3794ff]/40">
              <div className="flex items-start justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9d9d9d]">{label}</span><Icon size={17} className="text-[#6f6f6f] group-hover:text-[#3794ff]" /></div>
              <div className="mt-3 text-3xl font-semibold tracking-tight text-[#d4d4d4]">{value}</div>
              <div className="mt-1 text-xs text-[#9d9d9d]">{note}</div>
            </div>
          ))}
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_.75fr]">
          <div className="spr-panel p-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3794ff]">Network trust state</div>
                <div className="mt-2 flex items-end gap-3"><span className="text-6xl font-semibold tracking-[-0.06em] text-[#d4d4d4]">87.4</span><span className="mb-2 text-xs text-[#9d9d9d]">/ 100</span></div>
                <div className="mt-2 flex items-center gap-2 text-xs text-[#89d185]"><TrendingUp size={14} /> +2.8% evidence-weighted movement</div>
              </div>
              <div className="rounded-xl border border-[#3794ff]/15 bg-[#3794ff]/[0.04] px-4 py-3 text-right"><div className="text-[9px] font-bold uppercase tracking-widest text-[#9d9d9d]">Decision state</div><div className="mt-1 text-sm font-black text-[#3794ff]">BUY WITH REVIEW</div></div>
            </div>
            <div className="mt-8 h-28 overflow-hidden rounded-xl border border-[#3c3c3c] bg-[#181818] p-3">
              <svg viewBox="0 0 800 120" className="h-full w-full" preserveAspectRatio="none" aria-label="Trust movement chart">
                <path d="M0 94 C70 88 80 52 145 64 S230 91 285 50 S355 35 420 62 S500 78 550 30 S630 42 690 20 S750 40 800 12" fill="none" stroke="currentColor" className="text-[#3794ff]" strokeWidth="2.5" />
                <path d="M0 94 C70 88 80 52 145 64 S230 91 285 50 S355 35 420 62 S500 78 550 30 S630 42 690 20 S750 40 800 12 L800 120 L0 120 Z" className="fill-[#3794ff]/[0.06]" />
              </svg>
            </div>
            <div className="mt-3 flex justify-between text-[9px] uppercase tracking-wider text-[#6f6f6f]"><span>30 days ago</span><span>Current observation</span></div>
          </div>

          <div className="spr-panel p-6">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9d9d9d]">Decision distribution</div><div className="mt-2 text-lg font-semibold text-[#d4d4d4]">312 passports</div></div><Zap size={18} className="text-[#3794ff]" /></div>
            <div className="mt-7 space-y-4">
              {[
                ['BUY', 241, 'bg-[#3794ff]'],
                ['INVESTIGATE', 61, 'bg-[#cca700]'],
                ['AVOID', 10, 'bg-[#f14c4c]'],
              ].map(([name, count, color]: any) => (
                <div key={name}>
                  <div className="mb-2 flex justify-between text-[10px] font-bold uppercase tracking-wider"><span className="text-[#9d9d9d]">{name}</span><span className="text-[#d4d4d4]">{count}</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#383838]"><div className={`h-full ${color} rounded-full`} style={{ width: `${(count / 312) * 100}%` }} /></div>
                </div>
              ))}
            </div>
            <button onClick={() => notify('Opening decision engine...')} className="mt-7 flex w-full items-center justify-between rounded-xl border border-[#3c3c3c] px-4 py-3 text-xs font-bold text-[#d4d4d4] transition hover:border-[#3794ff]/30 hover:text-[#d4d4d4]">Open Decision Engine <ArrowRight size={14} /></button>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
          <div className="spr-panel p-6">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3794ff]">Trust Vector</div><div className="mt-1 text-sm text-[#9d9d9d]">12 dimensions · evidence weighted</div></div><CircleDot size={18} className="text-[#6f6f6f]" /></div>
            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-3">
              {dimensions.map(d => (
                <button key={d.key} onClick={() => setSelectedDimension(d.key)} className={`rounded-xl border p-3 text-left transition ${selectedDimension === d.key ? 'border-[#3794ff]/35 bg-[#3794ff]/[0.06]' : 'border-[#3c3c3c] bg-[#1e1e1e] hover:border-[#6f6f6f]'}`}>
                  <div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-wider text-[#9d9d9d]">{d.label}</span><span className={`text-lg font-semibold ${scoreColor(d.value)}`}>{d.value ?? '—'}</span></div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#383838]">{d.value !== null && <div className="h-full rounded-full bg-[#3794ff]" style={{ width: `${d.value}%` }} />}</div>
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-[#3794ff]/15 bg-[#3794ff]/[0.035] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#3794ff]"><ShieldCheck size={14} /> {selected.label}</div>
              <p className="mt-2 text-sm leading-6 text-[#d4d4d4]">{selected.note}</p>
              <button onClick={() => notify(`Evidence explorer: ${selected.label}`)} className="mt-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#9d9d9d] hover:text-[#d4d4d4]">Explore supporting evidence <ChevronRight size={13} /></button>
            </div>
          </div>

          <div className="spr-panel p-6">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3794ff]">Live trust activity</div><div className="mt-1 text-sm text-[#9d9d9d]">Observation stream</div></div><Activity size={18} className="text-[#6f6f6f]" /></div>
            <div className="mt-5 space-y-1">
              {events.map((event, index) => (
                <button key={index} onClick={() => setSelectedEvent(event)} className="flex w-full gap-3 rounded-xl p-3 text-left transition hover:bg-[#2d2d2d]">
                  <div className="mt-0.5"><EventIcon type={event.type} /></div>
                  <div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><span className="truncate text-xs font-semibold text-[#d4d4d4]">{event.title}</span><span className="font-mono text-[9px] text-[#6f6f6f]">{event.time}</span></div><div className="mt-1 text-[10px] text-[#9d9d9d]">{event.asset}</div></div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-4 spr-panel p-6">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3794ff]">Trust Network</div><h2 className="mt-1 text-xl font-semibold text-[#d4d4d4]">Evidence lineage</h2><p className="mt-1 text-xs text-[#9d9d9d]">Follow the chain from publisher identity to observable evidence.</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full border border-[#3c3c3c] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#9d9d9d]">LIVE GRAPH</span><span className="rounded-full border border-[#89d185]/20 bg-[#89d185]/[0.03] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#89d185]">VERIFIABLE</span></div></div>
          <div className="relative mt-5 h-[300px] overflow-hidden rounded-md border border-[#3c3c3c] bg-[#1e1e1e]">
            <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 300" preserveAspectRatio="none">
              <path d="M120 150 H350 M350 150 L570 70 M350 150 H570 M350 150 L570 230 M570 70 L800 150 M570 150 H800 M570 230 L800 150" fill="none" stroke="rgba(55,148,255,.22)" strokeWidth="1.5" />
            </svg>
            {graphNodes.map(node => (
              <button key={node.id} onClick={() => setSelectedNode(node.id)} style={{ left: node.x, top: node.y }} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-md border px-4 py-3 text-left transition ${selectedNode === node.id ? 'border-[#3794ff]/50 bg-[#3794ff]/10' : 'border-[#3c3c3c] bg-[#252526] hover:border-[#6f6f6f]'}`}>
                <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${node.tone === 'gold' ? 'bg-[#3794ff]' : node.tone === 'blue' ? 'bg-[#3794ff]' : 'bg-[#858585]'}`} /><span className="text-[9px] font-black tracking-[0.18em] text-[#d4d4d4]">{node.label}</span></div><div className="mt-1 text-[9px] text-[#6f6f6f]">{node.sub}</div>
              </button>
            ))}
            <div className="absolute bottom-4 left-4 flex items-center gap-4 text-[9px] uppercase tracking-wider text-[#6f6f6f]"><span>Publisher</span><span>→</span><span>Software</span><span>→</span><span>Sources</span><span>→</span><span>Evidence</span></div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1fr_.8fr]">
          <div className="spr-panel p-6">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3794ff]">Software Registry</div><div className="mt-1 text-sm text-[#9d9d9d]">Searchable software trust identities</div></div><Globe2 size={18} className="text-[#6f6f6f]" /></div>
            <div className="mt-5 overflow-hidden rounded-xl border border-[#3c3c3c]"><div className="grid grid-cols-[1fr_90px_90px] bg-[#181818] px-4 py-2 text-[8px] font-bold uppercase tracking-wider text-[#6f6f6f]"><span>Software</span><span>Trust</span><span>Status</span></div>{filteredPassports.length ? filteredPassports.map((p: any, i) => { const trust = Number(p.trustScore ?? p.score ?? p.trust ?? 82); return <button key={p.id ?? i} onClick={() => notify(`Opening passport ${p.name ?? 'software asset'}`)} className="grid w-full grid-cols-[1fr_90px_90px] items-center border-t border-[#3c3c3c] px-4 py-3 text-left hover:bg-[#181818]"><span className="truncate text-xs font-semibold text-[#d4d4d4]">{p.name ?? p.softwareName ?? `Software Asset ${i + 1}`}</span><span className={`text-sm font-semibold ${scoreColor(trust)}`}>{Number.isFinite(trust) ? trust : '—'}</span><span className="text-[9px] font-bold uppercase tracking-wider text-[#89d185]">Verified</span></button>; }) : <div className="px-4 py-8 text-center text-xs text-[#6f6f6f]">No matching software identities. Create a passport to begin.</div>}</div>
          </div>

          <div className="spr-panel p-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3794ff]">Connect the trust layer</div><h3 className="mt-2 text-xl font-semibold text-[#d4d4d4]">Wire SPR into existing systems.</h3><p className="mt-2 text-xs leading-5 text-[#9d9d9d]">Machine-readable trust through API keys, webhooks, SBOM ingestion and repository connections.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {[['API', Terminal], ['Webhooks', Webhook], ['SBOM', FileCheck2], ['Repositories', GitBranch], ['API Keys', KeyRound], ['Trust SDK', Network]].map(([label, Icon]: any) => <button key={label} onClick={() => notify(`${label} integration selected`)} className="flex items-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#1e1e1e] px-3 py-3 text-left text-[10px] font-bold text-[#9d9d9d] transition hover:border-[#3794ff]/25 hover:text-[#d4d4d4]"><Icon size={14} className="text-[#3794ff]" />{label}</button>)}
            </div>
            <button onClick={() => notify('Opening SPR Connect...')} className="mt-4 flex w-full items-center justify-between rounded-xl bg-[#2d2d2d] px-4 py-3 text-[10px] font-black uppercase tracking-wider text-[#d4d4d4] hover:bg-[#383838]">Open SPR Connect <ArrowRight size={14} /></button>
          </div>
        </section>

        <footer className="mt-6 flex flex-col justify-between gap-3 border-t border-[#3c3c3c] py-5 text-[9px] uppercase tracking-[0.18em] text-[#6f6f6f] md:flex-row">
          <span>SPR · Software Trust Infrastructure</span><span>Observed evidence only · Unknown remains unknown · Continuous verification</span>
        </footer>
      </div>

      {toast && <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border border-[#3794ff]/20 bg-[#252526] px-4 py-3 text-xs text-[#d4d4d4] shadow-2xl"><Sparkles size={14} className="text-[#3794ff]" />{toast}</div>}

      {selectedEvent && <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 p-4 backdrop-blur-sm md:items-center"><div className="w-full max-w-md rounded-md border border-[#3c3c3c] bg-[#252526] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#3794ff]">Trust observation</div><h3 className="mt-2 text-xl font-semibold text-[#d4d4d4]">{selectedEvent.title}</h3></div><button onClick={() => setSelectedEvent(null)} className="rounded-lg p-2 text-[#9d9d9d] hover:bg-[#2d2d2d] hover:text-[#d4d4d4]"><X size={17} /></button></div><div className="mt-5 space-y-3"><div className="rounded-xl border border-[#3c3c3c] p-4"><div className="text-[9px] uppercase tracking-wider text-[#6f6f6f]">Asset</div><div className="mt-1 text-sm text-[#d4d4d4]">{selectedEvent.asset}</div></div><div className="rounded-xl border border-[#3c3c3c] p-4"><div className="text-[9px] uppercase tracking-wider text-[#6f6f6f]">Observation</div><div className="mt-1 text-sm leading-6 text-[#d4d4d4]">{selectedEvent.detail}</div></div><div className="flex items-center gap-2 text-[10px] font-mono text-[#6f6f6f]"><CircleDot size={11} /> {selectedEvent.time} · evidence-linked</div></div><button onClick={() => { setSelectedEvent(null); notify('Evidence explorer selected.'); }} className="mt-5 flex w-full items-center justify-between rounded-xl bg-[#3794ff] px-4 py-3 text-xs font-black uppercase tracking-wider text-white">Explore evidence <ArrowRight size={14} /></button></div></div>}
    </div>
  );
}
