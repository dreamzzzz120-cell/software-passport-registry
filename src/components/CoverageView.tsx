import React, { useMemo } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Database, FileCheck2, Shield, Users, XCircle } from 'lucide-react';
import type { Client, Scan, SoftwarePassport } from '../types';

interface CoverageViewProps {
  clients: Client[];
  scans: Scan[];
  passports: SoftwarePassport[];
  onNavigateTab: (path: string) => void;
}

type CoverageState = 'Observed' | 'Partial' | 'Not observed';

const stateClasses: Record<CoverageState, string> = {
  Observed: 'border-[#3c3c3c] bg-[#2d2d2d] text-[#89d185]',
  Partial: 'border-[#3c3c3c] bg-[#2d2d2d] text-[#cca700]',
  'Not observed': 'border-[#3c3c3c] bg-[#2d2d2d] text-[#f14c4c]',
};

function hasArrayValue(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function CoverageRow({ label, description, observed, total }: { label: string; description: string; observed: number; total: number }) {
  const state: CoverageState = total === 0 ? 'Not observed' : observed === total ? 'Observed' : observed > 0 ? 'Partial' : 'Not observed';
  const percentage = total === 0 ? 0 : Math.round((observed / total) * 100);
  const Icon = state === 'Observed' ? CheckCircle2 : state === 'Partial' ? AlertTriangle : XCircle;

  return (
    <div className="spr-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-[#d4d4d4]">{label}</div>
          <div className="mt-1 text-xs leading-5 text-[#9d9d9d]">{description}</div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${stateClasses[state]}`}>
          <Icon className="h-3.5 w-3.5" /> {state}
        </span>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#2d2d2d]">
          <div className="h-full rounded-full bg-[#3794ff] transition-all" style={{ width: `${percentage}%` }} />
        </div>
        <span className="w-12 text-right text-xs font-semibold text-[#d4d4d4]">{percentage}%</span>
      </div>
      <div className="mt-2 text-[11px] text-[#6f6f6f]">{observed} of {total} passport records contain this evidence category.</div>
    </div>
  );
}

export default function CoverageView({ clients, scans, passports, onNavigateTab }: CoverageViewProps) {
  const metrics = useMemo(() => {
    const total = passports.length;
    const evidence = passports.filter((p: any) => hasArrayValue(p.evidence)).length;
    const vulnerabilities = passports.filter((p: any) => hasArrayValue(p.vulnerabilities)).length;
    const timeline = passports.filter((p: any) => hasArrayValue(p.timeline)).length;
    const sbom = passports.filter((p: any) => hasArrayValue(p.sbom)).length;
    const version = passports.filter((p: any) => p.version && String(p.version).toLowerCase() !== 'unknown').length;
    const publisher = passports.filter((p: any) => p.publisher && String(p.publisher).toLowerCase() !== 'unknown').length;
    const completedScans = scans.filter((s: any) => ['completed', 'success'].includes(String(s.status || '').toLowerCase())).length;
    const evidenceBearing = passports.filter((p: any) => hasArrayValue(p.evidence) || hasArrayValue(p.sbom) || hasArrayValue(p.timeline)).length;
    const overall = total === 0 ? 0 : Math.round((evidenceBearing / total) * 100);
    return { total, evidence, vulnerabilities, timeline, sbom, version, publisher, completedScans, evidenceBearing, overall };
  }, [passports, scans]);

  return (
    <div className="space-y-7">
      <section className="spr-panel p-7 md:p-9">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#89d185]">01 · Coverage</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#d4d4d4] md:text-4xl">Know exactly what was observed.</h1>
            <p className="mt-4 text-sm leading-6 text-[#9d9d9d]">Coverage is calculated from records currently loaded from the tenant backend. Missing evidence is shown as missing; it is never treated as a positive security or trust signal.</p>
          </div>
          <div className="spr-panel-alt px-6 py-5 text-left lg:min-w-56">
            {/* The count leads, not the percentage. This measures how many
                passports carry any evidence at all, not how complete that
                evidence is - a passport counted here can still be
                "Evidence Incomplete". A headline "100%" derived from 1 of 1
                record reads as completeness and overstates what was observed. */}
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#6f6f6f]">Passports carrying evidence</div>
            <div className="mt-2 text-4xl font-semibold text-[#d4d4d4]">{metrics.evidenceBearing} <span className="text-2xl text-[#9d9d9d]">of {metrics.total}</span></div>
            <div className="mt-1 text-xs text-[#9d9d9d]">Carrying any evidence — not a completeness measure</div>
          </div>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="spr-panel-alt p-4"><Database className="h-4 w-4 text-[#3794ff]" /><div className="mt-3 text-2xl font-semibold text-[#d4d4d4]">{metrics.total}</div><div className="mt-1 text-xs text-[#9d9d9d]">Passport records observed</div></div>
          <div className="spr-panel-alt p-4"><FileCheck2 className="h-4 w-4 text-[#3794ff]" /><div className="mt-3 text-2xl font-semibold text-[#d4d4d4]">{metrics.evidence}</div><div className="mt-1 text-xs text-[#9d9d9d]">With evidence arrays</div></div>
          <div className="spr-panel-alt p-4"><Activity className="h-4 w-4 text-[#3794ff]" /><div className="mt-3 text-2xl font-semibold text-[#d4d4d4]">{metrics.completedScans}</div><div className="mt-1 text-xs text-[#9d9d9d]">Completed scans observed</div></div>
          <div className="spr-panel-alt p-4"><Users className="h-4 w-4 text-[#3794ff]" /><div className="mt-3 text-2xl font-semibold text-[#d4d4d4]">{clients.length}</div><div className="mt-1 text-xs text-[#9d9d9d]">Client records observed</div></div>
        </div>
      </section>

      <section className="spr-panel p-6 md:p-8">
        <div className="flex items-center gap-3"><Shield className="h-5 w-5 text-[#3794ff]" /><div><h2 className="text-lg font-semibold text-[#d4d4d4]">Evidence-domain coverage</h2><p className="mt-1 text-xs text-[#9d9d9d]">Coverage is a visibility metric, not a trust score.</p></div></div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <CoverageRow label="Core evidence" description="Passport records contain explicit evidence entries." observed={metrics.evidence} total={metrics.total} />
          <CoverageRow label="SBOM" description="Passport records contain component/SBOM observations." observed={metrics.sbom} total={metrics.total} />
          <CoverageRow label="Vulnerability evidence" description="Passport records contain vulnerability observations." observed={metrics.vulnerabilities} total={metrics.total} />
          <CoverageRow label="Timeline / provenance" description="Passport records contain timeline observations." observed={metrics.timeline} total={metrics.total} />
          <CoverageRow label="Version identity" description="A known software version is present." observed={metrics.version} total={metrics.total} />
          <CoverageRow label="Publisher identity" description="A publisher value other than unknown is present." observed={metrics.publisher} total={metrics.total} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <button onClick={() => onNavigateTab('/passports')} className="spr-panel p-5 text-left transition hover:bg-[#2d2d2d]"><FileCheck2 className="h-5 w-5 text-[#3794ff]" /><h2 className="mt-4 text-sm font-semibold text-[#d4d4d4]">Inspect evidence</h2><p className="mt-2 text-xs leading-5 text-[#9d9d9d]">Move from coverage percentages to the underlying evidence records.</p></button>
        <button onClick={() => onNavigateTab('/scans')} className="spr-panel p-5 text-left transition hover:bg-[#2d2d2d]"><Activity className="h-5 w-5 text-[#3794ff]" /><h2 className="mt-4 text-sm font-semibold text-[#d4d4d4]">Run a scan</h2><p className="mt-2 text-xs leading-5 text-[#9d9d9d]">Collect additional observations instead of guessing about missing coverage.</p></button>
        <button onClick={() => onNavigateTab('/security')} className="spr-panel p-5 text-left transition hover:bg-[#2d2d2d]"><Shield className="h-5 w-5 text-[#3794ff]" /><h2 className="mt-4 text-sm font-semibold text-[#d4d4d4]">Review security</h2><p className="mt-2 text-xs leading-5 text-[#9d9d9d]">Security assessment stays downstream from observed evidence.</p></button>
      </section>
    </div>
  );
}
