import { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock3, Play, RefreshCw, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Configuration = { id: string; clientId: string; collectorId: string; subjectIdentifier: string; enabled: boolean; lastStatus: string; lastObservedAt?: string | null; nextScheduledAt: string; };
type CollectorJob = { id: string; monitoringConfigurationId: string; collectorId: string; state: string; createdAt: string; completedAt?: string | null; };

const readable = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not yet observed';

export default function MonitoringView({ role = 'Viewer' }: { role?: string }) {
  const canRun = role === 'Owner' || role === 'Admin' || role === 'Technician';
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [jobs, setJobs] = useState<CollectorJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [configResponse, jobsResponse] = await Promise.all([apiFetch('/api/monitoring/monitoring-configurations'), apiFetch('/api/monitoring/collector-jobs')]);
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
      const response = await apiFetch(`/api/monitoring/monitoring-configurations/${id}/run`, { method: 'POST' });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body?.error || 'SPR could not queue this verification.'); }
      await load();
    } catch (cause: any) { setError(cause?.message || 'SPR could not queue this verification.'); }
    finally { setRunning(null); }
  };
  const latest = (id: string) => jobs.find(job => job.monitoringConfigurationId === id);

  return (
    <section className="space-y-4" id="monitoring-workspace">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e]">Continuous verification</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">Monitoring queues configured server-side collectors. A queued run is not a completed or verified result.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Each row is a server-side collector configured to watch a subject. Re-verifying queues a fresh check; it does not itself guarantee an updated result.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Review last observed and last run status for each configured source.</li>
            <li>Select re-verify to queue a new check (requires Owner, Admin or Technician).</li>
            <li>An administrator must configure a source before this tenant has any monitoring coverage.</li>
          </ol>
        </div>
      </details>

      {error && (
        <div role="alert" className="flex gap-3 rounded-md border border-[#f3d6d8] bg-[#fdf2f2] p-3 text-[13px] text-[#a4262c]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div><p className="font-semibold">Verification unavailable</p><p className="mt-1">{error}</p></div>
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="space-y-2">{[1, 2].map(item => <div key={item} className="h-10 animate-pulse rounded bg-[#f3f2f1]" />)}</div>
        </div>
      ) : configurations.length ? (
        <div className="overflow-x-auto rounded-md border border-[#e1dfdd] bg-white">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-4 py-2.5 font-medium">Collector / subject</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last observed</th>
                <th className="px-4 py-2.5 font-medium">Last run</th>
                <th className="px-4 py-2.5 font-medium">Next check</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {configurations.map(config => {
                const job = latest(config.id);
                return (
                  <tr key={config.id} className="border-b border-[#f3f2f1] text-[13px]">
                    <td className="px-4 py-2.5">
                      <div className="text-[11px] uppercase tracking-wide text-[#8a8886]">{config.collectorId.replace('_', ' ')} collector</div>
                      <div className="mt-0.5 break-all font-medium text-[#201f1e]">{config.subjectIdentifier}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${config.enabled ? 'bg-[#0e700e]' : 'bg-[#8a8886]'}`} />
                        {config.enabled ? 'Watching' : 'Paused'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[#605e5c]"><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-[#8a8886]" />{readable(config.lastObservedAt)}</span></td>
                    <td className="px-4 py-2.5 text-[#605e5c]"><span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-[#8a8886]" />{job ? `${job.state} · ${readable(job.completedAt || job.createdAt)}` : 'No run recorded'}</span></td>
                    <td className="px-4 py-2.5 text-[#605e5c]"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#8a8886]" />{readable(config.nextScheduledAt)}</span></td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => void run(config.id)}
                        disabled={!canRun || !config.enabled || running === config.id}
                        title={!canRun ? `Your ${role} role cannot run verifications.` : undefined}
                        className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[12px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" />{running === config.id ? 'Queueing…' : 'Re-verify'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-[#e1dfdd] bg-white px-6 py-10 text-center">
          <XCircle className="mx-auto h-6 w-6 text-[#c8c6c4]" />
          <h2 className="mt-2 text-[13px] font-semibold text-[#201f1e]">No verification sources configured</h2>
          <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[#605e5c]">SPR cannot claim continuous coverage until an administrator configures a monitored source for this tenant.</p>
        </div>
      )}
    </section>
  );
}
