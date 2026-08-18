import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock3, FileSearch, ShieldAlert, X } from 'lucide-react';
import { Alert, Client } from '../types';
import { apiFetch } from '../utils/apiClient';

interface Props {
  clients: Client[];
  alerts: Alert[];
  onSelectClient: (id: string) => void;
  onNavigate: (tab: string) => void;
}

const severityClass = (severity: Alert['severity']) => severity === 'Critical'
  ? 'bg-rose-500/10 text-rose-300 border-rose-500/25'
  : severity === 'High' ? 'bg-amber-500/10 text-amber-200 border-amber-500/25'
  : 'bg-sky-500/10 text-sky-200 border-sky-500/25';

export default function MSPCommandCenter({ clients, alerts, onSelectClient, onNavigate }: Props) {
  const [selected, setSelected] = useState<Alert | null>(null);
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
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">MSP command center</p>
        <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">Who needs you today?</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Prioritized work from the evidence and findings SPR currently has on record. A closed task is not a verified fix.</p>
      </div>
      <button onClick={() => onNavigate('clients')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:bg-slate-800">
        View all clients <ArrowRight className="h-4 w-4" />
      </button>
    </section>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="Clients" value={clients.length} icon={<Building2 />} tone="text-indigo-300" />
      <Metric label="Healthy" value={Math.max(0, clients.length - criticalClients - attentionClients)} icon={<CheckCircle2 />} tone="text-emerald-300" />
      <Metric label="Need attention" value={attentionClients} icon={<AlertTriangle />} tone="text-amber-200" />
      <Metric label="Critical" value={criticalClients} icon={<ShieldAlert />} tone="text-rose-300" />
    </section>

    <section className="rounded-2xl border border-slate-800 bg-[#0d1322] shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-bold text-white">Clients needing action</h2><p className="mt-1 text-sm text-slate-400">Most urgent first, based on active recorded findings.</p></div>
        <span className="w-fit rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300">{attention.length} active findings</span>
      </div>
      {attention.length ? <div className="divide-y divide-slate-800">
        {attention.map(alert => {
          const client = clients.find(item => item.name === alert.clientName);
          return <article key={alert.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.5fr)_auto] lg:items-center">
            <div>
              <p className="font-semibold text-white">{alert.clientName}</p>
              <p className="mt-1 text-xs text-slate-500">Observed {alert.timestamp}</p>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap gap-2"><span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${severityClass(alert.severity)}`}>{alert.severity}</span><span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{alert.category}</span></div>
              <p className="font-medium text-slate-100">{alert.title}</p><p className="mt-1 text-sm leading-5 text-slate-400">{alert.description}</p>
            </div>
            <div className="flex gap-2 lg:flex-col"><button onClick={() => setSelected(alert)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400">Investigate <ArrowRight className="h-4 w-4" /></button>{client && <button onClick={() => onSelectClient(client.id)} className="rounded-lg border border-slate-700 px-3.5 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800">Client</button>}</div>
          </article>;
        })}
      </div> : <div className="px-6 py-14 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" /><h3 className="mt-3 font-semibold text-white">No clients need attention</h3><p className="mt-1 text-sm text-slate-400">Your monitored clients currently have no active recorded findings requiring action.</p></div>}
    </section>

    {selected && <div className="fixed inset-0 z-50 flex items-end bg-slate-950/75 p-0 backdrop-blur-sm md:items-center md:justify-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="finding-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#0d1322] p-6 shadow-2xl md:rounded-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Finding detail · Explain this</p><h2 id="finding-title" className="mt-2 text-xl font-bold text-white">{selected.title}</h2></div><button onClick={() => setSelected(null)} aria-label="Close finding" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button></div>
        {findingLoading && <div className="mt-6 grid gap-4 sm:grid-cols-2">{[1, 2, 3, 4].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-800" />)}</div>}
        {findingError && <div role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100"><p className="font-semibold">Finding detail unavailable</p><p className="mt-1 text-rose-200">{findingError}</p></div>}
        {finding && <><div className="mt-6 grid gap-4 sm:grid-cols-2"><Detail label="Client" value={finding.clientName} /><Detail label="Severity and status" value={`${finding.severity} — ${finding.status}`} /><Detail label="First observed" value={formatStoredTime(finding.firstObservedAt || finding.timestamp)} /><Detail label="Last observed" value={formatStoredTime(finding.lastObservedAt || finding.timestamp)} /></div>
        <section className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4"><h3 className="text-sm font-semibold text-white">Observed</h3><p className="mt-2 text-sm leading-6 text-slate-300">{finding.description || 'No observation description is available.'}</p></section><div className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Why it matters" value="Review this recorded finding with its evidence before choosing remediation." /><Detail label="What you can do" value="Create a remediation task, then collect a new observation before treating the finding as resolved." /></div>
        <section className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4"><h3 className="text-sm font-semibold text-white">Evidence chain</h3><p className="mt-1 text-xs text-slate-500">Finding → observed artifact → source evidence → verification time</p>{evidenceList(finding.evidenceIds).length ? <ul className="mt-4 space-y-2">{evidenceList(finding.evidenceIds).map((id: string) => <li key={id} className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300">Evidence reference: {id}</li>)}</ul> : <p className="mt-4 text-sm text-slate-400">Evidence unavailable. This finding has no stored evidence references.</p>}</section></>}
        {taskError && <p role="alert" className="mt-4 text-sm text-rose-300">{taskError}</p>}
        {task && <section className="mt-5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Remediation task</p><p className="mt-2 font-semibold text-white">{task.title}</p><p className="mt-1 text-sm text-slate-300">{task.status.replaceAll('_', ' ')} · created {formatStoredTime(task.createdAt)}</p>{task.status === 'OPEN' && <button onClick={() => void transitionTask('start')} disabled={taskLoading} className="mt-4 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Start remediation'}</button>}{task.status === 'IN_PROGRESS' && <button onClick={() => void transitionTask('ready-for-verification')} disabled={taskLoading} className="mt-4 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">{taskLoading ? 'Updating task…' : 'Mark ready for verification'}</button>}{task.status === 'READY_FOR_VERIFICATION' && <div className="mt-3"><p className="text-sm text-amber-200">Remediation marked complete. Verification required.</p>{monitoringConfigurations.length ? <div className="mt-3 flex flex-wrap gap-2"><select value={monitoringConfigurationId} onChange={event => setMonitoringConfigurationId(event.target.value)} aria-label="Verification source" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">{monitoringConfigurations.map(config => <option key={config.id} value={config.id}>{config.collectorId}: {config.subjectIdentifier}</option>)}</select><button onClick={() => void queueVerification()} disabled={taskLoading} className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">{taskLoading ? 'Queueing verification…' : 'Verify now'}</button></div> : <p className="mt-2 text-sm text-slate-400">No accessible monitoring source is configured for verification.</p>}</div>}{task.status === 'VERIFICATION_QUEUED' && <p className="mt-3 text-sm text-amber-200">Verification queued. SPR has not received a verified result.</p>}{task.status === 'VERIFICATION_FAILED' && <p className="mt-3 text-sm text-rose-200">Verification could not be completed. SPR did not receive a reliable observation.</p>}</section>}
        <div className="mt-6 flex flex-wrap gap-3"><button onClick={() => { setSelected(null); onNavigate('alerts'); }} disabled={!finding} className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"><FileSearch className="h-4 w-4" /> Show evidence</button>{task ? <span className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300">Task created</span> : <button onClick={() => void createTask()} disabled={!finding || taskLoading} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">{taskLoading ? 'Creating task…' : 'Create remediation task'}</button>}</div>
      </div>
    </div>}
  </div>;
}

function Metric({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) { return <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5"><div className={`mb-4 h-5 w-5 ${tone}`}>{icon}</div><p className="text-3xl font-bold text-white">{value}</p><p className="mt-1 text-sm text-slate-400">{label}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p><p className="mt-2 text-sm leading-5 text-slate-200">{value}</p></div>; }
function formatStoredTime(value?: string | null) { return value ? new Date(value).toLocaleString() : 'Not observed'; }
function evidenceList(value?: string | null) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
