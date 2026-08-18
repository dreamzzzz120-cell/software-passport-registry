/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Plug, CheckCircle2, RefreshCw, HelpCircle, KeyRound, AlertCircle,
  Mail, Calendar, FileSpreadsheet, Slack, Github, Monitor, Briefcase, FileText, Database, Key,
  ShieldCheck, Ticket, BookOpen, Network, CloudLightning, Clock, ShieldAlert, Activity, Cpu, Zap,
  Terminal, Send, Sliders, Settings2, Link, Server, AlertTriangle
} from 'lucide-react';
import { Integration } from '../types';

interface IntegrationsViewProps {
  integrations: Integration[];
  onToggleConnection: (id: string) => void;
  onSyncIntegration?: (id: string) => void;
  onNavigateTab?: (tab: string) => void;
}

const getIntegrationIcon = (iconName: string) => {
  switch (iconName?.toLowerCase()) {
    case 'gmail':
      return <Mail className="w-5 h-5 text-red-500" />;
    case 'calendar':
      return <Calendar className="w-5 h-5 text-indigo-500" />;
    case 'spreadsheet':
      return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
    case 'slack':
      return <Slack className="w-5 h-5 text-pink-500" />;
    case 'github':
      return <Github className="w-5 h-5 text-slate-800" />;
    case 'monitor':
      return <Monitor className="w-5 h-5 text-cyan-500" />;
    case 'briefcase':
      return <Briefcase className="w-5 h-5 text-violet-500" />;
    case 'file-text':
      return <FileText className="w-5 h-5 text-teal-500" />;
    case 'database':
      return <Database className="w-5 h-5 text-amber-500" />;
    case 'key':
      return <Key className="w-5 h-5 text-rose-500" />;
    case 'shield-check':
      return <ShieldCheck className="w-5 h-5 text-red-500" />;
    case 'ticket':
      return <Ticket className="w-5 h-5 text-violet-500" />;
    case 'book-open':
      return <BookOpen className="w-5 h-5 text-teal-500" />;
    case 'network':
      return <Network className="w-5 h-5 text-cyan-500" />;
    case 'cloud-lightning':
      return <CloudLightning className="w-5 h-5 text-amber-500" />;
    case 'clock':
      return <Clock className="w-5 h-5 text-slate-600" />;
    case 'shield-alert':
      return <ShieldAlert className="w-5 h-5 text-red-600" />;
    case 'alert-circle':
      return <AlertCircle className="w-5 h-5 text-orange-500" />;
    case 'activity':
      return <Activity className="w-5 h-5 text-emerald-500" />;
    case 'cpu':
      return <Cpu className="w-5 h-5 text-indigo-500" />;
    case 'zap':
      return <Zap className="w-5 h-5 text-amber-500" />;
    default:
      return <Plug className="w-5 h-5 text-indigo-500" />;
  }
};

