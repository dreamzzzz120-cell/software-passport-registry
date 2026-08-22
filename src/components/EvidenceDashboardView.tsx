import React from 'react';
import { Activity, ArrowRight, Database, ShieldAlert, Users, Workflow } from 'lucide-react';
import type { Alert, Client, Scan, SoftwarePassport } from '../types';

interface EvidenceDashboardViewProps {
  clients: Client[];
  alerts: Alert[];
  scans: Scan[];
  passports: SoftwarePassport[];
  onNavigateTab: (path: string, itemId?: string) => void;
  onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void;
}

const Metric = ({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: React.ComponentType<{ className?: string }> }) => (
  <div className="rounded-3xl border border-white/[.07] bg-white/[.035] p-5 backdrop-blur-xl">
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
      <Icon className="h-4 w-4 text-cyan-300" />
      {label}
    </div>
    <div className="mt-4 text-3xl font-semibold text-white">{value}</div>
    <div className="mt-2 text-xs leading-5 text-slate-500">{detail}</div>
  </div>
);

export default function EvidenceDashboardView({ clients, alerts, scans, passports, onNavigateTab, onOpenQuickAction }: EvidenceDashboardViewProps) {
  const activeFindings = alerts.filter((item) => item.status === 'Active').length;
  const completedScans = scans.filter((item) => String(item.status).toLowerCase() === 'completed' || String(item.status).toLowerCase() === 'success').length;
  const observedPassportCount = passports.length;
  const observedClientCount = clients.length;

  return (
    <div className="space-y-7">
      <section className="rounded-3xl border border-white/[.07] bg-white/[.035] p-7 backdrop-blur-2xl md:p-9">
        <div className="max-w-3xl">
          <div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">Evidence-first Command Center</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">Software trust, operated as verified workflows.</h1>
          <p className="mt-4 text-sm leading-6 text-slate-400">This overview reports only records currently returned by the backend. Trust ratings, certifications, investment decisions, and security assertions are not inferred from software names.</p>
        </div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Passports observed" value={String(observedPassportCount)} detail="Current passport records returned by the tenant API." icon={Database} />
          <Metric label="Clients observed" value={String(observedClientCount)} detail="Current client records returned by the tenant API." icon={Users} />
          <Metric label="Active findings" value={String(activeFindings)} detail="Findings currently marked Active by the backend." icon={ShieldAlert} />
          <Metric label="Completed scans" value={String(completedScans)} detail="Scans currently reported as completed/successful." icon={Activity} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <button onClick={() => onOpenQuickAction('register-passport')} className="rounded-3xl border border-white/[.07] bg-white/[.035] p-5 text-left transition hover:border-cyan-300/20 hover:bg-white/[.05]">
          <Workflow className="h-5 w-5 text-cyan-300" />
          <h2 className="mt-4 text-sm font-semibold text-white">Register Passport</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">Open the real passport workflow and create or review software evidence.</p>
          <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-cyan-200">Open workflow <ArrowRight className="h-3.5 w-3.5" /></span>
        </button>
        <button onClick={() => onOpenQuickAction('scan-sbom')} className="rounded-3xl border border-white/[.07] bg-white/[.035] p-5 text-left transition hover:border-cyan-300/20 hover:bg-white/[.05]">
          <Activity className="h-5 w-5 text-cyan-300" />
          <h2 className="mt-4 text-sm font-semibold text-white">Run Scan</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">Open the scanner that dispatches a real backend agent job and polls its evidence.</p>
          <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-cyan-200">Open workflow <ArrowRight className="h-3.5 w-3.5" /></span>
        </button>
        <button onClick={() => onNavigateTab('/security')} className="rounded-3xl border border-white/[.07] bg-white/[.035] p-5 text-left transition hover:border-cyan-300/20 hover:bg-white/[.05]">
          <ShieldAlert className="h-5 w-5 text-cyan-300" />
          <h2 className="mt-4 text-sm font-semibold text-white">Security Evidence</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">Open the protected security workflow rather than relying on dashboard inference.</p>
          <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-cyan-200">Open workflow <ArrowRight className="h-3.5 w-3.5" /></span>
        </button>
      </section>
    </div>
  );
}
