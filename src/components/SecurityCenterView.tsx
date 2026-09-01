import { useMemo, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import type { Client, SoftwarePassport, Vulnerability } from '../types';

interface SecurityCenterViewProps {
  clients: Client[];
  passports: SoftwarePassport[];
}

type VulnerabilityRow = Vulnerability & { clientName: string; passportName: string };

const severityDot: Record<string, string> = {
  Critical: 'bg-[#a4262c]',
  High: 'bg-[#8a5700]',
  Medium: 'bg-[#8a5700]',
  Low: 'bg-[#0f6cbd]',
};

const severityText: Record<string, string> = {
  Critical: 'text-[#a4262c]',
  High: 'text-[#8a5700]',
  Medium: 'text-[#8a5700]',
  Low: 'text-[#0f6cbd]',
};

const statusDot: Record<string, string> = {
  Open: 'bg-[#a4262c]',
  Mitigated: 'bg-[#8a5700]',
  Resolved: 'bg-[#0e700e]',
  Snoozed: 'bg-[#8a8886]',
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
    <section className="space-y-4" id="msp-security-center">
      <div>
        <h1 className="text-[22px] font-semibold text-[#201f1e]">Security posture ledger</h1>
        <p className="mt-1 text-[13px] text-[#605e5c]">Vulnerabilities rendered from software passport evidence available to this authenticated workspace. No finding is inferred from an empty dataset.</p>
      </div>

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Every row below is a vulnerability observation attached to a software passport's evidence record.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Search or filter by severity to narrow the ledger.</li>
            <li>Status and fix guidance come directly from the recorded evidence — an empty table is not proof software is clear.</li>
          </ol>
        </div>
      </details>

      <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div><div className="text-[11px] text-[#605e5c]">Recorded findings</div><div className="text-lg font-semibold text-[#201f1e]">{allVulnerabilities.length}</div></div>
        <div><div className="text-[11px] text-[#605e5c]">Critical unresolved</div><div className="text-lg font-semibold text-[#201f1e]">{critical}</div></div>
        <div><div className="text-[11px] text-[#605e5c]">Mitigated or resolved</div><div className="text-lg font-semibold text-[#201f1e]">{mitigated}</div></div>
        <div><div className="text-[11px] text-[#605e5c]">Unresolved</div><div className="text-lg font-semibold text-[#201f1e]">{unresolved.length}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-56 items-center gap-2 rounded border border-[#c8c6c4] bg-white px-3 focus-within:border-[#0f6cbd] focus-within:ring-1 focus-within:ring-[#0f6cbd]">
          <Search className="h-3.5 w-3.5 text-[#8a8886]" />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search CVE, package, client" aria-label="Search vulnerability evidence" className="min-w-0 flex-1 bg-transparent text-[13px] text-[#201f1e] outline-none placeholder:text-[#8a8886]" />
        </label>
        <label className="flex h-9 items-center gap-2 rounded border border-[#c8c6c4] bg-white px-3">
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} aria-label="Filter vulnerability severity" className="bg-transparent text-[13px] text-[#323130] outline-none">
            <option value="all">All severities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white">
        <div className="flex flex-col gap-0.5 border-b border-[#e1dfdd] px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-[#201f1e]">Recorded vulnerability observations</h2>
          <p className="text-[12px] text-[#8a8886]">{filteredVulnerabilities.length} matching evidence record{filteredVulnerabilities.length === 1 ? '' : 's'}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-4 py-2.5 font-medium">Finding</th>
                <th className="px-4 py-2.5 font-medium">Software / client</th>
                <th className="px-4 py-2.5 font-medium">Severity</th>
                <th className="px-4 py-2.5 font-medium">CVSS</th>
                <th className="px-4 py-2.5 font-medium">Remediation</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredVulnerabilities.map((vulnerability, index) => (
                <tr key={`${vulnerability.id}-${vulnerability.component}-${index}`} className="border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02]">
                  <td className="px-4 py-2.5"><div className="font-mono font-medium text-[#201f1e]">{vulnerability.id}</div><div className="mt-0.5 max-w-xs text-[11px] text-[#8a8886]">{vulnerability.title}</div></td>
                  <td className="px-4 py-2.5"><div className="font-medium text-[#201f1e]">{vulnerability.passportName}</div><div className="mt-0.5 text-[11px] text-[#8a8886]">{vulnerability.clientName} · {vulnerability.component}</div></td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 ${severityText[vulnerability.severity] || 'text-[#605e5c]'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${severityDot[vulnerability.severity] || 'bg-[#8a8886]'}`} />
                      {vulnerability.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[#605e5c]">{vulnerability.cvss ?? 'Not observed'}</td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{vulnerability.fixedVersion ? `Upgrade to ${vulnerability.fixedVersion}+` : 'No fixed version observed'}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[#605e5c]">
                      <span className={`h-1.5 w-1.5 rounded-full ${statusDot[vulnerability.status] || 'bg-[#8a8886]'}`} />
                      {vulnerability.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredVulnerabilities.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center"><ShieldCheck className="mx-auto h-6 w-6 text-[#c8c6c4]" /><p className="mt-2 text-[13px] font-medium text-[#323130]">No recorded vulnerability observations match this view.</p><p className="mt-1 text-[12px] text-[#8a8886]">An empty result is not evidence that software is clear.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
