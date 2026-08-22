/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ShieldCheck, Filter } from 'lucide-react';
import { Client, SoftwarePassport } from '../types';

interface SecurityCenterViewProps {
  clients: Client[];
  passports: SoftwarePassport[];
}

type VulnerabilityRow = {
  id: string;
  title: string;
  severity: string;
  cvss: number;
  component: string;
  fixedVersion: string;
  status: string;
  description: string;
  clientName: string;
};

export default function SecurityCenterView({ clients, passports }: SecurityCenterViewProps) {
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const allVulnerabilities: VulnerabilityRow[] = [];
  clients.forEach((client) => {
    client.softwareInventory.forEach((item) => {
      const pass = passports.find((passport) => passport.id === item.passportId);
      if (!pass) return;
      pass.vulnerabilities.forEach((vulnerability) => {
        allVulnerabilities.push({ ...vulnerability, clientName: client.name });
      });
    });
  });

  const filteredVuls = allVulnerabilities.filter((vulnerability) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = vulnerability.id.toLowerCase().includes(query)
      || vulnerability.title.toLowerCase().includes(query)
      || vulnerability.component.toLowerCase().includes(query);
    const matchesSeverity = severityFilter === 'all' || vulnerability.severity === severityFilter;
    return matchesSearch && matchesSeverity;
  });

  const criticalCount = allVulnerabilities.filter((vulnerability) => vulnerability.severity === 'Critical' && !['Mitigated', 'Resolved'].includes(vulnerability.status)).length;
  const mitigatedCount = allVulnerabilities.filter((vulnerability) => ['Mitigated', 'Resolved'].includes(vulnerability.status)).length;
  const unresolvedCount = allVulnerabilities.filter((vulnerability) => !['Mitigated', 'Resolved'].includes(vulnerability.status)).length;

  return (
    <div className="space-y-6" id="msp-security-center">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900">Cybersecurity Operations Center</h1>
          <p className="text-xs text-slate-500 font-sans mt-1">
            Vulnerabilities derived only from software passport evidence available to the authenticated workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter CVE / component..."
            aria-label="Filter vulnerabilities"
            className="bg-white border border-slate-200 rounded-lg text-xs px-3 py-1.5 focus:outline-none focus:border-indigo-500 font-sans"
          />
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value)}
              aria-label="Filter vulnerability severity"
              className="bg-transparent focus:outline-none font-semibold cursor-pointer text-slate-800"
            >
              <option value="all">All Severities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Metric label="Recorded vulnerabilities" value={allVulnerabilities.length} />
        <Metric label="Critical unresolved" value={criticalCount} />
        <Metric label="Recorded mitigated" value={mitigatedCount} />
        <Metric label="Unresolved" value={unresolvedCount} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 font-display">Cyberthreat Posture Ledger</h3>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">Recorded software vulnerability observations and their stored status.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-mono text-slate-400 font-bold uppercase">
                <th className="px-5 py-3">CVE ID</th>
                <th className="px-5 py-3">Impacted Client</th>
                <th className="px-5 py-3">Package</th>
                <th className="px-5 py-3">Severity</th>
                <th className="px-5 py-3">CVSS</th>
                <th className="px-5 py-3">Remediation</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVuls.map((vulnerability, index) => (
                <tr key={`${vulnerability.id}-${index}`} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3.5 font-bold text-indigo-600 font-mono">{vulnerability.id}</td>
                  <td className="px-5 py-3.5 font-semibold text-slate-700">{vulnerability.clientName}</td>
                  <td className="px-5 py-3.5 font-mono text-slate-600">{vulnerability.component}</td>
                  <td className="px-5 py-3.5"><span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-700">{vulnerability.severity}</span></td>
                  <td className="px-5 py-3.5 font-bold font-mono text-slate-800">{vulnerability.cvss}</td>
                  <td className="px-5 py-3.5 font-mono text-slate-500">{vulnerability.fixedVersion ? `Upgrade to v${vulnerability.fixedVersion}+` : 'No stored fixed version'}</td>
                  <td className="px-5 py-3.5"><span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-50 text-slate-700 border border-slate-200">{vulnerability.status}</span></td>
                </tr>
              ))}
              {filteredVuls.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <span className="text-xs font-bold text-slate-700 block">No recorded vulnerability observations match this view.</span>
                    <span className="text-xs text-slate-400 block mt-1">An empty dataset is not evidence that managed environments are clear.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-sm text-center"><p className="text-[9px] text-slate-400 font-mono font-bold uppercase">{label}</p><h3 className="text-2xl font-bold font-mono text-slate-800 mt-1">{value}</h3></div>;
}
