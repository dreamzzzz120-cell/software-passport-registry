import React, { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock3, Play, RefreshCw, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Configuration = { id: string; clientId: string; collectorId: string; subjectIdentifier: string; enabled: boolean; lastStatus: string; lastObservedAt?: string | null; nextScheduledAt: string; };
type CollectorJob = { id: string; monitoringConfigurationId: string; collectorId: string; state: string; createdAt: string; completedAt?: string | null; };

const readable = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not yet observed';

export default function MonitoringView() {
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [jobs, setJobs] = useState<CollectorJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [configResponse, jobsResponse] = await Promise.all([apiFetch('/api/monitoring-configurations'), apiFetch('/api/collector-jobs')]);
      if (!configResponse.ok) {
        const body = await configResponse.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || 'Monitoring data could not be loaded.');
      }
      setConfigurations(await configResponse.json());
      if (jobsResponse.ok) setJobs(await jobsResponse.json());
    } catch (cause: any) { setError(cause?.message || 'Monitoring data could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const run = async (id: string) => {
    setRunning(id); setError(null);
    try {
      const response = await apiFetch(`/api/monitoring-configurations/${id}/run`, { method: 'POST' });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.error || 'SPR could not queue this verification.'); }
      await load();
    } catch (cause: any) { setError(cause?.message || 'SPR could not queue this verification.'); }
    finally { setRunning(null); }
  };
  const latest = (id: string) => jobs.find(job => job.monitoringConfigurationId === id);

  return <div className="mx-auto max-w-6xl space-y-7 pb-10" id="monitoring-workspace">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.2em] text-indigo-300">Continuous verification</p><h1 className="mt-3 text-3xl font-bold tracking-tight text-white">What changed since the last check?</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Monitoring queues configured server-side collectors. A queued run is not a completed or verified result.</p></div><button onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3.5 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button></header>
    {error && <div role="alert" className="flex gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100"><AlertCircle className="h-5 w-5 shrink-0" /><div><p className="font-semibold">Verification unavailable</p><p className="mt-1 text-rose-200">{error}</p></div></div>}
    {loading ? <div className="grid gap-4 md:grid-cols-2">{[1, 2].map(item => <div key={item} className="h-52 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />)}</div> : configurations.length ? <section className="grid gap-4 md:grid-cols-2">{configurations.map(config => { const job = latest(config.id); return <article key={config.id} className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{config.collectorId.replace('_', ' ')} collector</p><h2 className="mt-2 break-all font-semibold text-white">{config.subjectIdentifier}</h2></div><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${config.enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>{config.enabled ? 'Watching' : 'Paused'}</span></div><dl className="mt-5 space-y-3 text-sm"><Row icon={<Clock3 />} label="Last observed" value={readable(config.lastObservedAt)} /><Row icon={<Activity />} label="Last run" value={job ? `${job.state} · ${readable(job.completedAt || job.createdAt)}` : 'No run recorded'} /><Row icon={<CheckCircle2 />} label="Next check" value={readable(config.nextScheduledAt)} /></dl><button onClick={() => void run(config.id)} disabled={!config.enabled || running === config.id} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"><Play className="h-4 w-4" />{running === config.id ? 'Queueing check…' : 'Re-verify now'}</button></article>; })}</section> : <section className="rounded-2xl border border-slate-800 bg-[#0d1322] px-6 py-16 text-center"><XCircle className="mx-auto h-8 w-8 text-slate-500" /><h2 className="mt-3 font-semibold text-white">No verification sources configured</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">SPR cannot claim continuous coverage until an administrator configures a monitored source for this tenant.</p></section>}
  </div>;
}
function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-3"><span className="h-4 w-4 text-slate-500">{icon}</span><div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 text-slate-200">{value}</dd></div></div>; }
