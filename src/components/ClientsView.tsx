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
  Plus,
  Loader2,
  X
} from 'lucide-react';
import { Client, SoftwarePassport } from '../types';
import { generateClientCompliancePDF } from '../utils/pdfGenerator';
import { apiFetch } from '../utils/apiClient';

interface ClientsViewProps {
  clients: Client[];
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
  passports: SoftwarePassport[];
  onNavigateTab: (tab: string, itemId?: string) => void;
  searchQuery: string;
  role?: string;
  onClientCreated?: (client: Client) => void;
}

export default function ClientsView({
  clients,
  selectedClientId,
  setSelectedClientId,
  passports,
  onNavigateTab,
  searchQuery,
  role = 'Viewer',
  onClientCreated
}: ClientsViewProps) {
  const [industryFilter, setIndustryFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'inventory' | 'security' | 'compliance' | 'team'>('overview');
  const canCreateClient = role === 'Owner' || role === 'Admin';
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientDomain, setNewClientDomain] = useState('');
  const [newClientIndustry, setNewClientIndustry] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [addClientError, setAddClientError] = useState<string | null>(null);
  const [addClientSuccess, setAddClientSuccess] = useState<string | null>(null);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingClient(true);
    setAddClientError(null);
    setAddClientSuccess(null);
    try {
      const response = await apiFetch('/api/user/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newClientName.trim(), domain: newClientDomain.trim().toLowerCase(), industry: newClientIndustry.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // POST /api/user/clients reports Zod validation failures (e.g. an
        // invalid domain format) as a generic 'Invalid request' with the real
        // per-field message nested under details.fieldErrors -- surface that
        // specific message instead of the unhelpful generic one.
        const fieldMessage = Object.values(data?.details?.fieldErrors || {}).flat()[0] as string | undefined;
        throw new Error(fieldMessage || data?.details?.formErrors?.[0] || data?.error?.message || data?.error || 'Unable to create client.');
      }
      const created: Client = {
        id: data.id, name: data.name, domain: data.domain, industry: data.industry,
        trustScore: data.trustScore ?? 0, riskLevel: data.riskLevel ?? 'Unknown', avatarColor: data.avatarColor ?? 'indigo',
        subscriptionTier: data.subscriptionTier ?? 'Standard', joinedDate: data.joinedDate ?? new Date().toISOString(),
        teamCount: data.teamCount ?? 1, passportCount: data.passportCount ?? 0, criticalRisksCount: data.criticalRisksCount ?? 0,
        complianceProgress: data.complianceProgress ?? 0, softwareInventory: data.softwareInventory ?? [],
        complianceStatus: data.complianceStatus ?? [], teamMembers: data.teamMembers ?? [], activityTimeline: data.activityTimeline ?? [],
      };
      onClientCreated?.(created);
      setAddClientSuccess(`${created.name} created.`);
      setNewClientName(''); setNewClientDomain(''); setNewClientIndustry('');
      setTimeout(() => { setShowAddClient(false); setAddClientSuccess(null); }, 1200);
    } catch (err) {
      setAddClientError(err instanceof Error ? err.message : 'Unable to create client.');
    } finally {
      setCreatingClient(false);
    }
  };

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

  return (
    <div className="space-y-6" id="msp-clients-index">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#c586c0]"><Building2 className="h-4 w-4" /> Tenant directory</div>
          <h1 className="text-xl font-display font-extrabold text-[#d4d4d4] mt-1">Client Tenant Directory</h1>
          <p className="text-xs text-[#9d9d9d] font-sans mt-1">
            Browse and manage software trust state across {clients.length} active workspace tenants. Click a card to open.
          </p>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {canCreateClient && (
            <button
              onClick={() => { setShowAddClient(true); setAddClientError(null); }}
              className="spr-btn spr-btn-primary flex items-center gap-1.5"
              id="add-client-btn"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Client</span>
            </button>
          )}
          <button
            onClick={handleExportCSV}
            className="spr-btn spr-btn-secondary flex items-center gap-1.5"
            id="export-tenants-csv-btn"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Directory</span>
          </button>

          <div className="flex items-center gap-1.5 bg-[#252526] border border-[#3c3c3c] px-3 py-2 rounded-md text-xs text-[#6f6f6f] ">
            <Filter className="w-3.5 h-3.5 text-[#9d9d9d]" />
            <span>Industry:</span>
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              className="bg-transparent focus:outline-none font-semibold cursor-pointer text-[#d4d4d4] "
            >
              <option value="all">All Industries</option>
              {industries.map(ind => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-[#252526] border border-[#3c3c3c] px-3 py-2 rounded-md text-xs text-[#6f6f6f] ">
            <ShieldAlert className="w-3.5 h-3.5 text-[#9d9d9d]" />
            <span>Risk Level:</span>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="bg-transparent focus:outline-none font-semibold cursor-pointer text-[#d4d4d4] "
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
              className={`spr-panel p-5 cursor-pointer flex flex-col gap-4 relative group transition-all duration-300 ${
                isDrawerActive
                  ? 'border-[#3794ff]'
                  : 'hover:border-[#3794ff]'
              }`}
            >
              {/* Upper Details */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center font-bold text-sm ${c.avatarColor}`}>
                    {c.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#d4d4d4] group-hover:text-[#3794ff] transition-colors">
                      {c.name}
                    </h3>
                    <p className="text-[10px] text-[#9d9d9d] font-mono flex items-center gap-1 mt-0.5">
                      <Globe className="w-3 h-3 text-[#9d9d9d]" />
                      <span>{c.domain}</span> • <span>{c.industry}</span>
                    </p>
                  </div>
                </div>

                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                  c.riskLevel === 'Safe' ? 'bg-[#89d185]/15 border-[#89d185] text-[#89d185] ' :
                  c.riskLevel === 'Medium' ? 'bg-[#cca700]/15 border-[#cca700] text-[#cca700] ' :
                  'bg-[#f14c4c]/15 border-[#f14c4c] text-[#f14c4c] '
                }`}>
                  {c.riskLevel} Risk
                </span>
              </div>

              {/* Performance indicators Grid */}
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[#3c3c3c] text-center">
                <div className="bg-[#2d2d2d] p-2.5 rounded-md border border-[#3c3c3c] ">
                  <p className="text-[8px] text-[#9d9d9d] font-mono font-bold uppercase">Trust Score</p>
                  <p className="text-base font-bold font-mono text-[#d4d4d4] mt-0.5">
                    {c.trustScore}<span className="text-[10px] text-[#9d9d9d] ">/100</span>
                  </p>
                </div>
                <div className="bg-[#2d2d2d] p-2.5 rounded-md border border-[#3c3c3c] ">
                  <p className="text-[8px] text-[#9d9d9d] font-mono font-bold uppercase">Passports</p>
                  <p className="text-base font-bold font-mono text-[#d4d4d4] mt-0.5">{c.passportCount}</p>
                </div>
                <div className="bg-[#2d2d2d] p-2.5 rounded-md border border-[#3c3c3c] ">
                  <p className="text-[8px] text-[#9d9d9d] font-mono font-bold uppercase">Compliance</p>
                  <p className="text-base font-bold font-mono text-[#d4d4d4] mt-0.5">{c.complianceProgress}%</p>
                </div>
              </div>

              {/* Subtext warning / health status */}
              <div className="flex items-center justify-between text-[10px] font-mono mt-1">
                <span className="text-[#9d9d9d] ">Joined: {c.joinedDate}</span>
                {hasCriticalRisks ? (
                  <span className="text-[#f14c4c] font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#f14c4c] animate-pulse" />
                    {c.criticalRisksCount} Critical Alerts Active
                  </span>
                ) : (
                  <span className="text-[#89d185] font-bold flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#89d185] " />
                    No critical risks recorded
                  </span>
                )}
              </div>

              <div className="absolute bottom-4 right-5 text-[#3794ff] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 font-bold text-xs">
                <span>Configure Drawer</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>
          );
        })}
      </div>

      {filteredClients.length === 0 && (
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-md p-12 text-center ">
          <Building2 className="w-12 h-12 text-[#d4d4d4] mx-auto mb-3" />
          <h3 className="text-sm font-bold text-[#6f6f6f] ">{clients.length === 0 ? 'No clients yet' : 'No client workspaces found'}</h3>
          <p className="text-xs text-[#9d9d9d] max-w-sm mx-auto mt-1">
            {clients.length === 0
              ? (canCreateClient ? 'Add your first client to start tracking their software passports and evidence.' : 'Ask an Owner or Admin to add a client to this workspace.')
              : 'Adjust your search keywords or industry filters and try again.'}
          </p>
          {clients.length === 0 && canCreateClient && (
            <button onClick={() => setShowAddClient(true)} className="spr-btn spr-btn-primary mt-4 inline-flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Client
            </button>
          )}
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
              className="fixed inset-0 bg-black/60 z-40 cursor-pointer"
            />

            {/* Sliding Drawer Container */}
            <motion.div
              key="clients-drawer-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 170 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-4xl bg-[#2d2d2d] border-l border-[#3c3c3c] z-50 overflow-y-auto p-6 flex flex-col"
            >
              {/* Drawer Top Navigation & Actions */}
              <div className="flex items-center justify-between border-b border-[#3c3c3c] pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center font-bold text-sm ${client.avatarColor}`}>
                    {client.name.charAt(0)}
                  </div>
                  <div>
                    <span className="text-[9px] font-mono font-bold tracking-wider text-[#9d9d9d] uppercase">
                      ACTIVE TENANT CONTROLLER
                    </span>
                    <h2 className="text-base font-display font-extrabold text-[#d4d4d4] leading-tight">
                      {client.name}
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => generateClientCompliancePDF(client)}
                    className="spr-btn spr-btn-primary flex items-center gap-1.5 !text-[11px] !py-1.8"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Compliance PDF</span>
                  </button>
                  <button
                    onClick={() => setSelectedClientId('global')}
                    className="p-1.8 hover:bg-[#383838] border border-[#3c3c3c] rounded-md text-[#9d9d9d] hover:text-[#6f6f6f] cursor-pointer transition-colors"
                    title="Close Drawer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Badges and summary bar */}
              <div className="flex flex-wrap gap-2 text-[10px] font-mono mt-4 shrink-0">
                <span className="bg-[#383838] text-[#6f6f6f] px-2.5 py-1 rounded-md font-medium border border-[#3c3c3c] ">
                  Tier: {client.subscriptionTier}
                </span>
                <span className="bg-[#383838] text-[#6f6f6f] px-2.5 py-1 rounded-md font-medium border border-[#3c3c3c] ">
                  Domain: {client.domain}
                </span>
                <span className={`px-2.5 py-1 rounded-md font-bold border ${
                  client.riskLevel === 'Safe' ? 'bg-[#89d185]/15 border-[#89d185] text-[#89d185] ' :
                  client.riskLevel === 'Medium' ? 'bg-[#cca700]/15 border-[#cca700] text-[#cca700] ' :
                  'bg-[#f14c4c]/15 border-[#f14c4c] text-[#f14c4c] '
                }`}>
                  Risk Status: {client.riskLevel}
                </span>
              </div>

              {/* Drawer Tabs Header */}
              <div className="flex border-b border-[#3c3c3c] text-xs font-semibold gap-1 select-none overflow-x-auto mt-4 shrink-0">
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
                          ? 'border-[#3794ff] text-[#3794ff] '
                          : 'border-transparent text-[#9d9d9d] hover:text-[#d4d4d4] '
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
                    <div className="bg-[#252526] p-5 rounded-md border border-[#3c3c3c] ">
                      <h3 className="text-xs font-bold text-[#9d9d9d] font-mono uppercase tracking-wider mb-4">Core Trust Coordinates</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-[#2d2d2d] border border-[#3c3c3c] p-4 rounded-md text-center">
                          <p className="text-[9px] text-[#9d9d9d] font-mono font-bold uppercase">Overall score</p>
                          <p className="text-2xl font-display font-extrabold font-mono text-[#d4d4d4] mt-1">{client.trustScore}</p>
                          <span className="text-[9px] text-[#9d9d9d] font-semibold font-mono">Observed client record</span>
                        </div>
                        <div className="bg-[#2d2d2d] border border-[#3c3c3c] p-4 rounded-md text-center">
                          <p className="text-[9px] text-[#9d9d9d] font-mono font-bold uppercase">Security Score</p>
                          <p className="text-2xl font-display font-extrabold font-mono text-[#d4d4d4] mt-1">
                            {securityScores.length > 0 ? Math.round(securityScores.reduce((sum, score) => sum + score, 0) / securityScores.length) : 'Not verified'}
                          </p>
                          <span className="text-[9px] text-[#9d9d9d] font-mono">Passport-derived</span>
                        </div>
                        <div className="bg-[#2d2d2d] border border-[#3c3c3c] p-4 rounded-md text-center">
                          <p className="text-[9px] text-[#9d9d9d] font-mono font-bold uppercase">Compliance Score</p>
                          <p className="text-2xl font-display font-extrabold font-mono text-[#d4d4d4] mt-1">{client.complianceProgress}%</p>
                          <span className="text-[9px] text-[#9d9d9d] font-mono">Client record</span>
                        </div>
                        <div className="bg-[#2d2d2d] border border-[#3c3c3c] p-4 rounded-md text-center">
                          <p className="text-[9px] text-[#9d9d9d] font-mono font-bold uppercase">Supplier Rep</p>
                          <p className="text-2xl font-display font-extrabold font-mono text-[#d4d4d4] mt-1">
                            { 'Not verified'}
                          </p>
                          <span className="text-[9px] text-[#9d9d9d] font-mono">No vendor score observed</span>
                        </div>
                      </div>
                    </div>

                    {/* Company Overview Details Card */}
                    <div className="bg-[#252526] p-5 rounded-md border border-[#3c3c3c] grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-3.5">
                        <h3 className="text-xs font-bold text-[#d4d4d4] font-display">Tenant Profile Overview</h3>
                        <div className="text-xs space-y-2">
                          <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                            <span className="text-[#9d9d9d] font-mono text-[10px]">ORGANIZATION NAME</span>
                            <span className="font-semibold text-[#6f6f6f] ">{client.name}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                            <span className="text-[#9d9d9d] font-mono text-[10px]">DOMAIN</span>
                            <span className="font-semibold text-[#6f6f6f] font-mono">{client.domain}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                            <span className="text-[#9d9d9d] font-mono text-[10px]">INDUSTRY</span>
                            <span className="font-semibold text-[#6f6f6f] ">{client.industry}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3.5">
                        <h3 className="text-xs font-bold text-[#d4d4d4] font-display">SLA & Scope Details</h3>
                        <div className="text-xs space-y-2">
                          <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                            <span className="text-[#9d9d9d] font-mono text-[10px]">VERIFIED REGISTRY</span>
                            <span className="font-semibold text-[#6f6f6f] font-mono">tenant-{client.id}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                            <span className="text-[#9d9d9d] font-mono text-[10px]">JOINED DATE</span>
                            <span className="font-semibold text-[#6f6f6f] font-mono">{client.joinedDate}</span>
                          </div>
                          <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                            <span className="text-[#9d9d9d] font-mono text-[10px]">COMPLIANCE TARGET</span>
                            <span className="font-bold text-[#3794ff] font-mono">{client.complianceStatus.length ? client.complianceStatus.map((item) => item.code).join(', ') : 'Not observed'}</span>
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
                      <h3 className="text-xs font-bold text-[#9d9d9d] font-mono uppercase tracking-wider">Registered Client Software SBOM Passports</h3>
                      <span className="text-[10px] text-[#9d9d9d] font-mono">Count: {client.passportCount}</span>
                    </div>

                    {client.softwareInventory.length === 0 && (
                      <div className="rounded-md border border-dashed border-[#3c3c3c] px-5 py-10 text-center text-xs text-[#9d9d9d] ">No software passports registered for this client yet.</div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {passports.filter(p => {
                        const clientPassportIds = new Set(client.softwareInventory.map(item => item.passportId));
                        return clientPassportIds.has(p.id);
                      }).map(p => (
                        <div
                          key={p.id}
                          onClick={() => onNavigateTab('passports', p.id)}
                          className="bg-[#252526] p-4 rounded-md border border-[#3c3c3c] hover:border-[#3794ff] cursor-pointer transition-colors space-y-3 "
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="text-xs font-bold text-[#d4d4d4] ">{p.name}</h4>
                              <p className="text-[10px] text-[#9d9d9d] font-mono">Version: {p.version || 'Not observed'}</p>
                            </div>
                            <span className="text-[10px] font-mono bg-[#094771] text-[#3794ff] px-2 py-0.5 border border-[#3794ff] rounded font-semibold">
                              {p.sbom.length} Dependencies
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[10px] font-mono text-[#9d9d9d] pt-2 border-t border-[#3c3c3c] ">
                            <span>Compliance: {p.complianceScore == null ? 'Not verified' : `${p.complianceScore}%`}</span>
                            <span className="text-[#3794ff] font-bold flex items-center gap-0.5">
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
                      <h3 className="text-xs font-bold text-[#9d9d9d] font-mono uppercase tracking-wider">Active Vulnerability Footprint</h3>
                      <button
                        onClick={() => onNavigateTab('alerts')}
                        className="text-[10px] font-mono text-[#3794ff] hover:underline font-bold"
                      >
                        Launch Threat Mitigator
                      </button>
                    </div>

                    <div className="bg-[#252526] rounded-md border border-[#3c3c3c] overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-[#2d2d2d] text-[#9d9d9d] font-mono font-bold border-b border-[#3c3c3c] text-[10px]">
                              <th className="px-5 py-3">CVE ID</th>
                              <th className="px-5 py-3">COMPONENT</th>
                              <th className="px-5 py-3">SEVERITY</th>
                              <th className="px-5 py-3">CVSS</th>
                              <th className="px-5 py-3">STATUS</th>
                              <th className="px-5 py-3">THREAT SUMMARY</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#3c3c3c] text-[#6f6f6f] ">
                            {clientPassports.flatMap(passport => (passport.vulnerabilities || []).map(vulnerability => ({ passport, vulnerability }))).map(({ passport, vulnerability }, index) => (
                              <tr key={`${passport.id}-${vulnerability.id}-${index}`} className="hover:bg-[#2d2d2d] ">
                                <td className="px-5 py-3.5 font-bold text-[#3794ff] font-mono">{vulnerability.id}</td>
                                <td className="px-5 py-3.5 font-semibold text-[#6f6f6f] ">{vulnerability.component}</td>
                                <td className="px-5 py-3.5"><span className="rounded-full border border-[#3c3c3c] bg-[#383838] px-2.5 py-0.5 text-[9px] font-extrabold uppercase ">{vulnerability.severity}</span></td>
                                <td className="px-5 py-3.5 font-bold font-mono">{vulnerability.cvss ?? 'Not observed'}</td>
                                <td className="px-5 py-3.5"><span className="rounded border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-0.5 text-[9px] font-bold ">{vulnerability.status}</span></td>
                                <td className="max-w-sm truncate px-5 py-3.5 text-[#9d9d9d] " title={vulnerability.description}>{vulnerability.description || 'No description observed.'}</td>
                              </tr>
                            ))}
                            {clientPassports.every(passport => !passport.vulnerabilities?.length) && <tr><td colSpan={6} className="px-5 py-6 text-center text-[#9d9d9d] font-mono">No vulnerability observations are recorded for this client.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Compliance Framework Matrices Tab */}
                {workspaceTab === 'compliance' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {client.complianceStatus.length === 0 && (
                      <div className="col-span-full rounded-md border border-dashed border-[#3c3c3c] px-5 py-10 text-center text-xs text-[#9d9d9d] ">No compliance frameworks recorded for this client yet.</div>
                    )}
                    {client.complianceStatus.map((comp) => (
                      <div key={comp.id} className="bg-[#252526] p-5 rounded-md border border-[#3c3c3c] flex flex-col justify-between gap-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[9px] font-mono font-bold bg-[#094771] border border-[#3794ff] text-[#3794ff] px-2 py-0.5 rounded">
                              {comp.code} Framework
                            </span>
                            <h3 className="text-sm font-bold text-[#d4d4d4] font-display mt-2">{comp.name}</h3>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${
                            comp.status === 'Compliant' ? 'bg-[#89d185]/15 border-[#89d185] text-[#89d185] ' :
                            comp.status === 'In Progress' ? 'bg-[#cca700]/15 border-[#cca700] text-[#cca700] ' :
                            'bg-[#f14c4c]/15 border-[#f14c4c] text-[#f14c4c] '
                          }`}>
                            {comp.status}
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-mono text-[#9d9d9d] ">
                            <span>Controls verification progress</span>
                            <span className="font-bold text-[#6f6f6f] ">{comp.progress}%</span>
                          </div>
                          <div className="w-full bg-[#383838] h-2 rounded-full overflow-hidden">
                            <div className="bg-[#0e639c] h-full transition-all duration-500" style={{ width: `${comp.progress}%` }}></div>
                          </div>
                          <div className="flex justify-between text-[9px] font-mono text-[#9d9d9d] ">
                            <span>{comp.compliantControls} of {comp.totalControls} Controls Certified</span>
                            <span>SLA Audit Ready</span>
                          </div>
                        </div>

                        <button
                          onClick={() => onNavigateTab('compliance')}
                          className="spr-btn spr-btn-secondary w-full text-center"
                        >
                          Launch Verification Portal
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 5. Team Directory Tab */}
                {workspaceTab === 'team' && (
                  <div className="bg-[#252526] rounded-md border border-[#3c3c3c] overflow-hidden">
                    <div className="px-5 py-4 border-b border-[#3c3c3c] ">
                      <h3 className="text-sm font-bold text-[#d4d4d4] font-display">Client Stakeholders & Key Operators</h3>
                      <p className="text-[10px] text-[#9d9d9d] font-mono mt-0.5">Authorizing authorities registered with access privileges inside this workspace.</p>
                    </div>
                    <div className="divide-y divide-[#3c3c3c] ">
                      {client.teamMembers.length === 0 && (
                        <div className="px-5 py-10 text-center text-xs text-[#9d9d9d] ">No stakeholders recorded for this client yet.</div>
                      )}
                      {client.teamMembers.map((member, i) => (
                        <div key={i} className="px-5 py-4 flex items-center justify-between hover:bg-[#2d2d2d] ">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-[#094771] border border-[#3794ff] flex items-center justify-center text-xs font-bold text-[#3794ff] ">
                              {member.avatar}
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-[#d4d4d4] ">{member.name}</h4>
                              <p className="text-[10px] text-[#9d9d9d] font-mono">{member.role}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <a
                              href={`mailto:${member.email}`}
                              className="text-xs font-semibold text-[#3794ff] hover:text-[#3794ff] font-mono flex items-center gap-1 cursor-pointer"
                            >
                              <span>{member.email}</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <span className="text-[9px] font-mono text-[#9d9d9d] mt-1 block">Privileges: Authorized Auditor</span>
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

      {showAddClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="add-client-title">
          <div className="w-full max-w-lg rounded-md border border-[#3c3c3c] bg-[#252526] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#c586c0]"><Building2 className="h-4 w-4" /> New client trust environment</div>
                <h2 id="add-client-title" className="mt-1 text-lg font-bold text-[#d4d4d4]">Establish a client trust environment</h2>
                <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">Create the foundation for monitoring the software, vendors, and technology this client depends on.</p>
              </div>
              <button onClick={() => setShowAddClient(false)} aria-label="Close" className="rounded-md p-1.5 text-[#9d9d9d] hover:bg-[#383838] hover:text-[#d4d4d4]"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleCreateClient} className="mt-5 space-y-3.5">
              {addClientError && (
                <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2.5 text-xs text-[#f14c4c] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {addClientError}
                </div>
              )}
              {addClientSuccess && (
                <div className="rounded-md border border-[#89d185]/40 bg-[#89d185]/10 px-3 py-2.5 text-xs text-[#89d185] flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0" /> {addClientSuccess}
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#9d9d9d]">Client / Organization name *</label>
                <input required value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Acme Manufacturing" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#9d9d9d]">Primary domain *</label>
                <input required value={newClientDomain} onChange={(e) => setNewClientDomain(e.target.value)} placeholder="acme.com" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#9d9d9d]">Industry *</label>
                <input required value={newClientIndustry} onChange={(e) => setNewClientIndustry(e.target.value)} placeholder="Manufacturing" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" />
              </div>

              <div className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] p-3.5">
                <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#6f6f6f]">After creation, this environment will track</div>
                <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-[#9d9d9d]"><Globe className="h-3.5 w-3.5 text-[#3794ff]" /> Software</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[#9d9d9d]"><Users className="h-3.5 w-3.5 text-[#3794ff]" /> Vendors</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[#9d9d9d]"><FileCheck className="h-3.5 w-3.5 text-[#3794ff]" /> Passports</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[#9d9d9d]"><FileText className="h-3.5 w-3.5 text-[#3794ff]" /> Evidence</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[#9d9d9d]"><Activity className="h-3.5 w-3.5 text-[#3794ff]" /> Monitoring</div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddClient(false)} className="rounded-md border border-[#3c3c3c] px-3.5 py-2 text-xs font-semibold text-[#9d9d9d] hover:bg-[#383838]">Cancel</button>
                <button type="submit" disabled={creatingClient || !newClientName.trim() || !newClientDomain.trim() || !newClientIndustry.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[#0e639c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1177bb] disabled:opacity-40">
                  {creatingClient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {creatingClient ? 'Establishing…' : 'Establish Trust Environment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
