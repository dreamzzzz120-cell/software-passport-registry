import { useMemo } from 'react';
import { Activity, AlertTriangle, CheckCircle2, FileCheck2, Shield, XCircle } from 'lucide-react';
import type { Client, Scan, SoftwarePassport } from '../types';

interface CoverageViewProps {
  clients: Client[];
  scans: Scan[];
  passports: SoftwarePassport[];
  onNavigateTab: (path: string) => void;
}

type CoverageState = 'Observed' | 'Partial' | 'Not observed';

const stateDot: Record<CoverageState, string> = {
  Observed: 'bg-[#0e700e]',
  Partial: 'bg-[#8a5700]',
  'Not observed': 'bg-[#a4262c]',
};

function hasArrayValue(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function CoverageRow({ label, description, observed, total }: { label: string; description: string; observed: number; total: number }) {
  const state: CoverageState = total === 0 ? 'Not observed' : observed === total ? 'Observed' : observed > 0 ? 'Partial' : 'Not observed';
  const percentage = total === 0 ? 0 : Math.round((observed / total) * 100);
  const Icon = state === 'Observed' ? CheckCircle2 : state === 'Partial' ? AlertTriangle : XCircle;

  return (
    <div className="rounded-md border border-[#e1dfdd] bg-white p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-semibold text-[#201f1e]">{label}</div>
          <div className="mt-0.5 text-[12px] leading-5 text-[#605e5c]">{description}</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-[#323130]">
          <Icon className="h-3.5 w-3.5 text-[#605e5c]" /> {state}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f3f2f1]">
          <div className={`h-full rounded-full ${stateDot[state]}`} style={{ width: `${percentage}%` }} />
        </div>
        <span className="w-10 text-right text-[12px] font-medium text-[#323130]">{percentage}%</span>
      </div>
      <div className="mt-1.5 text-[11px] text-[#8a8886]">{observed} of {total} passport records contain this evidence category.</div>
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
    <div className="space-y-4 pb-8">
      <div className="mb-1">
        <h1 className="text-[22px] font-semibold text-[#201f1e]">Evidence Coverage</h1>
        <p className="mt-1 text-[13px] text-[#605e5c]">Know exactly what has been observed for this tenant's software passports.</p>
      </div>

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Coverage is calculated from records currently loaded from the tenant backend. Missing evidence is shown as missing; it is never treated as a positive security or trust signal.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Each passport record is checked for evidence, SBOM, vulnerability, timeline, version and publisher data.</li>
            <li>Coverage percentages reflect how many records contain each category — nothing is inferred.</li>
            <li>Use the coverage rows below to find where evidence collection is incomplete.</li>
          </ol>
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div className="flex flex-wrap gap-6">
          <MetricItem label="Passport records" value={metrics.total} />
          <MetricItem label="With evidence arrays" value={metrics.evidence} />
          <MetricItem label="Completed scans" value={metrics.completedScans} />
          <MetricItem label="Client records" value={clients.length} />
        </div>
        <div className="text-right">
          <div className="text-[11px] text-[#605e5c]">Evidence-bearing passports</div>
          <div className="text-lg font-semibold text-[#201f1e]">{metrics.overall}% <span className="text-[12px] font-normal text-[#605e5c]">({metrics.evidenceBearing} of {metrics.total})</span></div>
        </div>
      </div>

      <section className="rounded-md border border-[#e1dfdd] bg-white p-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#605e5c]" />
          <div>
            <h2 className="text-[14px] font-semibold text-[#201f1e]">Evidence-domain coverage</h2>
            <p className="mt-0.5 text-[12px] text-[#605e5c]">Coverage is a visibility metric, not a trust score.</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CoverageRow label="Core evidence" description="Passport records contain explicit evidence entries." observed={metrics.evidence} total={metrics.total} />
          <CoverageRow label="SBOM" description="Passport records contain component/SBOM observations." observed={metrics.sbom} total={metrics.total} />
          <CoverageRow label="Vulnerability evidence" description="Passport records contain vulnerability observations." observed={metrics.vulnerabilities} total={metrics.total} />
          <CoverageRow label="Timeline / provenance" description="Passport records contain timeline observations." observed={metrics.timeline} total={metrics.total} />
          <CoverageRow label="Version identity" description="A known software version is present." observed={metrics.version} total={metrics.total} />
          <CoverageRow label="Publisher identity" description="A publisher value other than unknown is present." observed={metrics.publisher} total={metrics.total} />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <button onClick={() => onNavigateTab('/passports')} className="rounded-md border border-[#e1dfdd] bg-white p-4 text-left hover:bg-black/[.02]">
          <FileCheck2 className="h-4 w-4 text-[#605e5c]" />
          <h2 className="mt-2 text-[13px] font-semibold text-[#201f1e]">Inspect evidence</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#605e5c]">Move from coverage percentages to the underlying evidence records.</p>
        </button>
        <button onClick={() => onNavigateTab('/scans')} className="rounded-md border border-[#e1dfdd] bg-white p-4 text-left hover:bg-black/[.02]">
          <Activity className="h-4 w-4 text-[#605e5c]" />
          <h2 className="mt-2 text-[13px] font-semibold text-[#201f1e]">Run a scan</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#605e5c]">Collect additional observations instead of guessing about missing coverage.</p>
        </button>
        <button onClick={() => onNavigateTab('/security')} className="rounded-md border border-[#e1dfdd] bg-white p-4 text-left hover:bg-black/[.02]">
          <Shield className="h-4 w-4 text-[#605e5c]" />
          <h2 className="mt-2 text-[13px] font-semibold text-[#201f1e]">Review security</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#605e5c]">Security assessment stays downstream from observed evidence.</p>
        </button>
      </section>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] text-[#605e5c]">{label}</div>
      <div className="text-lg font-semibold text-[#201f1e]">{value}</div>
    </div>
  );
}
