import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, Database, ArrowRight, RefreshCw, Activity, Webhook, Plug, GitBranch, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface FounderDashboardViewProps {
  userRole: string;
}

interface FounderMetrics {
  latency: string;
  capitalProtected: string;
  throughput: string;
  mitigations: string;
  overallScore?: number;
  auditEvents?: number;
  activeThreats?: number;
  systemIntegrity?: string;
}

interface SelfPassportSummary {
  id?: string;
  name?: string;
  version?: string;
  overallScore?: number;
  healthStatus?: string;
  releaseDate?: string;
  publisher?: string;
  evidence?: any[];
}

export default function FounderDashboardView({ userRole }: FounderDashboardViewProps) {
  const [metrics, setMetrics] = useState<FounderMetrics | null>(null);
  const [passport, setPassport] = useState<SelfPassportSummary | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadingPassport, setLoadingPassport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operations, setOperations] = useState<any | null>(null);
  const [loadingOperations, setLoadingOperations] = useState(false);
  const [operationsError, setOperationsError] = useState<string | null>(null);

  const ownerAccess = userRole === 'Owner';

  const loadOperations = async () => {
    setLoadingOperations(true);
    setOperationsError(null);
    try {
      const response = await apiFetch('/api/founder/operations');
      if (!response.ok) throw new Error(`Operational health failed (${response.status})`);
      setOperations(await response.json());
    } catch (err: any) {
      setOperationsError(err?.message || 'Unable to fetch operational health.');
    } finally {
      setLoadingOperations(false);
    }
  };

  useEffect(() => {
    if (!ownerAccess) return;
    const loadFounderData = async () => {
      setLoadingMetrics(true);
      setError(null);
      try {
        const response = await apiFetch('/api/founder/metrics');
        if (!response.ok) throw new Error(`Founder metrics failed (${response.status})`);
        setMetrics(await response.json());
      } catch (err: any) {
        setError(err?.message || 'Unable to fetch founder metrics.');
      } finally {
        setLoadingMetrics(false);
      }
    };
    void loadFounderData();
    void loadOperations();
  }, [ownerAccess]);

  const fetchSelfPassport = async () => {
    setLoadingPassport(true);
    setError(null);
    try {
      const response = await apiFetch('/api/passports/self-passport');
      if (!response.ok) throw new Error(`Self passport request failed (${response.status})`);
      const data = await response.json();
      setPassport({
        id: data.id,
        name: data.name,
        version: data.version,
        overallScore: data.overallScore,
        healthStatus: data.healthStatus,
        releaseDate: data.releaseDate,
        publisher: data.publisher,
        evidence: data.evidence || []
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to fetch SPR self passport.');
    } finally {
      setLoadingPassport(false);
    }
  };

  if (!ownerAccess) {
    return (
      <div className="rounded-md border border-[#a4262c]/30 bg-[#fdf2f2] p-4 text-[#201f1e]">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#a4262c]" />
          <div>
            <h1 className="text-[16px] font-semibold text-[#201f1e]">Founder Admin Access Required</h1>
            <p className="text-[13px] text-[#605e5c]">You must be signed in as an Owner to view the Founder/Admin Control Center.</p>
          </div>
        </div>
        <div className="rounded-md border border-[#e1dfdd] bg-white p-3">
          <p className="text-[13px] text-[#605e5c]">This dashboard contains privileged SPR system telemetry, self-verification reports, and high-confidence executive controls. Please contact your administrator to request Owner role access.</p>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="founder-dashboard-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="founder-dashboard-title" className="text-[22px] font-semibold text-[#201f1e]">Founder / Owner Command Center</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">Observed founder/admin metrics and self-passport evidence for SPR. Unavailable information is shown as not verified.</p>
        </div>
        <button type="button" onClick={fetchSelfPassport} disabled={loadingPassport} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50">
          <RefreshCw className="h-3.5 w-3.5" />
          {loadingPassport ? 'Refreshing Passport' : 'Fetch SPR Self Passport'}
        </button>
      </div>

      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Owner-only view of SPR's own self-reported passport plus live operational health pulled directly from the same tables the workers, webhooks, integrations and audit chain write to.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Access level and founder metrics are shown only when the backend returns them.</li>
            <li>Use "Fetch SPR Self Passport" to pull SPR's latest self-verification record.</li>
            <li>The operational health section below is left empty rather than filled with a placeholder when no real data exists yet.</li>
          </ol>
        </div>
      </details>

      {error && <div role="alert" className="mb-4 rounded-md border border-[#a4262c]/30 bg-[#fdf2f2] px-3 py-2 text-[13px] text-[#a4262c]">{error}</div>}

      <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-[#605e5c]" /><div><div className="text-[11px] text-[#605e5c]">Access Level</div><div className="text-lg font-semibold text-[#201f1e]">Owner</div></div></div>
        <div className="flex items-center gap-1.5"><Database className="h-3.5 w-3.5 text-[#605e5c]" /><div><div className="text-[11px] text-[#605e5c]">Autonomy Score</div><div className="text-lg font-semibold text-[#201f1e]">{loadingMetrics ? '—' : metrics?.overallScore ?? 'Not verified'}</div></div></div>
        <div className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-[#605e5c]" /><div><div className="text-[11px] text-[#605e5c]">Health Status</div><div className="text-lg font-semibold text-[#201f1e]">{loadingMetrics ? '—' : metrics?.systemIntegrity ?? 'Not verified'}</div></div></div>
        <div className="flex items-center gap-1.5"><ArrowRight className="h-3.5 w-3.5 text-[#605e5c]" /><div><div className="text-[11px] text-[#605e5c]">Mitigations</div><div className="text-lg font-semibold text-[#201f1e]">{loadingMetrics ? '—' : metrics?.mitigations ?? 'Not verified'}</div></div></div>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-[#201f1e]">SPR Self Passport</h2>
              <p className="mt-0.5 text-[12px] text-[#605e5c]">Latest self-verification record returned by the protected owner endpoint. No local defaults are presented as evidence.</p>
            </div>
            <button type="button" onClick={fetchSelfPassport} disabled={loadingPassport} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" />Refresh Passport</button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><span className="text-[11px] uppercase tracking-wide text-[#605e5c]">Passport Name</span><p className="mt-1 text-[14px] font-semibold text-[#201f1e]">{passport?.name ?? 'Not verified'}</p></div>
            <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><span className="text-[11px] uppercase tracking-wide text-[#605e5c]">Version</span><p className="mt-1 text-[14px] font-semibold text-[#201f1e]">{passport?.version ?? 'Not verified'}</p></div>
            <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><span className="text-[11px] uppercase tracking-wide text-[#605e5c]">Health</span><p className="mt-1 text-[14px] font-semibold text-[#201f1e]">{passport?.healthStatus ?? 'Not verified'}</p></div>
            <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><span className="text-[11px] uppercase tracking-wide text-[#605e5c]">Updated</span><p className="mt-1 text-[14px] font-semibold text-[#201f1e]">{passport?.releaseDate ?? 'Not verified'}</p></div>
          </div>

          {passport?.publisher && <div className="mt-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"><span className="text-[11px] uppercase tracking-wide text-[#605e5c]">Publisher</span><p className="mt-1 text-[13px] font-semibold text-[#201f1e]">{passport.publisher}</p></div>}

          {passport?.evidence && passport.evidence.length > 0 && (
            <div className="mt-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-[11px] uppercase tracking-wide text-[#605e5c]">Evidence Summary</span><span className="text-[11px] font-semibold text-[#323130]">{passport.evidence.length} Entries</span></div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">{passport.evidence.slice(0, 4).map((item: any, index: number) => <div key={index} className="rounded border border-[#e1dfdd] bg-white p-2 text-[12px] text-[#323130]">{item.summary || item.type || 'Evidence item'}</div>)}</div>
            </div>
          )}
        </div>

        <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-4">
          <div className="flex items-center gap-1.5 text-[#605e5c]"><Database className="h-3.5 w-3.5" /><span className="text-[11px] font-semibold uppercase tracking-wide">Founder Intelligence Snapshot</span></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-[#e1dfdd] bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-[#605e5c]">Point-of-Trust</p><p className="mt-1 text-lg font-semibold text-[#201f1e]">{loadingMetrics ? '—' : metrics?.throughput ?? 'Not verified'}</p><p className="mt-1 text-[12px] text-[#605e5c]">Backend-reported throughput.</p></div>
            <div className="rounded-md border border-[#e1dfdd] bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-[#605e5c]">Capital Protected</p><p className="mt-1 text-lg font-semibold text-[#201f1e]">{loadingMetrics ? '—' : metrics?.capitalProtected ?? 'Not verified'}</p><p className="mt-1 text-[12px] text-[#605e5c]">Only shown when reported by the owner endpoint.</p></div>
            <div className="rounded-md border border-[#e1dfdd] bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-[#605e5c]">Active Threat Mitigations</p><p className="mt-1 text-lg font-semibold text-[#201f1e]">{loadingMetrics ? '—' : metrics?.mitigations ?? 'Not verified'}</p><p className="mt-1 text-[12px] text-[#605e5c]">Backend-reported mitigation evidence.</p></div>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-[#201f1e]"><Activity className="h-3.5 w-3.5 text-[#605e5c]" />Operational health — real system state, Owner-only</h2>
            <p className="mt-0.5 text-[12px] text-[#605e5c]">Every number below comes from a live database query. A section is left empty rather than filled with a placeholder if SPR has no real data for it yet.</p>
          </div>
          <button type="button" onClick={loadOperations} disabled={loadingOperations} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loadingOperations ? 'animate-spin' : ''}`} />{loadingOperations ? 'Refreshing' : 'Refresh'}
          </button>
        </div>

        {operationsError && <div role="alert" className="mb-3 rounded-md border border-[#a4262c]/30 bg-[#fdf2f2] px-3 py-2 text-[13px] text-[#a4262c]">{operationsError}</div>}

        {operations && (
          <div className="space-y-4">
            {operations.notes?.length > 0 && (
              <div className="rounded-md border border-[#f5dfa0] bg-[#fff4ce] p-3 text-[12px] leading-5 text-[#8a5700]">
                {operations.notes.map((note: string, i: number) => <p key={i}>{note}</p>)}
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <OpsPanel icon={<GitBranch className="h-3.5 w-3.5" />} title="Worker health — osv-worker.ts">
                <CountRow rows={operations.workers.osv.countsByStatus} keyField="status" groupField="jobType" />
                <MetaRow label="Stuck running (>10min, unclaimed)" value={operations.workers.osv.staleRunningCount} warn={operations.workers.osv.staleRunningCount > 0} />
                <MetaRow label="Last queue activity" value={formatTime(operations.workers.osv.lastActivityAt)} />
                <FailureList label="Recent failures" items={operations.workers.osv.recentFailures} render={(f: any) => `${f.jobType} · ${f.error || 'no error recorded'} · attempt ${f.attemptCount}/${f.maxAttempts} · ${formatTime(f.updatedAt)}`} />
              </OpsPanel>

              <OpsPanel icon={<GitBranch className="h-3.5 w-3.5" />} title="Worker health — trust-monitoring-worker.ts">
                <CountRow rows={operations.workers.monitoringWorker.countsByState} keyField="state" />
                <MetaRow label="Last heartbeat (running jobs)" value={formatTime(operations.workers.monitoringWorker.lastHeartbeatAt)} />
                <FailureList label="Recent failures / dead-lettered" items={operations.workers.monitoringWorker.recentFailures} render={(f: any) => `${f.collectorId} · ${f.errorCode || 'unknown'}: ${f.errorMessage || ''} · ${formatTime(f.completedAt)}`} />
              </OpsPanel>

              <OpsPanel icon={<Webhook className="h-3.5 w-3.5" />} title="Webhook delivery health (last 7 days)">
                <CountRow rows={operations.webhooks.countsByStatusLast7Days} keyField="status" />
                <MetaRow label="Active endpoints" value={operations.webhooks.activeEndpoints} />
                <MetaRow label="Disabled endpoints (repeated failures)" value={operations.webhooks.disabledEndpoints} warn={operations.webhooks.disabledEndpoints > 0} />
                <FailureList label="Recent failed/dead-lettered deliveries" items={operations.webhooks.recentFailures} render={(f: any) => `${f.url} · ${f.eventType} · ${f.errorCode || 'unknown'} · ${formatTime(f.completedAt)}`} />
              </OpsPanel>

              <OpsPanel icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Audit chain integrity">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                  {operations.auditChain.isValid ? <CheckCircle2 className="h-3.5 w-3.5 text-[#0e700e]" /> : <XCircle className="h-3.5 w-3.5 text-[#a4262c]" />}
                  <span className={operations.auditChain.isValid ? 'text-[#0e700e]' : 'text-[#a4262c]'}>{operations.auditChain.isValid ? 'Chain intact' : 'Chain integrity broken'}</span>
                </div>
                <MetaRow label="Blocks verified" value={operations.auditChain.totalBlocksVerified} />
                <MetaRow label="Verified at" value={formatTime(operations.auditChain.verifiedAt)} />
                {operations.auditChain.error && <p className="mt-1.5 text-[12px] text-[#a4262c]">{operations.auditChain.error}</p>}
              </OpsPanel>
            </div>

            <OpsPanel icon={<Plug className="h-3.5 w-3.5" />} title="Integration connection health (all catalog providers)">
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {operations.integrations.map((item: any) => (
                  <div key={item.provider} className="flex items-center justify-between gap-2 rounded border border-[#e1dfdd] bg-white px-2.5 py-2 text-[12px]">
                    <div>
                      <p className="font-semibold text-[#323130]">{item.name}</p>
                      <p className="mt-0.5 text-[11px] text-[#8a8886]">Last sync {formatTime(item.lastSyncDate)}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[12px]"><span className={`h-1.5 w-1.5 rounded-full ${item.connected ? 'bg-[#0e700e]' : 'bg-[#8a8886]'}`} />{item.connected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                ))}
              </div>
            </OpsPanel>

            <OpsPanel icon={<AlertTriangle className="h-3.5 w-3.5" />} title="Scan / job queue">
              <p className="text-[11px] uppercase tracking-wide text-[#605e5c]">Currently running repository scans</p>
              {operations.queue.runningRepositoryScans.length ? (
                <ul className="mt-1.5 space-y-1 text-[12px] text-[#323130]">{operations.queue.runningRepositoryScans.map((s: any) => <li key={s.id}>{s.passportId} · {s.progress}% · since {formatTime(s.updatedAt)}</li>)}</ul>
              ) : <p className="mt-1.5 text-[12px] text-[#8a8886]">None currently running.</p>}
              <p className="mt-3 text-[11px] uppercase tracking-wide text-[#605e5c]">Compliance schedule runs</p>
              {operations.queue.complianceSchedules.length ? (
                <ul className="mt-1.5 space-y-1 text-[12px] text-[#323130]">{operations.queue.complianceSchedules.map((s: any) => <li key={s.id}>{s.clientId} · {s.frequency} · {s.status} · last run {formatTime(s.lastAuditAt)} · next {formatTime(s.nextAuditAt)}</li>)}</ul>
              ) : <p className="mt-1.5 text-[12px] text-[#8a8886]">No compliance schedules configured.</p>}
            </OpsPanel>
          </div>
        )}
      </div>
    </section>
  );
}

function formatTime(value?: string | null) { return value ? new Date(value).toLocaleString() : 'never'; }

function OpsPanel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
      <div className="flex items-center gap-1.5 text-[#605e5c]">{icon}<span className="text-[12px] font-semibold uppercase tracking-wide">{title}</span></div>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function CountRow({ rows, keyField, groupField }: { rows: any[]; keyField: string; groupField?: string }) {
  if (!rows?.length) return <p className="text-[12px] text-[#8a8886]">No jobs recorded yet.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((row, i) => (
        <span key={i} className="rounded border border-[#c8c6c4] bg-white px-2 py-0.5 text-[11px] font-medium text-[#323130]">
          {groupField ? `${row[groupField]} · ` : ''}{row[keyField]}: {row.count}
        </span>
      ))}
    </div>
  );
}

function MetaRow({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-[#605e5c]">{label}</span>
      <span className={`font-semibold ${warn ? 'text-[#8a5700]' : 'text-[#323130]'}`}>{value}</span>
    </div>
  );
}

function FailureList({ label, items, render }: { label: string; items: any[]; render: (item: any) => string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[#605e5c]">{label}</p>
      {items?.length ? (
        <ul className="mt-1 space-y-1 text-[11px] leading-4 text-[#605e5c]">{items.map((item, i) => <li key={i} className="truncate">{render(item)}</li>)}</ul>
      ) : <p className="mt-1 text-[11px] text-[#8a8886]">None.</p>}
    </div>
  );
}
