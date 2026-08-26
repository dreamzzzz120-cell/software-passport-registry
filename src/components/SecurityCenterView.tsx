import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Filter, Search, ShieldCheck, ShieldAlert, XCircle } from 'lucide-react';
import type { Client, SoftwarePassport, Vulnerability } from '../types';

interface SecurityCenterViewProps {
  clients: Client[];
  passports: SoftwarePassport[];
}

type VulnerabilityRow = Vulnerability & { clientName: string; passportName: string };

const severityStyles: Record<string, string> = {
  Critical: 'border-rose-300/25 bg-rose-300/10 text-rose-200',
  High: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
  Medium: 'border-yellow-300/25 bg-yellow-300/10 text-yellow-200',
  Low: 'border-cyan-300/20 bg-cyan-300/[.06] text-cyan-200',
};

const statusStyles: Record<string, string> = {
  Open: 'border-rose-300/20 bg-rose-300/[.06] text-rose-200',
  Mitigated: 'border-amber-300/20 bg-amber-300/[.06] text-amber-200',
  Resolved: 'border-emerald-300/20 bg-emerald-300/[.06] text-emerald-200',
  Snoozed: 'border-white/10 bg-white/[.04] text-slate-400',
};

export default function SecurityCenterView({ clients, passports }: SecurityCenterViewProps) {
  const [severityFilter, setSeverityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const allVulnerabilities = useMemo<VulnerabilityRow[]>(() => {
    return passports.flatMap((passport) => {
      const owningClient = clients.find((client) => client.softwareInventory?.some((item) => item.passportId === passport.id));
      return (passport.vulnerabilities || []).map((vulnerability) => ({
        ...vulnerability,
        clientName: owningClient?.name || 'Workspace',
        passportName: passport.name || 'Unnamed software',
      }));
    });
  }, [clients, passports]);

  const filteredVulnerabilities = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allVulnerabilities.filter((vulnerability) => {
      const matchesSearch = !query || [
        vulnerability.id,
        vulnerability.title,
        vulnerability.component,
        vulnerability.clientName,
        vulnerability.passportName,
      ].some((value) => String(value || '').toLowerCase().includes(query));
      return matchesSearch && (severityFilter === 'all' || vulnerability.severity === severityFilter);
    });
  }, [allVulnerabilities, searchQuery, severityFilter]);

  const unresolved = allVulnerabilities.filter((item) => !['Mitigated', 'Resolved'].includes(item.status));
  const critical = unresolved.filter((item) => item.severity === 'Critical').length;
  const mitigated = allVulnerabilities.filter((item) => ['Mitigated', 'Resolved'].includes(item.status)).length;

  return (
    <section className="space-y-6" id="msp-security-center">
      <header className="rounded-[28px] border border-white/10 bg-white/[.035] p-6 backdrop-blur-2xl md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">
              <ShieldCheck className="h-4 w-4" /> Security evidence
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Security posture ledger</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Vulnerabilities are rendered from software passport evidence available to this authenticated workspace. No finding is inferred from an empty dataset.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex min-w-56 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
              <Search className="h-4 w-4 text-slate-600" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search CVE, package, client" aria-label="Search vulnerability evidence" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-slate-600" />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-slate-400">
              <Filter className="h-4 w-4 text-slate-600" />
              <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} aria-label="Filter vulnerability severity" className="bg-transparent font-semibold text-slate-200 outline-none">
                <option value="all">All severities</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>
          </div>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={<ShieldAlert />} label="Recorded findings" value={allVulnerabilities.length} />
          <Metric icon={<AlertTriangle />} label="Critical unresolved" value={critical} tone="rose" />
          <Metric icon={<ShieldCheck />} label="Mitigated or resolved" value={mitigated} tone="emerald" />
          <Metric icon={<XCircle />} label="Unresolved" value={unresolved.length} tone="amber" />
        </div>
      </header>

      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[.025] backdrop-blur-xl">
        <div className="flex flex-col gap-1 border-b border-white/[.07] px-5 py-4 md:px-6">
          <h2 className="text-sm font-semibold text-white">Recorded vulnerability observations</h2>
          <p className="text-xs text-slate-500">{filteredVulnerabilities.length} matching evidence record{filteredVulnerabilities.length === 1 ? '' : 's'}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/[.07] bg-black/15 text-[10px] font-bold uppercase tracking-[.14em] text-slate-600">
                <th className="px-5 py-3">Finding</th>
                <th className="px-5 py-3">Software / client</th>
                <th className="px-5 py-3">Severity</th>
                <th className="px-5 py-3">CVSS</th>
                <th className="px-5 py-3">Remediation</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.06]">
              {filteredVulnerabilities.map((vulnerability, index) => (
                <tr key={`${vulnerability.id}-${vulnerability.component}-${index}`} className="transition-colors hover:bg-white/[.035]">
                  <td className="px-5 py-4"><div className="font-mono font-semibold text-cyan-200">{vulnerability.id}</div><div className="mt-1 max-w-xs text-[11px] text-slate-500">{vulnerability.title}</div></td>
                  <td className="px-5 py-4"><div className="font-semibold text-slate-200">{vulnerability.passportName}</div><div className="mt-1 text-[11px] text-slate-500">{vulnerability.clientName} · {vulnerability.component}</div></td>
                  <td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${severityStyles[vulnerability.severity] || severityStyles.Low}`}>{vulnerability.severity}</span></td>
                  <td className="px-5 py-4 font-mono text-slate-300">{vulnerability.cvss ?? 'Not observed'}</td>
                  <td className="px-5 py-4 text-slate-400">{vulnerability.fixedVersion ? `Upgrade to ${vulnerability.fixedVersion}+` : 'No fixed version observed'}</td>
                  <td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusStyles[vulnerability.status] || statusStyles.Open}`}>{vulnerability.status}</span></td>
                </tr>
              ))}
              {filteredVulnerabilities.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-14 text-center"><ShieldCheck className="mx-auto h-9 w-9 text-slate-700" /><p className="mt-3 text-sm font-semibold text-slate-300">No recorded vulnerability observations match this view.</p><p className="mt-1 text-xs text-slate-600">An empty result is not evidence that software is clear.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function Metric({ icon, label, value, tone = 'cyan' }: { icon: ReactNode; label: string; value: number; tone?: 'cyan' | 'rose' | 'emerald' | 'amber' }) {
  const tones = {
    cyan: 'border-cyan-300/15 bg-cyan-300/[.05] text-cyan-200',
    rose: 'border-rose-300/15 bg-rose-300/[.05] text-rose-200',
    emerald: 'border-emerald-300/15 bg-emerald-300/[.05] text-emerald-200',
    amber: 'border-amber-300/15 bg-amber-300/[.05] text-amber-200',
  };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-500"><span className="h-4 w-4">{icon}</span>{label}</div><div className="mt-3 text-2xl font-semibold text-white">{value}</div></div>;
}
