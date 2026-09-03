import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, Building2, CheckCircle2, CircleSlash2, Database, FileCheck2, PlugZap, RefreshCw, ShieldAlert, Users, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type State = 'loading' | 'ready' | 'error';
type Source = { id: string; label: string; path: string; kind: string; state: State; count: number | null; detail?: string };

const SOURCES = [
  ['clients', 'Clients', '/api/user/clients', 'Client estate'],
  ['passports', 'Software Passports', '/api/user/passports', 'Trust records'],
  ['scans', 'Scans', '/api/scans', 'Analysis jobs'],
  ['findings', 'Findings', '/api/trust-loop/findings', 'Security / trust findings'],
  ['integrations', 'Integrations', '/api/integrations', 'Connected evidence sources'],
  ['vendors', 'Vendors', '/api/user/vendors', 'Supplier records'],
  ['monitoring', 'Monitoring', '/api/monitoring/monitoring-configurations', 'Continuous verification'],
  ['remediation', 'Remediation', '/api/remediation-tasks', 'Work queue'],
  ['team', 'Team', '/api/organization/team', 'Technicians / operators'],
] as const;

const NAV = [
  ['New Software Review', '/extensions/new-review'],
  ['Clients', '/clients'],
  ['Software / Assets', '/assets'],
  ['Passports', '/passports'],
  ['Evidence', '/evidence-explorer'],
  ['Alerts', '/alerts'],
  ['Compliance', '/compliance'],
  ['Monitoring', '/monitoring'],
  ['Integrations', '/integrations'],
  ['Reports', '/reports'],
  ['Audit Log', '/audit-log'],
  ['Billing', '/billing'],
] as const;

function collectionCount(body: any): number | null {
  if (Array.isArray(body)) return body.length;
  for (const key of ['clients', 'passports', 'scans', 'findings', 'integrations', 'vendors', 'configurations', 'tasks', 'team', 'items', 'data']) {
    if (body && Array.isArray(body[key])) return body[key].length;
  }
  return null;
}

function sourceStatus(source: Source) {
  if (source.state === 'loading') return <span className="text-[var(--spr-text-faint)]">Checking…</span>;
  if (source.state === 'error') return <span className="inline-flex items-center gap-1 text-[var(--spr-red)]"><XCircle className="h-3.5 w-3.5" />Unavailable</span>;
  return <span className="inline-flex items-center gap-1 text-[var(--spr-green)]"><CheckCircle2 className="h-3.5 w-3.5" />Connected</span>;
}

