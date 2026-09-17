import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Database, FileCheck2, RefreshCw, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../utils/apiClient';

type SoftwareRecord = {
  id: string;
  name: string;
  publisher: string;
  version: string;
  clientId?: string;
  category?: string;
  environment?: string;
  evidence: unknown[];
  vulnerabilities: unknown[];
  scoreStatus?: string;
};

type ClientRecord = { id: string; name: string };

type LoadState = 'loading' | 'ready' | 'error';

type StateLabel = 'Operational' | 'Needs Attention' | 'Evidence Gap' | 'Unknown';

function asSoftware(row: any): SoftwareRecord {
  return {
    id: String(row?.id ?? ''),
    name: String(row?.name || 'Unnamed software'),
    publisher: String(row?.publisher || 'Unknown provider'),
    version: String(row?.version || 'unknown'),
    clientId: row?.clientId ? String(row.clientId) : undefined,
    category: row?.category ? String(row.category) : undefined,
    environment: row?.environment ? String(row.environment) : undefined,
    evidence: Array.isArray(row?.evidence) ? row.evidence : [],
    vulnerabilities: Array.isArray(row?.vulnerabilities) ? row.vulnerabilities : [],
    scoreStatus: row?.scoreStatus ? String(row.scoreStatus) : undefined,
  };
}

function deriveState(item: SoftwareRecord): StateLabel {
  const findings = item.vulnerabilities.length;
  const evidence = item.evidence.length;
  if (findings > 0) return 'Needs Attention';
  if (evidence === 0) return 'Evidence Gap';
  if (item.scoreStatus && item.scoreStatus !== 'not_authoritatively_scored') return 'Operational';
  return 'Unknown';
}

function stateClasses(state: StateLabel) {
  switch (state) {
    case 'Operational': return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'Needs Attention': return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'Evidence Gap': return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300';
    default: return 'border-border bg-muted/40 text-muted-foreground';
  }
}

