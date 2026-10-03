import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, FileCheck2, History, Orbit, X } from 'lucide-react';
import type { Client, SoftwarePassport } from '../types';

type Lens = 'observe' | 'govern' | 'history';
interface Props { client: Client; passports: SoftwarePassport[]; onOpenLaunchTicket: (id: string) => void; onClose: () => void; }

function state(p: SoftwarePassport) {
  const evidence = Array.isArray(p.evidence) ? p.evidence : [];
  const findings = Array.isArray(p.vulnerabilities) ? p.vulnerabilities : [];
  if (findings.length) return 'FINDINGS';
  if (!evidence.length) return 'UNKNOWN';
  return p.verificationStatus ? String(p.verificationStatus).toUpperCase() : 'UNVERIFIED';
}

export default function ClientGalaxyView({ client, passports, onOpenLaunchTicket, onClose }: Props) {
  const [lens, setLens] = useState<Lens>('observe');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inventoryIds = useMemo(() => new Set((client.softwareInventory || []).map((x: any) => String(x?.passportId || '')).filter(Boolean)), [client.softwareInventory]);
  const stars = useMemo(() => passports.filter(p => inventoryIds.has(p.id)), [passports, inventoryIds]);
  const selected = stars.find(p => p.id === selectedId) || null;
  const history = Array.isArray(client.activityTimeline) ? client.activityTimeline : [];

  return <section className="spr-panel relative min-h-[680px] overflow-hidden p-5 md:p-7" aria-label={`${client.name} client galaxy`}>
    <div className="pointer-events-none absolute inset-0 opacity-70" style={{background:'radial-gradient(circle at 50% 45%,rgba(34,211,238,.12),transparent 28%),radial-gradient(circle at 22% 20%,rgba(124,58,237,.16),transparent 24%)'}} />
    <header className="relative z-10 flex flex-col gap-4 border-b border-[var(--spr-border)] pb-5 lg:flex-row lg:items-center lg:justify-between">
      <div><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.2em] text-cyan-300"><Orbit className="h-4 w-4"/>Client Galaxy</div><h1 className="mt-2 text-2xl font-semibold">{client.name}</h1><p className="mt-1 text-sm text-[var(--spr-text-muted)]">{stars.length} persisted Launch Ticket{stars.length===1?'':'s'} connected to this client.</p></div>
      <div className="flex flex-wrap gap-2">{(['observe','govern','history'] as Lens[]).map(x=><button key={x} onClick={()=>setLens(x)} className={`spr-btn ${lens===x?'spr-btn-primary':''}`}>{x[0].toUpperCase()+x.slice(1)}</button>)}<button onClick={onClose} className="spr-btn" aria-label="Close Galaxy"><X className="h-4 w-4"/></button></div>
    </header>
    {lens==='history' ? <div className="relative z-10 mt-6"><div className="mb-4 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-cyan-300"/>Observed history</div>{history.length?<div className="space-y-3">{history.map((e:any,i:number)=><div key={String(e?.id||i)} className="spr-panel-alt p-4"><div className="text-sm font-medium">{String(e?.title||e?.action||e?.type||'Recorded activity')}</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">{String(e?.timestamp||e?.createdAt||e?.date||'Timestamp UNKNOWN')}</div></div>)}</div>:<div className="spr-panel-alt p-5 text-sm text-[var(--spr-text-muted)]">UNKNOWN — no persisted client activity history is available.</div>}</div>
    : <div className="relative z-10 mt-6 grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="relative min-h-[500px] overflow-hidden rounded-[28px] border border-white/10 bg-black/20 p-8">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/10"/><div className="pointer-events-none absolute left-1/2 top-1/2 h-[430px] w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-300/10"/>
        {stars.length?<div className="relative grid min-h-[430px] grid-cols-2 place-items-center gap-8 md:grid-cols-3">{stars.map(p=>{const s=state(p);return <button key={p.id} onClick={()=>setSelectedId(p.id)} className={`grid h-32 w-32 place-items-center rounded-full border bg-black/30 text-center transition hover:scale-105 ${selectedId===p.id?'border-cyan-300 shadow-[0_0_40px_rgba(34,211,238,.35)]':'border-white/10'}`}><span><FileCheck2 className="mx-auto h-5 w-5 text-cyan-200"/><span className="mt-2 block max-w-24 truncate text-xs font-semibold">{p.name}</span><span className={`mt-1 block text-[10px] ${s==='UNKNOWN'?'text-amber-300':'text-[var(--spr-text-muted)]'}`}>{lens==='govern' ? `Verification: ${s}` : s}</span></span></button>})}</div>:<div className="grid min-h-[430px] place-items-center text-center"><div><Orbit className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]"/><p className="mt-3 text-sm font-semibold">No observed systems</p><p className="mt-1 text-xs text-[var(--spr-text-muted)]">SPR will not manufacture stars without persisted records.</p></div></div>}
      </div>
      <aside className="spr-panel-alt p-5">{selected?<><div className="flex items-center justify-between"><div className="text-[11px] font-bold uppercase tracking-[.18em] text-cyan-300">Star Inspector</div><Activity className="h-4 w-4"/></div><h2 className="mt-3 text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">{selected.publisher||'Publisher UNKNOWN'} · {selected.version||'Version UNKNOWN'}</p><div className="mt-5 space-y-2"><Row label="Evidence" value={String(Array.isArray(selected.evidence)?selected.evidence.length:0)}/><Row label="Findings" value={String(Array.isArray(selected.vulnerabilities)?selected.vulnerabilities.length:0)}/><Row label="Verification" value={state(selected)}/><Row label="Identity" value={String((selected as any).softwareIdentityId||(selected as any).identityId||'UNKNOWN')}/><Row label="Hash" value={String((selected as any).fileHash||'UNKNOWN')}/></div><button onClick={()=>onOpenLaunchTicket(selected.id)} className="spr-btn spr-btn-primary mt-5 w-full"><FileCheck2 className="h-4 w-4"/>Open Launch Ticket</button><p className="mt-4 text-[11px] leading-5 text-[var(--spr-text-faint)]">UNKNOWN is an evidence gap, never PASS.</p></>:<div className="grid min-h-72 place-items-center text-center"><div><AlertTriangle className="mx-auto h-6 w-6"/><p className="mt-2 text-sm">Select a star to inspect it.</p></div></div>}</aside>
    </div>}
  </section>;
}
function Row({label,value}:{label:string;value:string}) { return <div className="rounded-xl border border-white/5 bg-black/15 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">{label}</div><div className={`mt-1 break-all text-xs ${value==='UNKNOWN'?'text-amber-300':''}`}>{value}</div></div>; }