export default function MSPStackCommandCenter({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [sources, setSources] = useState<Source[]>(() => SOURCES.map(([id, label, path, kind]) => ({ id, label, path, kind, state: 'loading', count: null })));
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    const results = await Promise.all(SOURCES.map(async ([id, label, path, kind]) => {
      try {
        const response = await apiFetch(path);
        const body = await response.json().catch(() => null);
        return { id, label, path, kind, state: response.ok ? 'ready' as State : 'error' as State, count: response.ok ? collectionCount(body) : null, detail: response.ok ? undefined : `HTTP ${response.status}` };
      } catch {
        return { id, label, path, kind, state: 'error' as State, count: null, detail: 'Request failed' };
      }
    }));
    setSources(results);
    setLastSync(Date.now());
    setRefreshing(false);
  };

  useEffect(() => { void load(); }, []);

  const connected = useMemo(() => sources.filter((s) => s.state === 'ready').length, [sources]);
  const failed = useMemo(() => sources.filter((s) => s.state === 'error').length, [sources]);
  const totalKnown = useMemo(() => sources.reduce((sum, s) => sum + (s.count ?? 0), 0), [sources]);
  const findings = sources.find((s) => s.id === 'findings')?.count;
  const clients = sources.find((s) => s.id === 'clients')?.count;
  const passports = sources.find((s) => s.id === 'passports')?.count;
  const integrations = sources.find((s) => s.id === 'integrations')?.count;

  return <section className="space-y-6">
    <div className="spr-panel p-6 md:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-sm border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><Activity className="h-3.5 w-3.5" /> MSP command center</div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--spr-text)] md:text-4xl">One operating view across the stack.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">SPR stays above the PSA/RMM and evidence stack: it pulls the signals it can access, preserves unknowns when a source is unavailable, and gives the MSP one place to see clients, software, findings, evidence, monitoring and remediation.</p>
        </div>
        <button onClick={() => void load()} disabled={refreshing} className="spr-btn spr-btn-secondary shrink-0"><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh stack</button>
      </div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[['Clients', clients, Building2], ['Software', passports, Database], ['Findings', findings, ShieldAlert], ['Sources', integrations, PlugZap]].map(([label, value, Icon]: any) => <div key={label} className="spr-panel p-5"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]"><Icon className="h-3.5 w-3.5" />{label}</div><div className="mt-3 text-3xl font-semibold text-[var(--spr-text)]">{value === null || value === undefined ? 'Not verified' : value}</div></div>)}
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <div className="spr-panel p-5">
        <div className="mb-4 flex items-center justify-between"><div><div className="text-sm font-semibold text-[var(--spr-text)]">Stack connectivity</div><div className="mt-1 text-xs text-[var(--spr-text-faint)]">Live protected API checks — no synthetic connection states.</div></div><div className="text-xs text-[var(--spr-text-muted)]">{connected}/{sources.length} reachable</div></div>
        <div className="grid gap-2 md:grid-cols-2">{sources.map((source) => <div key={source.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-medium text-[var(--spr-text)]">{source.label}</div><div className="mt-1 text-[11px] text-[var(--spr-text-faint)]">{source.kind}</div></div>{sourceStatus(source)}</div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-[var(--spr-text-muted)]">Observed records</span><span className="font-semibold text-[var(--spr-text)]">{source.count === null ? 'Not verified' : source.count}</span></div>{source.detail && <div className="mt-2 text-[11px] text-[var(--spr-red)]">{source.detail}</div>}</div>)}</div>
      </div>

      <div className="spr-panel p-5">
        <div className="text-sm font-semibold text-[var(--spr-text)]">Today’s control plane</div>
        <div className="mt-1 text-xs text-[var(--spr-text-faint)]">Jump directly into the real operating surfaces.</div>
        <div className="mt-4 space-y-2">{NAV.map(([label, path]) => <button key={path} onClick={() => onNavigate(path)} className="flex w-full items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-3 text-left hover:bg-[var(--spr-surface-hover)]"><span className="text-xs text-[var(--spr-text-muted)]">{label}</span><ArrowRight className="h-4 w-4 text-[var(--spr-text-faint)]" /></button>)}</div>
      </div>
    </div>

    <div className="grid gap-5 md:grid-cols-3">
      <div className="spr-panel p-5"><div className="flex items-center gap-2 text-sm font-semibold text-[var(--spr-text)]"><Users className="h-4 w-4" />Multi-client</div><p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">Client-scoped records remain behind the authenticated workspace. The command center only reports what protected endpoints return.</p></div>
      <div className="spr-panel p-5"><div className="flex items-center gap-2 text-sm font-semibold text-[var(--spr-text)]"><FileCheck2 className="h-4 w-4" />Evidence-first</div><p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">Unavailable sources are never converted into a clean, zero, or verified state. That keeps MSP reporting defensible.</p></div>
      <div className="spr-panel p-5"><div className="flex items-center gap-2 text-sm font-semibold text-[var(--spr-text)]"><CircleSlash2 className="h-4 w-4" />Integration boundary</div><p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">SPR does not pretend to replace RMM/PSA functions. It correlates their evidence and links back to the systems of record.</p></div>
    </div>

    <div className="text-[11px] text-[var(--spr-text-faint)]">{failed > 0 ? <span className="inline-flex items-center gap-1 text-[var(--spr-amber)]"><AlertTriangle className="h-3.5 w-3.5" />{failed} source{failed === 1 ? '' : 's'} unavailable; those values remain unverified.</span> : <span className="inline-flex items-center gap-1 text-[var(--spr-green)]"><CheckCircle2 className="h-3.5 w-3.5" />All configured command-center sources responded.</span>} {lastSync ? ` Last checked ${new Date(lastSync).toLocaleTimeString()}.` : ''} {totalKnown > 0 ? ` ${totalKnown} records observed across collection endpoints.` : ''}</div>
  </section>;
}
