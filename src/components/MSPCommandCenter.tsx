import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, FileSearch, ShieldAlert, User, X } from 'lucide-react';
import { Alert, Client } from '../types';
import { apiFetch } from '../utils/apiClient';

interface Props {
  clients: Client[];
  alerts: Alert[];
  findings: any[];
  role?: string;
  onSelectClient: (id: string) => void;
  onNavigate: (tab: string) => void;
}

type Assignment = { id: string; client_id: string; technician_display: string; assigned_by: string; updated_at: string };
type TeamMember = { id: number; email: string; displayName?: string | null; role: string };

const severityClass = (severity: Alert['severity']) => severity === 'Critical'
  ? 'border-[#a4262c]/30 bg-[#fdf2f2] text-[#a4262c]'
  : severity === 'High' ? 'border-[#8a5700]/30 bg-[#fff4ce] text-[#8a5700]'
  : 'border-[#0f6cbd]/30 bg-[#eff6fc] text-[#0f6cbd]';

export default function MSPCommandCenter({ clients, alerts, findings, role = 'Viewer', onSelectClient, onNavigate }: Props) {
  const [selected, setSelected] = useState<Alert | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assigningClientId, setAssigningClientId] = useState<string | null>(null);
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
  // Sourced from the same /api/trust-loop/findings data App.tsx already fetched
  // to build `alerts` -- no second network round trip for finding detail.
  const finding = useMemo(() => selected ? findings.find((item: any) => String(item.id) === selected.id) || null : null, [selected?.id, findings]);
  const findingError = selected && !finding ? 'Finding details are unavailable.' : null;
  const [task, setTask] = useState<any | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const attention = useMemo(() => alerts.filter(item => item.status === 'Active').sort((a, b) => {
    const rank = { Critical: 3, High: 2, Medium: 1, Low: 0 };
    return rank[b.severity] - rank[a.severity];
  }), [alerts]);
  const criticalClients = new Set(attention.filter(item => item.severity === 'Critical').map(item => item.clientName)).size;
  const attentionClients = new Set(attention.filter(item => item.severity !== 'Critical').map(item => item.clientName)).size;
  // A remediation may already exist for this finding (created from the Alerts
  // view via the same /api/trust-loop/remediations backend) -- load it by the
  // id the findings join already gives us instead of scanning a task list.
  useEffect(() => {
    setTask(null); setTaskError(null);
    if (!selected?.remediationId) return;
    let cancelled = false;
    apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(selected.remediationId)}`).then(response => response.ok ? response.json() : null).then(data => { if (!cancelled && data) setTask(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected?.id, selected?.remediationId]);
  const createTask = async () => {
    if (!selected || !finding || taskLoading) return;
    setTaskLoading(true); setTaskError(null);
    try {
      const response = await apiFetch('/api/trust-loop/remediations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId: selected.id, title: selected.title, description: selected.description, priority: selected.severity.toUpperCase() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'SPR could not create the remediation task.');
      setTask(body);
    } catch (cause: any) { setTaskError(cause?.message || 'SPR could not create the remediation task.'); }
    finally { setTaskLoading(false); }
  };
  const transitionTask = async (status: 'IN_PROGRESS' | 'READY_FOR_VERIFICATION') => {
    if (!task || taskLoading) return;
    setTaskLoading(true); setTaskError(null);
    try {
      const response = await apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(task.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'SPR could not update the task.');
      setTask(body);
    } catch (cause: any) { setTaskError(cause?.message || 'SPR could not update the task.'); }
    finally { setTaskLoading(false); }
  };
  // Re-verifies against the most recent trust_observation SPR already has on
  // file for this software -- there is no live "run a check now" job queue,
  // so this is honestly a re-check of existing evidence, not a fresh scan.
  const verifyWithLatestEvidence = async () => {
    if (!task || taskLoading) return;
    setTaskLoading(true); setTaskError(null);
    try {
      const response = await apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(task.id)}/verify-latest`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'SPR could not verify this task against current evidence.');
      setTask(body);
    } catch (cause: any) { setTaskError(cause?.message || 'SPR could not verify this task against current evidence.'); }
    finally { setTaskLoading(false); }
  };

  return <section id="msp-command-center" aria-labelledby="msp-command-center-title">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 id="msp-command-center-title" className="text-[22px] font-semibold text-[#201f1e]">Who needs you today?</h1>
        <p className="mt-1 text-[13px] text-[#605e5c]">Prioritized work from the evidence and findings SPR currently has on record. A closed task is not a verified fix.</p>
      </div>
      <button type="button" onClick={() => onNavigate('clients')} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]">
        View all clients <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>

    <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
      <Metric label="Clients" value={clients.length} icon={<Building2 className="h-3.5 w-3.5" />} />
      <Metric label="Healthy" value={Math.max(0, clients.length - criticalClients - attentionClients)} icon={<CheckCircle2 className="h-3.5 w-3.5 text-[#0e700e]" />} />
      <Metric label="Need attention" value={attentionClients} icon={<AlertTriangle className="h-3.5 w-3.5 text-[#8a5700]" />} />
      <Metric label="Critical" value={criticalClients} icon={<ShieldAlert className="h-3.5 w-3.5 text-[#a4262c]" />} />
    </div>

    <div className="mb-4 rounded-md border border-[#e1dfdd] bg-white">
      <div className="border-b border-[#e1dfdd] px-4 py-3"><h2 className="text-[14px] font-semibold text-[#201f1e]">Cross-client risk</h2><p className="mt-0.5 text-[12px] text-[#605e5c]">Every client ranked by active critical and high findings, with technician assignment.</p></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]"><tr><th className="px-4 py-2">Client</th><th className="px-4 py-2">Critical</th><th className="px-4 py-2">High</th><th className="px-4 py-2">Active findings</th><th className="px-4 py-2">Assigned technician</th></tr></thead>
          <tbody>
            {clientRiskRollup.map(({ client, activeCount, critical, high, assignment }) => (
              <tr key={client.id} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                <td className="px-4 py-2.5 font-medium text-[#201f1e]">{client.name}</td>
                <td className="px-4 py-2.5">{critical > 0 ? <span className="rounded border border-[#a4262c]/30 bg-[#fdf2f2] px-1.5 py-0.5 text-[11px] font-semibold text-[#a4262c]">{critical}</span> : <span className="text-[#8a8886]">0</span>}</td>
                <td className="px-4 py-2.5">{high > 0 ? <span className="rounded border border-[#8a5700]/30 bg-[#fff4ce] px-1.5 py-0.5 text-[11px] font-semibold text-[#8a5700]">{high}</span> : <span className="text-[#8a8886]">0</span>}</td>
                <td className="px-4 py-2.5 text-[#323130]">{activeCount}</td>
                <td className="px-4 py-2.5">
                  {assigningClientId === client.id ? (
                    <select autoFocus onBlur={() => setAssigningClientId(null)} onChange={(e) => { const member = team.find((m) => String(m.id) === e.target.value); if (member) void assignTechnician(client.id, member); }} className="h-8 rounded border border-[#c8c6c4] bg-white px-2 text-[12px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]">
                      <option value="">Select technician…</option>
                      {team.map((member) => <option key={member.id} value={member.id}>{member.displayName || member.email}</option>)}
                    </select>
                  ) : assignment ? (
                    <div className="flex items-center gap-2 text-[12px] text-[#323130]"><User className="h-3 w-3 text-[#8a8886]" />{assignment.technician_display}
                      {canAssign && <button type="button" onClick={() => void unassignTechnician(client.id)} className="text-[#8a8886] hover:text-[#a4262c]">×</button>}
                      {canAssign && <button type="button" onClick={() => setAssigningClientId(client.id)} className="text-[#0f6cbd] hover:text-[#004578]">change</button>}
                    </div>
                  ) : canAssign ? (
                    <button type="button" onClick={() => setAssigningClientId(client.id)} className="rounded border border-[#c8c6c4] px-2 py-1 text-[12px] text-[#605e5c] hover:bg-black/[.03]">Assign…</button>
                  ) : <span className="text-[12px] text-[#8a8886]">Unassigned</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    <div className="rounded-md border border-[#e1dfdd] bg-white">
      <div className="flex flex-col gap-2 border-b border-[#e1dfdd] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-[14px] font-semibold text-[#201f1e]">Clients needing action</h2><p className="mt-0.5 text-[12px] text-[#605e5c]">Most urgent first, based on active recorded findings.</p></div>
        <span className="w-fit rounded border border-[#c8c6c4] bg-[#faf9f8] px-2 py-0.5 text-[11px] font-medium text-[#605e5c]">{attention.length} active findings</span>
      </div>
      {attention.length ? <div>
        {attention.map(alert => {
          const client = clients.find(item => item.name === alert.clientName);
          return <article key={alert.id} className="grid gap-3 border-b border-[#f3f2f1] px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.5fr)_auto] lg:items-center">
            <div>
              <p className="font-medium text-[#201f1e]">{alert.clientName}</p>
              <p className="mt-0.5 text-[11px] text-[#8a8886]">Observed {alert.timestamp}</p>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap gap-1.5"><span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${severityClass(alert.severity)}`}>{alert.severity}</span><span className="rounded bg-[#f3f2f1] px-1.5 py-0.5 text-[11px] text-[#605e5c]">{alert.category}</span></div>
              <p className="text-[13px] font-medium text-[#201f1e]">{alert.title}</p><p className="mt-0.5 text-[12px] leading-5 text-[#605e5c]">{alert.description}</p>
            </div>
            <div className="flex gap-2 lg:flex-col"><button type="button" onClick={() => setSelected(alert)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]">Investigate <ArrowRight className="h-3.5 w-3.5" /></button>{client && <button type="button" onClick={() => onSelectClient(client.id)} className="h-8 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]">Client</button>}</div>
          </article>;
        })}
      </div> : <div className="px-6 py-10 text-center"><CheckCircle2 className="mx-auto h-6 w-6 text-[#0e700e]" /><h3 className="mt-2 text-[13px] font-semibold text-[#201f1e]">No clients need attention</h3><p className="mt-1 text-[12px] text-[#605e5c]">Your monitored clients currently have no active recorded findings requiring action.</p></div>}
    </div>

    {selected && <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 md:items-center md:justify-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="finding-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-md border border-[#e1dfdd] bg-white p-5 md:rounded-md"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-[#605e5c]">Finding detail · Explain this</p><h2 id="finding-title" className="mt-1 text-[18px] font-semibold text-[#201f1e]">{selected.title}</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="Close finding" className="rounded p-1.5 text-[#605e5c] hover:bg-black/[.05]"><X className="h-4 w-4" /></button></div>
        {findingError && <div role="alert" className="mt-4 rounded-md border border-[#a4262c]/30 bg-[#fdf2f2] p-3 text-[13px] text-[#a4262c]"><p className="font-semibold">Finding detail unavailable</p><p className="mt-0.5">{findingError}</p></div>}
        {finding && <><div className="mt-4 grid gap-3 sm:grid-cols-2"><Detail label="Client" value={selected.clientName} /><Detail label="Severity and status" value={`${finding.severity} — ${finding.status}`} /><Detail label="First observed" value={formatStoredTime(finding.created_at)} /><Detail label="Last observed" value={formatStoredTime(finding.updated_at)} /></div>
        <section className="mt-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><h3 className="text-[13px] font-semibold text-[#201f1e]">Observed</h3><p className="mt-1 text-[13px] leading-6 text-[#323130]">{finding.description || 'No observation description is available.'}</p></section><div className="mt-3 grid gap-3 sm:grid-cols-2"><Detail label="Why it matters" value="Review this recorded finding with its evidence before choosing remediation." /><Detail label="What you can do" value="Create a remediation task, then collect a new observation before treating the finding as resolved." /></div>
        <section className="mt-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><h3 className="text-[13px] font-semibold text-[#201f1e]">Evidence chain</h3><p className="mt-0.5 text-[11px] text-[#8a8886]">Finding → observed artifact → source evidence → verification time</p>{evidenceList(finding.evidence_ids).length ? <ul className="mt-3 space-y-1.5">{evidenceList(finding.evidence_ids).map((id: string) => <li key={id} className="rounded border border-[#e1dfdd] bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#323130]">Evidence reference: {id}</li>)}</ul> : <p className="mt-3 text-[13px] text-[#605e5c]">Evidence unavailable. This finding has no stored evidence references.</p>}</section></>}
        {taskError && <p role="alert" className="mt-3 text-[13px] text-[#a4262c]">{taskError}</p>}
        {task && <section className="mt-3 rounded-md border border-[#0f6cbd]/30 bg-[#eff6fc] p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-[#0f6cbd]">Remediation task</p><p className="mt-1 text-[13px] font-semibold text-[#201f1e]">{task.title}</p><p className="mt-0.5 text-[12px] text-[#323130]">{task.status.replaceAll('_', ' ')} · created {formatStoredTime(task.created_at)}</p>{task.status === 'OPEN' && <button type="button" onClick={() => void transitionTask('IN_PROGRESS')} disabled={taskLoading} className="mt-3 inline-flex h-8 items-center rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Start remediation'}</button>}{task.status === 'IN_PROGRESS' && <button type="button" onClick={() => void transitionTask('READY_FOR_VERIFICATION')} disabled={taskLoading} className="mt-3 inline-flex h-8 items-center rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Mark ready for verification'}</button>}{task.status === 'READY_FOR_VERIFICATION' && <div className="mt-2"><p className="text-[13px] text-[#8a5700]">Remediation marked complete. Verification required.</p><p className="mt-0.5 text-[11px] text-[#605e5c]">Re-checks the most recent evidence SPR already has on file for this software — this is not a live scan.</p><button type="button" onClick={() => void verifyWithLatestEvidence()} disabled={taskLoading} className="mt-2 inline-flex h-8 items-center rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:opacity-50">{taskLoading ? 'Verifying…' : 'Verify with latest evidence'}</button></div>}{task.status === 'VERIFIED' && <p className="mt-2 text-[13px] text-[#0e700e]">Verified against evidence SPR collected. The underlying finding is now marked resolved.</p>}</section>}
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => { setSelected(null); onNavigate('alerts'); }} disabled={!finding} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:opacity-50"><FileSearch className="h-3.5 w-3.5" /> Show evidence</button>{task ? <span className="inline-flex h-8 items-center rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130]">Task created</span> : <button type="button" onClick={() => void createTask()} disabled={!finding || taskLoading} className="inline-flex h-8 items-center rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-50">{taskLoading ? 'Creating task…' : 'Create remediation task'}</button>}</div>
      </div>
    </div>}
  </section>;
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <div className="flex items-center gap-1.5">{icon}<div><div className="text-[11px] text-[#605e5c]">{label}</div><div className="text-lg font-semibold text-[#201f1e]">{value}</div></div></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-[#605e5c]">{label}</p><p className="mt-1 text-[13px] leading-5 text-[#201f1e]">{value}</p></div>; }
function formatStoredTime(value?: string | null) { return value ? new Date(value).toLocaleString() : 'Not observed'; }
function evidenceList(value?: string | null) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
