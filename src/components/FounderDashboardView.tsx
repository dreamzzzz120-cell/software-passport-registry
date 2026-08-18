/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
    if (!ownerAccess) {
      return;
    }

    const loadFounderData = async () => {
      setLoadingMetrics(true);
      setError(null);
      try {
        const response = await apiFetch('/api/founder/metrics');
        if (!response.ok) {
          throw new Error(`Founder metrics failed (${response.status})`);
        }
        const data = await response.json();
        setMetrics(data);
      } catch (err: any) {
        setError(err?.message || 'Unable to fetch founder metrics.');
      } finally {
        setLoadingMetrics(false);
      }
    };

    loadFounderData();
  }, [ownerAccess]);

  const fetchSelfPassport = async () => {
    setLoadingPassport(true);
    setError(null);
    try {
      const response = await apiFetch('/api/passports/self-passport');
      if (!response.ok) {
        throw new Error(`Self passport request failed (${response.status})`);
      }
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
      <div className="rounded-3xl border border-rose-200/80 bg-rose-50/70 p-8 shadow-sm text-slate-900 dark:border-rose-500/20 dark:bg-rose-950/10 dark:text-slate-100">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-6 h-6 text-rose-600" />
          <div>
            <h1 className="text-xl font-semibold">Founder Admin Access Required</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">You must be signed in as an Owner to view the Founder/Admin Control Center.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-rose-200/70 bg-white dark:bg-zinc-900 p-6">
          <p className="text-sm text-slate-500 dark:text-slate-400">This dashboard contains privileged SPR system telemetry, self-verification reports, and high-confidence executive controls. Please contact your administrator to request Owner role access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-slate-200/80 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
              <Sparkles className="w-4 h-4" /> SPR Sovereign Control Center
            </div>
            <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-slate-100">Founder / Owner Command Center</h1>
            <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">View self-generated software passport metrics, continuous trust posture health, and executive protection telemetry for SPR.</p>
          </div>
          <button
            onClick={fetchSelfPassport}
            disabled={loadingPassport}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" />
            {loadingPassport ? 'Refreshing Passport' : 'Fetch SPR Self Passport'}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-rose-300/70 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-600/40 dark:bg-rose-950/20 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
              <Lock className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Access Level</span>
            </div>
            <p className="mt-4 text-3xl font-bold text-slate-900 dark:text-slate-100">Owner</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Executive system steward with founder and admin privileges.</p>
          </div>
          <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
              <Database className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Autonomy Score</span>
            </div>
            <p className="mt-4 text-3xl font-bold text-slate-900 dark:text-slate-100">{metrics?.overallScore ?? 'N/A'}</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Between self-verification and executive control KPIs.</p>
          </div>
          <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Health Status</span>
            </div>
            <p className="mt-4 text-3xl font-bold text-slate-900 dark:text-slate-100">{metrics?.systemIntegrity ?? 'Secure'}</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Continuous self-monitor trust posture status.</p>
          </div>
          <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
              <ArrowRight className="w-4 h-4" />
              <span className="text-[11px] uppercase tracking-[0.24em] font-semibold">High Confidence</span>
            </div>
            <p className="mt-4 text-3xl font-bold text-slate-900 dark:text-slate-100">{metrics?.mitigations ?? '0'}</p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Active mitigations processed by the SPR trust engine.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-300">
                <Sparkles className="w-4 h-4" /> SPR Self-Generated Passport
              </div>
              <h2 className="mt-4 text-xl font-semibold text-slate-900 dark:text-slate-100">Self-Verifying Software Passport</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Latest self-verification report for SPR, built from package metadata, SBOM, and trust evidence.</p>
            </div>
            <button
              onClick={fetchSelfPassport}
              disabled={loadingPassport}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-100"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Passport
            </button>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Passport Name</span>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{passport?.name || 'SPR Self Passport'}</p>
            </div>
            <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Version</span>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{passport?.version || 'v1.0'}</p>
            </div>
            <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Health</span>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{passport?.healthStatus || 'Pending'}</p>
            </div>
            <div className="rounded-3xl border border-slate-200/70 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Updated</span>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{passport?.releaseDate || 'Not fetched'}</p>
            </div>
          </div>

          {passport?.publisher && (
            <div className="mt-6 rounded-3xl border border-slate-200/70 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Publisher</span>
              <p className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">{passport.publisher}</p>
            </div>
          )}

          {passport?.evidence && passport.evidence.length > 0 && (
            <div className="mt-6 rounded-3xl border border-slate-200/70 bg-slate-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Evidence Summary</span>
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{passport.evidence.length} Entries</span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {passport.evidence.slice(0, 4).map((item: any, index: number) => (
                  <div key={index} className="rounded-2xl border border-slate-200/70 bg-white p-3 text-xs text-slate-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-slate-300">
                    {item.summary || item.type || 'Evidence item'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-slate-50 p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
            <Database className="w-4 h-4" />
            <span className="text-[11px] uppercase tracking-[0.24em] font-semibold">Founder Intelligence Snapshot</span>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl bg-white p-4 text-slate-900 dark:bg-zinc-950 dark:text-slate-100 border border-slate-200/70 dark:border-zinc-800">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Point-of-Trust</p>
              <p className="mt-3 text-3xl font-bold">{metrics?.throughput || '—'}</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">System throughput blocks/sec</p>
            </div>
            <div className="rounded-3xl bg-white p-4 text-slate-900 dark:bg-zinc-950 dark:text-slate-100 border border-slate-200/70 dark:border-zinc-800">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Capital Protected</p>
              <p className="mt-3 text-3xl font-bold">{metrics?.capitalProtected || '—'}</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Estimated value protected by SPR trust checks</p>
            </div>
            <div className="rounded-3xl bg-white p-4 text-slate-900 dark:bg-zinc-950 dark:text-slate-100 border border-slate-200/70 dark:border-zinc-800">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Active Threat Mitigations</p>
              <p className="mt-3 text-3xl font-bold">{metrics?.mitigations || '—'}</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Confirmed mitigations in last 24 hours</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
