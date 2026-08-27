import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, Sparkles, Database, ArrowRight, RefreshCw } from 'lucide-react';
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

  const ownerAccess = userRole === 'Owner';

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
      <div className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 p-8 text-[#d4d4d4]">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-6 h-6 text-[#f14c4c]" />
          <div>
            <h1 className="text-xl font-semibold">Founder Admin Access Required</h1>
            <p className="text-sm text-[#9d9d9d]">You must be signed in as an Owner to view the Founder/Admin Control Center.</p>
          </div>
        </div>
        <div className="rounded-md border border-[#f14c4c]/40 bg-[#1e1e1e] p-6">
          <p className="text-sm text-[#9d9d9d]">This dashboard contains privileged SPR system telemetry, self-verification reports, and high-confidence executive controls. Please contact your administrator to request Owner role access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] p-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f14c4c]/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f14c4c]">
              <Sparkles className="w-4 h-4" /> SPR Sovereign Control Center
            </div>
            <h1 className="text-2xl font-display font-bold text-[#d4d4d4]">Founder / Owner Command Center</h1>
            <p className="max-w-2xl text-sm text-[#9d9d9d]">View observed founder/admin metrics and self-passport evidence for SPR. Unavailable information is shown as not verified.</p>
          </div>
          <button onClick={fetchSelfPassport} disabled={loadingPassport} className="spr-btn spr-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw className="w-4 h-4" />
            {loadingPassport ? 'Refreshing Passport' : 'Fetch SPR Self Passport'}
          </button>
        </div>

        {error && <div className="mt-6 rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 p-4 text-sm text-[#f14c4c]">{error}</div>}

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
            <div className="flex items-center gap-3 text-[#9d9d9d]"><Lock className="w-4 h-4" /><span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Access Level</span></div>
            <p className="mt-4 text-3xl font-bold text-[#d4d4d4]">Owner</p>
            <p className="mt-2 text-sm text-[#9d9d9d]">Server-authorized owner access.</p>
          </div>
          <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
            <div className="flex items-center gap-3 text-[#9d9d9d]"><Database className="w-4 h-4" /><span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Autonomy Score</span></div>
            <p className="mt-4 text-3xl font-bold text-[#d4d4d4]">{loadingMetrics ? '—' : metrics?.overallScore ?? 'Not verified'}</p>
            <p className="mt-2 text-sm text-[#9d9d9d]">Observed founder metrics only.</p>
          </div>
          <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
            <div className="flex items-center gap-3 text-[#9d9d9d]"><ShieldCheck className="w-4 h-4" /><span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Health Status</span></div>
            <p className="mt-4 text-3xl font-bold text-[#d4d4d4]">{loadingMetrics ? '—' : metrics?.systemIntegrity ?? 'Not verified'}</p>
            <p className="mt-2 text-sm text-[#9d9d9d]">Only backend-reported system integrity is shown.</p>
          </div>
          <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
            <div className="flex items-center gap-3 text-[#9d9d9d]"><ArrowRight className="w-4 h-4" /><span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Mitigations</span></div>
            <p className="mt-4 text-3xl font-bold text-[#d4d4d4]">{loadingMetrics ? '—' : metrics?.mitigations ?? 'Not verified'}</p>
            <p className="mt-2 text-sm text-[#9d9d9d]">Backend-reported mitigation evidence only.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] p-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[#094771] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3794ff]"><Sparkles className="w-4 h-4" /> Evidence-backed self passport</div>
              <h2 className="mt-4 text-xl font-semibold text-[#d4d4d4]">SPR Self Passport</h2>
              <p className="mt-2 text-sm text-[#9d9d9d]">Latest self-verification record returned by the protected owner endpoint. No local defaults are presented as evidence.</p>
            </div>
            <button onClick={fetchSelfPassport} disabled={loadingPassport} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw className="w-4 h-4" />Refresh Passport</button>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-4"><span className="text-[10px] uppercase tracking-[0.24em] text-[#9d9d9d]">Passport Name</span><p className="mt-2 text-lg font-semibold text-[#d4d4d4]">{passport?.name ?? 'Not verified'}</p></div>
            <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-4"><span className="text-[10px] uppercase tracking-[0.24em] text-[#9d9d9d]">Version</span><p className="mt-2 text-lg font-semibold text-[#d4d4d4]">{passport?.version ?? 'Not verified'}</p></div>
            <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-4"><span className="text-[10px] uppercase tracking-[0.24em] text-[#9d9d9d]">Health</span><p className="mt-2 text-lg font-semibold text-[#d4d4d4]">{passport?.healthStatus ?? 'Not verified'}</p></div>
            <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-4"><span className="text-[10px] uppercase tracking-[0.24em] text-[#9d9d9d]">Updated</span><p className="mt-2 text-lg font-semibold text-[#d4d4d4]">{passport?.releaseDate ?? 'Not verified'}</p></div>
          </div>

          {passport?.publisher && <div className="mt-6 rounded-md border border-[#3c3c3c] bg-[#252526] p-4"><span className="text-[10px] uppercase tracking-[0.24em] text-[#9d9d9d]">Publisher</span><p className="mt-2 text-base font-semibold text-[#d4d4d4]">{passport.publisher}</p></div>}

          {passport?.evidence && passport.evidence.length > 0 && <div className="mt-6 rounded-md border border-[#3c3c3c] bg-[#252526] p-5"><div className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-[0.24em] text-[#9d9d9d]">Evidence Summary</span><span className="text-[10px] font-semibold text-[#d4d4d4]">{passport.evidence.length} Entries</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{passport.evidence.slice(0, 4).map((item: any, index: number) => <div key={index} className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] p-3 text-xs text-[#d4d4d4]">{item.summary || item.type || 'Evidence item'}</div>)}</div></div>}
        </div>

        <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-6">
          <div className="flex items-center gap-3 text-[#9d9d9d]"><Database className="w-4 h-4" /><span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Founder Intelligence Snapshot</span></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-md bg-[#1e1e1e] p-4 text-[#d4d4d4] border border-[#3c3c3c]"><p className="text-[11px] uppercase tracking-[0.18em] text-[#9d9d9d]">Point-of-Trust</p><p className="mt-3 text-3xl font-bold">{loadingMetrics ? '—' : metrics?.throughput ?? 'Not verified'}</p><p className="mt-2 text-sm text-[#9d9d9d]">Backend-reported throughput.</p></div>
            <div className="rounded-md bg-[#1e1e1e] p-4 text-[#d4d4d4] border border-[#3c3c3c]"><p className="text-[11px] uppercase tracking-[0.18em] text-[#9d9d9d]">Capital Protected</p><p className="mt-3 text-3xl font-bold">{loadingMetrics ? '—' : metrics?.capitalProtected ?? 'Not verified'}</p><p className="mt-2 text-sm text-[#9d9d9d]">Only shown when reported by the owner endpoint.</p></div>
            <div className="rounded-md bg-[#1e1e1e] p-4 text-[#d4d4d4] border border-[#3c3c3c]"><p className="text-[11px] uppercase tracking-[0.18em] text-[#9d9d9d]">Active Threat Mitigations</p><p className="mt-3 text-3xl font-bold">{loadingMetrics ? '—' : metrics?.mitigations ?? 'Not verified'}</p><p className="mt-2 text-sm text-[#9d9d9d]">Backend-reported mitigation evidence.</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}
