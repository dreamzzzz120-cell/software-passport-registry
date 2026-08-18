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
  ArrowLeft,
  Users,
  Activity,
  Award,
  Lock,
  Globe,
  FileCheck,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Clock,
  UserCheck,
  FileText,
  Search,
  Filter,
  Download,
  X
} from 'lucide-react';
import { Client, SoftwarePassport } from '../types';
import { generateClientCompliancePDF } from '../utils/pdfGenerator';

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

  return (
    <div className="space-y-6" id="msp-clients-index">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-display font-extrabold text-slate-900 dark:text-zinc-50">Client Tenant Directory</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
            Browse and manage software trust state across {clients.length} active workspace tenants. Click a card to open.
          </p>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-semibold text-xs px-3.5 py-2 rounded-lg shadow-sm hover:shadow transition-all cursor-pointer"
            id="export-tenants-csv-btn"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Directory</span>
          </button>
          
          <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-850 border border-slate-200 dark:border-zinc-800 px-3 py-2 rounded-lg text-xs text-slate-600 dark:text-zinc-300">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Industry:</span>
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              className="bg-transparent focus:outline-none font-semibold cursor-pointer text-slate-800 dark:text-zinc-200"
            >
              <option value="all">All Industries</option>
              {industries.map(ind => (
                <option key={ind} value={ind} className="dark:bg-zinc-850">{ind}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-850 border border-slate-200 dark:border-zinc-800 px-3 py-2 rounded-lg text-xs text-slate-600 dark:text-zinc-300">
            <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
            <span>Risk Level:</span>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="bg-transparent focus:outline-none font-semibold cursor-pointer text-slate-800 dark:text-zinc-200"
            >
              <option value="all">All Tiers</option>
              <option value="Safe">Safe</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
        </div>
      </div>

      {/* Client Directory Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredClients.map(c => {
          const hasCriticalRisks = c.criticalRisksCount > 0;
          const isDrawerActive = selectedClientId === c.id;
          return (
            <div
              key={c.id}
              onClick={() => setSelectedClientId(c.id)}
              className={`studio-card p-5 cursor-pointer flex flex-col gap-4 relative group transition-all duration-300 ${
                isDrawerActive 
                  ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-lg' 
                  : 'hover:border-indigo-400 dark:hover:border-indigo-900/60 hover:shadow-md'
              }`}
            >
              {/* Upper Details */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${c.avatarColor}`}>
                    {c.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {c.name}
                    </h3>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono flex items-center gap-1 mt-0.5">
                      <Globe className="w-3 h-3 text-slate-400" />
                      <span>{c.domain}</span> • <span>{c.industry}</span>
                    </p>
                  </div>
                </div>

                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                  c.riskLevel === 'Safe' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800/50 dark:text-emerald-400' :
                  c.riskLevel === 'Medium' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800/50 dark:text-amber-400' :
                  'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/30 dark:border-rose-800/50 dark:text-rose-400'
                }`}>
                  {c.riskLevel} Risk
                </span>
              </div>

              {/* Performance indicators Grid */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100 dark:border-zinc-800/80 text-center">
                <div className="bg-slate-50 dark:bg-zinc-950/40 p-2.5 rounded-lg border border-slate-150 dark:border-zinc-850">
                  <p className="text-[8px] text-slate-400 dark:text-zinc-500 font-mono font-bold uppercase">Trust Score</p>
                  <p className="text-base font-bold font-mono text-slate-800 dark:text-zinc-100 mt-0.5">
                    {c.trustScore}<span className="text-[10px] text-slate-400 dark:text-zinc-500">/100</span>
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-zinc-950/40 p-2.5 rounded-lg border border-slate-150 dark:border-zinc-850">
                  <p className="text-[8px] text-slate-400 dark:text-zinc-500 font-mono font-bold uppercase">Passports</p>
                  <p className="text-base font-bold font-mono text-slate-800 dark:text-zinc-100 mt-0.5">{c.passportCount}</p>
                </div>
                <div className="bg-slate-50 dark:bg-zinc-950/40 p-2.5 rounded-lg border border-slate-150 dark:border-zinc-850">
                  <p className="text-[8px] text-slate-400 dark:text-zinc-500 font-mono font-bold uppercase">Compliance</p>
                  <p className="text-base font-bold font-mono text-slate-800 dark:text-zinc-100 mt-0.5">{c.complianceProgress}%</p>
                </div>
              </div>

              {/* Subtext warning / health status */}
              <div className="flex items-center justify-between text-[10px] font-mono mt-1">
                <span className="text-slate-400 dark:text-zinc-500">Joined: {c.joinedDate}</span>
                {hasCriticalRisks ? (
                  <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                    {c.criticalRisksCount} Critical Alerts Active
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                    Supply Chain Guarded
                  </span>
                )}
              </div>

              <div className="absolute bottom-4 right-5 text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 font-bold text-xs">
                <span>Configure Drawer</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>
          );
        })}
      </div>

      {filteredClients.length === 0 && (
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-12 text-center shadow-sm">
          <Building2 className="w-12 h-12 text-slate-300 dark:text-zinc-700 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300">No client workspaces found</h3>
          <p className="text-xs text-slate-400 dark:text-zinc-500 max-w-sm mx-auto mt-1">
            Adjust your search keywords or industry filters and try again.
          </p>
        </div>
      )}

      {/* Slide-out Drawer Panel */}
      <AnimatePresence>
        {selectedClientId !== 'global' && client && (
          <>
            {/* Backdrop Overlay with blur */}
            <motion.div
              key="clients-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedClientId('global')}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 cursor-pointer"
            />

            {/* Sliding Drawer Container */}
            <motion.div
              key="clients-drawer-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 170 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-4xl bg-slate-50 dark:bg-zinc-900 border-l border-slate-200 dark:border-zinc-800/80 shadow-2xl z-50 overflow-y-auto p-6 flex flex-col"
            >
              {/* Drawer Top Navigation & Actions */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${client.avatarColor}`}>
                    {client.name.charAt(0)}
                  </div>
                  <div>
                    <span className="text-[9px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
                      ACTIVE TENANT CONTROLLER
                    </span>
                    <h2 className="text-base font-display font-extrabold text-slate-900 dark:text-zinc-50 leading-tight">
                      {client.name}
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => generateClientCompliancePDF(client)}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-semibold text-[11px] px-3 py-1.8 rounded-lg shadow-sm cursor-pointer transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Compliance PDF</span>
                  </button>
                  <button
                    onClick={() => setSelectedClientId('global')}
                    className="p-1.8 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-lg text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer transition-colors"
                    title="Close Drawer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Badges and summary bar */}
              <div className="flex flex-wrap gap-2 text-[10px] font-mono mt-4 shrink-0">
                <span className="bg-slate-100 dark:bg-zinc-850 text-slate-600 dark:text-zinc-300 px-2.5 py-1 rounded-md font-medium border border-slate-200 dark:border-zinc-800">
                  Tier: {client.subscriptionTier}
                </span>
                <span className="bg-slate-100 dark:bg-zinc-850 text-slate-600 dark:text-zinc-300 px-2.5 py-1 rounded-md font-medium border border-slate-200 dark:border-zinc-800">
                  Domain: {client.domain}
                </span>
                <span className={`px-2.5 py-1 rounded-md font-bold border ${
                  client.riskLevel === 'Safe' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800/30 dark:text-emerald-400' :
                  client.riskLevel === 'Medium' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:border-amber-800/30 dark:text-amber-400' :
                  'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/20 dark:border-rose-800/30 dark:text-rose-400'
                }`}>
                  Risk Status: {client.riskLevel}
                </span>
              </div>

              {/* Drawer Tabs Header */}
              <div className="flex border-b border-slate-200 dark:border-zinc-800 text-xs font-semibold gap-1 select-none overflow-x-auto mt-4 shrink-0">
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
                      className={`flex items-center gap-1.5 px-3 py-2 cursor-pointer border-b-2 font-sans font-bold text-[11px] transition-colors whitespace-nowrap ${
                        isSel 
                          ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' 
                          : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tb.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Drawer Tabs Body content */}
              <div className="flex-1 overflow-y-auto pt-4 pb-2 space-y-6">
                
                {/* 1. Trust Coordinates Tab */}
                {workspaceTab === 'overview' && (
                  <div className="space-y-6">
                    {/* Trust Scores Bento Box */}
                    <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-slate-200 dark:border-zinc-850 shadow-xs">
                      <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 font-mono uppercase tracking-wider mb-4">Core Trust Coordinates</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-slate-50 dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800 p-4 rounded-lg text-center">
                          <p className="text-[9px] text-slate-400 dark:text-zinc-500 font-mono font-bold uppercase">Overall score</p>
                          <p className="text-2xl font-display font-extrabold font-mono text-slate-850 dark:text-zinc-100 mt-1">{client.trustScore}</p>
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold font-mono">Benchmark Pass</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800 p-4 rounded-lg text-center">
                          <p className="text-[9px] text-slate-400 dark:text-zinc-500 font-mono font-bold uppercase">Security Score</p>
                          <p className="text-2xl font-display font-extrabold font-mono text-slate-850 dark:text-zinc-100 mt-1">
                            {client.id === 'c-vanguard' ? 70 : 92}
                          </p>
                          <span className="text-[9px] text-slate-400 dark:text-zinc-500 font-mono">CVSS Weighted</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800 p-4 rounded-lg text-center">
                          <p className="text-[9px] text-slate-400 dark:text-zinc-500 font-mono font-bold uppercase">Compliance Score</p>
                          <p className="text-2xl font-display font-extrabold font-mono text-slate-850 dark:text-zinc-100 mt-1">{client.complianceProgress}%</p>
                          <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-semibold font-mono">Continuous Audit</span>
                        </div>
                        <div className="bg-slate-50 dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800 p-4 rounded-lg text-center">
                          <p className="text-[9px] text-slate-400 dark:text-zinc-500 font-mono font-bold uppercase">Supplier Rep</p>
                          <p className="text-2xl font-display font-extrabold font-mono text-slate-850 dark:text-zinc-100 mt-1">
                            {client.id === 'c-vanguard' ? 78 : 91}
                          </p>
                          <span className="text-[9px] text-slate-400 dark:text-zinc-500 font-mono">Signed Signatures</span>
                        </div>
                      </div>
                    </div>

                    {/* Company Overview Details Card */}
                    <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-slate-200 dark:border-zinc-850 shadow-xs grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-3.5">
                        <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display">Tenant Profile Overview</h3>
                        <div className="text-xs space-y-2">
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[10px]">ORGANIZATION NAME</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300">{client.name}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[10px]">DOMAIN</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300 font-mono">{client.domain}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[10px]">INDUSTRY</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300">{client.industry}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3.5">
                        <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display">SLA & Scope Details</h3>
                        <div className="text-xs space-y-2">
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[10px]">VERIFIED REGISTRY</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300 font-mono">tenant-{client.id}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[10px]">JOINED DATE</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300 font-mono">{client.joinedDate}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[10px]">COMPLIANCE TARGET</span>
                            <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">SOC2 Type II, ISO27001</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. SBOM Inventory Tab */}
                {workspaceTab === 'inventory' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 font-mono uppercase tracking-wider">Registered Client Software SBOM Passports</h3>
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">Count: {client.passportCount}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {passports.filter(p => {
                        const clientPassportIds = new Set(client.softwareInventory.map(item => item.passportId));
                        return clientPassportIds.has(p.id);
                      }).map(p => (
                        <div
                          key={p.id}
                          onClick={() => onNavigateTab('passports', p.id)}
                          className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-slate-200 dark:border-zinc-850 hover:border-indigo-500 cursor-pointer transition-colors space-y-3 shadow-inner"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-100">{p.name}</h4>
                              <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">Version: {p.version} | SLA Gold</p>
                            </div>
                            <span className="text-[10px] font-mono bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 border border-indigo-100 dark:border-indigo-900 rounded font-semibold">
                              {p.sbom.length} Dependencies
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 dark:text-zinc-400 pt-2 border-t border-slate-100 dark:border-zinc-850">
                            <span>Compliance: {p.complianceScore}%</span>
                            <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-0.5">
                              Open Passport <ChevronRight className="w-3 h-3" />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Security Center Tab */}
                {workspaceTab === 'security' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 font-mono uppercase tracking-wider">Active Vulnerability Footprint</h3>
                      <button
                        onClick={() => onNavigateTab('alerts')}
                        className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 hover:underline font-bold"
                      >
                        Launch Threat Mitigator
                      </button>
                    </div>

                    <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-850 shadow-xs overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 font-mono font-bold border-b border-slate-100 dark:border-zinc-800 text-[10px]">
                              <th className="px-5 py-3">CVE ID</th>
                              <th className="px-5 py-3">COMPONENT</th>
                              <th className="px-5 py-3">SEVERITY</th>
                              <th className="px-5 py-3">CVSS</th>
                              <th className="px-5 py-3">STATUS</th>
                              <th className="px-5 py-3">THREAT SUMMARY</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-zinc-850 text-slate-600 dark:text-zinc-300">
                            {client.id !== 'c-vanguard' ? (
                              <tr>
                                <td colSpan={6} className="px-5 py-6 text-center text-slate-400 dark:text-zinc-500 font-mono">
                                  ✓ Clean Scan Ledger: No active vulnerabilities or security gaps detected for this workspace.
                                </td>
                              </tr>
                            ) : (
                              <>
                                <tr className="hover:bg-slate-50/50 dark:hover:bg-zinc-900/30">
                                  <td className="px-5 py-3.5 font-bold text-indigo-600 dark:text-indigo-400 font-mono">CVE-2024-0567</td>
                                  <td className="px-5 py-3.5 font-semibold text-slate-700 dark:text-zinc-300">runc-runtime</td>
                                  <td className="px-5 py-3.5">
                                    <span className="bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400 border border-rose-200 dark:border-rose-900 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase">Critical</span>
                                  </td>
                                  <td className="px-5 py-3.5 font-bold font-mono">9.8</td>
                                  <td className="px-5 py-3.5">
                                    <span className="bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-850 px-2 py-0.5 rounded text-[9px] font-bold">Open</span>
                                  </td>
                                  <td className="px-5 py-3.5 text-slate-500 dark:text-zinc-400 max-w-sm truncate" title="A critical file descriptor leak inside runc allows containers to escape containment.">
                                    File descriptor leak inside runc container runtime.
                                  </td>
                                </tr>
                                <tr className="hover:bg-slate-50/50 dark:hover:bg-zinc-900/30">
                                  <td className="px-5 py-3.5 font-bold text-indigo-600 dark:text-indigo-400 font-mono">CVE-2023-35116</td>
                                  <td className="px-5 py-3.5 font-semibold text-slate-700 dark:text-zinc-300">jackson-databind</td>
                                  <td className="px-5 py-3.5">
                                    <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-900 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase">High</span>
                                  </td>
                                  <td className="px-5 py-3.5 font-bold font-mono">7.5</td>
                                  <td className="px-5 py-3.5">
                                    <span className="bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-850 px-2 py-0.5 rounded text-[9px] font-bold">Open</span>
                                  </td>
                                  <td className="px-5 py-3.5 text-slate-500 dark:text-zinc-400 max-w-sm truncate" title="Jackson-databind cyclic dependency denial of service.">
                                    Jackson databind cyclic deserialization StackOverflow denial of service.
                                  </td>
                                </tr>
                              </>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Compliance Framework Matrices Tab */}
                {workspaceTab === 'compliance' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {client.complianceStatus.map((comp) => (
                      <div key={comp.id} className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-slate-200 dark:border-zinc-850 shadow-xs flex flex-col justify-between gap-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 text-indigo-750 dark:text-indigo-400 px-2 py-0.5 rounded">
                              {comp.code} Framework
                            </span>
                            <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 font-display mt-2">{comp.name}</h3>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${
                            comp.status === 'Compliant' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/50 dark:text-emerald-400' :
                            comp.status === 'In Progress' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400' :
                            'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/50 dark:text-rose-400'
                          }`}>
                            {comp.status}
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                            <span>Controls verification progress</span>
                            <span className="font-bold text-slate-700 dark:text-zinc-300">{comp.progress}%</span>
                          </div>
                          <div className="w-full bg-slate-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                            <div className="bg-indigo-600 h-full transition-all duration-500" style={{ width: `${comp.progress}%` }}></div>
                          </div>
                          <div className="flex justify-between text-[9px] font-mono text-slate-400 dark:text-zinc-500">
                            <span>{comp.compliantControls} of {comp.totalControls} Controls Certified</span>
                            <span>SLA Audit Ready</span>
                          </div>
                        </div>

                        <button
                          onClick={() => onNavigateTab('compliance')}
                          className="w-full bg-slate-50 hover:bg-slate-100 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-slate-700 dark:text-zinc-300 text-xs font-semibold py-2 rounded-lg border border-slate-200 dark:border-zinc-800 text-center cursor-pointer transition-colors"
                        >
                          Launch Verification Portal
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 5. Team Directory Tab */}
                {workspaceTab === 'team' && (
                  <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-850 shadow-xs overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-850">
                      <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 font-display">Client Stakeholders & Key Operators</h3>
                      <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-0.5">Authorizing authorities registered with access privileges inside this workspace.</p>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-zinc-850">
                      {client.teamMembers.map((member, i) => (
                        <div key={i} className="px-5 py-4 flex items-center justify-between hover:bg-slate-50/30 dark:hover:bg-zinc-900/10">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-150 dark:border-indigo-900/60 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-400">
                              {member.avatar}
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-100">{member.name}</h4>
                              <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">{member.role}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <a
                              href={`mailto:${member.email}`}
                              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-mono flex items-center gap-1 cursor-pointer"
                            >
                              <span>{member.email}</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <span className="text-[9px] font-mono text-slate-400 dark:text-zinc-500 mt-1 block">Privileges: Authorized Auditor</span>
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
