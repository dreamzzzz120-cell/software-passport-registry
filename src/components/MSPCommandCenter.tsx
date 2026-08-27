import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock3, FileSearch, ShieldAlert, ShieldQuestion, User, X } from 'lucide-react';
import { Alert, Client, SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';

interface Props {
  clients: Client[];
  alerts: Alert[];
  passports: SoftwarePassport[];
  role?: string;
  onSelectClient: (id: string) => void;
  onNavigate: (tab: string) => void;
}

type Assignment = { id: string; client_id: string; technician_display: string; assigned_by: string; updated_at: string };
type TeamMember = { id: number; email: string; displayName?: string | null; role: string };

const severityClass = (severity: Alert['severity']) => severity === 'Critical'
  ? 'bg-[#f14c4c]/10 text-[#f14c4c] border-[#f14c4c]/30'
  : severity === 'High' ? 'bg-[#cca700]/10 text-[#cca700] border-[#cca700]/30'
  : 'bg-[#0e639c]/20 text-[#3794ff] border-[#3794ff]/30';

// Evidence older than this is not treated as fresh for the coverage metric below.
// This does not change any stored evidence or score — it only affects how the
// Command Center summarizes freshness for a human reading the dashboard.
const EVIDENCE_FRESHNESS_WINDOW_DAYS = 30;

export default function MSPCommandCenter({ clients, alerts, passports, role = 'Viewer', onSelectClient, onNavigate }: Props) {
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
    let unknown = 0;
    let freshEvidence = 0;
    let staleOrMissingEvidence = 0;
    const now = Date.now();
    for (const passport of passports) {
      if (passport.verificationStatus === 'verified') verified += 1;
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
    return { total, verified, unknown, freshEvidence, staleOrMissingEvidence, coveragePct, freshnessPct };
  }, [passports]);

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
    apiFetch('/api/monitoring-configurations').then(response => response.ok ? response.json() : []).then(rows => {
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

  return <div className="mx-auto max-w-6xl space-y-8 pb-10" id="msp-command-center">
    <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#c586c0]"><Building2 className="h-4 w-4" /> MSP command center</div>
        <h1 className="text-3xl font-bold tracking-tight text-[#d4d4d4] md:text-4xl">Who needs you today?</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#9d9d9d]">Prioritized work from the evidence and findings SPR currently has on record. A closed task is not a verified fix.</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <button onClick={() => setClientSwitcherOpen((open) => !open)} disabled={clients.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#2d2d2d] px-4 py-2.5 text-sm font-semibold text-[#d4d4d4] transition hover:border-[#6f6f6f] hover:bg-[#383838] disabled:opacity-50">
            <User className="h-4 w-4" /> Switch client
          </button>
          {clientSwitcherOpen && clients.length > 0 && (
            <div className="absolute right-0 z-10 mt-2 max-h-72 w-64 overflow-y-auto rounded-xl border border-[#3c3c3c] bg-[#252526] p-1 shadow-2xl" role="menu">
              {clients.map((client) => (
                <button key={client.id} role="menuitem" onClick={() => { onSelectClient(client.id); onNavigate('clients'); setClientSwitcherOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[#d4d4d4] hover:bg-[#383838]">
                  {client.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => onNavigate('clients')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#2d2d2d] px-4 py-2.5 text-sm font-semibold text-[#d4d4d4] transition hover:border-[#6f6f6f] hover:bg-[#383838]">
          View all clients <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="Clients" value={clients.length} icon={<Building2 />} tone="text-[#3794ff]" />
      <Metric label="Healthy" value={Math.max(0, clients.length - criticalClients - attentionClients)} icon={<CheckCircle2 />} tone="text-[#89d185]" />
      <Metric label="Need attention" value={attentionClients} icon={<AlertTriangle />} tone="text-[#cca700]" />
      <Metric label="Critical" value={criticalClients} icon={<ShieldAlert />} tone="text-[#f14c4c]" />
    </section>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="Verified software" value={softwareVerification.verified} icon={<CheckCircle2 />} tone="text-[#89d185]" />
      <Metric label="Unknown / unverified" value={softwareVerification.unknown} icon={<ShieldQuestion />} tone="text-[#cca700]" />
      <MetricPct label="Verification coverage" pct={softwareVerification.coveragePct} icon={<ShieldAlert />} tone="text-[#3794ff]" />
      <MetricPct label={`Evidence fresh (≤30d)`} pct={softwareVerification.freshnessPct} icon={<Clock3 />} tone="text-[#3794ff]" />
    </section>

    <section className="rounded-md border border-[#3c3c3c] bg-[#252526]">
      <div className="flex flex-col gap-3 border-b border-[#3c3c3c] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-bold text-[#d4d4d4]">Cross-client risk</h2><p className="mt-1 text-sm text-[#9d9d9d]">Every client ranked by active critical and high findings, with technician assignment.</p></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-[#3c3c3c] text-[10px] uppercase tracking-[.14em] text-[#6f6f6f]"><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3">Critical</th><th className="px-5 py-3">High</th><th className="px-5 py-3">Active findings</th><th className="px-5 py-3">Assigned technician</th></tr></thead>
          <tbody className="divide-y divide-[#3c3c3c]">
            {clientRiskRollup.map(({ client, activeCount, critical, high, assignment }) => (
              <tr key={client.id}>
                <td className="px-5 py-3 font-medium text-[#d4d4d4]">{client.name}</td>
                <td className="px-5 py-3">{critical > 0 ? <span className="rounded-md border border-[#f14c4c]/30 bg-[#f14c4c]/10 px-2 py-0.5 text-xs font-bold text-[#f14c4c]">{critical}</span> : <span className="text-[#6f6f6f]">0</span>}</td>
                <td className="px-5 py-3">{high > 0 ? <span className="rounded-md border border-[#cca700]/30 bg-[#cca700]/10 px-2 py-0.5 text-xs font-bold text-[#cca700]">{high}</span> : <span className="text-[#6f6f6f]">0</span>}</td>
                <td className="px-5 py-3 text-[#d4d4d4]">{activeCount}</td>
                <td className="px-5 py-3">
                  {assigningClientId === client.id ? (
                    <select autoFocus onBlur={() => setAssigningClientId(null)} onChange={(e) => { const member = team.find((m) => String(m.id) === e.target.value); if (member) void assignTechnician(client.id, member); }} className="rounded-lg border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-1.5 text-xs text-[#d4d4d4]">
                      <option value="">Select technician…</option>
                      {team.map((member) => <option key={member.id} value={member.id}>{member.displayName || member.email}</option>)}
                    </select>
                  ) : assignment ? (
                    <div className="flex items-center gap-2 text-xs text-[#d4d4d4]"><User className="h-3 w-3 text-[#9d9d9d]" />{assignment.technician_display}
                      {canAssign && <button onClick={() => void unassignTechnician(client.id)} className="text-[#6f6f6f] hover:text-[#f14c4c]">×</button>}
                      {canAssign && <button onClick={() => setAssigningClientId(client.id)} className="text-[#3794ff] hover:text-white">change</button>}
                    </div>
                  ) : canAssign ? (
                    <button onClick={() => setAssigningClientId(client.id)} className="rounded-lg border border-[#3c3c3c] px-2.5 py-1 text-xs text-[#9d9d9d] hover:bg-[#383838]">Assign…</button>
                  ) : <span className="text-xs text-[#6f6f6f]">Unassigned</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section className="rounded-md border border-[#3c3c3c] bg-[#252526]">
      <div className="flex flex-col gap-3 border-b border-[#3c3c3c] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-bold text-[#d4d4d4]">Clients needing action</h2><p className="mt-1 text-sm text-[#9d9d9d]">Most urgent first, based on active recorded findings.</p></div>
        <span className="w-fit rounded-full border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-1 text-xs font-medium text-[#d4d4d4]">{attention.length} active findings</span>
      </div>
      {attention.length ? <div className="divide-y divide-[#3c3c3c]">
        {attention.map(alert => {
          const client = clients.find(item => item.name === alert.clientName);
          return <article key={alert.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.5fr)_auto] lg:items-center">
            <div>
              <p className="font-semibold text-[#d4d4d4]">{alert.clientName}</p>
              <p className="mt-1 text-xs text-[#9d9d9d]">Observed {alert.timestamp}</p>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap gap-2"><span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${severityClass(alert.severity)}`}>{alert.severity}</span><span className="rounded-md bg-[#383838] px-2 py-0.5 text-[11px] text-[#d4d4d4]">{alert.category}</span></div>
              <p className="font-medium text-[#d4d4d4]">{alert.title}</p><p className="mt-1 text-sm leading-5 text-[#9d9d9d]">{alert.description}</p>
            </div>
            <div className="flex gap-2 lg:flex-col"><button onClick={() => setSelected(alert)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0e639c] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#1177bb]">Investigate <ArrowRight className="h-4 w-4" /></button>{client && <button onClick={() => onSelectClient(client.id)} className="rounded-lg border border-[#3c3c3c] px-3.5 py-2 text-sm font-medium text-[#d4d4d4] transition hover:bg-[#383838]">Client</button>}</div>
          </article>;
        })}
      </div> : <div className="px-6 py-14 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-[#89d185]" /><h3 className="mt-3 font-semibold text-[#d4d4d4]">No clients need attention</h3><p className="mt-1 text-sm text-[#9d9d9d]">Your monitored clients currently have no active recorded findings requiring action.</p></div>}
    </section>

    {selected && <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-0 md:items-center md:justify-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="finding-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-[#3c3c3c] bg-[#252526] p-6 shadow-2xl md:rounded-md"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#3794ff]">Finding detail · Explain this</p><h2 id="finding-title" className="mt-2 text-xl font-bold text-[#d4d4d4]">{selected.title}</h2></div><button onClick={() => setSelected(null)} aria-label="Close finding" className="rounded-lg p-2 text-[#9d9d9d] hover:bg-[#383838] hover:text-[#d4d4d4]"><X className="h-5 w-5" /></button></div>
        {findingLoading && <div className="mt-6 grid gap-4 sm:grid-cols-2">{[1, 2, 3, 4].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-[#383838]" />)}</div>}
        {findingError && <div role="alert" className="mt-6 rounded-xl border border-[#f14c4c]/30 bg-[#f14c4c]/10 p-4 text-sm text-[#f14c4c]"><p className="font-semibold">Finding detail unavailable</p><p className="mt-1 text-[#f14c4c]">{findingError}</p></div>}
        {finding && <><div className="mt-6 grid gap-4 sm:grid-cols-2"><Detail label="Client" value={finding.clientName} /><Detail label="Severity and status" value={`${finding.severity} — ${finding.status}`} /><Detail label="First observed" value={formatStoredTime(finding.firstObservedAt || finding.timestamp)} /><Detail label="Last observed" value={formatStoredTime(finding.lastObservedAt || finding.timestamp)} /></div>
        <section className="mt-5 rounded-xl border border-[#3c3c3c] bg-[#181818] p-4"><h3 className="text-sm font-semibold text-[#d4d4d4]">Observed</h3><p className="mt-2 text-sm leading-6 text-[#d4d4d4]">{finding.description || 'No observation description is available.'}</p></section><div className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Why it matters" value="Review this recorded finding with its evidence before choosing remediation." /><Detail label="What you can do" value="Create a remediation task, then collect a new observation before treating the finding as resolved." /></div>
        <section className="mt-5 rounded-xl border border-[#3c3c3c] bg-[#181818] p-4"><h3 className="text-sm font-semibold text-[#d4d4d4]">Evidence chain</h3><p className="mt-1 text-xs text-[#9d9d9d]">Finding → observed artifact → source evidence → verification time</p>{evidenceList(finding.evidenceIds).length ? <ul className="mt-4 space-y-2">{evidenceList(finding.evidenceIds).map((id: string) => <li key={id} className="rounded-lg border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 font-mono text-xs text-[#d4d4d4]">Evidence reference: {id}</li>)}</ul> : <p className="mt-4 text-sm text-[#9d9d9d]">Evidence unavailable. This finding has no stored evidence references.</p>}</section></>}
        {taskError && <p role="alert" className="mt-4 text-sm text-[#f14c4c]">{taskError}</p>}
        {task && <section className="mt-5 rounded-xl border border-[#0e639c] bg-[#094771] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-[#3794ff]">Remediation task</p><p className="mt-2 font-semibold text-[#d4d4d4]">{task.title}</p><p className="mt-1 text-sm text-[#d4d4d4]">{task.status.replaceAll('_', ' ')} · created {formatStoredTime(task.createdAt)}</p>{task.status === 'OPEN' && <button onClick={() => void transitionTask('start')} disabled={taskLoading} className="mt-4 rounded-lg bg-[#0e639c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1177bb] disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Start remediation'}</button>}{task.status === 'IN_PROGRESS' && <button onClick={() => void transitionTask('ready-for-verification')} disabled={taskLoading} className="mt-4 rounded-lg bg-[#0e639c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1177bb] disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Mark ready for verification'}</button>}{task.status === 'READY_FOR_VERIFICATION' && <div className="mt-3"><p className="text-sm text-[#cca700]">Remediation marked complete. Verification required.</p>{monitoringConfigurations.length ? <div className="mt-3 flex flex-wrap gap-2"><select value={monitoringConfigurationId} onChange={event => setMonitoringConfigurationId(event.target.value)} aria-label="Verification source" className="rounded-lg border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm text-[#d4d4d4]">{monitoringConfigurations.map(config => <option key={config.id} value={config.id}>{config.collectorId}: {config.subjectIdentifier}</option>)}</select><button onClick={() => void queueVerification()} disabled={taskLoading} className="rounded-lg bg-[#0e639c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1177bb] disabled:opacity-50">{taskLoading ? 'Queueing verification…' : 'Verify now'}</button></div> : <p className="mt-2 text-sm text-[#9d9d9d]">No accessible monitoring source is configured for verification.</p>}</div>}{task.status === 'VERIFICATION_QUEUED' && <p className="mt-3 text-sm text-[#cca700]">Verification queued. SPR has not received a verified result.</p>}{task.status === 'VERIFICATION_FAILED' && <p className="mt-3 text-sm text-[#f14c4c]">Verification could not be completed. SPR did not receive a reliable observation.</p>}</section>}
        <div className="mt-6 flex flex-wrap gap-3"><button onClick={() => { setSelected(null); onNavigate('alerts'); }} disabled={!finding} className="inline-flex items-center gap-2 rounded-lg bg-[#0e639c] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1177bb] disabled:opacity-50"><FileSearch className="h-4 w-4" /> Show evidence</button>{task ? <span className="rounded-lg border border-[#3c3c3c] px-4 py-2.5 text-sm font-semibold text-[#d4d4d4]">Task created</span> : <button onClick={() => void createTask()} disabled={!finding || taskLoading} className="rounded-lg border border-[#3c3c3c] px-4 py-2.5 text-sm font-semibold text-[#d4d4d4] hover:bg-[#383838] disabled:opacity-50">{taskLoading ? 'Creating task…' : 'Create remediation task'}</button>}</div>
      </div>
    </div>}
  </div>;
}

function Metric({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) { return <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5"><div className={`mb-4 h-5 w-5 ${tone}`}>{icon}</div><p className="text-3xl font-bold text-[#d4d4d4]">{value}</p><p className="mt-1 text-sm text-[#9d9d9d]">{label}</p></div>; }
// Renders "Not yet measured" instead of "0%" when there is no software on record —
// an empty portfolio must never read as a 0% verification score.
function MetricPct({ label, pct, icon, tone }: { label: string; pct: number | null; icon: React.ReactNode; tone: string }) { return <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5"><div className={`mb-4 h-5 w-5 ${tone}`}>{icon}</div><p className="text-3xl font-bold text-[#d4d4d4]">{pct === null ? '—' : `${pct}%`}</p><p className="mt-1 text-sm text-[#9d9d9d]">{pct === null ? `${label} (not yet measured)` : label}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[#3c3c3c] bg-[#181818] p-4"><p className="text-xs font-semibold uppercase tracking-wider text-[#9d9d9d]">{label}</p><p className="mt-2 text-sm leading-5 text-[#d4d4d4]">{value}</p></div>; }
function formatStoredTime(value?: string | null) { return value ? new Date(value).toLocaleString() : 'Not observed'; }
function evidenceList(value?: string | null) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
