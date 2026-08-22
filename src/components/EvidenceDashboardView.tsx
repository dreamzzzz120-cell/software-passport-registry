import React from 'react';
import type { Alert, Client, Scan, SoftwarePassport } from '../types';

interface EvidenceDashboardViewProps {
  clients: Client[];
  alerts: Alert[];
  scans: Scan[];
  passports: SoftwarePassport[];
  onNavigateTab: (tab: string, itemId?: string) => void;
  onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void;
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5 backdrop-blur-xl">
      <div className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-600">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

export default function EvidenceDashboardView({ clients, alerts, scans, passports, onNavigateTab, onOpenQuickAction }: EvidenceDashboardViewProps) {
  const activeFindings = alerts.filter((item) => item.status === 'Active').length;
  const verifiedPassports = passports.filter((item) => item.overallScore != null).length;

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-cyan-300/10 bg-white/[.035] p-6 backdrop-blur-2xl md:p-8">
        <div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">Evidence-first command center</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Software trust workspace</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">This overview reports only data returned by the authenticated workspace. Missing or unscored evidence is shown as unverified in the owning workflow.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Passports" value={passports.length} detail={`${verifiedPassports} with an observed score`} />
        <Metric label="Clients" value={clients.length} detail="Authenticated tenant records" />
        <Metric label="Active findings" value={activeFindings} detail="Trust-loop findings returned by API" />
        <Metric label="Scans" value={scans.length} detail="Scan records returned by API" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <button onClick={() => onOpenQuickAction('register-passport')} className="rounded-2xl border border-white/10 bg-white/[.025] p-5 text-left hover:bg-white/[.045]">
          <div className="text-sm font-semibold text-white">Register software passport</div>
          <div className="mt-1 text-xs text-slate-500">Open the Passport workflow.</div>
        </button>
        <button onClick={() => onOpenQuickAction('scan-sbom')} className="rounded-2xl border border-white/10 bg-white/[.025] p-5 text-left hover:bg-white/[.045]">
          <div className="text-sm font-semibold text-white">Run a scan</div>
          <div className="mt-1 text-xs text-slate-500">Open the scanning and attestation workflow.</div>
        </button>
        <button onClick={() => onNavigateTab('/security')} className="rounded-2xl border border-white/10 bg-white/[.025] p-5 text-left hover:bg-white/[.045]">
          <div className="text-sm font-semibold text-white">Review security findings</div>
          <div className="mt-1 text-xs text-slate-500">Open the evidence-backed Security Center.</div>
        </button>
      </div>

      <div className="rounded-2xl border border-amber-300/10 bg-amber-300/[.035] p-4 text-xs leading-5 text-amber-100/80">
        No score, certification, publisher reputation, deployment state, or compliance posture is inferred from a software name. Unobserved values remain unverified.
      </div>
    </section>
  );
}
