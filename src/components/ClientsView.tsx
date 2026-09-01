/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { fuzzyMatch, filterData } from '../utils/filter';
import {
  Building2,
  ShieldCheck,
  ShieldAlert,
  Users,
  Award,
  Lock,
  Globe,
  FileCheck,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  Download,
  X
} from 'lucide-react';
import { Client, SoftwarePassport } from '../types';
import { generateClientCompliancePDF } from '../utils/pdfGenerator';

// Compact risk-tier presentation tokens, shared across the row list, drawer
// badge, and status dot so the mapping only lives in one place.
const RISK_STYLES: Record<string, { dot: string; text: string }> = {
  Safe: { dot: 'bg-[#0e700e]', text: 'text-[#0e700e]' },
  Medium: { dot: 'bg-[#8a5700]', text: 'text-[#8a5700]' },
  High: { dot: 'bg-[#a4262c]', text: 'text-[#a4262c]' }
};
function riskStyle(level: string) {
  return RISK_STYLES[level] || { dot: 'bg-[#605e5c]', text: 'text-[#605e5c]' };
}

const COMPLIANCE_STYLES: Record<string, { dot: string; text: string }> = {
  Compliant: { dot: 'bg-[#0e700e]', text: 'text-[#0e700e]' },
  'In Progress': { dot: 'bg-[#8a5700]', text: 'text-[#8a5700]' }
};
function complianceStyle(status: string) {
  return COMPLIANCE_STYLES[status] || { dot: 'bg-[#a4262c]', text: 'text-[#a4262c]' };
}

interface ClientsViewProps {
  clients: Client[];
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
  passports: SoftwarePassport[];
  onNavigateTab: (tab: string, itemId?: string) => void;
  searchQuery: string;
}