export default function SoftwareWorkspaceView() {
  const [status, setStatus] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [software, setSoftware] = useState<SoftwareRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'All' | StateLabel>('All');
  const [userEmail, setUserEmail] = useState('');

  const load = async () => {
    setStatus('loading');
    setError('');
    try {
      const session = await supabase.auth.getSession();
      const sessionUser = session.data.session?.user;
      if (!sessionUser) {
        window.location.assign('/login?next=%2Fsoftware%2Fworkspace');
        return;
      }
      setUserEmail(sessionUser.email || '');
      const [meResponse, passportsResponse, clientsResponse] = await Promise.all([
        apiFetch('/api/user/me'),
        apiFetch('/api/user/passports'),
        apiFetch('/api/user/clients'),
      ]);
      if (meResponse.status === 401 || passportsResponse.status === 401 || clientsResponse.status === 401) {
        await supabase.auth.signOut();
        window.location.assign('/login?next=%2Fsoftware%2Fworkspace');
        return;
      }
      if (!passportsResponse.ok || !clientsResponse.ok) {
        throw new Error(`Workspace data could not be loaded (passports ${passportsResponse.status}, clients ${clientsResponse.status}).`);
      }
      const passportsBody = await passportsResponse.json().catch(() => []);
      const clientsBody = await clientsResponse.json().catch(() => []);
      const passportRows = Array.isArray(passportsBody) ? passportsBody : passportsBody?.passports;
      const clientRows = Array.isArray(clientsBody) ? clientsBody : clientsBody?.clients;
      if (!Array.isArray(passportRows) || !Array.isArray(clientRows)) throw new Error('SPR returned an invalid workspace data shape.');
      const nextSoftware = passportRows.map(asSoftware).filter((item: SoftwareRecord) => item.id);
      setSoftware(nextSoftware);
      setClients(clientRows.map((row: any) => ({ id: String(row?.id ?? ''), name: String(row?.name || row?.company_name || 'Unnamed client') })).filter((item: ClientRecord) => item.id));
      setSelectedId((current) => current && nextSoftware.some((item: SoftwareRecord) => item.id === current) ? current : (nextSoftware[0]?.id || ''));
      setStatus('ready');
      void meResponse.json().catch(() => null);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Unable to load the Software workspace.');
    }
  };

  useEffect(() => { void load(); }, []);

  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const rows = useMemo(() => software.map((item) => ({ ...item, state: deriveState(item), clientName: item.clientId ? (clientById.get(item.clientId) || 'Linked client') : 'No linked client' })), [software, clientById]);
  const filtered = useMemo(() => rows.filter((item) => {
    const matchesQuery = !query.trim() || `${item.name} ${item.publisher} ${item.version} ${item.clientName}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (filter === 'All' || item.state === filter);
  }), [rows, query, filter]);
  const selected = rows.find((item) => item.id === selectedId) || filtered[0] || null;

  const metrics = useMemo(() => ({
    assets: rows.length,
    passports: rows.filter((item) => item.id).length,
    evidence: rows.filter((item) => item.evidence.length > 0).length,
    attention: rows.filter((item) => item.state === 'Needs Attention').length,
    gaps: rows.filter((item) => item.state === 'Evidence Gap').length,
  }), [rows]);

  if (status === 'loading') return <main className="min-h-screen bg-background p-6 text-foreground md:p-10"><div className="mx-auto max-w-7xl"><div className="spr-panel p-8"><div className="text-xs font-semibold uppercase tracking-[.15em] text-muted-foreground">Software</div><h1 className="mt-2 text-2xl font-semibold">Loading software workspace…</h1><p className="mt-2 text-sm text-muted-foreground">Reading tenant-scoped software and evidence data.</p></div></div></main>;

  if (status === 'error') return <main className="min-h-screen bg-background p-6 text-foreground md:p-10"><div className="mx-auto max-w-3xl"><div className="spr-panel p-8"><div className="flex items-center gap-2 text-sm font-semibold text-destructive"><ShieldAlert size={18} /> Software workspace unavailable</div><p className="mt-3 text-sm leading-6 text-muted-foreground">{error}</p><button onClick={() => void load()} className="spr-btn spr-btn-primary mt-5 inline-flex items-center gap-2"><RefreshCw size={15} /> Retry</button></div></div></main>;

  return <main className="min-h-screen bg-background p-4 text-foreground md:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="spr-panel p-6 md:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Software command workspace</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Software</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Manage software identities across clients, see evidence posture, and move directly from evidence to action. Observed evidence is not treated as verification.</p>
            {userEmail && <p className="mt-2 text-xs text-muted-foreground">Signed in as {userEmail}</p>}
          </div>
          <div className="flex gap-2"><button onClick={() => void load()} className="spr-btn spr-btn-secondary inline-flex items-center gap-2"><RefreshCw size={15} /> Refresh</button><button onClick={() => window.location.assign('/passports')} className="spr-btn spr-btn-primary inline-flex items-center gap-2">Open Passports <ArrowRight size={15} /></button></div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Software assets', metrics.assets, Database],
          ['With passports', metrics.passports, FileCheck2],
          ['Evidence coverage', metrics.evidence, CheckCircle2],
          ['Needs attention', metrics.attention, AlertTriangle],
          ['Evidence gaps', metrics.gaps, ShieldAlert],
        ].map(([label, value, Icon]: any) => <div key={label} className="spr-panel p-4"><div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[.08em] text-muted-foreground"><span>{label}</span><Icon size={15} /></div><div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div></div>)}
      </section>

      <section className="spr-panel p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search software, provider, version, or client" className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary" /></label>
          <div className="flex flex-wrap gap-2">{(['All','Operational','Needs Attention','Evidence Gap','Unknown'] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-full border px-3 py-2 text-xs font-semibold ${filter === value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>{value}</button>)}</div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="spr-panel overflow-hidden">
          <div className="border-b border-border px-5 py-4"><h2 className="text-base font-semibold">Software portfolio</h2><p className="mt-1 text-xs text-muted-foreground">{filtered.length} of {rows.length} software records</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-[.08em] text-muted-foreground"><tr><th className="px-5 py-3">Software</th><th className="px-3 py-3">Provider</th><th className="px-3 py-3">Client</th><th className="px-3 py-3">Evidence</th><th className="px-3 py-3">Findings</th><th className="px-3 py-3">State</th><th className="px-5 py-3">Action</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} onClick={() => setSelectedId(item.id)} className={`cursor-pointer border-b border-border/70 hover:bg-muted/30 ${selected?.id === item.id ? 'bg-primary/5' : ''}`}><td className="px-5 py-4"><div className="font-semibold">{item.name}</div><div className="mt-1 text-xs text-muted-foreground">v{item.version}</div></td><td className="px-3 py-4 text-muted-foreground">{item.publisher}</td><td className="px-3 py-4 text-muted-foreground">{item.clientName}</td><td className="px-3 py-4 tabular-nums">{item.evidence.length}</td><td className="px-3 py-4 tabular-nums">{item.vulnerabilities.length}</td><td className="px-3 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stateClasses(item.state)}`}>{item.state}</span></td><td className="px-5 py-4"><button onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); }} className="text-xs font-semibold text-primary">Inspect →</button></td></tr>)}{filtered.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">No software matches the current filters.</td></tr>}</tbody></table></div>
        </div>

        <aside className="spr-panel p-5">
          {selected ? <>
            <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Selected software</div>
            <h2 className="mt-2 text-xl font-semibold">{selected.name}</h2>
            <div className="mt-1 text-sm text-muted-foreground">{selected.publisher} · v{selected.version}</div>
            <div className="mt-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${stateClasses(selected.state)}`}>{selected.state}</span></div>
            <dl className="mt-5 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Identity</dt><dd className="font-medium text-right">{selected.id}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Client</dt><dd className="font-medium">{selected.clientName}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Evidence items</dt><dd className="font-medium tabular-nums">{selected.evidence.length}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Open findings</dt><dd className="font-medium tabular-nums">{selected.vulnerabilities.length}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Verification</dt><dd className="font-medium">{selected.scoreStatus === 'not_authoritatively_scored' || !selected.scoreStatus ? 'Unknown' : selected.scoreStatus}</dd></div></dl>
            <div className="mt-5 rounded-lg border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Evidence boundary:</strong> observed evidence can drive review and action, but it does not by itself create a verification claim.</div>
            <div className="mt-5 grid gap-2"><button onClick={() => window.location.assign(`/passports/${encodeURIComponent(selected.id)}`)} className="spr-btn spr-btn-primary inline-flex items-center justify-center gap-2">Open Passport <ArrowRight size={15} /></button><button onClick={() => window.location.assign('/evidence-explorer')} className="spr-btn spr-btn-secondary inline-flex items-center justify-center gap-2">View Evidence <ArrowRight size={15} /></button><button onClick={() => window.location.assign('/monitoring')} className="spr-btn spr-btn-secondary inline-flex items-center justify-center gap-2">Monitor <ArrowRight size={15} /></button><button onClick={() => selected.clientId ? window.location.assign('/clients') : undefined} disabled={!selected.clientId} className="spr-btn spr-btn-secondary inline-flex items-center justify-center gap-2 disabled:opacity-50">View Client <ArrowRight size={15} /></button></div>
          </> : <div className="py-10 text-center text-sm text-muted-foreground">No software records are available for this workspace.</div>}
        </aside>
      </section>
    </div>
  </main>;
}
