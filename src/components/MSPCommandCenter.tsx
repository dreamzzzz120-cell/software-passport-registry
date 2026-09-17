import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Building2, CheckCircle2, ChevronRight, FileCheck2, FileSearch, Layers, Network, RefreshCw, Search, ShieldAlert, ShieldCheck, ShieldQuestion, User, Users, Wrench, X } from 'lucide-react';
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

// Evidence older than this is not treated as fresh for the coverage metric below.
// This does not change any stored evidence or score — it only affects how the
// Trust Network summarizes freshness for a human reading the page.
const EVIDENCE_FRESHNESS_WINDOW_DAYS = 30;
const MAX_NETWORK_CLIENTS = 6;

// Quick-jump strip to the real, existing routes that make up the trust
// network layer. None of these paths are invented — they mirror the exact
// routes already wired in App.tsx.
const NETWORK_NAV = [
  { id: 'msp', label: 'Command', path: '/msp' },
  { id: 'clients', label: 'Clients', path: '/clients' },
  { id: 'assets', label: 'Software', path: '/assets' },
  { id: 'passports', label: 'Passports', path: '/passports' },
  { id: 'evidence-explorer', label: 'Evidence', path: '/evidence-explorer' },
  { id: 'monitoring', label: 'Monitoring', path: '/monitoring' },
  { id: 'reports', label: 'Reports', path: '/reports' },
];

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

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--spr-text-muted)]">{label}</p><p className="mt-2 text-sm leading-5 text-[var(--spr-text)]">{value}</p></div>; }
function formatStoredTime(value?: string | null) { return value ? new Date(value).toLocaleString() : 'Not observed'; }
function evidenceList(value?: string | null) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }

export default function MSPCommandCenter({ clients, alerts, passports, role = 'Viewer', onSelectClient, onSelectPassport, onNavigate, verificationDecisions, dataStatus = 'ready', onRetry }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [clientSwitcherOpen, setClientSwitcherOpen] = useState(false);
  const canAssign = role === 'Owner' || role === 'Admin';

  // Finding detail ("Explain this") and the remediation workflow attached to it.
  const [finding, setFinding] = useState<any | null>(null);
  const [findingError, setFindingError] = useState<string | null>(null);
  const [findingLoading, setFindingLoading] = useState(false);
  const [task, setTask] = useState<any | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [monitoringConfigurations, setMonitoringConfigurations] = useState<any[]>([]);
  const [monitoringConfigurationId, setMonitoringConfigurationId] = useState('');

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
  const criticalClients = new Set(attention.filter(item => item.severity === 'Critical').map(item => item.clientName)).size;

  // Real software-verification rollup from passport records already loaded by the
  // app — nothing here is fabricated or defaulted to 0/100/VERIFIED. A passport
  // with no decision is counted as unknown, not coerced.
  const softwareVerification = useMemo(() => {
    let verified = 0;
    let needsReview = 0;
    let unknown = 0;
    let freshEvidence = 0;
    let staleOrMissingEvidence = 0;
    const now = Date.now();
    for (const passport of passports) {
      // Rollup counts come from the authoritative evaluator, not from the
      // legacy verification_status column.
      const decision = verificationDecisions?.[passport.id];
      if (decision === 'VERIFIED') verified += 1;
      else if (decision === 'PARTIAL' || decision === 'INVESTIGATE') needsReview += 1;
      else unknown += 1;

      const evidenceTimestamps = (passport.evidence || [])
        .map((item) => (item?.timestamp ? Date.parse(item.timestamp) : NaN))
        .filter((value) => !Number.isNaN(value));
      if (evidenceTimestamps.length === 0) {
        staleOrMissingEvidence += 1;
        continue;
      }
      const mostRecent = Math.max(...evidenceTimestamps);
      const ageDays = (now - mostRecent) / (1000 * 60 * 60 * 24);
      if (ageDays <= EVIDENCE_FRESHNESS_WINDOW_DAYS) freshEvidence += 1;
      else staleOrMissingEvidence += 1;
    }
    const total = passports.length;
    // Coverage is left undefined (not 0%) when there is nothing to measure yet,
    // so an empty portfolio never renders as "0% verified".
    const coveragePct = total > 0 ? Math.round((verified / total) * 100) : null;
    const freshnessPct = total > 0 ? Math.round((freshEvidence / total) * 100) : null;
    return { total, verified, needsReview, unknown, freshEvidence, staleOrMissingEvidence, coveragePct, freshnessPct };
  }, [passports, verificationDecisions]);

  // Evidence coverage counts real evidence *items* (not passports). A portfolio
  // with zero evidence items renders "no data", never a misleading 0% or 100%.
  const evidenceCoverage = useMemo(() => {
    let total = 0;
    let verified = 0;
    for (const passport of passports) {
      for (const item of passport.evidence || []) {
        total += 1;
        if (item?.status === 'VERIFIED') verified += 1;
      }
    }
    return { total, verified, pct: total > 0 ? Math.round((verified / total) * 100) : null };
  }, [passports]);

  // Recent observations come only from each passport's own real timeline
  // entries. Nothing here is synthesized.
  const recentObservations = useMemo(() => {
    const entries: { date: string; event: string; software: string; passportId: string }[] = [];
    for (const passport of passports) {
      for (const entry of passport.timeline || []) {
        if (!entry?.date) continue;
        entries.push({ date: entry.date, event: entry.event || entry.details || 'Recorded event', software: passport.name, passportId: passport.id });
      }
    }
    return entries.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 8);
  }, [passports]);

  const clientRiskRollup = useMemo(() => clients.map(client => {
    const findings = active.filter(a => a.clientName === client.name);
    return { client, findings, critical: findings.filter(a => a.severity === 'Critical').length, high: findings.filter(a => a.severity === 'High').length, technician: assignmentMap.get(client.id) || 'Unassigned' };
  }).sort((a, b) => b.critical - a.critical || b.high - a.high || b.findings.length - a.findings.length), [clients, active, assignmentMap]);
  const rows = useMemo(() => clientRiskRollup
    .filter(r => !query || r.client.name.toLowerCase().includes(query.toLowerCase()))
    .filter(r => filter === 'All' || (filter === 'Attention' ? r.findings.length > 0 : r.technician === filter)), [clientRiskRollup, query, filter]);

  // The Trust Network map's Client -> Software layer, built strictly from each
  // client's own real softwareInventory, joined to the authoritative decision
  // from the single batch retrieval in App — never a per-row request.
  const networkClients: NetworkClientNode[] = useMemo(() => clientRiskRollup.slice(0, MAX_NETWORK_CLIENTS).map(({ client }) => ({
    id: client.id,
    name: client.name,
    software: (client.softwareInventory || []).map((item) => {
      const state: TrustState = trustStateFromDecision(verificationDecisions?.[item.passportId]);
      return { passportId: item.passportId, name: item.name, state };
    }),
  })), [clientRiskRollup, verificationDecisions]);
  const clientsOmittedFromNetwork = Math.max(0, clients.length - networkClients.length);

  const assign = async (clientId: string, member: TeamMember) => {
    const response = await apiFetch('/api/msp/assignments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, technicianUserId: member.id, technicianDisplay: member.displayName || member.email }) });
    if (response.ok) setAssignments(current => [...current.filter(a => a.client_id !== clientId), { client_id: clientId, technician_display: member.displayName || member.email }]);
    setAssigning(null);
  };

  useEffect(() => {
    if (!selected) { setFinding(null); setFindingError(null); setTask(null); setTaskError(null); return; }
    let cancelled = false;
    setFindingLoading(true); setFindingError(null); setFinding(null);
    apiFetch(`/api/trust-loop/findings/${encodeURIComponent(selected.id)}`).then(async response => {
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.error || 'Finding details are unavailable.'); }
      return response.json();
    }).then(data => { if (!cancelled) setFinding(data); }).catch((cause: any) => { if (!cancelled) setFindingError(cause?.message || 'Finding details are unavailable.'); }).finally(() => { if (!cancelled) setFindingLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);
  useEffect(() => {
    if (!task?.id || !['VERIFICATION_QUEUED', 'VERIFYING'].includes(task.status)) return;
    const interval = window.setInterval(() => {
      apiFetch(`/api/remediation-tasks/${encodeURIComponent(task.id)}`).then(response => response.ok ? response.json() : null).then(updated => { if (updated) setTask(updated); }).catch(() => {});
    }, 2_500);
    return () => window.clearInterval(interval);
  }, [task?.id, task?.status]);
  useEffect(() => {
    if (!selected) return;
    apiFetch('/api/monitoring/monitoring-configurations').then(response => response.ok ? response.json() : []).then(rows => {
      if (Array.isArray(rows)) { setMonitoringConfigurations(rows); setMonitoringConfigurationId(rows[0]?.id || ''); }
    }).catch(() => { setMonitoringConfigurations([]); setMonitoringConfigurationId(''); });
  }, [selected?.id]);
  useEffect(() => {
    if (!selected) return;
    apiFetch('/api/remediation-tasks').then(response => response.ok ? response.json() : []).then(rows => {
      if (Array.isArray(rows)) setTask(rows.find((item: any) => item.alertId === selected.id) || null);
    }).catch(() => {});
  }, [selected?.id]);
  const createTask = async () => {
    if (!selected || taskLoading) return;
    setTaskLoading(true); setTaskError(null);
    try {
      const response = await apiFetch('/api/remediation-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertId: selected.id }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'SPR could not create the remediation task.');
      setTask(body);
    } catch (cause: any) { setTaskError(cause?.message || 'SPR could not create the remediation task.'); }
    finally { setTaskLoading(false); }
  };
  const transitionTask = async (action: 'start' | 'ready-for-verification') => {
    if (!task || taskLoading) return;
    setTaskLoading(true); setTaskError(null);
    try {
      const response = await apiFetch(`/api/remediation-tasks/${encodeURIComponent(task.id)}/${action}`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'SPR could not update the task.');
      setTask(body);
    } catch (cause: any) { setTaskError(cause?.message || 'SPR could not update the task.'); }
    finally { setTaskLoading(false); }
  };
  const queueVerification = async () => {
    if (!task || !monitoringConfigurationId || taskLoading) return;
    setTaskLoading(true); setTaskError(null);
    try {
      const response = await apiFetch(`/api/remediation-tasks/${encodeURIComponent(task.id)}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monitoringConfigurationId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'SPR could not queue verification.');
      setTask((current: any) => ({ ...current, status: 'VERIFICATION_QUEUED', verificationJobId: body.collectorJobId }));
    } catch (cause: any) { setTaskError(cause?.message || 'SPR could not queue verification.'); }
    finally { setTaskLoading(false); }
  };

  const hasClients = clients.length > 0;
  const hasSoftware = passports.length > 0;

  return <div id="msp-command-center" className="mx-auto max-w-7xl space-y-6 pb-14">
    <nav className="flex flex-wrap items-center gap-1.5 border-b border-[var(--spr-border)] pb-3" aria-label="MSP workspace navigation">
      {NETWORK_NAV.map((item) => <button key={item.id} onClick={() => onNavigate(item.path)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${item.id === 'msp' ? 'bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]' : 'text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] hover:text-[var(--spr-text)]'}`}>{item.label}</button>)}
      <div className="ml-auto relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--spr-text-faint)]" /><input aria-label="Search clients" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search clients" className="w-48 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] py-2 pl-9 pr-3 text-xs text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]" /></div>
    </nav>

    <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
      <div><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]"><Network className="h-4 w-4" /> MSP control plane</div><h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--spr-text)] md:text-4xl">Trust Network</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">A live view of software trust across your client environment. See what changed, what needs attention, and where your team can act.</p></div>
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <button onClick={() => setClientSwitcherOpen((open) => !open)} disabled={clients.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] disabled:opacity-50"><User className="h-4 w-4" /> Switch client</button>
          {clientSwitcherOpen && clients.length > 0 && (
            <div className="absolute right-0 z-10 mt-2 max-h-72 w-64 overflow-y-auto rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-1 shadow-2xl" role="menu">
              {clients.map((client) => (
                <button key={client.id} role="menuitem" onClick={() => { onSelectClient(client.id); onNavigate('clients'); setClientSwitcherOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">{client.name}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => onNavigate('/clients')} className="inline-flex items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)]"><Users className="h-4 w-4" />Add client</button>
        <button onClick={() => onNavigate('/passports')} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-semibold text-white"><Layers className="h-4 w-4" />Add software</button>
      </div>
    </header>

    {dataStatus === 'loading' ? (
      // Skeleton rather than zeros: rendering 0 clients / 0 software while the
      // estate is still being read states something false about the account.
      <section aria-busy="true" aria-live="polite" className="space-y-5">
        <span className="sr-only">Loading your trust network…</span>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]" />)}</div>
        <div className="h-96 animate-pulse rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]" />
      </section>
    ) : dataStatus === 'error' ? (
      <section role="alert" className="mx-auto max-w-2xl rounded-2xl border border-[var(--spr-red)]/30 bg-[var(--spr-surface-alt)] py-20 text-center">
        <AlertTriangle className="mx-auto h-9 w-9 text-[var(--spr-red)]" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-bold text-[var(--spr-text)]">Trust Network couldn&rsquo;t load</h2>
        {/* Deliberately says nothing about the underlying failure: no code, no
            URL, no message from the server. */}
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--spr-text-muted)]">We couldn&rsquo;t retrieve the latest trust information. Your stored data has not been changed.</p>
        {onRetry && <button onClick={onRetry} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-semibold text-white"><RefreshCw className="h-4 w-4" />Try again</button>}
      </section>
    ) : !hasClients ? (
      <section className="rounded-2xl border border-dashed border-[var(--spr-border)] bg-[var(--spr-surface-alt)] py-20 text-center">
        <Network className="mx-auto h-9 w-9 text-[var(--spr-text-faint)]" />
        <h2 className="mt-4 text-xl font-bold text-[var(--spr-text)]">Build your trust network</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--spr-text-muted)]">Add your first client to begin observing software trust across their environment.</p>
        <button onClick={() => onNavigate('/clients')} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white">Add client <ArrowRight className="h-4 w-4" /></button>
      </section>
    ) : !hasSoftware ? (
      <section className="rounded-2xl border border-dashed border-[var(--spr-border)] bg-[var(--spr-surface-alt)] py-20 text-center">
        <Layers className="mx-auto h-9 w-9 text-[var(--spr-text-faint)]" />
        <h2 className="mt-4 text-xl font-bold text-[var(--spr-text)]">Client trust environment ready</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--spr-text-muted)]">Add software to establish your first Software Passport.</p>
        <button onClick={() => onNavigate('/passports')} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white">Add software <ArrowRight className="h-4 w-4" /></button>
      </section>
    ) : <>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Clients" value={clients.length} sub={`${active.length} active observations`} icon={<Building2 className="h-5 w-5" />} tone="text-[var(--spr-highlight)]" /><Metric label="Verified software" value={softwareVerification.verified} sub={`${softwareVerification.needsReview} need review · ${softwareVerification.unknown} unknown`} icon={<ShieldCheck className="h-5 w-5" />} tone="text-[var(--spr-green)]" /><Metric label="Critical" value={criticalClients} sub="Clients with an active critical finding" icon={<AlertTriangle className="h-5 w-5" />} tone={criticalClients ? 'text-[var(--spr-red)]' : 'text-[var(--spr-text-faint)]'} /><Metric label="Attention" value={attention.length} sub={`${new Set(attention.map(a => a.clientName)).size} clients affected`} icon={<Bell className="h-5 w-5" />} tone={attention.length ? 'text-[var(--spr-amber)]' : 'text-[var(--spr-green)]'} /></section>
    <p className="flex items-start gap-1.5 text-xs leading-5 text-[var(--spr-text-faint)]"><ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Unknown means evidence unavailable or insufficient — SPR does not infer a pass when authoritative evidence is unavailable. Unknown is not the same as Critical.</p>

    <section className="grid gap-4 lg:grid-cols-[1.4fr_.8fr]"><div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-[var(--spr-text)]">Portfolio attention</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Prioritized from recorded findings.</p></div><span className="rounded-full border border-[var(--spr-border)] px-2.5 py-1 text-xs text-[var(--spr-text-muted)]">{attention.length} active</span></div><div className="mt-4 divide-y divide-[var(--spr-border)]">{attention.slice(0, 5).map(a => <button key={a.id} onClick={() => setSelected(a)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 py-4 text-left hover:bg-[var(--spr-surface-hover)]"><span className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase ${severityClass(a.severity)}`}>{a.severity}</span><span><span className="block text-sm font-semibold text-[var(--spr-text)]">{a.title}</span><span className="mt-1 block text-xs text-[var(--spr-text-muted)]">{a.clientName} · {a.category}</span><span className="mt-1 block text-[11px] text-[var(--spr-text-faint)]">Not linked to a specific software passport</span></span><ChevronRight className="h-4 w-4 text-[var(--spr-text-faint)]" /></button>)}{attention.length === 0 && <div className="py-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-[var(--spr-green)]" /><p className="mt-3 font-semibold text-[var(--spr-text)]">No active observations</p></div>}</div>{attention.length > 5 && <button onClick={() => onNavigate('/alerts')} className="mt-3 text-xs font-semibold text-[var(--spr-highlight)]">View all observations →</button>}</div>
      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><h2 className="text-lg font-bold text-[var(--spr-text)]">Trust posture</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Authoritative software verification state.</p><div className="mt-5 space-y-4">{[['Verified', softwareVerification.verified, 'var(--spr-green)'], ['Needs review', softwareVerification.needsReview, 'var(--spr-amber)'], ['Unknown', softwareVerification.unknown, 'var(--spr-text-faint)']].map(([label, value, tone]) => <div key={label as string}><div className="flex justify-between text-xs font-semibold"><span className="text-[var(--spr-text-muted)]">{label}</span><span className="text-[var(--spr-text)]">{value}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--spr-surface-hover)]"><div className="h-full rounded-full" style={{ width: `${softwareVerification.total ? Number(value) / softwareVerification.total * 100 : 0}%`, background: tone as string }} /></div></div>)}</div></div></section>

    <section className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Evidence coverage</h2>
        {evidenceCoverage.total > 0 ? (
          <>
            <p className="mt-3 text-3xl font-bold text-[var(--spr-text)]">{evidenceCoverage.verified} / {evidenceCoverage.total}</p>
            <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{evidenceCoverage.pct}% of recorded evidence is independently verified</p>
          </>
        ) : <p className="mt-3 text-sm text-[var(--spr-text-faint)]">No data — no evidence has been recorded yet.</p>}
      </div>
      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Verification coverage</h2>
        {softwareVerification.total > 0 ? (
          <>
            <p className="mt-3 text-3xl font-bold text-[var(--spr-text)]">{softwareVerification.verified} / {softwareVerification.total}</p>
            <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{softwareVerification.coveragePct}% of software assets · evidence fresh (≤{EVIDENCE_FRESHNESS_WINDOW_DAYS}d) for {softwareVerification.freshnessPct ?? '—'}%</p>
          </>
        ) : <p className="mt-3 text-sm text-[var(--spr-text-faint)]">No software assets on record yet.</p>}
      </div>
    </section>

    <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className="mb-4 flex items-end justify-between"><div><h2 className="text-lg font-bold text-[var(--spr-text)]">Trust network</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Client → software → current trust state.</p></div><button onClick={() => onNavigate('/trust-graph')} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--spr-highlight)]">Open graph <ArrowRight className="h-3.5 w-3.5" /></button></div><TrustNetworkMap clients={networkClients} clientsOmitted={clientsOmittedFromNetwork} onSelectClient={(id) => { onSelectClient(id); onNavigate('/clients'); }} onSelectSoftware={(passportId) => { onSelectPassport?.(passportId); onNavigate('/passports'); }} /></section>

    <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-lg font-bold text-[var(--spr-text)]">Client operations</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Portfolio risk, trust state and technician ownership.</p></div><div className="flex flex-wrap gap-1.5">{['All', 'Attention', ...team.slice(0, 4).map(t => t.displayName || t.email)].map(f => <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${filter === f ? 'border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{f}</button>)}</div></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-[var(--spr-border)] text-[10px] uppercase tracking-[.14em] text-[var(--spr-text-faint)]"><tr><th className="px-3 py-3">Client</th><th className="px-3 py-3">Trust</th><th className="px-3 py-3">Critical</th><th className="px-3 py-3">High</th><th className="px-3 py-3">Observations</th><th className="px-3 py-3">Technician</th><th /></tr></thead><tbody className="divide-y divide-[var(--spr-border)]">{rows.map(({ client, critical, high, findings, technician }) => { const states = (client.softwareInventory || []).map(s => verificationDecisions?.[s.passportId]).filter(Boolean); const state = states.length && states.every(s => s === 'VERIFIED') ? 'VERIFIED' : states.some(s => s === 'PARTIAL' || s === 'INVESTIGATE') ? 'INVESTIGATE' : 'UNKNOWN'; return <tr key={client.id} className="hover:bg-[var(--spr-surface-hover)]"><td className="px-3 py-3"><button onClick={() => { onSelectClient(client.id); onNavigate('/clients'); }} className="font-semibold text-[var(--spr-text)] hover:text-[var(--spr-highlight)]">{client.name}</button></td><td className="px-3 py-3"><StatePill state={state as any} /></td><td className="px-3 py-3 font-bold text-[var(--spr-red)]">{critical || '—'}</td><td className="px-3 py-3 font-semibold text-[var(--spr-amber)]">{high || '—'}</td><td className="px-3 py-3 text-[var(--spr-text-muted)]">{findings.length}</td><td className="relative px-3 py-3">{canAssign ? <><button onClick={() => setAssigning(assigning === client.id ? null : client.id)} className="inline-flex items-center gap-1.5 text-xs text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]"><Wrench className="h-3.5 w-3.5" />{technician}</button>{assigning === client.id && <div className="absolute left-2 top-11 z-20 w-56 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-1 shadow-2xl">{team.map(member => <button key={member.id} onClick={() => void assign(client.id, member)} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">{member.displayName || member.email}</button>)}</div>}</> : <span className="text-xs text-[var(--spr-text-faint)]">{technician}</span>}</td><td className="px-3 py-3"><button onClick={() => { onSelectClient(client.id); onNavigate('/clients'); }} className="rounded-lg p-2 text-[var(--spr-text-faint)] hover:bg-[var(--spr-surface-hover)]"><ArrowRight className="h-4 w-4" /></button></td></tr>; })}</tbody></table>{rows.length === 0 && <div className="py-10 text-center text-sm text-[var(--spr-text-muted)]">No clients match this view.</div>}</div></section>

    <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
      <h2 className="text-lg font-bold text-[var(--spr-text)]">Recent observations</h2>
      <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Real, recorded timeline events from your software passports.</p>
      {recentObservations.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {recentObservations.map((entry, index) => (
            <li key={`${entry.passportId}-${index}`} className="flex flex-col gap-1 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-[var(--spr-text)]">{entry.event}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-[var(--spr-text-muted)]"><span className="font-mono text-[var(--spr-text-faint)]">{entry.date}</span><span>{entry.software}</span></span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-[var(--spr-text-faint)]">No recorded observations yet.</p>}
    </section>

    <section className="grid gap-4 md:grid-cols-4">{[['Evidence review', '/evidence-explorer', evidenceCoverage.total - evidenceCoverage.verified], ['Software verification', '/passports', softwareVerification.needsReview + softwareVerification.unknown], ['Monitoring', '/monitoring', null], ['Reports', '/reports', null]].map(([label, path, count]) => <button key={label as string} onClick={() => onNavigate(path as string)} className="flex items-center justify-between rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-left hover:bg-[var(--spr-surface-hover)]"><span className="text-sm font-semibold text-[var(--spr-text)]">{label}</span><span className="flex items-center gap-2 text-xs text-[var(--spr-text-faint)]">{count == null ? 'Open' : `${Math.max(0, Number(count))} items`}<ArrowRight className="h-3.5 w-3.5" /></span></button>)}</section>

    </>}

    {selected && <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-0 md:items-center md:justify-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="finding-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl md:rounded-2xl">
        <div className="flex items-start justify-between gap-4"><div><span className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase ${severityClass(selected.severity)}`}>{selected.severity}</span><p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--spr-highlight)]">Finding detail · Explain this</p><h2 id="finding-title" className="mt-2 text-xl font-bold text-[var(--spr-text)]">{selected.title}</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">{selected.clientName} · {selected.category}</p></div><button onClick={() => setSelected(null)} aria-label="Close finding" className="rounded-lg p-2 text-[var(--spr-text-faint)] hover:bg-[var(--spr-surface-hover)] hover:text-[var(--spr-text)]"><X className="h-5 w-5" /></button></div>
        {findingLoading && <div className="mt-6 grid gap-4 sm:grid-cols-2">{[1, 2, 3, 4].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-[var(--spr-surface-hover)]" />)}</div>}
        {findingError && <div role="alert" className="mt-6 rounded-xl border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 p-4 text-sm text-[var(--spr-red)]"><p className="font-semibold">Finding detail unavailable</p><p className="mt-1">{findingError}</p></div>}
        {finding && <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2"><Detail label="Client" value={finding.clientName} /><Detail label="Severity and status" value={`${finding.severity} — ${finding.status}`} /><Detail label="First observed" value={formatStoredTime(finding.firstObservedAt || finding.timestamp)} /><Detail label="Last observed" value={formatStoredTime(finding.lastObservedAt || finding.timestamp)} /></div>
          <section className="mt-5 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4"><h3 className="text-sm font-semibold text-[var(--spr-text)]">Observed</h3><p className="mt-2 text-sm leading-6 text-[var(--spr-text)]">{finding.description || 'No observation description is available.'}</p></section>
          <div className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Why it matters" value="Review this recorded finding with its evidence before choosing remediation." /><Detail label="What you can do" value="Create a remediation task, then collect a new observation before treating the finding as resolved." /></div>
          <section className="mt-5 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4"><h3 className="text-sm font-semibold text-[var(--spr-text)]">Evidence chain</h3><p className="mt-1 text-xs text-[var(--spr-text-muted)]">Finding → observed artifact → source evidence → verification time</p>{evidenceList(finding.evidenceIds).length ? <ul className="mt-4 space-y-2">{evidenceList(finding.evidenceIds).map((id: string) => <li key={id} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-2 font-mono text-xs text-[var(--spr-text)]">Evidence reference: {id}</li>)}</ul> : <p className="mt-4 text-sm text-[var(--spr-text-muted)]">Evidence unavailable. This finding has no stored evidence references.</p>}</section>
        </>}
        {taskError && <p role="alert" className="mt-4 text-sm text-[var(--spr-red)]">{taskError}</p>}
        {task && <section className="mt-5 rounded-xl border border-[var(--spr-accent)] bg-[var(--spr-accent-soft)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--spr-highlight)]">Remediation task</p>
          <p className="mt-2 font-semibold text-[var(--spr-text)]">{task.title}</p>
          <p className="mt-1 text-sm text-[var(--spr-text)]">{String(task.status).replaceAll('_', ' ')} · created {formatStoredTime(task.createdAt)}</p>
          {task.status === 'OPEN' && <button onClick={() => void transitionTask('start')} disabled={taskLoading} className="mt-4 rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Start remediation'}</button>}
          {task.status === 'IN_PROGRESS' && <button onClick={() => void transitionTask('ready-for-verification')} disabled={taskLoading} className="mt-4 rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Mark ready for verification'}</button>}
          {task.status === 'READY_FOR_VERIFICATION' && <div className="mt-4 flex flex-wrap items-center gap-2">
            <select value={monitoringConfigurationId} onChange={(e) => setMonitoringConfigurationId(e.target.value)} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1.5 text-xs text-[var(--spr-text)]">
              <option value="">Select monitoring configuration…</option>
              {monitoringConfigurations.map((configuration: any) => <option key={configuration.id} value={configuration.id}>{configuration.name || configuration.id}</option>)}
            </select>
            <button onClick={() => void queueVerification()} disabled={taskLoading || !monitoringConfigurationId} className="rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{taskLoading ? 'Queueing…' : 'Collect new observation'}</button>
          </div>}
          {['VERIFICATION_QUEUED', 'VERIFYING'].includes(task.status) && <p className="mt-3 text-xs text-[var(--spr-text-muted)]">Verification observation in progress{task.verificationJobId ? ` · job ${task.verificationJobId}` : ''}. This panel refreshes automatically.</p>}
          {task.status === 'VERIFIED' && <p className="mt-3 text-xs text-[var(--spr-green)]">Verified by a new observation{task.verifiedAt ? ` at ${formatStoredTime(task.verifiedAt)}` : ''}.</p>}
          {task.status === 'VERIFICATION_FAILED' && <p className="mt-3 text-xs text-[var(--spr-red)]">The verification observation did not confirm remediation. Review the finding before retrying.</p>}
        </section>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={() => { setSelected(null); onNavigate('/alerts'); }} disabled={!finding} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><FileSearch className="h-4 w-4" /> Show evidence</button>
          {task ? <span className="rounded-xl border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Task created</span> : <button onClick={() => void createTask()} disabled={!finding || taskLoading} className="rounded-xl border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50">{taskLoading ? 'Creating task…' : 'Create remediation task'}</button>}
          <button onClick={() => { const c = clients.find(x => x.name === selected.clientName); if (c) { onSelectClient(c.id); onNavigate('/clients'); } setSelected(null); }} className="rounded-xl border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">Open client</button>
          <button onClick={() => { onNavigate('/monitoring'); setSelected(null); }} className="rounded-xl border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">Open monitoring</button>
        </div>
      </div>
    </div>}
  </div>;
}