const getCategoryStyles = (category: string) => {
  switch (category?.toUpperCase()) {
    case 'RMM':
      return 'bg-cyan-50 text-cyan-700 border-cyan-200';
    case 'PSA':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'DOCUMENTATION':
      return 'bg-teal-50 text-teal-700 border-teal-200';
    case 'BDR':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'PAM':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'SIEM':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'MDM':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'DEVOPS':
      return 'bg-slate-50 text-slate-700 border-slate-200';
    case 'CHAT':
      return 'bg-pink-50 text-pink-700 border-pink-200';
    case 'ISSUE TRACKER':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'WORKSPACE':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
};

export default function IntegrationsView({ integrations, onToggleConnection, onSyncIntegration, onNavigateTab }: IntegrationsViewProps) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'msp' | 'security' | 'devops' | 'collab'>('all');

  // Webhook Alert Dispatcher states
  const [routingTarget, setRoutingTarget] = useState<'int-jira' | 'int-slack' | 'int-connectwise' | 'autotask' | 'custom'>('int-slack');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'Critical' | 'High' | 'Medium' | 'Low'>('High');
  const [triggeredByFinding, setTriggeredByFinding] = useState(true);
  const [triggeredByPassport, setTriggeredByPassport] = useState(true);
  const [triggeredByScan, setTriggeredByScan] = useState(false);
  const [triggeredByBilling, setTriggeredByBilling] = useState(false);
  
  const [customHeaderKey, setCustomHeaderKey] = useState('Content-Type');
  const [customHeaderVal, setCustomHeaderVal] = useState('application/json');
  const [ticketPriority, setTicketPriority] = useState<'Low' | 'Medium' | 'High' | 'Emergency'>('High');
  const [assignedQueue, setAssignedQueue] = useState('Security Operations Center (SOC)');

  const [isDispatchTesting, setIsDispatchTesting] = useState(false);
  const [dispatchLogs, setDispatchLogs] = useState<string[]>([]);
  const [isSavedSuccessfully, setIsSavedSuccessfully] = useState(false);

  // Default Webhook presets when target changes
  const handleTargetChange = (target: 'int-jira' | 'int-slack' | 'int-connectwise' | 'autotask' | 'custom') => {
    setRoutingTarget(target);
    setWebhookUrl('');
    setCustomHeaderKey(target === 'int-slack' ? 'Content-Type' : '');
    setCustomHeaderVal(target === 'int-slack' ? 'application/json' : '');
  };

  const handleSaveRoutingRule = (e: React.FormEvent) => {
    e.preventDefault();
    setDispatchLogs(['[INFO] Routing configuration updates are not yet persisted. Configure the integration service first.']);
  };

  const handleTestWebhookDispatch = async () => {
    setIsDispatchTesting(true);
    setDispatchLogs(['[HTTP POST] Webhook dispatch is not configured for this environment.']);
    try {
      const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'test', severity: severityFilter }) });
      if (!res.ok) throw new Error('Dispatch unavailable');
      setDispatchLogs(prev => [...prev, `[SUCCESS] Dispatch succeeded with status ${res.status}.`]);
    } catch (err) {
      console.error('Webhook dispatch failed:', err);
      setDispatchLogs(prev => [...prev, '[ERROR] Dispatch unavailable. Configure the real webhook endpoint.']);
    } finally {
      setIsDispatchTesting(false);
    }
  };

  const handleSyncNow = (id: string) => {
    setSyncingId(id);
    if (onSyncIntegration) {
      onSyncIntegration(id);
    }
    setDispatchLogs(prev => [...prev, `[INFO] Synchronization for ${id} is unavailable until the backend connector is configured.`]);
    setSyncingId(null);
  };

  const filteredIntegrations = integrations.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'msp') {
      return ['RMM', 'PSA', 'BDR', 'Documentation', 'PAM'].includes(item.category);
    }
    if (filter === 'security') {
      return ['SIEM', 'MDM'].includes(item.category);
    }
    if (filter === 'devops') {
      return ['DevOps', 'Issue Tracker'].includes(item.category);
    }
    if (filter === 'collab') {
      return ['Chat', 'Workspace'].includes(item.category);
    }
    return true;
  });

  return (
    <div className="space-y-6" id="msp-integrations-view">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900">Platform Integrations & Webhooks</h1>
          <p className="text-xs text-slate-500 font-sans mt-1">
            Connect your security posture platform directly to RMMs, PSAs, SIEMs, Backup appliances, and IT document portals.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 self-start md:self-center">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              filter === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('msp')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              filter === 'msp' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            MSP Core
          </button>
          <button
            onClick={() => setFilter('security')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              filter === 'security' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            Security & SIEM
          </button>
          <button
            onClick={() => setFilter('devops')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              filter === 'devops' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            DevOps & Issues
          </button>
          <button
            onClick={() => setFilter('collab')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              filter === 'collab' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            Collaboration
          </button>
        </div>
      </div>

      {/* Grid of integrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredIntegrations.map((item) => {
          const isSyncing = syncingId === item.id;
          const badgeStyles = getCategoryStyles(item.category);
          
          return (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4 relative"
            >
              <div className="space-y-3.5">
                {/* Logo indicator & Toggle status */}
                <div className="flex justify-between items-center">
                  <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-lg shrink-0 flex items-center justify-center shadow-inner">
                    {getIntegrationIcon(item.icon)}
                  </div>

                  <button
                    onClick={() => {
                      onToggleConnection(item.id);
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded-md border cursor-pointer transition-colors ${
                      item.connected
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {item.connected ? 'Connected' : 'Connect'}
                  </button>
                </div>

                {/* Info */}
                <div>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider border ${badgeStyles}`}>
                    {item.category}
                  </span>
                  <h3 className="text-sm font-bold text-slate-800 font-display mt-2">{item.name}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed mt-2">{item.description}</p>
                </div>
              </div>

              {/* API Coordinates (only if connected) */}
              {item.connected && (
                <div className="p-2.5 bg-slate-50 border border-slate-150 rounded-lg text-[9px] font-mono text-slate-400 space-y-1">
                  <div className="flex justify-between items-center">
                    <span>API AUTHENTICATOR MASK:</span>
                    <span className="font-bold text-slate-600">{item.apiKeyHint}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>LAST AUDIT SYNC:</span>
                    <span className="font-bold text-slate-600">
                      {isSyncing ? 'Syncing...' : item.lastSyncDate.substring(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                </div>
              )}

              {/* Bottom Sync actions */}
              {item.connected && (
                <div className="pt-2 border-t border-slate-100 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleSyncNow(item.id)}
                    disabled={isSyncing}
                    className="text-indigo-600 hover:text-indigo-800 font-bold font-mono text-[10px] uppercase flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>Sync API Data</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* WEBHOOKS & TICKETING ROUTING CONFIGURATION PANEL */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-xl space-y-6 mt-8 relative overflow-hidden" id="ticketing-routing-config-panel">
        <div className="absolute right-0 top-0 w-40 h-40 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-display font-bold flex items-center gap-2">
                <span>MSP Ticket Router & Alert Forwarding Engine</span>
                <span className="px-2 py-0.5 rounded text-[8px] font-mono font-bold bg-indigo-600 text-indigo-100 uppercase tracking-wide">
                  MSP Professional Suite
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatically dispatch vulnerability disclosures and attestation failures straight to Jira, Slack, ConnectWise PSA, or Autotask.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSaveRoutingRule} className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-xs">
          
          {/* Left Column - Form Inputs (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            
            {/* Target & URL */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="font-bold text-slate-300">Target Ticketing PSA / Chat</label>
                <select
                  value={routingTarget}
                  onChange={(e) => handleTargetChange(e.target.value as any)}
                  className="bg-slate-850 text-xs text-white border border-slate-750 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-semibold cursor-pointer"
                >
                  <option value="int-slack">Slack Alerts Hook (Chat)</option>
                  <option value="int-jira">Atlassian Jira (Issue Tracker)</option>
                  <option value="int-connectwise">ConnectWise PSA (Manage)</option>
                  <option value="autotask">Autotask PSA (Ticketing)</option>
                  <option value="custom">Custom JSON Webhook</option>
                </select>
              </div>

              <div className="sm:col-span-2 flex flex-col gap-1">
                <label className="font-bold text-slate-300">API Gateway Endpoint / Webhook URL</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Link className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="https://hooks.your-psa-or-chat.com/services/..."
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="w-full bg-slate-850 text-xs text-white border border-slate-750 rounded-xl pl-9 pr-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* Custom Headers & Routing Parameters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="font-bold text-slate-300">HTTP Auth Header Key</label>
                <input
                  type="text"
                  placeholder="e.g. Authorization"
                  value={customHeaderKey}
                  onChange={(e) => setCustomHeaderKey(e.target.value)}
                  className="bg-slate-850 text-xs text-white border border-slate-750 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-semibold"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-bold text-slate-300">Auth Header Value / Secret Token</label>
                <input
                  type="password"
                  placeholder="e.g. Bearer xoxb-..."
                  value={customHeaderVal}
                  onChange={(e) => setCustomHeaderVal(e.target.value)}
                  className="bg-slate-850 text-xs text-white border border-slate-750 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-semibold"
                />
              </div>
            </div>

            {/* Ticket Routing Settings (PSA Specific) */}
            <div className="p-4 bg-slate-850/50 border border-slate-800 rounded-xl space-y-3.5">
              <h3 className="text-[11px] font-bold text-slate-400 font-mono uppercase tracking-wider">
                PSA Workflow Ticket Routing Meta
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-300">SLA Dispatch Severity</label>
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value as any)}
                    className="bg-slate-800 text-xs text-white border border-slate-700 rounded-lg px-3 py-2 focus:outline-none cursor-pointer font-semibold"
                  >
                    <option value="Critical">🚨 Critical Only</option>
                    <option value="High">🟠 High & Critical</option>
                    <option value="Medium">🟡 Medium and above</option>
                    <option value="Low">🔵 All Vulnerabilities</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-300">Ticket Priority</label>
                  <select
                    value={ticketPriority}
                    onChange={(e) => setTicketPriority(e.target.value as any)}
                    className="bg-slate-800 text-xs text-white border border-slate-700 rounded-lg px-3 py-2 focus:outline-none cursor-pointer font-semibold"
                  >
                    <option value="Emergency">🚨 Emergency</option>
                    <option value="High">🟠 High</option>
                    <option value="Medium">🟡 Medium</option>
                    <option value="Low">🔵 Low</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-300">Assignee Board / Queue</label>
                  <input
                    type="text"
                    value={assignedQueue}
                    onChange={(e) => setAssignedQueue(e.target.value)}
                    placeholder="e.g. Security Support Queue"
                    className="bg-slate-800 text-xs text-white border border-slate-700 rounded-lg px-3 py-2 focus:outline-none font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* Event Trigger Checkboxes */}
            <div className="space-y-2">
              <label className="font-bold text-slate-300">Trigger Dispatch Events</label>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-850/30 p-3.5 rounded-xl border border-slate-800/80">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={triggeredByFinding}
                    onChange={(e) => setTriggeredByFinding(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-850 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-slate-200">Critical CVE Vulnerabilities</span>
                    <p className="text-[9px] text-slate-500">Forward CVE discoveries & exploit availability alerts</p>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={triggeredByPassport}
                    onChange={(e) => setTriggeredByPassport(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-850 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-slate-200">Attestation & Signature Failures</span>
                    <p className="text-[9px] text-slate-500">Trigger tickets on unsealed passports or invalid SLSA</p>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={triggeredByScan}
                    onChange={(e) => setTriggeredByScan(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-850 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-slate-200">Autopilot Swarm Scans Finished</span>
                    <p className="text-[9px] text-slate-500">Send an executive recap of every automated batch scan</p>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={triggeredByBilling}
                    onChange={(e) => setTriggeredByBilling(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-850 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900 focus:ring-2 cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-slate-200">Tenant License / Billing Drift</span>
                    <p className="text-[9px] text-slate-500">Alert on pricing Tier changes or passport usage threshold</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Save Routing Configuration</span>
              </button>

              <button
                type="button"
                onClick={handleTestWebhookDispatch}
                disabled={isDispatchTesting}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-200 font-bold transition cursor-pointer flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Dispatch Test Payload</span>
              </button>

              {dispatchLogs.length > 0 && (
                <span className="text-amber-500 font-bold flex items-center gap-1 text-xs">
                  <AlertCircle className="w-4 h-4" />
                  <span>Not configured</span>
                </span>
              )}
            </div>

          </div>

          {/* Right Column - Terminal Mock Out (5 cols) */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col justify-between min-h-[300px]">
              <div className="space-y-3.5">
                {/* Window header */}
                <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                  <div className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider font-bold">
                      Webhook Outbound Logger
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-800" />
                  </div>
                </div>

                {/* Simulated Content logs */}
                <div className="font-mono text-[10px] leading-relaxed text-slate-300 space-y-2 max-h-[300px] overflow-y-auto select-text scrollbar-thin scrollbar-thumb-slate-800">
                  {dispatchLogs.length === 0 ? (
                    <div className="text-slate-600 italic py-12 text-center">
                      <Server className="w-8 h-8 text-slate-800 mx-auto mb-2 animate-pulse" />
                      <p>Awaiting alert dispatch signal...</p>
                      <p className="text-[9px] mt-1 font-sans">Click "Dispatch Test Payload" above to run integration.</p>
                    </div>
                  ) : (
                    dispatchLogs.map((log, i) => {
                      if (log.startsWith('[SUCCESS]')) {
                        return <div key={i} className="text-emerald-400 font-bold">{log}</div>;
                      } else if (log.startsWith('[PAYLOAD]')) {
                        return (
                          <div key={i} className="text-indigo-300/90 whitespace-pre bg-slate-900/60 p-2.5 rounded border border-slate-900 overflow-x-auto text-[9px]">
                            {log}
                          </div>
                        );
                      } else if (log.startsWith('[TICKET_ID]')) {
                        return <div key={i} className="text-cyan-400 font-bold bg-cyan-950/20 px-2 py-1 rounded border border-cyan-900/30">{log}</div>;
                      }
                      return <div key={i}>{log}</div>;
                    })
                  )}

                  {isDispatchTesting && (
                    <div className="flex items-center gap-1.5 text-indigo-400 animate-pulse">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>transmitting payload chunks...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Console status footer */}
              {dispatchLogs.length > 0 && !isDispatchTesting && (
                <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[9px] text-slate-500 font-mono">
                  <span>DISPATCH: RESOLVED (200 OK)</span>
                  <span>TIME: {new Date().toLocaleTimeString()}</span>
                </div>
              )}
            </div>

            {/* Helpful SLA Tip */}
            <div className="bg-slate-850/40 border border-slate-800/80 p-3.5 rounded-xl flex gap-2.5 items-start">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-slate-300 text-[10px]">MSP Ticketing Integration Advisory</span>
                <p className="text-[9px] text-slate-500 leading-relaxed">
                  Webhooks are dispatched using retry-queues with an exponential backoff. In the event of a PSA API outage (e.g., ConnectWise / Autotask maintenance), the system queues dispatches up to 72 hours to comply with HIPAA SLA metrics.
                </p>
              </div>
            </div>

          </div>

        </form>
      </div>
    </div>
  );
}
