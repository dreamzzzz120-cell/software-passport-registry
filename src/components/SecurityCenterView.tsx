/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle, Play, CheckCircle, Search, Filter } from 'lucide-react';
import { Client, SoftwarePassport } from '../types';

interface SecurityCenterViewProps {
  clients: Client[];
  passports: SoftwarePassport[];
}

export default function SecurityCenterView({ clients, passports }: SecurityCenterViewProps) {
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Collect all vulnerabilities from all passports across all clients
  const allVulnerabilities: {
    id: string;
    title: string;
    severity: string;
    cvss: number;
    component: string;
    fixedVersion: string;
    status: string;
    description: string;
    clientName: string;
  }[] = [];

  clients.forEach(client => {
    client.softwareInventory.forEach(item => {
      const pass = passports.find(p => p.id === item.passportId);
      if (pass) {
        pass.vulnerabilities.forEach(vul => {
          // Check if already exists to avoid duplicates, or display per-client (more accurate for MSP)
          allVulnerabilities.push({
            ...vul,
            clientName: client.name
          });
        });
      }
    });
  });

  const filteredVuls = allVulnerabilities.filter(v => {
    const matchesSearch = v.id.toLowerCase().includes(searchQuery.toLowerCase()) || v.title.toLowerCase().includes(searchQuery.toLowerCase()) || v.component.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSeverity = severityFilter === 'all' || v.severity === severityFilter;
    return matchesSearch && matchesSeverity;
  });

  return (
    <div className="space-y-6" id="msp-security-center">
      {/* Top Welcome Title */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900">Cybersecurity Operations Center</h1>
          <p className="text-xs text-slate-500 font-sans mt-1">
            Aggregated CVE threat intel, runc escapes, library overrides, and critical risk logs across all tenants.
          </p>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter CVE / component..."
            className="bg-white border border-slate-200 rounded-lg text-xs px-3 py-1.5 focus:outline-none focus:border-indigo-500 font-sans"
          />

          <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
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

      {/* Aggregate Posture Panels */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <p className="text-[9px] text-slate-400 font-mono font-bold uppercase">Total Aggregated Vulnerabilities</p>
          <h3 className="text-2xl font-bold font-mono text-slate-800 mt-1">{allVulnerabilities.length}</h3>
          <span className="text-[8px] text-rose-500 font-mono font-bold">Requires Action</span>
        </div>
        <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <p className="text-[9px] text-slate-400 font-mono font-bold uppercase">Critical Exploits Active</p>
          <h3 className="text-2xl font-bold font-mono text-rose-600 mt-1">
            {allVulnerabilities.filter(v => v.severity === 'Critical').length}
          </h3>
          <span className="text-[8px] text-rose-600 font-mono font-bold animate-pulse">Immediate patch mandated</span>
        </div>
        <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <p className="text-[9px] text-slate-400 font-mono font-bold uppercase">High Risks Mitigated</p>
          <h3 className="text-2xl font-bold font-mono text-emerald-600 mt-1">
            {allVulnerabilities.filter(v => v.status === 'Mitigated' || v.status === 'Resolved').length}
          </h3>
          <span className="text-[8px] text-emerald-600 font-mono font-bold">SLA Targets Met</span>
        </div>
        <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-sm text-center">
          <p className="text-[9px] text-slate-400 font-mono font-bold uppercase">Mean Time to Remediate</p>
          <h3 className="text-2xl font-bold font-mono text-slate-800 mt-1">4.2h</h3>
          <span className="text-[8px] text-slate-400 font-mono">Industry avg: 14 days</span>
        </div>
      </div>

      {/* Security Findings log */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 font-display">Cyberthreat Posture Ledger</h3>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">Aggregated software library and container CVE exposures.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-mono text-slate-400 font-bold uppercase">
                <th className="px-5 py-3">CVE ID</th>
                <th className="px-5 py-3">Impacted Tenant Client</th>
                <th className="px-5 py-3">Involved Package</th>
                <th className="px-5 py-3">Severity</th>
                <th className="px-5 py-3">CVSS Rating</th>
                <th className="px-5 py-3">Remediation Override</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVuls.map((vul, i) => (
                <tr key={i} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3.5 font-bold text-indigo-600 font-mono">{vul.id}</td>
                  <td className="px-5 py-3.5 font-semibold text-slate-700">{vul.clientName}</td>
                  <td className="px-5 py-3.5 font-mono text-slate-600">{vul.component}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                      vul.severity === 'Critical' ? 'bg-rose-100 text-rose-800' :
                      vul.severity === 'High' ? 'bg-amber-100 text-amber-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {vul.severity}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 font-bold font-mono text-slate-800">{vul.cvss}</td>
                  <td className="px-5 py-3.5 font-mono text-slate-500">Upgrade to v{vul.fixedVersion}+</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                      vul.status === 'Open' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                      'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      {vul.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredVuls.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                    <span className="text-xs font-bold text-slate-700">All managed environments are clear of threat exposures.</span>
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
