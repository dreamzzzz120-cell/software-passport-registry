import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, RefreshCw, Terminal } from 'lucide-react';
import { SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';

interface PassportSwarmViewProps {
  passport: SoftwarePassport;
}

interface AgentJob {
  id: string;
  passportId: string;
  agentId: string;
  jobType: string;
  status: string;
  progress: number;
  result?: string;
  error?: string;
}

interface AgentLog {
  id: number;
  level: string;
  message: string;
}

export default function PassportSwarmView({ passport }: PassportSwarmViewProps) {
  const [job, setJob] = useState<AgentJob | null>(null);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadJobs = async () => {
    const response = await apiFetch('/api/agent-jobs');
    if (!response.ok) throw new Error('Could not load worker jobs.');
    const jobs: AgentJob[] = await response.json();
    const matching = jobs
      .filter(item => item.passportId === passport.id && item.agentId === 'osv-worker' && item.jobType === 'osv_manifest_scan')
      .at(-1) || null;
    setJob(matching);
    if (matching) {
      const logsResponse = await apiFetch(`/api/agent-jobs/${encodeURIComponent(matching.id)}/logs`);
      if (!logsResponse.ok) throw new Error('Could not load persisted worker logs.');
      setLogs(await logsResponse.json());
    } else {
      setLogs([]);
    }
  };

  useEffect(() => {
    setError('');
    loadJobs().catch(err => setError(err.message));
  }, [passport.id]);

  useEffect(() => {
    if (!job || !['Pending', 'Running'].includes(job.status)) return;
    const timer = window.setInterval(() => loadJobs().catch(err => setError(err.message)), 2000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const startScan = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/agent-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'osv-worker',
          passportId: passport.id,
          jobType: 'osv_manifest_scan'
        })
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.jobId) {
        await loadJobs();
        return;
      }
      if (!response.ok) throw new Error(body.message || body.error || 'Worker job was not accepted.');
      setJob(body);
      await loadJobs();
    } catch (err: any) {
      setError(err?.message || 'Worker job unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const running = job && ['Pending', 'Running'].includes(job.status);

  return (
    <div className="space-y-5 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-lg font-bold">AI Swarm — Supported Worker</h2>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">
            SPR currently runs one independent worker here: OSV manifest-component scanning. Other advertised agents are unavailable.
          </p>
        </div>
        <button
          onClick={startScan}
          disabled={loading || Boolean(running)}
          className="flex items-center justify-center gap-2 rounded-xl bg-[var(--spr-accent-soft)] px-4 py-2 text-sm font-semibold text-[var(--spr-text)] disabled:opacity-50"
        >
          {loading || running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Worker running' : 'Run OSV scan'}
        </button>
      </div>

      <div className="rounded-xl border border-[var(--spr-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">OSV manifest worker</p>
            <p className="text-xs text-[var(--spr-text-muted)]">Queries observed SBOM components against api.osv.dev and persists provider responses and findings.</p>
          </div>
          <span className="rounded-full bg-[var(--spr-surface-sunken)] px-2 py-1 text-xs font-semibold text-[var(--spr-text-faint)]">
            {job?.status || 'No job'}
          </span>
        </div>
        {job && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--spr-surface-sunken)]">
              <div className="h-full bg-[var(--spr-accent-soft)]" style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} />
            </div>
            <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Job {job.id} · {job.progress || 0}%</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex gap-2 rounded-xl border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/15 p-4 text-sm text-[var(--spr-red)]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-xl bg-[var(--spr-surface)] p-4 text-[var(--spr-text)]">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--spr-text-muted)]">
          <Terminal className="h-4 w-4" /> Persisted worker logs
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto font-mono text-xs">
          {logs.length === 0 && <p className="text-[var(--spr-text-muted)]">No persisted logs for this passport.</p>}
          {logs.map(log => (
            <p key={log.id} className={log.level === 'Error' ? 'text-[var(--spr-red)]' : 'text-[var(--spr-text)]'}>
              [{log.level}] {log.message}
            </p>
          ))}
        </div>
      </div>

      {job?.status === 'Completed' && (
        <div className="flex gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          The worker completed. Review persisted findings and evidence; completion is not a declaration that the software is safe.
        </div>
      )}
    </div>
  );
}
