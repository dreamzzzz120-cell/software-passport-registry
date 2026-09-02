import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock3, Database, FileCheck2, FileSearch, Layers, Network, Plus, Radio, ShieldAlert, ShieldQuestion, User, X } from 'lucide-react';
import { Alert, Client, SoftwarePassport } from '../types';
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
  /**
   * Authoritative decisions keyed by passport id, from the single batch
   * retrieval in App (GET /api/user/verification). The grid never issues a
   * per-passport verification request, and a passport absent from this map
   * renders UNINITIALIZED rather than falling back to the legacy column.
   */
  verificationDecisions?: Record<string, VerificationDecisionState>;
}

type Assignment = { id: string; client_id: string; technician_display: string; assigned_by: string; updated_at: string };
type TeamMember = { id: number; email: string; displayName?: string | null; role: string };

const severityClass = (severity: Alert['severity']) => severity === 'Critical'
  ? 'bg-[var(--spr-red)]/10 text-[var(--spr-red)] border-[var(--spr-red)]/30'
  : severity === 'High' ? 'bg-[var(--spr-amber)]/10 text-[var(--spr-amber)] border-[var(--spr-amber)]/30'
  : 'bg-[var(--spr-accent)]/20 text-[var(--spr-highlight)] border-[var(--spr-highlight)]/30';

// Evidence older than this is not treated as fresh for the coverage metric below.
// This does not change any stored evidence or score — it only affects how the
// Trust Network summarizes freshness for a human reading the page.
const EVIDENCE_FRESHNESS_WINDOW_DAYS = 30;
const MAX_NETWORK_CLIENTS = 6;

// Quick-jump strip to the real, existing routes that make up the trust
// network layer. None of these paths are invented — they mirror the exact
// routes already wired in App.tsx/CommandCenter.tsx.
const NETWORK_NAV = [
  { id: 'msp', label: 'Trust Network', path: '/msp' },
  { id: 'clients', label: 'Clients', path: '/clients' },
  { id: 'assets', label: 'Software', path: '/assets' },
  { id: 'passports', label: 'Passports', path: '/passports' },
  { id: 'evidence-explorer', label: 'Evidence', path: '/evidence-explorer' },
  { id: 'monitoring', label: 'Monitoring', path: '/monitoring' },
  { id: 'reports', label: 'Reports', path: '/reports' },
];

