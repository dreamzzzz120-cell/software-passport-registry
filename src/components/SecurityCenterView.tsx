import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Filter, Search, ShieldCheck, ShieldAlert, XCircle } from 'lucide-react';
import type { Client, SoftwarePassport, Vulnerability } from '../types';

interface SecurityCenterViewProps {
  clients: Client[];
  passports: SoftwarePassport[];
}

type VulnerabilityRow = Vulnerability & { clientName: string; passportName: string };

const severityStyles: Record<string, string> = {
  Critical: 'border-[#f14c4c]/40 bg-[#f14c4c]/15 text-[#f14c4c]',
  High: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
  Medium: 'border-yellow-300/25 bg-yellow-300/10 text-yellow-200',
  Low: 'border-[#3794ff]/40 bg-[#094771] text-[#3794ff]',
};

const statusStyles: Record<string, string> = {
  Open: 'border-[#f14c4c]/40 bg-[#f14c4c]/15/[.06] text-[#f14c4c]',
  Mitigated: 'border-amber-300/20 bg-amber-300/[.06] text-amber-200',
  Resolved: 'border-[#89d185]/40 bg-[#89d185]/15 text-[#89d185]',
  Snoozed: 'border-[#3c3c3c] bg-[#252526] text-[#9d9d9d]',
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
      <header className="rounded-[28px] border border-[#3c3c3c] bg-[#252526] p-6 md:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#3794ff]">
              <ShieldCheck className="h-4 w-4" /> Security evidence
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#d4d4d4]">Security posture ledger</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9d9d9d]">
              Vulnerabilities are rendered from software passport evidence available to this authenticated workspace. No finding is inferred from an empty dataset.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex min-w-56 items-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#181818] px-3 py-2.5">
              <Search className="h-4 w-4 text-[#6f6f6f]" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search CVE, package, client" aria-label="Search vulnerability evidence" className="min-w-0 flex-1 bg-transparent text-xs text-[#d4d4d4] outline-none placeholder:text-[#6f6f6f]" />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#181818] px-3 py-2.5 text-xs text-[#9d9d9d]">
              <Filter className="h-4 w-4 text-[#6f6f6f]" />
              <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} aria-label="Filter vulnerability severity" className="bg-transparent font-semibold text-[#d4d4d4] outline-none">
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

      <section className="overflow-hidden rounded-[28px] border border-[#3c3c3c] bg-[#252526] ">
        <div className="flex flex-col gap-1 border-b border-[#3c3c3c] px-5 py-4 md:px-6">
          <h2 className="text-sm font-semibold text-[#d4d4d4]">Recorded vulnerability observations</h2>
          <p className="text-xs text-[#9d9d9d]">{filteredVulnerabilities.length} matching evidence record{filteredVulnerabilities.length === 1 ? '' : 's'}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#3c3c3c] bg-black/15 text-[10px] font-bold uppercase tracking-[.14em] text-[#6f6f6f]">
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
                <tr key={`${vulnerability.id}-${vulnerability.component}-${index}`} className="transition-colors hover:bg-[#252526]">
                  <td className="px-5 py-4"><div className="font-mono font-semibold text-[#3794ff]">{vulnerability.id}</div><div className="mt-1 max-w-xs text-[11px] text-[#9d9d9d]">{vulnerability.title}</div></td>
                  <td className="px-5 py-4"><div className="font-semibold text-[#d4d4d4]">{vulnerability.passportName}</div><div className="mt-1 text-[11px] text-[#9d9d9d]">{vulnerability.clientName} · {vulnerability.component}</div></td>
                  <td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${severityStyles[vulnerability.severity] || severityStyles.Low}`}>{vulnerability.severity}</span></td>
                  <td className="px-5 py-4 font-mono text-[#d4d4d4]">{vulnerability.cvss ?? 'Not observed'}</td>
                  <td className="px-5 py-4 text-[#9d9d9d]">{vulnerability.fixedVersion ? `Upgrade to ${vulnerability.fixedVersion}+` : 'No fixed version observed'}</td>
                  <td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusStyles[vulnerability.status] || statusStyles.Open}`}>{vulnerability.status}</span></td>
                </tr>
              ))}
              {filteredVulnerabilities.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-14 text-center"><ShieldCheck className="mx-auto h-9 w-9 text-[#6f6f6f]" /><p className="mt-3 text-sm font-semibold text-[#d4d4d4]">No recorded vulnerability observations match this view.</p><p className="mt-1 text-xs text-[#6f6f6f]">An empty result is not evidence that software is clear.</p></td></tr>
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
    cyan: 'border-[#3794ff]/40 bg-[#094771] text-[#3794ff]',
    rose: 'border-[#f14c4c]/40 bg-[#f14c4c]/15/[.05] text-[#f14c4c]',
    emerald: 'border-[#89d185]/40 bg-[#89d185]/15 text-[#89d185]',
    amber: 'border-amber-300/15 bg-amber-300/[.05] text-amber-200',
  };
  return <div className={`rounded-md border p-4 ${tones[tone]}`}><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#9d9d9d]"><span className="h-4 w-4">{icon}</span>{label}</div><div className="mt-3 text-2xl font-semibold text-[#d4d4d4]">{value}</div></div>;
}
