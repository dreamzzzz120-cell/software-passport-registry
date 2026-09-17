import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Building2, CheckCircle2, ChevronRight, FileCheck2, Layers, Network, RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldQuestion, Users, Wrench, X } from 'lucide-react';
import type { Alert, Client, SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';
import TrustNetworkMap, { type NetworkClientNode } from './trust/TrustNetworkMap';
import { trustStateFromDecision, type TrustState, type VerificationDecisionState } from './trust/TrustStateBadge';

interface Props {
  clients: Client[];
  alerts: Alert[];
  passports: SoftwarePassport[];
  role?: string;
  onSelectClient: (id: string) => void;
  onSelectPassport?: (id: string) => void;
  onNavigate: (tab: string) => void;
  verificationDecisions?: Record<string, VerificationDecisionState>;
  dataStatus?: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
}

type Assignment = { client_id: string; technician_display: string };
type TeamMember = { id: number; email: string; displayName?: string | null; role: string };

const NAV = [
  ['msp', 'Command'], ['clients', 'Clients'], ['assets', 'Software'], ['passports', 'Passports'],
  ['evidence-explorer', 'Evidence'], ['monitoring', 'Monitoring'], ['reports', 'Reports'],
] as const;

const severityClass = (s: Alert['severity']) => s === 'Critical'
  ? 'border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 text-[var(--spr-red)]'
  : s === 'High'
    ? 'border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/10 text-[var(--spr-amber)]'
    : 'border-[var(--spr-border)] bg-[var(--spr-surface-hover)] text-[var(--spr-text-muted)]';

function Metric({ label, value, sub, icon, tone }: { label: string; value: string | number; sub: string; icon: React.ReactNode; tone: string }) {
  return <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
    <div className="flex items-start justify-between"><span className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">{label}</span><span className={tone}>{icon}</span></div>
    <div className={`mt-3 text-2xl font-bold tracking-tight ${tone}`}>{value}</div>
    <div className="mt-1 text-xs text-[var(--spr-text-faint)]">{sub}</div>
  </div>;
}

function StatePill({ state }: { state: VerificationDecisionState | 'UNKNOWN' }) {
  const verified = state === 'VERIFIED';
  const review = state === 'PARTIAL' || state === 'INVESTIGATE';
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${verified ? 'border-[var(--spr-green)]/30 bg-[var(--spr-green)]/10 text-[var(--spr-green)]' : review ? 'border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/10 text-[var(--spr-amber)]' : 'border-[var(--spr-border)] bg-[var(--spr-surface-hover)] text-[var(--spr-text-faint)]'}`}>
    {verified ? <ShieldCheck className="h-3 w-3" /> : review ? <ShieldAlert className="h-3 w-3" /> : <ShieldQuestion className="h-3 w-3" />}{verified ? 'Verified' : review ? 'Needs review' : 'Unknown'}
  </span>;
}

export default function MSPCommandCenter({ clients, alerts, passports, role = 'Viewer', onSelectClient, onSelectPassport, onNavigate, verificationDecisions, dataStatus = 'ready', onRetry }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const canAssign = role === 'Owner' || role === 'Admin';

  useEffect(() => {
    Promise.all([
      apiFetch('/api/msp/assignments').then(r => r.ok ? r.json() : null),
      apiFetch('/api/organization/team').then(r => r.ok ? r.json() : null),
    ]).then(([a, t]) => {
      if (Array.isArray(a?.assignments)) setAssignments(a.assignments);
      if (Array.isArray(t)) setTeam(t);
    }).catch(() => undefined);
  }, []);

  const assignmentMap = useMemo(() => new Map(assignments.map(a => [a.client_id, a.technician_display])), [assignments]);
  const active = useMemo(() => alerts.filter(a => a.status !== 'Resolved' && a.status !== 'Cancelled'), [alerts]);
  const attention = useMemo(() => [...active].sort((a, b) => ({ Critical: 3, High: 2, Medium: 1, Low: 0 }[b.severity] || 0) - ({ Critical: 3, High: 2, Medium: 1, Low: 0 }[a.severity] || 0)), [active]);
  const verification = useMemo(() => passports.reduce((r, p) => { const d = verificationDecisions?.[p.id]; if (d === 'VERIFIED') r.verified++; else if (d === 'PARTIAL' || d === 'INVESTIGATE') r.review++; else r.unknown++; return r; }, { verified: 0, review: 0, unknown: 0 }), [passports, verificationDecisions]);
  const evidence = useMemo(() => passports.reduce((r, p) => (p.evidence || []).reduce((x, e) => { x.total++; if (e?.status === 'VERIFIED') x.verified++; return x; }, r), { total: 0, verified: 0 }), [passports]);
  const rows = useMemo(() => clients.map(client => {
    const findings = active.filter(a => a.clientName === client.name);
    return { client, findings, critical: findings.filter(a => a.severity === 'Critical').length, high: findings.filter(a => a.severity === 'High').length, technician: assignmentMap.get(client.id) || 'Unassigned' };
  }).filter(r => !query || r.client.name.toLowerCase().includes(query.toLowerCase())).filter(r => filter === 'All' || (filter === 'Attention' ? r.findings.length > 0 : r.technician === filter)).sort((a, b) => b.critical - a.critical || b.high - a.high || b.findings.length - a.findings.length), [clients, active, assignmentMap, query, filter]);

  const networkClients: NetworkClientNode[] = useMemo(() => rows.slice(0, 6).map(({ client }) => ({ id: client.id, name: client.name, software: (client.softwareInventory || []).map(item => ({ passportId: item.passportId, name: item.name, state: trustStateFromDecision(verificationDecisions?.[item.passportId]) as TrustState })) })), [rows, verificationDecisions]);

  const assign = async (clientId: string, member: TeamMember) => {
    const response = await apiFetch('/api/msp/assignments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, technicianUserId: member.id, technicianDisplay: member.displayName || member.email }) });
    if (response.ok) setAssignments(current => [...current.filter(a => a.client_id !== clientId), { client_id: clientId, technician_display: member.displayName || member.email }]);
    setAssigning(null);
  };

  if (dataStatus === 'loading') return <div className="mx-auto max-w-7xl space-y-5 pb-12" aria-busy="true"><div className="h-10 w-80 animate-pulse rounded-xl bg-[var(--spr-surface-alt)]" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]" />)}</div><div className="h-96 animate-pulse rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]" /></div>;
  if (dataStatus === 'error') return <section className="mx-auto max-w-2xl rounded-2xl border border-[var(--spr-red)]/30 bg-[var(--spr-surface-alt)] py-20 text-center"><AlertTriangle className="mx-auto h-9 w-9 text-[var(--spr-red)]" /><h1 className="mt-4 text-xl font-bold text-[var(--spr-text)]">MSP workspace could not load</h1><p className="mt-2 text-sm text-[var(--spr-text-muted)]">The latest portfolio state could not be retrieved. Your stored data has not been changed.</p>{onRetry && <button onClick={onRetry} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />Try again</button>}</section>;

  return <div id="msp-command-center" className="mx-auto max-w-7xl space-y-6 pb-14">
    <nav className="flex flex-wrap items-center gap-1.5 border-b border-[var(--spr-border)] pb-3" aria-label="MSP workspace navigation">
      {NAV.map(([id, label]) => <button key={id} onClick={() => onNavigate(`/${id}`)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${id === 'msp' ? 'bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]' : 'text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] hover:text-[var(--spr-text)]'}`}>{label}</button>)}
      <div className="ml-auto relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--spr-text-faint)]" /><input aria-label="Search clients" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search clients" className="w-48 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] py-2 pl-9 pr-3 text-xs text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]" /></div>
    </nav>

    <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]"><Network className="h-4 w-4" /> MSP control plane</div><h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--spr-text)] md:text-4xl">Trust Network</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Operate your client portfolio from one evidence-backed workspace. See what changed, what needs attention, and where your team can act.</p></div><div className="flex gap-2"><button onClick={() => onNavigate('/clients')} className="inline-flex items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)]"><Users className="h-4 w-4" />Add client</button><button onClick={() => onNavigate('/passports')} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-semibold text-white"><Layers className="h-4 w-4" />Add software</button></div></header>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Clients" value={clients.length} sub={`${active.length} active observations`} icon={<Building2 className="h-5 w-5" />} tone="text-[var(--spr-highlight)]" /><Metric label="Verified software" value={verification.verified} sub={`${verification.review} need review · ${verification.unknown} unknown`} icon={<ShieldCheck className="h-5 w-5" />} tone="text-[var(--spr-green)]" /><Metric label="Evidence" value={evidence.total} sub={evidence.total ? `${Math.round(evidence.verified / evidence.total * 100)}% marked verified` : 'No evidence recorded'} icon={<FileCheck2 className="h-5 w-5" />} tone="text-[var(--spr-highlight)]" /><Metric label="Attention" value={attention.length} sub={`${new Set(attention.map(a => a.clientName)).size} clients affected`} icon={<Bell className="h-5 w-5" />} tone={attention.length ? 'text-[var(--spr-amber)]' : 'text-[var(--spr-green)]'} /></section>

    <section className="grid gap-4 lg:grid-cols-[1.4fr_.8fr]"><div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-[var(--spr-text)]">Portfolio attention</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Prioritized from recorded findings.</p></div><span className="rounded-full border border-[var(--spr-border)] px-2.5 py-1 text-xs text-[var(--spr-text-muted)]">{attention.length} active</span></div><div className="mt-4 divide-y divide-[var(--spr-border)]">{attention.slice(0, 5).map(a => <button key={a.id} onClick={() => setSelected(a)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 py-4 text-left hover:bg-[var(--spr-surface-hover)]"><span className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase ${severityClass(a.severity)}`}>{a.severity}</span><span><span className="block text-sm font-semibold text-[var(--spr-text)]">{a.title}</span><span className="mt-1 block text-xs text-[var(--spr-text-muted)]">{a.clientName} · {a.category}</span></span><ChevronRight className="h-4 w-4 text-[var(--spr-text-faint)]" /></button>)}{attention.length === 0 && <div className="py-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-[var(--spr-green)]" /><p className="mt-3 font-semibold text-[var(--spr-text)]">No active observations</p></div>}</div>{attention.length > 5 && <button onClick={() => onNavigate('/alerts')} className="mt-3 text-xs font-semibold text-[var(--spr-highlight)]">View all observations →</button>}</div>
      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><h2 className="text-lg font-bold text-[var(--spr-text)]">Trust posture</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Authoritative software verification state.</p><div className="mt-5 space-y-4">{[["Verified", verification.verified, 'var(--spr-green)'], ['Needs review', verification.review, 'var(--spr-amber)'], ['Unknown', verification.unknown, 'var(--spr-text-faint)']].map(([label, value, tone]) => <div key={label as string}><div className="flex justify-between text-xs font-semibold"><span className="text-[var(--spr-text-muted)]">{label}</span><span className="text-[var(--spr-text)]">{value}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--spr-surface-hover)]"><div className="h-full rounded-full" style={{ width: `${verification.verified + verification.review + verification.unknown ? Number(value) / (verification.verified + verification.review + verification.unknown) * 100 : 0}%`, background: tone as string }} /></div></div>)}<div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-xs leading-5 text-[var(--spr-text-faint)]"><ShieldQuestion className="mr-1 inline h-3.5 w-3.5" />Unknown means evidence is unavailable or insufficient; it is not treated as a pass.</div></div></div></section>

    <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className="mb-4 flex items-end justify-between"><div><h2 className="text-lg font-bold text-[var(--spr-text)]">Trust network</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Client → software → current trust state.</p></div><button onClick={() => onNavigate('/trust-graph')} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--spr-highlight)]">Open graph <ArrowRight className="h-3.5 w-3.5" /></button></div><TrustNetworkMap clients={networkClients} clientsOmitted={Math.max(0, clients.length - networkClients.length)} onSelectClient={id => { onSelectClient(id); onNavigate('/clients'); }} onSelectSoftware={id => { onSelectPassport?.(id); onNavigate('/passports'); }} /></section>

    <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-lg font-bold text-[var(--spr-text)]">Client operations</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Portfolio risk, trust state and technician ownership.</p></div><div className="flex flex-wrap gap-1.5">{['All', 'Attention', ...team.slice(0, 4).map(t => t.displayName || t.email)].map(f => <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${filter === f ? 'border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{f}</button>)}</div></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-[var(--spr-border)] text-[10px] uppercase tracking-[.14em] text-[var(--spr-text-faint)]"><tr><th className="px-3 py-3">Client</th><th className="px-3 py-3">Trust</th><th className="px-3 py-3">Critical</th><th className="px-3 py-3">High</th><th className="px-3 py-3">Observations</th><th className="px-3 py-3">Technician</th><th /></tr></thead><tbody className="divide-y divide-[var(--spr-border)]">{rows.map(({ client, critical, high, findings, technician }) => { const states = (client.softwareInventory || []).map(s => verificationDecisions?.[s.passportId]).filter(Boolean); const state = states.length && states.every(s => s === 'VERIFIED') ? 'VERIFIED' : states.some(s => s === 'PARTIAL' || s === 'INVESTIGATE') ? 'INVESTIGATE' : 'UNKNOWN'; return <tr key={client.id} className="hover:bg-[var(--spr-surface-hover)]"><td className="px-3 py-3"><button onClick={() => { onSelectClient(client.id); onNavigate('/clients'); }} className="font-semibold text-[var(--spr-text)] hover:text-[var(--spr-highlight)]">{client.name}</button></td><td className="px-3 py-3"><StatePill state={state as any} /></td><td className="px-3 py-3 font-bold text-[var(--spr-red)]">{critical || '—'}</td><td className="px-3 py-3 font-semibold text-[var(--spr-amber)]">{high || '—'}</td><td className="px-3 py-3 text-[var(--spr-text-muted)]">{findings.length}</td><td className="relative px-3 py-3">{canAssign ? <><button onClick={() => setAssigning(assigning === client.id ? null : client.id)} className="inline-flex items-center gap-1.5 text-xs text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]"><Wrench className="h-3.5 w-3.5" />{technician}</button>{assigning === client.id && <div className="absolute left-2 top-11 z-20 w-56 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-1 shadow-2xl">{team.map(member => <button key={member.id} onClick={() => void assign(client.id, member)} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">{member.displayName || member.email}</button>)}</div>}</> : <span className="text-xs text-[var(--spr-text-faint)]">{technician}</span>}</td><td className="px-3 py-3"><button onClick={() => { onSelectClient(client.id); onNavigate('/clients'); }} className="rounded-lg p-2 text-[var(--spr-text-faint)] hover:bg-[var(--spr-surface-hover)]"><ArrowRight className="h-4 w-4" /></button></td></tr>; })}</tbody></table>{rows.length === 0 && <div className="py-10 text-center text-sm text-[var(--spr-text-muted)]">No clients match this view.</div>}</div></section>

    <section className="grid gap-4 md:grid-cols-4">{[['Evidence review', '/evidence-explorer', evidence.total - evidence.verified], ['Software verification', '/passports', verification.review + verification.unknown], ['Monitoring', '/monitoring', null], ['Reports', '/reports', null]].map(([label, path, count]) => <button key={label as string} onClick={() => onNavigate(path as string)} className="flex items-center justify-between rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-left hover:bg-[var(--spr-surface-hover)]"><span className="text-sm font-semibold text-[var(--spr-text)]">{label}</span><span className="flex items-center gap-2 text-xs text-[var(--spr-text-faint)]">{count == null ? 'Open' : `${Math.max(0, Number(count))} items`}<ArrowRight className="h-3.5 w-3.5" /></span></button>)}</section>

    {selected && <div className="fixed inset-0 z-50 bg-black/40 p-4" role="dialog" aria-modal="true"><div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] shadow-2xl"><div className="flex items-start justify-between border-b border-[var(--spr-border)] p-5"><div><span className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase ${severityClass(selected.severity)}`}>{selected.severity}</span><h2 className="mt-3 text-xl font-bold text-[var(--spr-text)]">{selected.title}</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">{selected.clientName} · {selected.category}</p></div><button onClick={() => setSelected(null)} className="rounded-lg p-2 text-[var(--spr-text-faint)] hover:bg-[var(--spr-surface-hover)]"><X className="h-5 w-5" /></button></div><div className="p-5"><p className="text-sm leading-6 text-[var(--spr-text-muted)]">{selected.description}</p><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => { const c = clients.find(x => x.name === selected.clientName); if (c) { onSelectClient(c.id); onNavigate('/clients'); } setSelected(null); }} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-semibold text-white">Open client <ArrowRight className="h-4 w-4" /></button><button onClick={() => { onNavigate('/monitoring'); setSelected(null); }} className="rounded-xl border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Open monitoring</button></div></div></div></div>}
  </div>;
}