export default function MSPCommandCenter({ clients, alerts, passports, role = 'Viewer', onSelectClient, onSelectPassport, onNavigate, verificationDecisions }: Props) {
  const [selected, setSelected] = useState<Alert | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assigningClientId, setAssigningClientId] = useState<string | null>(null);
  const [clientSwitcherOpen, setClientSwitcherOpen] = useState(false);
  const canAssign = role === 'Owner' || role === 'Admin';

  const loadAssignments = () => { apiFetch('/api/msp/assignments').then((r) => r.ok ? r.json() : null).then((data) => { if (Array.isArray(data?.assignments)) setAssignments(data.assignments); }).catch(() => {}); };
  useEffect(() => { loadAssignments(); apiFetch('/api/organization/team').then((r) => r.ok ? r.json() : null).then((data) => { if (Array.isArray(data)) setTeam(data); }).catch(() => {}); }, []);

  const assignmentByClient = useMemo(() => new Map(assignments.map((a) => [a.client_id, a])), [assignments]);
  const assignTechnician = async (clientId: string, member: TeamMember) => {
    const response = await apiFetch('/api/msp/assignments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, technicianUserId: member.id, technicianDisplay: member.displayName || member.email }) });
    if (response.ok) { loadAssignments(); setAssigningClientId(null); }
  };
  const unassignTechnician = async (clientId: string) => {
    const response = await apiFetch(`/api/msp/assignments/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
    if (response.ok) loadAssignments();
  };

  const clientRiskRollup = useMemo(() => clients.map((client) => {
    const clientAlerts = alerts.filter((a) => a.clientName === client.name);
    const active = clientAlerts.filter((a) => a.status !== 'Resolved' && a.status !== 'Cancelled');
    const critical = active.filter((a) => a.severity === 'Critical').length;
    const high = active.filter((a) => a.severity === 'High').length;
    return { client, activeCount: active.length, critical, high, assignment: assignmentByClient.get(client.id) };
  }).sort((a, b) => (b.critical - a.critical) || (b.high - a.high) || (b.activeCount - a.activeCount)), [clients, alerts, assignmentByClient]);
  const [finding, setFinding] = useState<any | null>(null);
  const [findingError, setFindingError] = useState<string | null>(null);
  const [findingLoading, setFindingLoading] = useState(false);
  const [task, setTask] = useState<any | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [monitoringConfigurations, setMonitoringConfigurations] = useState<any[]>([]);
  const [monitoringConfigurationId, setMonitoringConfigurationId] = useState('');
  const attention = useMemo(() => alerts.filter(item => item.status === 'Active').sort((a, b) => {
    const rank = { Critical: 3, High: 2, Medium: 1, Low: 0 };
    return rank[b.severity] - rank[a.severity];
  }), [alerts]);
  const criticalClients = new Set(attention.filter(item => item.severity === 'Critical').map(item => item.clientName)).size;
  const attentionClients = new Set(attention.filter(item => item.severity !== 'Critical').map(item => item.clientName)).size;

  // Real software-verification rollup from passport records already loaded by the
  // app — nothing here is fabricated or defaulted to 0/100/VERIFIED. A passport
  // with no recorded verificationStatus is counted as unknown, not coerced.
  const softwareVerification = useMemo(() => {
    let verified = 0;
    let needsReview = 0;
    let unknown = 0;
    let freshEvidence = 0;
    let staleOrMissingEvidence = 0;
    const now = Date.now();
    for (const passport of passports) {
      // Rollup counts come from the authoritative evaluator, not from the
      // legacy verification_status column. A passport with no decision yet is
      // counted as unknown rather than assumed to be anything better.
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

  // Evidence coverage counts real evidence *items* (not passports): how many
  // of all recorded evidence entries across the portfolio carry a VERIFIED
  // status. A portfolio with zero evidence items renders "NO DATA", never a
  // misleading 0% or 100%.
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
  }, [passports, verificationDecisions]);

  // Recent observations come only from each passport's own real timeline
  // entries. Nothing here is synthesized — a portfolio with no timeline
  // history simply has nothing to show.
  const recentObservations = useMemo(() => {
    const entries: { date: string; event: string; software: string; passportId: string }[] = [];
    for (const passport of passports) {
      for (const entry of passport.timeline || []) {
        if (!entry?.date) continue;
        entries.push({ date: entry.date, event: entry.event || entry.details || 'Recorded event', software: passport.name, passportId: passport.id });
      }
    }
    return entries.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 8);
  }, [passports, verificationDecisions]);

  // The Trust Network map's Client -> Software layer, built strictly from
  // each client's own real softwareInventory (server-computed), joined back
  // to the loaded passport records for their current, real verification
  // state. If a listed software item's passport can't be resolved, its state
  // is reported as unknown (insufficient evidence to say otherwise) rather
  // than guessed from a different field.
  const passportsById = useMemo(() => new Map(passports.map((p) => [p.id, p])), [passports]);
  const networkClients: NetworkClientNode[] = useMemo(() => clientRiskRollup.slice(0, MAX_NETWORK_CLIENTS).map(({ client }) => ({
    id: client.id,
    name: client.name,
    software: (client.softwareInventory || []).map((item) => {
      const passport = passportsById.get(item.passportId);
      // Authoritative decision from the single batch retrieval in App - never
      // the legacy verification_status column, and never a per-row request.
      const state: TrustState = trustStateFromDecision(verificationDecisions?.[item.passportId]);
      return { passportId: item.passportId, name: item.name, state };
    }),
  })), [clientRiskRollup, passportsById, verificationDecisions]);
  const clientsOmittedFromNetwork = Math.max(0, clients.length - networkClients.length);

  useEffect(() => {
    if (!selected) { setFinding(null); setFindingError(null); setTask(null); setTaskError(null); return; }
    let cancelled = false;
    setFindingLoading(true); setFindingError(null); setFinding(null);
    apiFetch(`/api/alerts/${encodeURIComponent(selected.id)}`).then(async response => {
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

  return <div className="mx-auto max-w-6xl space-y-8 pb-10" id="msp-command-center">
    <nav className="flex flex-wrap gap-1.5 overflow-x-auto" aria-label="Trust network sections">
      {NETWORK_NAV.map((item) => (
        <button key={item.id} onClick={() => onNavigate(item.path)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${item.id === 'msp' ? 'border-[var(--spr-highlight)]/50 bg-[var(--spr-accent-soft)]/30 text-[var(--spr-highlight)]' : 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)] text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-sunken)]'}`}>
          {item.label}
        </button>
      ))}
    </nav>

    <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#c586c0]"><Network className="h-4 w-4" /> MSP control plane</div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--spr-text)] md:text-4xl">Trust Network</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">A live view of software trust across your client environment. Observe clients, software, evidence, and trust states from one system.</p>
        {/* The one obvious way in. "Add client" creates the organization record;
            "Import client system" brings that client's software evidence into SPR.
            Both are stated so the difference is readable without training. */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={() => onNavigate('/import-system')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--spr-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spr-highlight)]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Import client system
          </button>
          <button
            onClick={() => onNavigate('/clients')}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-5 py-3 text-sm font-semibold text-[var(--spr-text)] transition hover:bg-[var(--spr-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spr-highlight)]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add client
          </button>
        </div>
        <p className="mt-3 max-w-2xl text-xs leading-5 text-[var(--spr-text-faint)]">
          <strong className="text-[var(--spr-text-muted)]">Import client system</strong> brings a client&rsquo;s software evidence — SBOMs, software files, security and compliance documents — into SPR and organizes it into one trust view. <strong className="text-[var(--spr-text-muted)]">Add client</strong> just creates the organization record.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <button onClick={() => setClientSwitcherOpen((open) => !open)} disabled={clients.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] transition hover:border-[var(--spr-text-faint)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50">
            <User className="h-4 w-4" /> Switch client
          </button>
          {clientSwitcherOpen && clients.length > 0 && (
            <div className="absolute right-0 z-10 mt-2 max-h-72 w-64 overflow-y-auto rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-1 shadow-2xl" role="menu">
              {clients.map((client) => (
                <button key={client.id} role="menuitem" onClick={() => { onSelectClient(client.id); onNavigate('clients'); setClientSwitcherOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">
                  {client.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => onNavigate('clients')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] transition hover:border-[var(--spr-text-faint)] hover:bg-[var(--spr-surface-hover)]">
          View all clients <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>

    {!hasClients ? (
      <section className="rounded-md border border-dashed border-[var(--spr-border)] bg-[var(--spr-surface-deep)] py-20 text-center">
        <Network className="mx-auto h-9 w-9 text-[var(--spr-text-faint)]" />
        <h2 className="mt-4 text-xl font-bold text-[var(--spr-text)]">Build your trust network</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--spr-text-muted)]">Add your first client to begin observing software trust across their environment.</p>
        <button onClick={() => onNavigate('clients')} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)]">Add client <ArrowRight className="h-4 w-4" /></button>
      </section>
    ) : !hasSoftware ? (
      <section className="rounded-md border border-dashed border-[var(--spr-border)] bg-[var(--spr-surface-deep)] py-20 text-center">
        <Layers className="mx-auto h-9 w-9 text-[var(--spr-text-faint)]" />
        <h2 className="mt-4 text-xl font-bold text-[var(--spr-text)]">Client trust environment ready</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--spr-text-muted)]">No software has been imported yet. Bring this client&rsquo;s software evidence into SPR and it will be organized into software assets, evidence and Software Passports.</p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button onClick={() => onNavigate('/import-system')} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[var(--spr-accent-hover)]"><Plus className="h-4 w-4" aria-hidden="true" /> Import client system</button>
          <button onClick={() => onNavigate('passports')} className="inline-flex items-center gap-2 rounded-xl border border-[var(--spr-border)] px-5 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">Add software manually <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </section>
    ) : <>

    <section>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Current trust state</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Verified" value={softwareVerification.verified} icon={<CheckCircle2 />} tone="text-[var(--spr-green)]" sub="Software passports" />
        <Metric label="Needs review" value={softwareVerification.needsReview} icon={<ShieldAlert />} tone="text-[var(--spr-amber)]" sub="Software passports" />
        <Metric label="Unknown" value={softwareVerification.unknown} icon={<ShieldQuestion />} tone="text-[var(--spr-text-faint)]" sub="Software passports" />
        <Metric label="Critical" value={criticalClients} icon={<AlertTriangle />} tone="text-[var(--spr-red)]" sub="Clients with an active critical finding" />
      </div>
      <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-5 text-[var(--spr-text-faint)]"><ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Unknown means evidence unavailable or insufficient — SPR does not infer a pass when authoritative evidence is unavailable. Unknown is not the same as Critical.</p>
    </section>

    <section>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Trust inventory</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Clients" value={clients.length} icon={<Building2 />} tone="text-[var(--spr-highlight)]" />
        <Metric label="Software" value={passports.length} icon={<Database />} tone="text-[var(--spr-highlight)]" />
        <Metric label="Passports" value={passports.length} icon={<Layers />} tone="text-[var(--spr-highlight)]" />
        <Metric label="Evidence" value={evidenceCoverage.total} icon={<FileCheck2 />} tone="text-[var(--spr-highlight)]" />
        <Metric label="Open observations" value={attention.length} icon={<Radio />} tone="text-[var(--spr-highlight)]" />
      </div>
    </section>

    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
      <div className="mb-4"><h2 className="text-lg font-bold text-[var(--spr-text)]">Trust network</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Client → Software → Trust state, built from your actual portfolio.</p></div>
      <TrustNetworkMap clients={networkClients} clientsOmitted={clientsOmittedFromNetwork} onSelectClient={(id) => { onSelectClient(id); onNavigate('clients'); }} onSelectSoftware={(passportId) => { onSelectPassport?.(passportId); onNavigate('passports'); }} />
    </section>

    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]">
      <div className="flex flex-col gap-3 border-b border-[var(--spr-border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-bold text-[var(--spr-text)]">Attention required</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Active observations currently recorded by SPR.</p></div>
        <span className="w-fit rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-1 text-xs font-medium text-[var(--spr-text)]">{attention.length} active findings</span>
      </div>
      {attention.length ? <div className="divide-y divide-[var(--spr-border)]">
        {attention.map(alert => {
          const client = clients.find(item => item.name === alert.clientName);
          return <article key={alert.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.5fr)_auto] lg:items-center">
            <div>
              <p className="font-semibold text-[var(--spr-text)]">{alert.clientName}</p>
              <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Observed {alert.timestamp}</p>
              <p className="mt-1 text-[11px] text-[var(--spr-text-faint)]">Not linked to a specific software passport</p>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap gap-2"><span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${severityClass(alert.severity)}`}>{alert.severity}</span><span className="rounded-md bg-[var(--spr-surface-hover)] px-2 py-0.5 text-[11px] text-[var(--spr-text)]">{alert.category}</span></div>
              <p className="font-medium text-[var(--spr-text)]">{alert.title}</p><p className="mt-1 text-sm leading-5 text-[var(--spr-text-muted)]">{alert.description}</p>
            </div>
            <div className="flex gap-2 lg:flex-col"><button onClick={() => setSelected(alert)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--spr-accent)] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--spr-accent-hover)]">Investigate <ArrowRight className="h-4 w-4" /></button>{client && <button onClick={() => onSelectClient(client.id)} className="rounded-lg border border-[var(--spr-border)] px-3.5 py-2 text-sm font-medium text-[var(--spr-text)] transition hover:bg-[var(--spr-surface-hover)]">Client</button>}</div>
          </article>;
        })}
      </div> : <div className="px-6 py-14 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-[var(--spr-green)]" /><h3 className="mt-3 font-semibold text-[var(--spr-text)]">No clients need attention</h3><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Your monitored clients currently have no active recorded findings requiring action.</p></div>}
    </section>

    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]">
      <div className="flex flex-col gap-3 border-b border-[var(--spr-border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-bold text-[var(--spr-text)]">Cross-client trust risk</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Every client ranked by active critical and high findings, with technician assignment.</p></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[var(--spr-border)] text-[10px] uppercase tracking-[.14em] text-[var(--spr-text-faint)]"><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3">Critical</th><th className="px-5 py-3">High</th><th className="px-5 py-3">Active observations</th><th className="px-5 py-3">Trust state</th><th className="px-5 py-3">Assigned technician</th></tr></thead>
          <tbody className="divide-y divide-[var(--spr-border)]">
            {clientRiskRollup.map(({ client, activeCount, critical, high, assignment }) => (
              <tr key={client.id}>
                <td className="px-5 py-3 font-medium text-[var(--spr-text)]">{client.name}</td>
                <td className="px-5 py-3">{critical > 0 ? <span className="rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 px-2 py-0.5 text-xs font-bold text-[var(--spr-red)]">{critical}</span> : <span className="text-[var(--spr-text-faint)]">0</span>}</td>
                <td className="px-5 py-3">{high > 0 ? <span className="rounded-md border border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/10 px-2 py-0.5 text-xs font-bold text-[var(--spr-amber)]">{high}</span> : <span className="text-[var(--spr-text-faint)]">0</span>}</td>
                <td className="px-5 py-3 text-[var(--spr-text)]">{activeCount}</td>
                <td className="px-5 py-3 text-xs text-[var(--spr-text-muted)]">{client.riskLevel || 'Unknown'}</td>
                <td className="px-5 py-3">
                  {assigningClientId === client.id ? (
                    <select autoFocus onBlur={() => setAssigningClientId(null)} onChange={(e) => { const member = team.find((m) => String(m.id) === e.target.value); if (member) void assignTechnician(client.id, member); }} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]">
                      <option value="">Select technician…</option>
                      {team.map((member) => <option key={member.id} value={member.id}>{member.displayName || member.email}</option>)}
                    </select>
                  ) : assignment ? (
                    <div className="flex items-center gap-2 text-xs text-[var(--spr-text)]"><User className="h-3 w-3 text-[var(--spr-text-muted)]" />{assignment.technician_display}
                      {canAssign && <button onClick={() => void unassignTechnician(client.id)} className="text-[var(--spr-text-faint)] hover:text-[var(--spr-red)]">×</button>}
                      {canAssign && <button onClick={() => setAssigningClientId(client.id)} className="text-[var(--spr-highlight)] hover:text-white">change</button>}
                    </div>
                  ) : canAssign ? (
                    <button onClick={() => setAssigningClientId(client.id)} className="rounded-lg border border-[var(--spr-border)] px-2.5 py-1 text-xs text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Assign…</button>
                  ) : <span className="text-xs text-[var(--spr-text-faint)]">Unassigned</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="grid gap-4 md:grid-cols-2">
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
        <h2 className="text-sm font-bold uppercase tracking-[.1em] text-[var(--spr-text-faint)]">Evidence coverage</h2>
        {evidenceCoverage.total > 0 ? (
          <>
            <p className="mt-3 text-3xl font-bold text-[var(--spr-text)]">{evidenceCoverage.verified} / {evidenceCoverage.total}</p>
            <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{evidenceCoverage.pct}% of recorded evidence is independently verified</p>
          </>
        ) : <p className="mt-3 text-sm text-[var(--spr-text-faint)]">No data — no evidence has been recorded yet.</p>}
      </div>
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
        <h2 className="text-sm font-bold uppercase tracking-[.1em] text-[var(--spr-text-faint)]">Verification coverage</h2>
        {softwareVerification.total > 0 ? (
          <>
            <p className="mt-3 text-3xl font-bold text-[var(--spr-text)]">{softwareVerification.verified} / {softwareVerification.total}</p>
            <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{softwareVerification.coveragePct}% of software assets · evidence fresh (≤30d) for {softwareVerification.freshnessPct ?? '—'}%</p>
          </>
        ) : <p className="mt-3 text-sm text-[var(--spr-text-faint)]">No software assets on record yet.</p>}
      </div>
    </section>

    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
      <h2 className="text-lg font-bold text-[var(--spr-text)]">Recent observations</h2>
      <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Real, recorded timeline events from your software passports.</p>
      {recentObservations.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {recentObservations.map((entry, index) => (
            <li key={`${entry.passportId}-${index}`} className="flex flex-col gap-1 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-[var(--spr-text)]">{entry.event}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-[var(--spr-text-muted)]"><span className="font-mono text-[var(--spr-text-faint)]">{entry.date}</span><span>{entry.software}</span></span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-[var(--spr-text-faint)]">No recorded observations yet.</p>}
    </section>

    </>}

    {selected && <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-0 md:items-center md:justify-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="finding-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl md:rounded-md"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--spr-highlight)]">Finding detail · Explain this</p><h2 id="finding-title" className="mt-2 text-xl font-bold text-[var(--spr-text)]">{selected.title}</h2></div><button onClick={() => setSelected(null)} aria-label="Close finding" className="rounded-lg p-2 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] hover:text-[var(--spr-text)]"><X className="h-5 w-5" /></button></div>
        {findingLoading && <div className="mt-6 grid gap-4 sm:grid-cols-2">{[1, 2, 3, 4].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-[var(--spr-surface-hover)]" />)}</div>}
        {findingError && <div role="alert" className="mt-6 rounded-xl border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 p-4 text-sm text-[var(--spr-red)]"><p className="font-semibold">Finding detail unavailable</p><p className="mt-1 text-[var(--spr-red)]">{findingError}</p></div>}
        {finding && <><div className="mt-6 grid gap-4 sm:grid-cols-2"><Detail label="Client" value={finding.clientName} /><Detail label="Severity and status" value={`${finding.severity} — ${finding.status}`} /><Detail label="First observed" value={formatStoredTime(finding.firstObservedAt || finding.timestamp)} /><Detail label="Last observed" value={formatStoredTime(finding.lastObservedAt || finding.timestamp)} /></div>
        <section className="mt-5 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-4"><h3 className="text-sm font-semibold text-[var(--spr-text)]">Observed</h3><p className="mt-2 text-sm leading-6 text-[var(--spr-text)]">{finding.description || 'No observation description is available.'}</p></section><div className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Why it matters" value="Review this recorded finding with its evidence before choosing remediation." /><Detail label="What you can do" value="Create a remediation task, then collect a new observation before treating the finding as resolved." /></div>
        <section className="mt-5 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-4"><h3 className="text-sm font-semibold text-[var(--spr-text)]">Evidence chain</h3><p className="mt-1 text-xs text-[var(--spr-text-muted)]">Finding → observed artifact → source evidence → verification time</p>{evidenceList(finding.evidenceIds).length ? <ul className="mt-4 space-y-2">{evidenceList(finding.evidenceIds).map((id: string) => <li key={id} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 font-mono text-xs text-[var(--spr-text)]">Evidence reference: {id}</li>)}</ul> : <p className="mt-4 text-sm text-[var(--spr-text-muted)]">Evidence unavailable. This finding has no stored evidence references.</p>}</section></>}
        {taskError && <p role="alert" className="mt-4 text-sm text-[var(--spr-red)]">{taskError}</p>}
        {task && <section className="mt-5 rounded-xl border border-[var(--spr-accent)] bg-[var(--spr-accent-soft)] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--spr-highlight)]">Remediation task</p><p className="mt-2 font-semibold text-[var(--spr-text)]">{task.title}</p><p className="mt-1 text-sm text-[var(--spr-text)]">{task.status.replaceAll('_', ' ')} · created {formatStoredTime(task.createdAt)}</p>{task.status === 'OPEN' && <button onClick={() => void transitionTask('start')} disabled={taskLoading} className="mt-4 rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Start remediation'}</button>}{task.status === 'IN_PROGRESS' && <button onClick={() => void transitionTask('ready-for-verification')} disabled={taskLoading} className="mt-4 rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Mark ready for verification'}</button>}{task.status === 'READY_FOR_VERIFICATION' && <div className="mt-3"><p className="text-sm text-[var(--spr-amber)]">Remediation marked complete. Verification required.</p>{monitoringConfigurations.length ? <div className="mt-3 flex flex-wrap gap-2"><select value={monitoringConfigurationId} onChange={event => setMonitoringConfigurationId(event.target.value)} aria-label="Verification source" className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]">{monitoringConfigurations.map(config => <option key={config.id} value={config.id}>{config.collectorId}: {config.subjectIdentifier}</option>)}</select><button onClick={() => void queueVerification()} disabled={taskLoading} className="rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-50">{taskLoading ? 'Queueing verification…' : 'Verify now'}</button></div> : <p className="mt-2 text-sm text-[var(--spr-text-muted)]">No accessible monitoring source is configured for verification.</p>}</div>}{task.status === 'VERIFICATION_QUEUED' && <p className="mt-3 text-sm text-[var(--spr-amber)]">Verification queued. SPR has not received a verified result.</p>}{task.status === 'VERIFICATION_FAILED' && <p className="mt-3 text-sm text-[var(--spr-red)]">Verification could not be completed. SPR did not receive a reliable observation.</p>}</section>}
        <div className="mt-6 flex flex-wrap gap-3"><button onClick={() => { setSelected(null); onNavigate('alerts'); }} disabled={!finding} className="inline-flex items-center gap-2 rounded-lg bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-50"><FileSearch className="h-4 w-4" /> Show evidence</button>{task ? <span className="rounded-lg border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Task created</span> : <button onClick={() => void createTask()} disabled={!finding || taskLoading} className="rounded-lg border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50">{taskLoading ? 'Creating task…' : 'Create remediation task'}</button>}</div>
      </div>
    </div>}
  </div>;
}

function Metric({ label, value, icon, tone, sub }: { label: string; value: number; icon: React.ReactNode; tone: string; sub?: string }) { return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className={`mb-4 h-5 w-5 ${tone}`}>{icon}</div><p className="text-3xl font-bold text-[var(--spr-text)]">{value}</p><p className="mt-1 text-sm text-[var(--spr-text-muted)]">{label}</p>{sub && <p className="mt-0.5 text-[10px] text-[var(--spr-text-faint)]">{sub}</p>}</div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--spr-text-muted)]">{label}</p><p className="mt-2 text-sm leading-5 text-[var(--spr-text)]">{value}</p></div>; }
function formatStoredTime(value?: string | null) { return value ? new Date(value).toLocaleString() : 'Not observed'; }
function evidenceList(value?: string | null) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
