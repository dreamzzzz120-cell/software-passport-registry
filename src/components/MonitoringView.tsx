import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock3, Loader2, Lock, Play, Plus, RefreshCw, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { capacityLimitFrom, capacityMessage, type CapacityLimit } from '../lib/capacityLimit.ts';
import type { Client, SoftwarePassport } from '../types';

type Configuration = { id: string; clientId: string; passportId: string; collectorId: string; subjectType: string; subjectIdentifier: string; scheduleSeconds: number; enabled: boolean; lastStatus: string; lastObservedAt?: string | null; nextScheduledAt: string; };
type CollectorJob = { id: string; monitoringConfigurationId: string; collectorId: string; state: string; createdAt: string; completedAt?: string | null; };
type CollectorDefinition = { id: string; supportedSubjectTypes: string[]; minimumScheduleSeconds: number };
type Alert = { id: string; passport_id: string; alert_type: string; severity: 'informational' | 'low' | 'medium' | 'high' | 'critical'; status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED'; message: string; created_at: string; };

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'text-[var(--spr-red)] border-[var(--spr-red)]/40', high: 'text-[var(--spr-red)] border-[var(--spr-red)]/40',
  medium: 'text-[var(--spr-amber)] border-[var(--spr-amber)]/40', low: 'text-[var(--spr-text-muted)] border-[var(--spr-border)]',
  informational: 'text-[var(--spr-text-muted)] border-[var(--spr-border)]',
};

const readable = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not yet observed';
const ENROLLABLE_COLLECTORS: { id: string; label: string; subjectType: string; placeholder: string }[] = [
  { id: 'repository', label: 'GitHub repository', subjectType: 'github_repository', placeholder: 'owner/repository' },
  { id: 'tls', label: 'TLS certificate', subjectType: 'hostname', placeholder: 'example.com' },
  { id: 'domain_dns', label: 'Domain / DNS', subjectType: 'domain', placeholder: 'example.com' },
  { id: 'uptime', label: 'Endpoint uptime', subjectType: 'url', placeholder: 'https://example.com/health' },
];
const SCHEDULE_OPTIONS = [
  { seconds: 900, label: 'Every 15 minutes' },
  { seconds: 3600, label: 'Every hour' },
  { seconds: 21600, label: 'Every 6 hours' },
  { seconds: 86400, label: 'Every 24 hours' },
];

