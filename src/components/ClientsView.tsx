/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck2,
  Filter,
  Globe,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
  Orbit,
} from 'lucide-react';
import { fuzzyMatch } from '../utils/filter';
import { toJsonArrayColumn } from '../lib/clientJsonColumns';
import { Client, SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';
import ClientGalaxyView from './ClientGalaxyView';

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

type ClientState = 'ready' | 'review' | 'unknown';

// trustScore / complianceProgress are `number | 'Not assessed'`. A client the
// scoring engine has never assessed must read "Not assessed", never 0/100 or
// "Not assessed/100" — an unassessed client is not a failing client.
const trustDisplay = (c: Client) => (typeof c.trustScore === 'number' ? `${c.trustScore}/100` : 'Not assessed');
const complianceDisplay = (c: Client) => (typeof c.complianceProgress === 'number' ? `${c.complianceProgress}%` : 'Not assessed');

const stateForClient = (client: Client): ClientState => {
  if (client.riskLevel === 'High' || client.criticalRisksCount > 0) return 'review';
  const assessed = typeof client.complianceProgress === 'number' && client.complianceProgress > 0;
  if (!client.passportCount || !assessed) return 'unknown';
  return 'ready';
};

const stateLabel: Record<ClientState, string> = {
  ready: 'Operational',
  review: 'Needs attention',
  unknown: 'Evidence gap',
};

export default function ClientsView({
  clients,
  selectedClientId,
  setSelectedClientId,
  passports,
  onNavigateTab,
  searchQuery,
  role = 'Viewer',
  onClientCreated,
}: ClientsViewProps) {
  const [industryFilter, setIndustryFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState<'all' | ClientState>('all');
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientDomain, setNewClientDomain] = useState('');
  const [newClientIndustry, setNewClientIndustry] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const [addClientError, setAddClientError] = useState<string | null>(null);
  const [addClientSuccess, setAddClientSuccess] = useState<string | null>(null);
  const [showGalaxy, setShowGalaxy] = useState(false);

  const canCreateClient = role === 'Owner' || role === 'Admin';

  useEffect(() => {
    if (!showAddClient) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creatingClient) setShowAddClient(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAddClient, creatingClient]);

  useEffect(() => {
    if (selectedClientId !== 'global' && !clients.some((client) => client.id === selectedClientId)) {
      setSelectedClientId('global');
    }
  }, [clients, selectedClientId, setSelectedClientId]);

  const industries = useMemo(
    () => Array.from(new Set(clients.map((client) => client.industry).filter(Boolean))).sort(),
    [clients],
  );

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      const matchesSearch = searchQuery
        ? fuzzyMatch(searchQuery, client.name) || fuzzyMatch(searchQuery, client.domain) || fuzzyMatch(searchQuery, client.industry)
        : true;
      const matchesIndustry = industryFilter === 'all' || client.industry === industryFilter;
      const matchesRisk = riskFilter === 'all' || client.riskLevel === riskFilter;
      const matchesState = stateFilter === 'all' || stateForClient(client) === stateFilter;
      return matchesSearch && matchesIndustry && matchesRisk && matchesState;
    });
  }, [clients, searchQuery, industryFilter, riskFilter, stateFilter]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) || null,
    [clients, selectedClientId],
  );

  const selectedPassports = useMemo(() => {
    if (!selectedClient) return [];
    const ids = new Set((selectedClient.softwareInventory || []).map((item: any) => item.passportId).filter(Boolean));
    return passports.filter((passport) => ids.has(passport.id));
  }, [selectedClient, passports]);

  const portfolio = useMemo(() => {
    const operational = clients.filter((client) => stateForClient(client) === 'ready').length;
    const attention = clients.filter((client) => stateForClient(client) === 'review').length;
    const evidenceGaps = clients.filter((client) => stateForClient(client) === 'unknown').length;
    const software = clients.reduce((sum, client) => sum + (client.passportCount || 0), 0);
    const critical = clients.reduce((sum, client) => sum + (client.criticalRisksCount || 0), 0);
    return { operational, attention, evidenceGaps, software, critical };
  }, [clients]);

  const handleCreateClient = async (event: React.FormEvent) => {
    event.preventDefault();
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
        id: data.id,
        name: data.name,
        domain: data.domain,
        industry: data.industry,
        trustScore: data.trustScore ?? 'Not assessed',
        riskLevel: data.riskLevel ?? 'Unknown',
        avatarColor: data.avatarColor ?? 'indigo',
        subscriptionTier: data.subscriptionTier ?? 'Standard',
        joinedDate: data.joinedDate ?? new Date().toISOString(),
        teamCount: data.teamCount ?? 1,
        passportCount: data.passportCount ?? 0,
        criticalRisksCount: data.criticalRisksCount ?? 0,
        complianceProgress: data.complianceProgress ?? 'Not assessed',
        softwareInventory: toJsonArrayColumn(data.softwareInventory),
        complianceStatus: toJsonArrayColumn(data.complianceStatus),
        teamMembers: toJsonArrayColumn(data.teamMembers),
        activityTimeline: toJsonArrayColumn(data.activityTimeline),
      };
      onClientCreated?.(created);
      setSelectedClientId(created.id);
      setAddClientSuccess(`${created.name} created.`);
      setNewClientName('');
      setNewClientDomain('');
      setNewClientIndustry('');
      window.setTimeout(() => {
        setShowAddClient(false);
        setAddClientSuccess(null);
      }, 1000);
    } catch (error) {
      setAddClientError(error instanceof Error ? error.message : 'Unable to create client.');
    } finally {
      setCreatingClient(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ['Client Name', 'Domain', 'Industry', 'Trust Score', 'Software', 'Compliance', 'Risk', 'Critical Risks'];
    const escapeCsv = (value: unknown) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = filteredClients.map((client) => [
      client.name,
      client.domain,
      client.industry,
      client.trustScore,
      client.passportCount,
      client.complianceProgress,
      client.riskLevel,
      client.criticalRisksCount,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `spr-client-galaxies-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (showGalaxy && selectedClient) {
    return <ClientGalaxyView client={selectedClient} passports={passports} onClose={() => setShowGalaxy(false)} onOpenLaunchTicket={(id) => onNavigateTab('passports', id)} />;
  }

  return (
    <div className="space-y-6" id="msp-clients-index">
      <section className="spr-panel p-5 sm:p-6 overflow-hidden relative">
        <div className="absolute inset-x-0 top-0 h-px bg-[var(--spr-highlight)] opacity-70" />
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-5">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">
              <Building2 className="h-4 w-4" /> Client galaxies
            </div>
            <h1 className="text-2xl font-display font-extrabold text-[var(--spr-text)] mt-2">A living system map for every client</h1>
            <p className="text-sm text-[var(--spr-text-muted)] mt-2 max-w-2xl">
              Each client is its own operational galaxy: software, evidence, findings and Launch Tickets stay connected to their real records. Unknown means insufficient evidence—not a pass.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreateClient && (
              <button className="spr-btn spr-btn-primary flex items-center gap-2" type="button" onClick={() => { setShowAddClient(true); setAddClientError(null); setAddClientSuccess(null); }}>
                <Plus className="w-4 h-4" /> Add client
              </button>
            )}
            <button className="spr-btn spr-btn-secondary flex items-center gap-2" type="button" onClick={handleExportCSV} disabled={!filteredClients.length}>
              <Download className="w-4 h-4" /> Export view
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6">
          <Metric label="Clients" value={clients.length} icon={<Users className="w-4 h-4" />} />
          <Metric label="Operational" value={portfolio.operational} icon={<CheckCircle2 className="w-4 h-4" />} />
          <Metric label="Needs attention" value={portfolio.attention} icon={<AlertTriangle className="w-4 h-4" />} />
          <Metric label="Evidence gaps" value={portfolio.evidenceGaps} icon={<FileCheck2 className="w-4 h-4" />} />
          <Metric label="Critical risks" value={portfolio.critical} icon={<ShieldAlert className="w-4 h-4" />} />
        </div>
      </section>

      <section className="spr-panel-alt p-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--spr-text-muted)]" />
            <input
              value={searchQuery}
              readOnly
              aria-label="Global client search"
              placeholder="Search is controlled by the workspace header…"
              className="w-full bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md pl-9 pr-3 py-2.5 text-sm text-[var(--spr-text)] placeholder:text-[var(--spr-text-faint)] focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1.5 text-xs text-[var(--spr-text-muted)]"><Filter className="w-3.5 h-3.5" /> Filter</div>
            <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} className="bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md px-3 py-2 text-xs font-semibold text-[var(--spr-text)]">
              <option value="all">All industries</option>
              {industries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
            </select>
            <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md px-3 py-2 text-xs font-semibold text-[var(--spr-text)]">
              <option value="all">All risk</option>
              <option value="Safe">Safe</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
            <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)} className="bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md px-3 py-2 text-xs font-semibold text-[var(--spr-text)]">
              <option value="all">All states</option>
              <option value="ready">Operational</option>
              <option value="review">Needs attention</option>
              <option value="unknown">Evidence gap</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 text-[11px] font-mono text-[var(--spr-text-muted)]">
          <span>{filteredClients.length} of {clients.length} clients in view</span>
          <span>{portfolio.software} software records across portfolio</span>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)] gap-5 items-start">
        <section className="spr-panel overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--spr-border)] flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--spr-text)]">Client galaxies</h2>
              <p className="text-[11px] text-[var(--spr-text-muted)] mt-1">Select a client galaxy to inspect its software and evidence context.</p>
            </div>
            <span className="text-[10px] font-mono text-[var(--spr-text-faint)] uppercase tracking-wider">Live workspace</span>
          </div>

          <div className="divide-y divide-[var(--spr-border)]">
            {filteredClients.map((client) => {
              const state = stateForClient(client);
              const active = selectedClientId === client.id;
              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelectedClientId(client.id)}
                  className={`w-full text-left p-4 transition-colors ${active ? 'bg-[var(--spr-surface-alt)]' : 'hover:bg-[var(--spr-surface-alt)]'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-md shrink-0 flex items-center justify-center font-bold text-sm ${client.avatarColor}`}>{client.name.charAt(0)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-[var(--spr-text)] truncate">{client.name}</span>
                            <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wide ${state === 'ready' ? 'text-[var(--spr-green)] border-[var(--spr-green)]/40 bg-[var(--spr-green)]/10' : state === 'review' ? 'text-[var(--spr-red)] border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10' : 'text-[var(--spr-amber)] border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10'}`}>{stateLabel[state]}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-[var(--spr-text-muted)] font-mono">
                            <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{client.domain}</span>
                            <span>•</span><span>{client.industry}</span>
                          </div>
                        </div>
                        <ChevronRight className={`w-4 h-4 shrink-0 mt-1 ${active ? 'text-[var(--spr-highlight)]' : 'text-[var(--spr-text-faint)]'}`} />
                      </div>
                      <div className="grid grid-cols-4 gap-2 mt-3">
                        <MiniStat label="Trust" value={trustDisplay(client)} />
                        <MiniStat label="Software" value={client.passportCount ?? 0} />
                        <MiniStat label="Compliance" value={complianceDisplay(client)} />
                        <MiniStat label="Risks" value={client.criticalRisksCount ?? 0} />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {!filteredClients.length && (
              <div className="p-10 text-center">
                <Search className="w-6 h-6 mx-auto text-[var(--spr-text-faint)]" />
                <p className="text-sm font-semibold text-[var(--spr-text)] mt-3">No clients match this view</p>
                <p className="text-xs text-[var(--spr-text-muted)] mt-1">Clear a filter or use a broader workspace search.</p>
              </div>
            )}
          </div>
        </section>

        <section className="spr-panel overflow-hidden sticky top-4">
          {selectedClient ? (
            <>
              <div className="p-5 border-b border-[var(--spr-border)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-12 h-12 rounded-md flex items-center justify-center font-bold ${selectedClient.avatarColor}`}>{selectedClient.name.charAt(0)}</div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono uppercase tracking-[.18em] text-[var(--spr-highlight)]">Selected galaxy</p>
                      <h2 className="text-lg font-bold text-[var(--spr-text)] truncate">{selectedClient.name}</h2>
                      <p className="text-[11px] font-mono text-[var(--spr-text-muted)] truncate">{selectedClient.domain}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${stateForClient(selectedClient) === 'review' ? 'text-[var(--spr-red)] border-[var(--spr-red)]/40' : stateForClient(selectedClient) === 'unknown' ? 'text-[var(--spr-amber)] border-[var(--spr-amber)]/40' : 'text-[var(--spr-green)] border-[var(--spr-green)]/40'}`}>{stateLabel[stateForClient(selectedClient)]}</span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-5">
                  <Metric label="Trust posture" value={trustDisplay(selectedClient)} icon={<ShieldCheck className="w-4 h-4" />} />
                  <Metric label="Compliance" value={complianceDisplay(selectedClient)} icon={<FileCheck2 className="w-4 h-4" />} />
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[var(--spr-text)]">Evidence posture</span>
                    <span className="text-[10px] font-mono text-[var(--spr-text-muted)]">{selectedPassports.length} linked Launch Tickets</span>
                  </div>
                  <div className="h-2 bg-[var(--spr-surface-sunken)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--spr-highlight)] rounded-full" style={{ width: `${typeof selectedClient.complianceProgress === 'number' ? Math.max(0, Math.min(100, selectedClient.complianceProgress)) : 0}%` }} />
                  </div>
                  <p className="text-[11px] text-[var(--spr-text-muted)] mt-2">Coverage is based on available records. It should not be read as a certification by itself.</p>
                </div>

                <button type="button" onClick={() => setShowGalaxy(true)} className="spr-btn spr-btn-primary w-full"><Orbit className="w-4 h-4" /> View Client Galaxy →</button>

                <div className="grid grid-cols-2 gap-2">
                  <ActionButton icon={<FileCheck2 className="w-4 h-4" />} label="Open Launch Tickets" onClick={() => onNavigateTab('passports')} />
                  <ActionButton icon={<Activity className="w-4 h-4" />} label="Open monitoring" onClick={() => onNavigateTab('monitoring')} />
                  <ActionButton icon={<ShieldAlert className="w-4 h-4" />} label="Review security" onClick={() => onNavigateTab('security')} />
                  <ActionButton icon={<Users className="w-4 h-4" />} label="Client team" onClick={() => onNavigateTab('clients', selectedClient.id)} />
                </div>

                <div className="border border-[var(--spr-border)] rounded-md overflow-hidden">
                  <div className="px-3 py-2 bg-[var(--spr-surface-alt)] text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-muted)]">Orbiting software</div>
                  {selectedPassports.slice(0, 5).map((passport) => (
                    <button key={passport.id} type="button" onClick={() => onNavigateTab('passports', passport.id)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border-t border-[var(--spr-border)] hover:bg-[var(--spr-surface-alt)] text-left">
                      <div className="min-w-0"><p className="text-xs font-semibold text-[var(--spr-text)] truncate">{passport.name}</p><p className="text-[10px] font-mono text-[var(--spr-text-faint)] truncate">{passport.version || 'Version unknown'}</p></div>
                      <ArrowUpRight className="w-3.5 h-3.5 text-[var(--spr-text-faint)] shrink-0" />
                    </button>
                  ))}
                  {!selectedPassports.length && <p className="px-3 py-4 text-[11px] text-[var(--spr-text-muted)]">No linked Launch Ticket records are available yet.</p>}
                </div>
              </div>
            </>
          ) : (
            <div className="p-10 text-center">
              <Building2 className="w-7 h-7 mx-auto text-[var(--spr-text-faint)]" />
              <p className="text-sm font-semibold text-[var(--spr-text)] mt-3">Select a client</p>
              <p className="text-xs text-[var(--spr-text-muted)] mt-1">The client command view will appear here.</p>
            </div>
          )}
        </section>
      </div>

      <section className="spr-panel-alt p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 mt-0.5 text-[var(--spr-highlight)]" />
          <div><p className="text-xs font-bold text-[var(--spr-text)]">Operational rule</p><p className="text-[11px] text-[var(--spr-text-muted)] mt-0.5">Use client state to route work; use evidence and findings to establish what is actually verified.</p></div>
        </div>
        <button type="button" className="spr-btn spr-btn-secondary shrink-0" onClick={() => onNavigateTab('evidence-explorer')}>Explore evidence <ArrowUpRight className="w-3.5 h-3.5 ml-1.5 inline" /></button>
      </section>

      {showAddClient && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="add-client-title">
          <div className="spr-panel w-full max-w-lg p-5">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div><p className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[.18em] text-[var(--spr-highlight)]"><Building2 className="w-3.5 h-3.5" /> New client</p><h2 id="add-client-title" className="text-lg font-bold text-[var(--spr-text)] mt-1">Add a client</h2><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">Create the client workspace you’ll use to track software, evidence, risks, and verification.</p></div>
              <button type="button" onClick={() => !creatingClient && setShowAddClient(false)} className="spr-btn spr-btn-secondary p-2" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreateClient} className="space-y-4">
              <Field label="Client name"><input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} autoFocus placeholder="Acme Corporation" className="field-input" /></Field>
              <Field label="Primary domain"><input value={newClientDomain} onChange={(e) => setNewClientDomain(e.target.value)} placeholder="acme.example" className="field-input" /></Field>
              <Field label="Industry"><input value={newClientIndustry} onChange={(e) => setNewClientIndustry(e.target.value)} placeholder="Financial services" className="field-input" /></Field>
              <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3.5"><div className="text-[10px] font-mono font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">SPR will track for this client</div><div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><Globe className="w-3.5 h-3.5 text-[var(--spr-highlight)]" /> Software</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><Users className="w-3.5 h-3.5 text-[var(--spr-highlight)]" /> Vendors</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><FileCheck2 className="w-3.5 h-3.5 text-[var(--spr-highlight)]" /> Launch Tickets</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><ShieldCheck className="w-3.5 h-3.5 text-[var(--spr-highlight)]" /> Evidence</div><div className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text-muted)]"><Activity className="w-3.5 h-3.5 text-[var(--spr-highlight)]" /> Monitoring</div></div></div>
              {addClientError && <div className="p-3 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 text-xs text-[var(--spr-red)]">{addClientError}</div>}
              {addClientSuccess && <div className="p-3 rounded-md border border-[var(--spr-green)]/40 bg-[var(--spr-green)]/10 text-xs text-[var(--spr-green)] flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{addClientSuccess}</div>}
              <div className="flex justify-end gap-2 pt-2"><button type="button" className="spr-btn spr-btn-secondary" onClick={() => setShowAddClient(false)} disabled={creatingClient}>Cancel</button><button type="submit" className="spr-btn spr-btn-primary" disabled={creatingClient}>{creatingClient ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5 inline" />Creating…</> : 'Create client'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
  return <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md p-3"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-[var(--spr-text-muted)]">{icon}{label}</div><div className="text-lg font-mono font-bold text-[var(--spr-text)] mt-1">{value}</div></div>;
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded p-2"><p className="text-[9px] uppercase tracking-wide font-bold text-[var(--spr-text-faint)]">{label}</p><p className="text-xs font-mono font-bold text-[var(--spr-text)] mt-0.5">{value}</p></div>;
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="spr-btn spr-btn-secondary flex items-center justify-center gap-2 text-[11px] min-h-9">{icon}{label}</button>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--spr-text-muted)] mb-1.5">{label}</span>{children}</label>;
}