export default function ClientsView({
  clients,
  selectedClientId,
  setSelectedClientId,
  passports,
  onNavigateTab,
  searchQuery
}: ClientsViewProps) {
  const [industryFilter, setIndustryFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'inventory' | 'security' | 'compliance' | 'team'>('overview');

  // Identify all unique client industries for dynamic filters
  const industries = useMemo(() => {
    const list = clients.map(c => c.industry);
    return Array.from(new Set(list));
  }, [clients]);

  // Extract the current selected client
  const client = useMemo(() => {
    return clients.find(c => c.id === selectedClientId) || null;
  }, [clients, selectedClientId]);

  const clientPassports = useMemo(() => {
    if (!client) return [];
    const passportIds = new Set(client.softwareInventory.map(item => item.passportId));
    return passports.filter(passport => passportIds.has(passport.id));
  }, [client, passports]);

  const securityScores = clientPassports
    .map(passport => passport.securityScore)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));

  // Filter clients list based on search and industry/risk selectors
  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const matchesSearch = searchQuery
        ? fuzzyMatch(searchQuery, c.name) ||
          fuzzyMatch(searchQuery, c.domain) ||
          fuzzyMatch(searchQuery, c.industry)
        : true;
      const matchesIndustry = industryFilter === 'all' || c.industry === industryFilter;
      const matchesRisk = riskFilter === 'all' || c.riskLevel === riskFilter;

      return matchesSearch && matchesIndustry && matchesRisk;
    });
  }, [clients, searchQuery, industryFilter, riskFilter]);

  // Handle client compliance data CSV export
  const handleExportCSV = () => {
    const headers = ['Client Name', 'Industry', 'Trust Score', 'Passports Active', 'Compliance Progress', 'Risk Level', 'Joined Date'];
    const rows = filteredClients.map(c => [
      c.name,
      c.industry,
      c.trustScore,
      c.passportCount,
      c.complianceProgress,
      c.riskLevel,
      c.joinedDate
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,'
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `tenant_compliance_audit_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const safeCount = clients.filter(c => c.riskLevel === 'Safe').length;
  const mediumCount = clients.filter(c => c.riskLevel === 'Medium').length;
  const highCount = clients.filter(c => c.riskLevel === 'High').length;
  const criticalAlertsTotal = clients.reduce((sum, c) => sum + (c.criticalRisksCount || 0), 0);

  return (
    <div id="msp-clients-index">
      {/* Page Header */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e]">Client Tenant Directory</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">
            Browse and manage software trust state across {clients.length} active workspace tenants.
          </p>
        </div>
        <button
          onClick={handleExportCSV}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]"
          id="export-tenants-csv-btn"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Export Directory</span>
        </button>
      </div>

      {/* About this page */}
      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Every workspace tenant registered under this MSP, with its trust score, passport inventory, and compliance state.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Filter or search the directory below.</li>
            <li>Click a row to open the tenant workspace drawer.</li>
            <li>Use Export Directory to download the filtered list as CSV.</li>
          </ol>
        </div>
      </details>

      {/* Summary strip */}
      <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div>
          <div className="text-[11px] text-[#605e5c]">Total Tenants</div>
          <div className="text-lg font-semibold text-[#201f1e]">{clients.length}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">Safe</div>
          <div className="text-lg font-semibold text-[#0e700e]">{safeCount}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">Medium Risk</div>
          <div className="text-lg font-semibold text-[#8a5700]">{mediumCount}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">High Risk</div>
          <div className="text-lg font-semibold text-[#a4262c]">{highCount}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">Critical Alerts</div>
          <div className="text-lg font-semibold text-[#201f1e]">{criticalAlertsTotal}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-[13px] text-[#605e5c]">Industry</label>
          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
            className="h-9 rounded border border-[#c8c6c4] bg-white px-2 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
          >
            <option value="all">All Industries</option>
            {industries.map(ind => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-[13px] text-[#605e5c]">Risk Level</label>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="h-9 rounded border border-[#c8c6c4] bg-white px-2 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
          >
            <option value="all">All Tiers</option>
            <option value="Safe">Safe</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </div>
      </div>

      {/* Client Directory Table */}
      <div className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-3 py-2.5 font-medium">Client</th>
                <th className="px-3 py-2.5 font-medium">Industry</th>
                <th className="px-3 py-2.5 font-medium">Risk</th>
                <th className="px-3 py-2.5 font-medium">Trust Score</th>
                <th className="px-3 py-2.5 font-medium">Passports</th>
                <th className="px-3 py-2.5 font-medium">Compliance</th>
                <th className="px-3 py-2.5 font-medium">Joined</th>
                <th className="px-3 py-2.5 font-medium">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map(c => {
                const hasCriticalRisks = c.criticalRisksCount > 0;
                const isDrawerActive = selectedClientId === c.id;
                const rs = riskStyle(c.riskLevel);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedClientId(c.id)}
                    className={`cursor-pointer border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02] ${isDrawerActive ? 'bg-[#eff6fc]' : ''}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-[11px] font-semibold ${c.avatarColor}`}>
                          {c.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-[#201f1e]">{c.name}</div>
                          <div className="flex items-center gap-1 truncate text-[11px] text-[#8a8886]">
                            <Globe className="h-3 w-3 shrink-0" />
                            <span className="truncate">{c.domain}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{c.industry}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${rs.dot}`} />
                        <span className={rs.text}>{c.riskLevel}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[#201f1e]">{c.trustScore}<span className="text-[#8a8886]">/100</span></td>
                    <td className="px-3 py-2.5 text-[#201f1e]">{c.passportCount}</td>
                    <td className="px-3 py-2.5 text-[#201f1e]">{c.complianceProgress}%</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{c.joinedDate}</td>
                    <td className="px-3 py-2.5">
                      {hasCriticalRisks ? (
                        <span className="inline-flex items-center gap-1 font-medium text-[#a4262c]">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {c.criticalRisksCount}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[#8a8886]">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          None
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredClients.length === 0 && (
          <div className="p-12 text-center">
            <Building2 className="mx-auto mb-3 h-8 w-8 text-[#c8c6c4]" />
            <h3 className="text-[13px] font-medium text-[#323130]">No client workspaces found</h3>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-[#8a8886]">
              Adjust your search keywords or industry filters and try again.
            </p>
          </div>
        )}
      </div>

      {/* Slide-out Drawer Panel */}
      <AnimatePresence>
        {selectedClientId !== 'global' && client && (
          <>
            {/* Backdrop Overlay */}
            <motion.div
              key="clients-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedClientId('global')}
              className="fixed inset-0 z-40 cursor-pointer bg-black"
            />

            {/* Sliding Drawer Container */}
            <motion.div
              key="clients-drawer-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 170 }}
              className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-3xl flex-col overflow-y-auto border-l border-[#e1dfdd] bg-white p-5"
            >
              {/* Drawer Top Navigation & Actions */}
              <div className="flex shrink-0 items-center justify-between border-b border-[#e1dfdd] pb-3">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-9 w-9 items-center justify-center rounded text-[13px] font-semibold ${client.avatarColor}`}>
                    {client.name.charAt(0)}
                  </div>
                  <div>
                    <span className="text-[11px] uppercase tracking-wide text-[#8a8886]">
                      Active tenant
                    </span>
                    <h2 className="text-[16px] font-semibold leading-tight text-[#201f1e]">
                      {client.name}
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => generateClientCompliancePDF(client)}
                    className="flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] text-[#323130] hover:bg-black/[.03]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Compliance PDF</span>
                  </button>
                  <button
                    onClick={() => setSelectedClientId('global')}
                    className="flex h-8 w-8 items-center justify-center rounded border border-[#c8c6c4] text-[#605e5c] hover:bg-black/[.03]"
                    title="Close Drawer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Badges and summary bar */}
              <div className="mt-3 flex shrink-0 flex-wrap gap-2 text-[11px]">
                <span className="rounded-md border border-[#e1dfdd] bg-[#f3f2f1] px-2.5 py-1 font-medium text-[#323130]">
                  Tier: {client.subscriptionTier}
                </span>
                <span className="rounded-md border border-[#e1dfdd] bg-[#f3f2f1] px-2.5 py-1 font-medium text-[#323130]">
                  Domain: {client.domain}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-md border border-[#e1dfdd] bg-[#f3f2f1] px-2.5 py-1 font-medium ${riskStyle(client.riskLevel).text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${riskStyle(client.riskLevel).dot}`} />
                  Risk: {client.riskLevel}
                </span>
              </div>

              {/* Drawer Tabs Header */}
              <div className="mt-3 flex shrink-0 gap-1 overflow-x-auto border-b border-[#e1dfdd] text-[13px] select-none">
                {[
                  { id: 'overview', label: 'Trust Coordinates', icon: Award },
                  { id: 'inventory', label: 'SBOM Inventory', icon: FileCheck },
                  { id: 'security', label: 'Security Center', icon: ShieldAlert },
                  { id: 'compliance', label: 'Framework Matrices', icon: Lock },
                  { id: 'team', label: 'Stakeholders', icon: Users }
                ].map(tb => {
                  const Icon = tb.icon;
                  const isSel = workspaceTab === tb.id;
                  return (
                    <button
                      key={tb.id}
                      type="button"
                      onClick={() => setWorkspaceTab(tb.id as any)}
                      className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-medium transition-colors ${
                        isSel
                          ? 'border-[#0f6cbd] text-[#0f6cbd]'
                          : 'border-transparent text-[#605e5c] hover:text-[#201f1e]'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{tb.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Drawer Tabs Body content */}
              <div className="flex-1 space-y-4 overflow-y-auto pt-4 pb-2">

                {/* 1. Trust Coordinates Tab */}
                {workspaceTab === 'overview' && (
                  <div className="space-y-4">
                    {/* Trust Scores strip */}
                    <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
                      <h3 className="mb-3 text-[13px] font-semibold text-[#323130]">Core Trust Coordinates</h3>
                      <div className="flex flex-wrap gap-6">
                        <div>
                          <p className="text-[11px] text-[#605e5c]">Overall score</p>
                          <p className="mt-0.5 text-lg font-semibold text-[#201f1e]">{client.trustScore}</p>
                          <span className="text-[11px] text-[#8a8886]">Observed client record</span>
                        </div>
                        <div>
                          <p className="text-[11px] text-[#605e5c]">Security score</p>
                          <p className="mt-0.5 text-lg font-semibold text-[#201f1e]">
                            {securityScores.length > 0 ? Math.round(securityScores.reduce((sum, score) => sum + score, 0) / securityScores.length) : 'Not verified'}
                          </p>
                          <span className="text-[11px] text-[#8a8886]">Passport-derived</span>
                        </div>
                        <div>
                          <p className="text-[11px] text-[#605e5c]">Compliance score</p>
                          <p className="mt-0.5 text-lg font-semibold text-[#201f1e]">{client.complianceProgress}%</p>
                          <span className="text-[11px] text-[#8a8886]">Client record</span>
                        </div>
                        <div>
                          <p className="text-[11px] text-[#605e5c]">Supplier reputation</p>
                          <p className="mt-0.5 text-lg font-semibold text-[#201f1e]">Not verified</p>
                          <span className="text-[11px] text-[#8a8886]">No vendor score observed</span>
                        </div>
                      </div>
                    </div>

                    {/* Company Overview Details Card */}
                    <div className="grid grid-cols-1 gap-4 rounded-md border border-[#e1dfdd] bg-white p-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <h3 className="text-[13px] font-semibold text-[#323130]">Tenant Profile Overview</h3>
                        <div className="space-y-1.5 text-[13px]">
                          <div className="flex justify-between border-b border-[#f3f2f1] pb-1.5">
                            <span className="text-[11px] text-[#8a8886]">Organization Name</span>
                            <span className="font-medium text-[#323130]">{client.name}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#f3f2f1] pb-1.5">
                            <span className="text-[11px] text-[#8a8886]">Domain</span>
                            <span className="font-medium text-[#323130]">{client.domain}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#f3f2f1] pb-1.5">
                            <span className="text-[11px] text-[#8a8886]">Industry</span>
                            <span className="font-medium text-[#323130]">{client.industry}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h3 className="text-[13px] font-semibold text-[#323130]">SLA & Scope Details</h3>
                        <div className="space-y-1.5 text-[13px]">
                          <div className="flex justify-between border-b border-[#f3f2f1] pb-1.5">
                            <span className="text-[11px] text-[#8a8886]">Verified Registry</span>
                            <span className="font-medium text-[#323130]">tenant-{client.id}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#f3f2f1] pb-1.5">
                            <span className="text-[11px] text-[#8a8886]">Joined Date</span>
                            <span className="font-medium text-[#323130]">{client.joinedDate}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#f3f2f1] pb-1.5">
                            <span className="text-[11px] text-[#8a8886]">Compliance Target</span>
                            <span className="font-medium text-[#0f6cbd]">{client.complianceStatus.length ? client.complianceStatus.map((item) => item.code).join(', ') : 'Not observed'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. SBOM Inventory Tab */}
                {workspaceTab === 'inventory' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[13px] font-semibold text-[#323130]">Registered Client Software Passports</h3>
                      <span className="text-[11px] text-[#8a8886]">Count: {client.passportCount}</span>
                    </div>

                    {client.softwareInventory.length === 0 && (
                      <div className="rounded-md border border-dashed border-[#e1dfdd] px-5 py-10 text-center text-[13px] text-[#8a8886]">No software passports registered for this client yet.</div>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {passports.filter(p => {
                        const clientPassportIds = new Set(client.softwareInventory.map(item => item.passportId));
                        return clientPassportIds.has(p.id);
                      }).map(p => (
                        <div
                          key={p.id}
                          onClick={() => onNavigateTab('passports', p.id)}
                          className="cursor-pointer space-y-2 rounded-md border border-[#e1dfdd] bg-white p-3 hover:border-[#0f6cbd]"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="text-[13px] font-medium text-[#201f1e]">{p.name}</h4>
                              <p className="text-[11px] text-[#8a8886]">Version: {p.version || 'Not observed'}</p>
                            </div>
                            <span className="rounded border border-[#e1dfdd] bg-[#eff6fc] px-2 py-0.5 text-[11px] font-medium text-[#0f6cbd]">
                              {p.sbom.length} Dependencies
                            </span>
                          </div>

                          <div className="flex items-center justify-between border-t border-[#f3f2f1] pt-2 text-[11px] text-[#605e5c]">
                            <span>Compliance: {p.complianceScore}%</span>
                            <span className="flex items-center gap-0.5 font-medium text-[#0f6cbd]">
                              Open Passport <ChevronRight className="h-3 w-3" />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Security Center Tab */}
                {workspaceTab === 'security' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[13px] font-semibold text-[#323130]">Active Vulnerability Footprint</h3>
                      <button
                        onClick={() => onNavigateTab('alerts')}
                        className="text-[13px] font-medium text-[#0f6cbd] hover:underline"
                      >
                        Launch Threat Mitigator
                      </button>
                    </div>

                    <div className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                              <th className="px-3 py-2.5 font-medium">CVE ID</th>
                              <th className="px-3 py-2.5 font-medium">Component</th>
                              <th className="px-3 py-2.5 font-medium">Severity</th>
                              <th className="px-3 py-2.5 font-medium">CVSS</th>
                              <th className="px-3 py-2.5 font-medium">Status</th>
                              <th className="px-3 py-2.5 font-medium">Threat Summary</th>
                            </tr>
                          </thead>
                          <tbody className="text-[13px] text-[#323130]">
                            {clientPassports.flatMap(passport => (passport.vulnerabilities || []).map(vulnerability => ({ passport, vulnerability }))).map(({ passport, vulnerability }, index) => (
                              <tr key={`${passport.id}-${vulnerability.id}-${index}`} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                                <td className="px-3 py-2.5 font-medium text-[#0f6cbd]">{vulnerability.id}</td>
                                <td className="px-3 py-2.5">{vulnerability.component}</td>
                                <td className="px-3 py-2.5"><span className="rounded-full border border-[#e1dfdd] bg-[#f3f2f1] px-2 py-0.5 text-[11px] uppercase text-[#605e5c]">{vulnerability.severity}</span></td>
                                <td className="px-3 py-2.5">{vulnerability.cvss ?? 'Not observed'}</td>
                                <td className="px-3 py-2.5"><span className="rounded border border-[#e1dfdd] bg-[#faf9f8] px-2 py-0.5 text-[11px] text-[#605e5c]">{vulnerability.status}</span></td>
                                <td className="max-w-sm truncate px-3 py-2.5 text-[#605e5c]" title={vulnerability.description}>{vulnerability.description || 'No description observed.'}</td>
                              </tr>
                            ))}
                            {clientPassports.every(passport => !passport.vulnerabilities?.length) && <tr><td colSpan={6} className="px-3 py-6 text-center text-[#8a8886]">No vulnerability observations are recorded for this client.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Compliance Framework Matrices Tab */}
                {workspaceTab === 'compliance' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {client.complianceStatus.length === 0 && (
                      <div className="col-span-full rounded-md border border-dashed border-[#e1dfdd] px-5 py-10 text-center text-[13px] text-[#8a8886]">No compliance frameworks recorded for this client yet.</div>
                    )}
                    {client.complianceStatus.map((comp) => {
                      const cs = complianceStyle(comp.status);
                      return (
                        <div key={comp.id} className="flex flex-col justify-between gap-3 rounded-md border border-[#e1dfdd] bg-white p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <span className="rounded border border-[#e1dfdd] bg-[#eff6fc] px-2 py-0.5 text-[11px] font-medium text-[#0f6cbd]">
                                {comp.code} Framework
                              </span>
                              <h3 className="mt-2 text-[13px] font-semibold text-[#201f1e]">{comp.name}</h3>
                            </div>
                            <span className={`inline-flex items-center gap-1.5 text-[13px] ${cs.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${cs.dot}`} />
                              {comp.status}
                            </span>
                          </div>

                          {/* Progress Bar */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[11px] text-[#605e5c]">
                              <span>Controls verification progress</span>
                              <span className="font-medium text-[#323130]">{comp.progress}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f3f2f1]">
                              <div className="h-full bg-[#0f6cbd]" style={{ width: `${comp.progress}%` }}></div>
                            </div>
                            <div className="flex justify-between text-[11px] text-[#8a8886]">
                              <span>{comp.compliantControls} of {comp.totalControls} Controls Certified</span>
                              <span>SLA Audit Ready</span>
                            </div>
                          </div>

                          <button
                            onClick={() => onNavigateTab('compliance')}
                            className="w-full rounded border border-[#c8c6c4] py-1.5 text-center text-[13px] text-[#323130] hover:bg-black/[.03]"
                          >
                            Launch Verification Portal
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 5. Team Directory Tab */}
                {workspaceTab === 'team' && (
                  <div className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white">
                    <div className="border-b border-[#e1dfdd] px-4 py-3">
                      <h3 className="text-[13px] font-semibold text-[#323130]">Client Stakeholders & Key Operators</h3>
                      <p className="mt-0.5 text-[11px] text-[#8a8886]">Authorizing authorities registered with access privileges inside this workspace.</p>
                    </div>
                    <div className="divide-y divide-[#f3f2f1]">
                      {client.teamMembers.length === 0 && (
                        <div className="px-4 py-10 text-center text-[13px] text-[#8a8886]">No stakeholders recorded for this client yet.</div>
                      )}
                      {client.teamMembers.map((member, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-black/[.02]">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e1dfdd] bg-[#eff6fc] text-[11px] font-semibold text-[#0f6cbd]">
                              {member.avatar}
                            </div>
                            <div>
                              <h4 className="text-[13px] font-medium text-[#201f1e]">{member.name}</h4>
                              <p className="text-[11px] text-[#8a8886]">{member.role}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <a
                              href={`mailto:${member.email}`}
                              className="flex items-center gap-1 text-[13px] font-medium text-[#0f6cbd] hover:underline"
                            >
                              <span>{member.email}</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            <span className="mt-1 block text-[11px] text-[#8a8886]">Privileges: Authorized Auditor</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