export default function MonitoringView({ role = 'Viewer', passports = [], clients = [] }: { role?: string; passports?: SoftwarePassport[]; clients?: Client[] }) {
  const canRun = role === 'Owner' || role === 'Admin' || role === 'Technician';
  const canEnroll = role === 'Owner' || role === 'Admin';
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [jobs, setJobs] = useState<CollectorJob[]>([]);
  const [collectorDefs, setCollectorDefs] = useState<CollectorDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capacityLimit, setCapacityLimit] = useState<CapacityLimit | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [monitoringDisabled, setMonitoringDisabled] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertUpdating, setAlertUpdating] = useState<string | null>(null);
  const canManageAlerts = role === 'Owner' || role === 'Admin' || role === 'Technician';

  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollClientId, setEnrollClientId] = useState('');
  const [enrollPassportId, setEnrollPassportId] = useState('');
  const [enrollCollectorId, setEnrollCollectorId] = useState(ENROLLABLE_COLLECTORS[0].id);
  const [enrollSubject, setEnrollSubject] = useState('');
  const [enrollSchedule, setEnrollSchedule] = useState(SCHEDULE_OPTIONS[1].seconds);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollSuccess, setEnrollSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [configResponse, jobsResponse, collectorsResponse, alertsResponse] = await Promise.all([
        apiFetch('/api/monitoring/monitoring-configurations'), apiFetch('/api/monitoring/collector-jobs'),
        apiFetch('/api/monitoring/collectors'), apiFetch('/api/trust-loop/monitoring'),
      ]);
      if (configResponse.status === 404) { setMonitoringDisabled(true); setConfigurations([]); return; }
      if (!configResponse.ok) {
        const body = await configResponse.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || 'Monitoring data could not be loaded.');
      }
      setMonitoringDisabled(false);
      setConfigurations(await configResponse.json());
      if (jobsResponse.ok) setJobs(await jobsResponse.json());
      if (collectorsResponse.ok) setCollectorDefs(await collectorsResponse.json());
      if (alertsResponse.ok) setAlerts((await alertsResponse.json()).alerts ?? []);
    } catch (cause: any) { setError(cause?.message || 'Monitoring data could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const updateAlert = async (id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') => {
    setAlertUpdating(id);
    try {
      const response = await apiFetch(`/api/trust-loop/alerts/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.error || 'Unable to update this alert.'); }
      const updated = await response.json();
      setAlerts((current) => current.map((a) => (a.id === id ? { ...a, status: updated.status } : a)));
    } catch (cause: any) { setError(cause?.message || 'Unable to update this alert.'); }
    finally { setAlertUpdating(null); }
  };
  const openAlerts = alerts.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');

  const run = async (id: string) => {
    setRunning(id); setError(null);
    try {
      const response = await apiFetch(`/api/monitoring/monitoring-configurations/${id}/run`, { method: 'POST' });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.error || 'SPR could not queue this verification.'); }
      await load();
    } catch (cause: any) { setError(cause?.message || 'SPR could not queue this verification.'); }
    finally { setRunning(null); }
  };
  const latest = (id: string) => jobs.find(job => job.monitoringConfigurationId === id);

  const activeCollector = ENROLLABLE_COLLECTORS.find((c) => c.id === enrollCollectorId) ?? ENROLLABLE_COLLECTORS[0];
  const minimumForCollector = collectorDefs.find((c) => c.id === enrollCollectorId)?.minimumScheduleSeconds ?? 900;
  const availableSchedules = useMemo(() => SCHEDULE_OPTIONS.filter((s) => s.seconds >= minimumForCollector), [minimumForCollector]);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollClientId || !enrollPassportId || !enrollSubject.trim()) return;
    setEnrolling(true); setEnrollError(null); setEnrollSuccess(null);
    try {
      const response = await apiFetch('/api/monitoring/monitoring-configurations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: enrollClientId, assetId: enrollPassportId, passportId: enrollPassportId,
          collectorId: enrollCollectorId, subjectType: activeCollector.subjectType,
          subjectIdentifier: enrollSubject.trim(), scheduleSeconds: enrollSchedule,
        }),
      });
      const data = await response.json().catch(() => null);
      // Reaching the plan ceiling is a commercial outcome, not a failure. It is
      // shown as an upgrade prompt with the customer's real numbers rather than
      // as red error text, which is what it looked like before -- and before
      // that, the route rethrew and it was a 500.
      const limit = capacityLimitFrom(response.status, data);
      if (limit) { setCapacityLimit(limit); setEnrolling(false); return; }
      if (!response.ok) throw new Error(data?.error === 'MONITORING_CONFIGURATION_EXISTS' ? 'This exact source is already being monitored.' : (data?.error?.message || data?.error || 'Unable to enable monitoring.'));
      setEnrollSuccess('Monitoring enabled.');
      setEnrollSubject('');
      await load();
      setTimeout(() => { setShowEnroll(false); setEnrollSuccess(null); }, 1000);
    } catch (cause: any) {
      setEnrollError(cause?.message || 'Unable to enable monitoring.');
    } finally {
      setEnrolling(false);
    }
  };

  return <div className="mx-auto max-w-6xl space-y-7 pb-10" id="monitoring-workspace">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-[var(--spr-highlight)]"><Activity className="h-4 w-4" /> Continuous verification</div><h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--spr-text)]">What changed since the last check?</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Monitoring queues configured server-side collectors. A queued run is not a completed or verified result.</p></div>
      <div className="flex gap-2">
        {canEnroll && !monitoringDisabled && <button onClick={() => { setShowEnroll(true); setEnrollError(null); }} className="spr-btn spr-btn-primary inline-flex items-center justify-center gap-2"><Plus className="h-4 w-4" />Enable monitoring</button>}
        <button onClick={() => void load()} disabled={loading} className="spr-btn spr-btn-secondary inline-flex items-center justify-center gap-2 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
    </header>

    {monitoringDisabled && <div className="flex gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm text-[var(--spr-amber)]"><AlertCircle className="h-5 w-5 shrink-0" /><div><p className="font-semibold">Monitoring is not enabled for this workspace</p><p className="mt-1 text-[var(--spr-text-muted)]">Ask an Owner to enable it for this tenant.</p></div></div>}
    {error && <div role="alert" className="flex gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm text-[var(--spr-red)]"><AlertCircle className="h-5 w-5 shrink-0" /><div><p className="font-semibold">Verification unavailable</p><p className="mt-1 text-[var(--spr-red)]">{error}</p></div></div>}

    {!monitoringDisabled && !loading && (
      <section className="spr-panel p-5">
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-wider text-[var(--spr-text)]">Alerts{openAlerts.length > 0 ? ` (${openAlerts.length} open)` : ''}</h2></div>
        {alerts.length === 0
          ? <p className="mt-3 text-sm text-[var(--spr-text-muted)]">No changes have triggered an alert yet. Alerts appear here automatically when a monitored source regresses.</p>
          : <ul className="mt-3 divide-y divide-[var(--spr-border)]">{alerts.slice(0, 25).map((alert) => (
              <li key={alert.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.informational}`}>{alert.severity}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--spr-text-faint)]">{alert.status}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-[var(--spr-text)]">{alert.message}</p>
                  <p className="mt-0.5 text-xs text-[var(--spr-text-faint)]">{readable(alert.created_at)}</p>
                </div>
                {canManageAlerts && (alert.status === 'OPEN' || alert.status === 'ACKNOWLEDGED') && (
                  <div className="flex shrink-0 gap-1.5">
                    {alert.status === 'OPEN' && <button onClick={() => void updateAlert(alert.id, 'ACKNOWLEDGED')} disabled={alertUpdating === alert.id} className="rounded-md border border-[var(--spr-border)] px-2.5 py-1 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50">Acknowledge</button>}
                    <button onClick={() => void updateAlert(alert.id, 'RESOLVED')} disabled={alertUpdating === alert.id} className="rounded-md border border-[var(--spr-border)] px-2.5 py-1 text-xs font-semibold text-[var(--spr-green)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50">Resolve</button>
                  </div>
                )}
              </li>
            ))}</ul>}
      </section>
    )}

    {loading ? <div className="grid gap-4 md:grid-cols-2">{[1, 2].map(item => <div key={item} className="h-52 animate-pulse rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]" />)}</div>
      : configurations.length ? <section className="grid gap-4 md:grid-cols-2">{configurations.map(config => { const job = latest(config.id); return <article key={config.id} className="spr-panel p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--spr-text-faint)]">{config.collectorId.replace('_', ' ')} collector</p><h2 className="mt-2 break-all font-semibold text-[var(--spr-text)]">{config.subjectIdentifier}</h2></div><span className={`inline-flex items-center gap-1.5 rounded-sm border border-[var(--spr-border)] px-2.5 py-1 text-xs font-semibold ${config.enabled ? 'text-[var(--spr-green)]' : 'text-[var(--spr-text-muted)]'}`}><span className={`spr-status-dot ${config.enabled ? 'spr-status-dot--green' : 'spr-status-dot--gray'}`} />{config.enabled ? 'Watching' : 'Paused'}</span></div><dl className="mt-5 space-y-3 text-sm"><Row icon={<Clock3 />} label="Last observed" value={readable(config.lastObservedAt)} /><Row icon={<Activity />} label="Last run" value={job ? `${job.state} · ${readable(job.completedAt || job.createdAt)}` : 'No run recorded'} /><Row icon={<CheckCircle2 />} label="Next check" value={readable(config.nextScheduledAt)} /></dl><button onClick={() => void run(config.id)} disabled={!canRun || !config.enabled || running === config.id} title={!canRun ? `Your ${role} role cannot run verifications.` : undefined} className="spr-btn spr-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"><Play className="h-4 w-4" />{running === config.id ? 'Queueing check…' : 'Re-verify now'}</button></article>; })}</section>
      : !monitoringDisabled && <section className="spr-panel px-6 py-16 text-center"><XCircle className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]" /><h2 className="mt-3 font-semibold text-[var(--spr-text)]">No verification sources configured</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--spr-text-muted)]">SPR cannot claim continuous coverage until an administrator configures a monitored source for this tenant.</p>{canEnroll && <button onClick={() => setShowEnroll(true)} className="spr-btn spr-btn-primary mt-5 inline-flex items-center gap-2"><Plus className="h-4 w-4" />Enable monitoring</button>}</section>}

    {showEnroll && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="enroll-title">
        <div className="w-full max-w-md rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><Activity className="h-4 w-4" /> New monitor</div><h2 id="enroll-title" className="mt-1 text-lg font-bold text-[var(--spr-text)]">Enable monitoring</h2></div>
            <button onClick={() => setShowEnroll(false)} aria-label="Close" className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] hover:text-[var(--spr-text)]"><XCircle className="h-4 w-4" /></button>
          </div>
          <form onSubmit={handleEnroll} className="mt-5 space-y-3.5">
            {/* The plan ceiling is a commercial outcome, not a failure, so it is
                not rendered in the error style. The numbers are the ones the
                server actually counted, and the action is the one that resolves
                it -- previously this route rethrew and the customer got a 500. */}
            {capacityLimit && (() => {
              const message = capacityMessage(capacityLimit);
              return (
                <div role="status" className="rounded-md border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent)]/10 px-4 py-3.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--spr-text)]">
                    <Lock className="h-4 w-4 shrink-0" />{message.headline}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">{message.detail}</p>
                  <div className="mt-2 text-xs tabular-nums text-[var(--spr-text-muted)]">
                    {capacityLimit.activePassports} active Passport{capacityLimit.activePassports === 1 ? '' : 's'}
                    {capacityLimit.includedActivePassports > 0 ? ` of ${capacityLimit.includedActivePassports} included` : ''}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href="/billing" className="rounded-md bg-[var(--spr-accent)] px-3 py-2 text-xs font-semibold text-white">{message.cta}</a>
                    <button type="button" onClick={() => setCapacityLimit(null)} className="rounded-md border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)]">Not now</button>
                  </div>
                </div>
              );
            })()}
            {enrollError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2.5 text-xs text-[var(--spr-red)] flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {enrollError}</div>}
            {enrollSuccess && <div className="rounded-md border border-[var(--spr-green)]/40 bg-[var(--spr-green)]/10 px-3 py-2.5 text-xs text-[var(--spr-green)] flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {enrollSuccess}</div>}

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[var(--spr-text-muted)]">Client *</label>
              <select required value={enrollClientId} onChange={(e) => setEnrollClientId(e.target.value)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">
                <option value="">{clients.length ? 'Select client…' : 'No clients yet — add one first'}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[var(--spr-text-muted)]">Software / Passport *</label>
              <select required value={enrollPassportId} onChange={(e) => setEnrollPassportId(e.target.value)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">
                <option value="">{passports.length ? 'Select passport…' : 'No passports yet'}</option>
                {passports.map((p) => <option key={p.id} value={p.id}>{p.name} {p.version ? `· ${p.version}` : ''}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[var(--spr-text-muted)]">Source type *</label>
              <select value={enrollCollectorId} onChange={(e) => { setEnrollCollectorId(e.target.value); setEnrollSubject(''); }} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">
                {ENROLLABLE_COLLECTORS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[var(--spr-text-muted)]">{activeCollector.label} identifier *</label>
              <input required value={enrollSubject} onChange={(e) => setEnrollSubject(e.target.value)} placeholder={activeCollector.placeholder} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-[var(--spr-text-muted)]">Check frequency</label>
              <select value={enrollSchedule} onChange={(e) => setEnrollSchedule(Number(e.target.value))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]">
                {availableSchedules.map((s) => <option key={s.seconds} value={s.seconds}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowEnroll(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
              <button type="submit" disabled={enrolling || !enrollClientId || !enrollPassportId || !enrollSubject.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">
                {enrolling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {enrolling ? 'Enabling…' : 'Enable monitoring'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </div>;
}
function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-3"><span className="h-4 w-4 text-[var(--spr-text-faint)]">{icon}</span><div><dt className="text-xs text-[var(--spr-text-faint)]">{label}</dt><dd className="mt-0.5 text-[var(--spr-text)]">{value}</dd></div></div>; }
