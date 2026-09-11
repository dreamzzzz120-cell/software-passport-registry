/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { fuzzyMatch } from '../utils/filter';
import { toJsonArrayColumn } from '../lib/clientJsonColumns';
import {
  Building2,
  ShieldCheck,
  ShieldAlert,
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
  FileText,
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

  useEffect(() => {
    if (!showAddClient) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creatingClient) setShowAddClient(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAddClient, creatingClient]);

  useEffect(() => {
    if (selectedClientId !== 'global' && !clients.some(c => c.id === selectedClientId)) {
      setSelectedClientId('global');
    }
  }, [clients, selectedClientId, setSelectedClientId]);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateClient || creatingClient) return;

    const name = newClientName.trim();
    const domain = newClientDomain.trim().toLowerCase();
    const industry = newClientIndustry.trim();
    if (!name || !domain || !industry) {
      setAddClientError('Client name, primary domain, and industry are required.');
      return;
    }

    setCreatingClient(true);
    setAddClientError(null);
    setAddClientSuccess(null);
    try {
      const response = await apiFetch('/api/user/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, domain, industry }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const fieldMessage = Object.values(data?.details?.fieldErrors || {}).flat()[0] as string | undefined;
        throw new Error(fieldMessage || data?.details?.formErrors?.[0] || data?.error?.message || data?.error || 'Unable to create client.');
      }
      if (!data?.id || !data?.name || !data?.domain || !data?.industry) {
        throw new Error('The server returned an incomplete client record. Please try again.');
      }
      const created: Client = {
        id: data.id, name: data.name, domain: data.domain, industry: data.industry,
        trustScore: data.trustScore ?? 0, riskLevel: data.riskLevel ?? 'Unknown', avatarColor: data.avatarColor ?? 'indigo',
        subscriptionTier: data.subscriptionTier ?? 'Standard', joinedDate: data.joinedDate ?? new Date().toISOString(),
        teamCount: data.teamCount ?? 1, passportCount: data.passportCount ?? 0, criticalRisksCount: data.criticalRisksCount ?? 0,
        complianceProgress: data.complianceProgress ?? 0,
        softwareInventory: toJsonArrayColumn(data.softwareInventory),
        complianceStatus: toJsonArrayColumn(data.complianceStatus),
        teamMembers: toJsonArrayColumn(data.teamMembers),
        activityTimeline: toJsonArrayColumn(data.activityTimeline),
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

  const industries = useMemo(() => {
    const list = clients.map(c => c.industry);
    return Array.from(new Set(list));
  }, [clients]);

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

  const supplierReputationScores = clientPassports
    .map(passport => passport.vendorReputationScore)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));

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

  const handleExportCSV = () => {
    const headers = ['Client Name', 'Industry', 'Trust Score', 'Passports Active', 'Compliance Progress', 'Risk Level', 'Joined Date'];
    const escapeCsv = (value: unknown) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = filteredClients.map(c => [
      c.name,
      c.industry,
      c.trustScore,
      c.passportCount,
      c.complianceProgress,
      c.riskLevel,
      c.joinedDate
    ]);
    const csvContent = [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `client_compliance_report_${new Date().toISOString().split('T')[0]}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6" id="msp-clients-index">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.22em] text-[#c586c0]"><Building2 className="h-4 w-4" /> Client management</div>
          <h1 className="text-xl font-display font-extrabold text-[var(--spr-text)] mt-1">Protect every client’s software stack</h1>
          <p className="text-xs text-[var(--spr-text-muted)] font-sans mt-1">
            Manage each client’s software, evidence, security findings, and verification status from one place.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreateClient && (
            <button
              onClick={() => { setShowAddClient(true); setAddClientError(null); setAddClientSuccess(null); }}
              className="spr-btn spr-btn-primary flex items-center gap-1.5"
              id="add-client-btn"
              type="button"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add client</span>
            </button>
          )}
          <button
            onClick={handleExportCSV}
            className="spr-btn spr-btn-secondary flex items-center gap-1.5"
            id="export-tenants-csv-btn"
            type="button"
            disabled={filteredClients.length === 0}
            title={filteredClients.length === 0 ? 'No clients to export' : 'Export the clients currently shown'}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export client report</span>
          </button>

          <div className="flex items-center gap-1.5 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] px-3 py-2 rounded-md text-xs text-[var(--spr-text-faint)]">
            <Filter className="w-3.5 h-3.5 text-[var(--spr-text-muted)]" />
            <label htmlFor="client-industry-filter">Industry:</label>
            <select id="client-industry-filter" value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} className="bg-transparent focus:outline-none font-semibold cursor-pointer text-[var(--spr-text)]">
              <option value="all">All industries</option>
              {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] px-3 py-2 rounded-md text-xs text-[var(--spr-text-faint)]">
            <ShieldAlert className="w-3.5 h-3.5 text-[var(--spr-text-muted)]" />
            <label htmlFor="client-risk-filter">Risk:</label>
            <select id="client-risk-filter" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="bg-transparent focus:outline-none font-semibold cursor-pointer text-[var(--spr-text)]">
              <option value="all">All risk levels</option>
              <option value="Safe">Safe</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[12px] font-mono text-[var(--spr-text-muted)]">
        <span>{filteredClients.length} of {clients.length} clients shown</span>
        {(searchQuery || industryFilter !== 'all' || riskFilter !== 'all') && <span>Filters are active</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredClients.map(c => {
          const hasCriticalRisks = c.criticalRisksCount > 0;
          const isDrawerActive = selectedClientId === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedClientId(c.id)}
              aria-label={`Open client ${c.name}`}
              aria-pressed={isDrawerActive}
              className={`spr-panel p-5 text-left cursor-pointer flex flex-col gap-4 relative group transition-all duration-300 w-full ${isDrawerActive ? 'border-[var(--spr-highlight)]' : 'hover:border-[var(--spr-highlight)]'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center font-bold text-sm shrink-0 ${c.avatarColor}`}>{c.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-[var(--spr-text)] group-hover:text-[var(--spr-highlight)] transition-colors truncate">{c.name}</h3>
                    <p className="text-[12px] text-[var(--spr-text-muted)] font-mono flex items-center gap-1 mt-0.5 truncate">
                      <Globe className="w-3 h-3 shrink-0" /><span className="truncate">{c.domain}</span> • <span>{c.industry}</span>
                    </p>
                  </div>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-[12px] font-mono font-bold border shrink-0 ${c.riskLevel === 'Safe' ? 'bg-[var(--spr-green)]/15 border-[var(--spr-green)] text-[var(--spr-green)]' : c.riskLevel === 'Medium' ? 'bg-[var(--spr-amber)]/15 border-[var(--spr-amber)] text-[var(--spr-amber)]' : 'bg-[var(--spr-red)]/15 border-[var(--spr-red)] text-[var(--spr-red)]'}`}>
                  {c.riskLevel} risk
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[var(--spr-border)] text-center">
                <div className="bg-[var(--spr-surface-sunken)] p-2.5 rounded-md border border-[var(--spr-border)]">
                  <p className="text-[8px] text-[var(--spr-text-muted)] font-mono font-bold uppercase">Trust</p>
                  <p className="text-base font-bold font-mono text-[var(--spr-text)] mt-0.5">{typeof c.trustScore === 'number' ? <>{c.trustScore}<span className="text-[12px] text-[var(--spr-text-muted)]">/100</span></> : c.trustScore}</p>
                </div>
                <div className="bg-[var(--spr-surface-sunken)] p-2.5 rounded-md border border-[var(--spr-border)]">
                  <p className="text-[8px] text-[var(--spr-text-muted)] font-mono font-bold uppercase">Software</p>
                  <p className="text-base font-bold font-mono text-[var(--spr-text)] mt-0.5">{c.passportCount}</p>
                </div>
                <div className="bg-[var(--spr-surface-sunken)] p-2.5 rounded-md border border-[var(--spr-border)]">
                  <p className="text-[8px] text-[var(--spr-text-muted)] font-mono font-bold uppercase">Compliance</p>
                  <p className="text-base font-bold font-mono text-[var(--spr-text)] mt-0.5">{typeof c.complianceProgress === 'number' ? `${c.complianceProgress}%` : c.complianceProgress}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 text-[12px] font-mono mt-1">
                <span className="text-[var(--spr-text-muted)] truncate">Joined: {c.joinedDate}</span>
                {hasCriticalRisks ? (
                  <span className="text-[var(--spr-red)] font-bold flex items-center gap-1 shrink-0"><AlertTriangle className="w-3.5 h-3.5" />{c.criticalRisksCount} issues need attention</span>
                ) : (
                  <span className="text-[var(--spr-green)] font-bold flex items-center gap-1 shrink-0"><ShieldCheck className="w-3.5 h-3.5" />No critical issues recorded</span>
                )}
              </div>

              <div className="absolute bottom-4 right-5 text-[var(--spr-highlight)] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 font-bold text-xs"><span>Open client</span><ChevronRight className="w-3.5 h-3.5" /></div>
            </button>
          );
        })}
      </div>

      {filteredClients.length === 0 && (
        <div className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-md p-12 text-center">
          <Building2 className="w-12 h-12 text-[var(--spr-text)] mx-auto mb-3" />
          <h3 className="text-sm font-bold text-[var(--spr-text-faint)]">{clients.length === 0 ? 'Add your first client' : 'No clients match these filters'}</h3>
          <p className="text-xs text-[var(--spr-text-muted)] max-w-sm mx-auto mt-1">
            {clients.length === 0 ? (canCreateClient ? 'Create a client workspace to start tracking their software, evidence, risks, and verification.' : 'Ask an Owner or Admin to add a client to this workspace.') : 'Adjust your search or filters to find the client you need.'}
          </p>
          {clients.length === 0 && canCreateClient && (
            <button type="button" onClick={() => setShowAddClient(true)} className="spr-btn spr-btn-primary mt-4 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add client</button>
          )}
        </div>
      )}

      <AnimatePresence>
        {selectedClientId !== 'global' && client && (
          <>
            <motion.div key="clients-drawer-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }} onClick={() => setSelectedClientId('global')} className="fixed inset-0 bg-black/60 z-40 cursor-pointer" />
            <motion.div key="clients-drawer-panel" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 26, stiffness: 170 }} className="fixed right-0 top-0 bottom-0 w-full max-w-4xl bg-[var(--spr-surface-sunken)] border-l border-[var(--spr-border)] z-50 overflow-y-auto p-6 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="client-drawer-title">
              <div className="flex items-center justify-between border-b border-[var(--spr-border)] pb-4 shrink-0 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center font-bold text-sm shrink-0 ${client.avatarColor}`}>{client.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <span className="text-[11px] font-mono font-bold tracking-wider text-[var(--spr-text-muted)] uppercase">CLIENT</span>
                    <h2 id="client-drawer-title" className="text-base font-display font-extrabold text-[var(--spr-text)] leading-tight truncate">{client.name}</h2>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => generateClientCompliancePDF(client)} className="spr-btn spr-btn-primary flex items-center gap-1.5 !text-[11px] !py-1.8"><Download className="w-3.5 h-3.5" /><span>Download compliance report</span></button>
                  <button type="button" onClick={() => setSelectedClientId('global')} className="p-1.8 hover:bg-[var(--spr-surface-hover)] border border-[var(--spr-border)] rounded-md text-[var(--spr-text-muted)] hover:text-[var(--spr-text-faint)] cursor-pointer transition-colors" title="Close client" aria-label="Close client"><X className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[12px] font-mono mt-4 shrink-0">
                <span className="bg-[var(--spr-surface-hover)] text-[var(--spr-text-faint)] px-2.5 py-1 rounded-md font-medium border border-[var(--spr-border)]">Plan: {client.subscriptionTier}</span>
                <span className="bg-[var(--spr-surface-hover)] text-[var(--spr-text-faint)] px-2.5 py-1 rounded-md font-medium border border-[var(--spr-border)]">Domain: {client.domain}</span>
                <span className={`px-2.5 py-1 rounded-md font-bold border ${client.riskLevel === 'Safe' ? 'bg-[var(--spr-green)]/15 border-[var(--spr-green)] text-[var(--spr-green)]' : client.riskLevel === 'Medium' ? 'bg-[var(--spr-amber)]/15 border-[var(--spr-amber)] text-[var(--spr-amber)]' : 'bg-[var(--spr-red)]/15 border-[var(--spr-red)] text-[var(--spr-red)]'}`}>Risk: {client.riskLevel}</span>
              </div>

              <div className="flex border-b border-[var(--spr-border)] text-xs font-semibold gap-1 select-none overflow-x-auto mt-4 shrink-0" role="tablist" aria-label="Client details">
                {[
                  { id: 'overview', label: 'Overview', icon: Award },
                  { id: 'inventory', label: 'Software', icon: FileCheck },
                  { id: 'security', label: 'Security', icon: ShieldAlert },
                  { id: 'compliance', label: 'Compliance', icon: Lock },
                  { id: 'team', label: 'Contacts', icon: Users }
                ].map(tb => {
                  const Icon = tb.icon;
                  const isSel = workspaceTab === tb.id;
                  return <button key={tb.id} type="button" role="tab" aria-selected={isSel} onClick={() => setWorkspaceTab(tb.id as typeof workspaceTab)} className={`flex items-center gap-1.5 px-3 py-2 cursor-pointer border-b-2 font-sans font-bold text-[11px] transition-colors whitespace-nowrap ${isSel ? 'border-[var(--spr-highlight)] text-[var(--spr-highlight)]' : 'border-transparent text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]'}`}><Icon className="w-3.5 h-3.5" /><span>{tb.label}</span></button>;
                })}
              </div>

              <div className="flex-1 overflow-y-auto pt-4 pb-2 space-y-6">
                {workspaceTab === 'overview' && (
                  <div className="space-y-6">
                    <div className="bg-[var(--spr-surface-alt)] p-5 rounded-md border border-[var(--spr-border)]">
                      <h3 className="text-xs font-bold text-[var(--spr-text-muted)] font-mono uppercase tracking-wider mb-4">Trust overview</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] p-4 rounded-md text-center"><p className="text-[11px] text-[var(--spr-text-muted)] font-mono font-bold uppercase">Overall score</p><p className="text-2xl font-display font-extrabold font-mono text-[var(--spr-text)] mt-1">{client.trustScore}</p><span className="text-[11px] text-[var(--spr-text-muted)] font-semibold font-mono">Client record</span></div>
                        <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] p-4 rounded-md text-center"><p className="text-[11px] text-[var(--spr-text-muted)] font-mono font-bold uppercase">Security</p><p className="text-2xl font-display font-extrabold font-mono text-[var(--spr-text)] mt-1">{securityScores.length > 0 ? Math.round(securityScores.reduce((sum, score) => sum + score, 0) / securityScores.length) : 'Not verified'}</p><span className="text-[11px] text-[var(--spr-text-muted)] font-mono">Passport-derived</span></div>
                        <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] p-4 rounded-md text-center"><p className="text-[11px] text-[var(--spr-text-muted)] font-mono font-bold uppercase">Compliance</p><p className="text-2xl font-display font-extrabold font-mono text-[var(--spr-text)] mt-1">{typeof client.complianceProgress === 'number' ? `${client.complianceProgress}%` : client.complianceProgress}</p><span className="text-[11px] text-[var(--spr-text-muted)] font-mono">Client record</span></div>
                        <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] p-4 rounded-md text-center"><p className="text-[11px] text-[var(--spr-text-muted)] font-mono font-bold uppercase">Supplier reputation</p><p className="text-2xl font-display font-extrabold font-mono text-[var(--spr-text)] mt-1">{supplierReputationScores.length > 0 ? Math.round(supplierReputationScores.reduce((sum, score) => sum + score, 0) / supplierReputationScores.length) : 'Not verified'}</p><span className="text-[11px] text-[var(--spr-text-muted)] font-mono">{supplierReputationScores.length > 0 ? 'Passport-derived' : 'No vendor score observed'}</span></div>
                      </div>
                    </div>

                    <div className="bg-[var(--spr-surface-alt)] p-5 rounded-md border border-[var(--spr-border)] grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-3.5"><h3 className="text-xs font-bold text-[var(--spr-text)] font-display">Client profile</h3><div className="text-xs space-y-2"><div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5"><span className="text-[var(--spr-text-muted)] font-mono text-[12px]">ORGANIZATION</span><span className="font-semibold text-[var(--spr-text-faint)]">{client.name}</span></div><div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5"><span className="text-[var(--spr-text-muted)] font-mono text-[12px]">DOMAIN</span><span className="font-semibold text-[var(--spr-text-faint)] font-mono">{client.domain}</span></div><div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5"><span className="text-[var(--spr-text-muted)] font-mono text-[12px]">INDUSTRY</span><span className="font-semibold text-[var(--spr-text-faint)]">{client.industry}</span></div></div></div>
                      <div className="space-y-3.5"><h3 className="text-xs font-bold text-[var(--spr-text)] font-display">Service scope</h3><div className="text-xs space-y-2"><div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5"><span className="text-[var(--spr-text-muted)] font-mono text-[12px]">CLIENT ID</span><span className="font-semibold text-[var(--spr-text-faint)] font-mono break-all">{client.id}</span></div><div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5"><span className="text-[var(--spr-text-muted)] font-mono text-[12px]">JOINED</span><span className="font-semibold text-[var(--spr-text-faint)] font-mono">{client.joinedDate}</span></div><div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5"><span className="text-[var(--spr-text-muted)] font-mono text-[12px]">COMPLIANCE TARGET</span><span className="font-bold text-[var(--spr-highlight)] font-mono text-right">{client.complianceStatus.length ? client.complianceStatus.map(item => item.code).join(', ') : 'Not observed'}</span></div></div></div>
                    </div>
                  </div>
                )}

                {workspaceTab === 'inventory' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center"><h3 className="text-xs font-bold text-[var(--spr-text-muted)] font-mono uppercase tracking-wider">Software & passports</h3><span className="text-[12px] text-[var(--spr-text-muted)] font-mono">Count: {client.passportCount}</span></div>
                    {client.softwareInventory.length === 0 && <div className="rounded-md border border-dashed border-[var(--spr-border)] px-5 py-10 text-center text-xs text-[var(--spr-text-muted)]">No software passports registered for this client yet.</div>}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{passports.filter(p => client.softwareInventory.some(item => item.passportId === p.id)).map(p => <button key={p.id} type="button" onClick={() => onNavigateTab('passports', p.id)} className="bg-[var(--spr-surface-alt)] p-4 rounded-md border border-[var(--spr-border)] hover:border-[var(--spr-highlight)] cursor-pointer transition-colors space-y-3 text-left"><div className="flex justify-between items-start gap-3"><div><h4 className="text-xs font-bold text-[var(--spr-text)]">{p.name}</h4><p className="text-[12px] text-[var(--spr-text-muted)] font-mono">Version: {p.version || 'Not observed'}</p></div><span className="text-[12px] font-mono bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)] px-2 py-0.5 border border-[var(--spr-highlight)] rounded font-semibold shrink-0">{p.sbom.length} dependencies</span></div><div className="flex justify-between items-center text-[12px] font-mono text-[var(--spr-text-muted)] pt-2 border-t border-[var(--spr-border)]"><span>Compliance: {p.complianceScore == null ? 'Not verified' : `${p.complianceScore}%`}</span><span className="text-[var(--spr-highlight)] font-bold flex items-center gap-0.5">Open passport <ChevronRight className="w-3 h-3" /></span></div></button>)}</div>
                  </div>
                )}

                {workspaceTab === 'security' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center gap-3"><h3 className="text-xs font-bold text-[var(--spr-text-muted)] font-mono uppercase tracking-wider">Security findings</h3><button type="button" onClick={() => onNavigateTab('alerts')} className="text-[12px] font-mono text-[var(--spr-highlight)] hover:underline font-bold">View all findings</button></div>
                    <div className="bg-[var(--spr-surface-alt)] rounded-md border border-[var(--spr-border)] overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left border-collapse text-xs"><thead><tr className="bg-[var(--spr-surface-sunken)] text-[var(--spr-text-muted)] font-mono font-bold border-b border-[var(--spr-border)] text-[12px]"><th className="px-5 py-3">CVE ID</th><th className="px-5 py-3">COMPONENT</th><th className="px-5 py-3">SEVERITY</th><th className="px-5 py-3">CVSS</th><th className="px-5 py-3">STATUS</th><th className="px-5 py-3">THREAT SUMMARY</th></tr></thead><tbody className="divide-y divide-[var(--spr-border)] text-[var(--spr-text-faint)]">{clientPassports.flatMap(passport => (passport.vulnerabilities || []).map(vulnerability => ({ passport, vulnerability }))).map(({ passport, vulnerability }, index) => <tr key={`${passport.id}-${vulnerability.id}-${index}`} className="hover:bg-[var(--spr-surface-sunken)]"><td className="px-5 py-3.5 font-bold text-[var(--spr-highlight)] font-mono">{vulnerability.id}</td><td className="px-5 py-3.5 font-semibold">{vulnerability.component}</td><td className="px-5 py-3.5"><span className="rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-hover)] px-2.5 py-0.5 text-[11px] font-extrabold uppercase">{vulnerability.severity}</span></td><td className="px-5 py-3.5 font-bold font-mono">{vulnerability.cvss ?? 'Not observed'}</td><td className="px-5 py-3.5"><span className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-0.5 text-[11px] font-bold">{vulnerability.status}</span></td><td className="max-w-sm truncate px-5 py-3.5 text-[var(--spr-text-muted)]" title={vulnerability.description}>{vulnerability.description || 'No description observed.'}</td></tr>)}{clientPassports.every(passport => !passport.vulnerabilities?.length) && <tr><td colSpan={6} className="px-5 py-6 text-center text-[var(--spr-text-muted)] font-mono">No vulnerability observations are recorded for this client.</td></tr>}</tbody></table></div></div>
                  </div>
                )}

                {workspaceTab === 'compliance' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {client.complianceStatus.length === 0 && <div className="col-span-full rounded-md border border-dashed border-[var(--spr-border)] px-5 py-10 text-center text-xs text-[var(--spr-text-muted)]">No compliance frameworks recorded for this client yet.</div>}
                    {client.complianceStatus.map(comp => <div key={comp.id} className="bg-[var(--spr-surface-alt)] p-5 rounded-md border border-[var(--spr-border)] flex flex-col justify-between gap-4"><div className="flex justify-between items-start gap-3"><div><span className="text-[11px] font-mono font-bold bg-[var(--spr-accent-soft)] border border-[var(--spr-highlight)] text-[var(--spr-highlight)] px-2 py-0.5 rounded">{comp.code} framework</span><h3 className="text-sm font-bold text-[var(--spr-text)] font-display mt-2">{comp.name}</h3></div><span className={`px-2 py-0.5 rounded text-[12px] font-bold font-mono border ${comp.status === 'Compliant' ? 'bg-[var(--spr-green)]/15 border-[var(--spr-green)] text-[var(--spr-green)]' : comp.status === 'In Progress' ? 'bg-[var(--spr-amber)]/15 border-[var(--spr-amber)] text-[var(--spr-amber)]' : 'bg-[var(--spr-red)]/15 border-[var(--spr-red)] text-[var(--spr-red)]'}`}>{comp.status}</span></div><div className="space-y-1.5"><div className="flex justify-between text-[12px] font-mono text-[var(--spr-text-muted)]"><span>Control verification progress</span><span className="font-bold text-[var(--spr-text-faint)]">{comp.progress}%</span></div><div className="w-full bg-[var(--spr-surface-hover)] h-2 rounded-full overflow-hidden"><div className="bg-[var(--spr-accent)] h-full transition-all duration-500" style={{ width: `${comp.progress}%` }} /></div><div className="flex justify-between text-[11px] font-mono text-[var(--spr-text-muted)]"><span>{comp.compliantControls} of {comp.totalControls} controls</span><span>Verification status</span></div></div><button type="button" onClick={() => onNavigateTab('compliance')} className="spr-btn spr-btn-secondary w-full text-center">View compliance</button></div>)}
                  </div>
                )}

                {workspaceTab === 'team' && (
                  <div className="bg-[var(--spr-surface-alt)] rounded-md border border-[var(--spr-border)] overflow-hidden"><div className="px-5 py-4 border-b border-[var(--spr-border)]"><h3 className="text-sm font-bold text-[var(--spr-text)] font-display">Client contacts</h3><p className="text-[12px] text-[var(--spr-text-muted)] font-mono mt-0.5">People responsible for the client environment and security decisions.</p></div><div className="divide-y divide-[var(--spr-border)]">{client.teamMembers.length === 0 && <div className="px-5 py-10 text-center text-xs text-[var(--spr-text-muted)]">No contacts recorded for this client yet.</div>}{client.teamMembers.map((member, i) => <div key={`${member.email}-${i}`} className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-[var(--spr-surface-sunken)]"><div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 rounded-full bg-[var(--spr-accent-soft)] border border-[var(--spr-highlight)] flex items-center justify-center text-xs font-bold text-[var(--spr-highlight)] shrink-0">{member.avatar}</div><div className="min-w-0"><h4 className="text-xs font-bold text-[var(--spr-text)] truncate">{member.name}</h4><p className="text-[12px] text-[var(--spr-text-muted)] font-mono">{member.role}</p></div></div><a href={`mailto:${encodeURIComponent(member.email)}`} className="text-xs font-semibold text-[var(--spr-highlight)] hover:underline font-mono flex items-center gap-1 cursor-pointer shrink-0"><span>{member.email}</span><ExternalLink className="w-3.5 h-3.5" /></a></div>)}</div></div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {showAddClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="add-client-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !creatingClient) setShowAddClient(false); }}>
          <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.18em] text-[#c586c0]"><Building2 className="h-4 w-4" /> New client</div><h2 id="add-client-title" className="mt-1 text-lg font-bold text-[var(--spr-text)]">Add a client</h2><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">Create the client workspace you’ll use to track software, evidence, risks, and verification.</p></div><button type="button" onClick={() => setShowAddClient(false)} aria-label="Close" disabled={creatingClient} className="rounded-md p-1.5 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] hover:text-[var(--spr-text)] disabled:opacity-40"><X className="h-4 w-4" /></button></div>
            <form onSubmit={handleCreateClient} className="mt-5 space-y-3.5">
              {addClientError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2.5 text-xs text-[var(--spr-red)] flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {addClientError}</div>}
              {addClientSuccess && <div role="status" className="rounded-md border border-[var(--spr-green)]/40 bg-[var(--spr-green)]/10 px-3 py-2.5 text-xs text-[var(--spr-green)] flex items-center gap-2"><CheckCircle className="w-4 h-4 shrink-0" /> {addClientSuccess}</div>}
              <div className="flex flex-col gap-1"><label htmlFor="new-client-name" className="text-[12px] font-bold text-[var(--spr-text-muted)]">Client / organization name *</label><input id="new-client-name" required autoFocus value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Acme Manufacturing" autoComplete="organization" maxLength={200} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></div>
              <div className="flex flex-col gap-1"><label htmlFor="new-client-domain" className="text-[12px] font-bold text-[var(--spr-text-muted)]">Primary domain *</label><input id="new-client-domain" required value={newClientDomain} onChange={(e) => setNewClientDomain(e.target.value)} placeholder="acme.com" autoComplete="url" maxLength={253} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></div>
              <div className="flex flex-col gap-1"><label htmlFor="new-client-industry" className="text-[12px] font-bold text-[var(--spr-text-muted)]">Industry *</label><input id="new-client-industry" required value={newClientIndustry} onChange={(e) => setNewClientIndustry(e.target.value)} placeholder="Manufacturing" autoComplete="organization-title" maxLength={120} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" /></div>
              <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3.5"><div className="text-[12px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">SPR will track for this client</div><div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><Globe className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> Software</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><Users className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> Vendors</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><FileCheck className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> Passports</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><FileText className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> Evidence</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><Activity className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> Monitoring</div></div></div>
              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowAddClient(false)} disabled={creatingClient} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-40">Cancel</button><button type="submit" disabled={creatingClient || !newClientName.trim() || !newClientDomain.trim() || !newClientIndustry.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{creatingClient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{creatingClient ? 'Creating…' : 'Create client'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
