/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
// @ts-ignore
import sprLegalBadge from '../assets/images/spr_legal_badge_1783630546377.jpg';
import SPRLogo from './SPRLogo';
import {
  LayoutDashboard,
  Building2,
  FileCheck,
  Radar,
  Factory,
  Server,
  ShieldAlert,
  ClipboardCheck,
  FileBarChart2,
  Shield,
  Sparkles,
  Brain,
  Cpu,
  Bell,
  Plug,
  CreditCard,
  Settings,
  ChevronDown,
  Globe,
  Award,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Layers,
  Handshake
} from 'lucide-react';
import { Client } from '../types';

interface SidebarProps {
  clients: Client[];
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  alertCount: number;
  installedExtensions: string[];
  userRole: string;
}

export default function Sidebar({
  clients,
  selectedClientId,
  setSelectedClientId,
  activeTab,
  setActiveTab,
  alertCount,
  installedExtensions,
  userRole
}: SidebarProps) {
  const [showClientSelector, setShowClientSelector] = useState(false);

  const selectedClient = clients.find(c => c.id === selectedClientId);

  // Grouped Navigation Mappings with Dynamic Active Extensions
  const menuGroups = useMemo(() => {
    const activeExtensionsList: any[] = [];

    if (installedExtensions.includes('exec-board')) {
      activeExtensionsList.push({ id: 'reports', label: 'Analytical Reports', icon: FileBarChart2 });
    }
    if (installedExtensions.includes('ops-cmdb')) {
      activeExtensionsList.push({ id: 'clients', label: 'Multi-Tenant Director', icon: Building2, badge: clients.length.toString() });
    }
    if (installedExtensions.includes('vendor-risk')) {
      activeExtensionsList.push({ id: 'vendors', label: 'Supply Chain Tracker', icon: Factory });
    }
    if (installedExtensions.includes('sec-vuln')) {
      activeExtensionsList.push({ id: 'security', label: 'Security Center', icon: ShieldAlert, badge: '!' });
      activeExtensionsList.push({ id: 'alerts', label: 'Live Alerts Router', icon: Bell, badge: alertCount > 0 ? alertCount.toString() : undefined, badgeColor: 'bg-[#f14c4c] text-white font-bold' });
    }
    if (installedExtensions.includes('comp-soc2')) {
      activeExtensionsList.push({ id: 'compliance', label: 'Compliance Audit', icon: ClipboardCheck });
      activeExtensionsList.push({ id: 'enterprise-audit', label: 'Enterprise Audit', icon: Shield, badge: 'SOC2' });
    }
    if (installedExtensions.includes('ai-swarm')) {
      activeExtensionsList.push({ id: 'ai-swarm', label: 'AI Security Swarm', icon: Sparkles, badge: 'Live', animateBadge: true });
    }
    if (installedExtensions.includes('ai-brain')) {
      activeExtensionsList.push({ id: 'trust-brain', label: 'Trust Brain AI', icon: Brain, badge: 'AI' });
    }
    if (installedExtensions.includes('fin-license')) {
      activeExtensionsList.push({ id: 'billing', label: 'Billing & Tokens', icon: CreditCard });
    }
    if (installedExtensions.includes('disc-m365') || installedExtensions.includes('disc-github')) {
      activeExtensionsList.push({ id: 'integrations', label: 'Webhooks & Sync', icon: Plug });
    }

    return [{
      title: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
        { id: 'clients', label: 'Clients', icon: Building2, badge: clients.length.toString() },
        { id: 'alerts', label: 'Attention', icon: Bell, badge: alertCount ? alertCount.toString() : undefined, badgeColor: 'bg-[#f14c4c] text-white font-bold' },
        { id: 'passports', label: 'Evidence', icon: FileCheck },
        { id: 'reports', label: 'Reports', icon: FileBarChart2 },
        { id: 'scans', label: 'Monitoring', icon: Radar },
      ]
    }, {
      title: 'System',
      items: [
        { id: 'partner-program', label: 'MSP Partner Program', icon: Handshake },
        { id: 'settings', label: 'Settings', icon: Settings }
      ]
    }];
  }, [clients.length, alertCount, installedExtensions]);

  return (
    <aside
      className="w-64 bg-[#1e1e1e] border-r border-[#3c3c3c] flex flex-col h-full text-[#d4d4d4] select-none z-40 shrink-0 relative font-sans"
      id="spr-sovereign-sidebar-shell"
    >
      {/* 1. Header & SPR Logo */}
      <div className="h-16 px-5 border-b border-[#3c3c3c] flex items-center shrink-0">
        <SPRLogo size="md" subtext="GLOBAL TRUST PLATFORM" />
      </div>

      {/* 2. Multi-Tenant Workspace Selector */}
      <div className="px-4 py-3 border-b border-[#3c3c3c] bg-[#252526] relative shrink-0">
        <span className="text-[8px] font-mono font-bold text-[#9d9d9d] uppercase tracking-widest block mb-1.5">ORGANIZATION WORKSPACE</span>
        <button
          onClick={() => setShowClientSelector(!showClientSelector)}
          className="w-full flex items-center justify-between gap-1.5 p-2 rounded-md bg-[#2d2d2d] hover:bg-[#383838] text-[#d4d4d4] border border-[#3c3c3c] transition-all cursor-pointer text-left text-xs"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            {selectedClientId === 'global' ? (
              <Globe className="w-3.5 h-3.5 text-[#3794ff] shrink-0" />
            ) : (
              <span className={`w-3.5 h-3.5 text-[9px] rounded flex items-center justify-center font-bold shrink-0 ${selectedClient?.avatarColor || 'bg-[#3c3c3c]'}`}>
                {selectedClient?.name.charAt(0) || 'C'}
              </span>
            )}
            <span className="font-semibold truncate">
              {selectedClientId === 'global' ? 'Global Multi-Tenant Hub' : selectedClient?.name}
            </span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-[#9d9d9d] shrink-0" />
        </button>

        {showClientSelector && (
          <div className="absolute left-4 right-4 mt-1.5 bg-[#252526] border border-[#3c3c3c] rounded-md z-50 py-1 max-h-56 overflow-y-auto">
            <div className="px-3 py-1.5 text-[8px] font-mono text-[#9d9d9d] uppercase tracking-wider font-bold border-b border-[#3c3c3c]">Switch Workspace</div>
            <button
              onClick={() => {
                setSelectedClientId('global');
                setShowClientSelector(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left cursor-pointer transition-colors ${
                selectedClientId === 'global' ? 'bg-[#094771] text-white font-bold' : 'hover:bg-[#383838] text-[#d4d4d4]'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-[#3794ff] shrink-0" />
              <span>Global Multi-Tenant Hub</span>
            </button>
            <div className="border-t border-[#3c3c3c] my-1"></div>
            {clients.map(client => (
              <button
                key={client.id}
                onClick={() => {
                  setSelectedClientId(client.id);
                  setShowClientSelector(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left cursor-pointer transition-colors ${
                  selectedClientId === client.id ? 'bg-[#094771] text-white font-bold' : 'hover:bg-[#383838] text-[#d4d4d4]'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className={`w-3.5 h-3.5 text-[8px] rounded flex items-center justify-center font-bold shrink-0 ${client.avatarColor}`}>
                    {client.name.charAt(0)}
                  </span>
                  <span className="truncate">{client.name}</span>
                </div>
                {client.criticalRisksCount > 0 && (
                  <span className="bg-[#2d2d2d] text-[#f14c4c] text-[8px] font-bold px-1.5 py-0.5 rounded-full border border-[#3c3c3c]">
                    {client.criticalRisksCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 sidebar-scrollbar">
        {menuGroups.map(group => (
          <div key={group.title} className="space-y-1">
            <span className="px-3 text-[9px] font-mono font-bold text-[#9d9d9d] uppercase tracking-widest block mb-2">{group.title}</span>
            <div className="space-y-0.5">
              {group.items.length === 0 ? (
                <div className="px-3 py-3 bg-[#252526] border border-[#3c3c3c] rounded-md text-[10px] text-[#9d9d9d] font-mono italic text-center">
                  No active modules installed.
                </div>
              ) : (
                group.items.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-md text-xs font-medium cursor-pointer transition-all ${
                        isActive
                          ? 'bg-[#094771] text-white font-bold'
                          : 'text-[#9d9d9d] hover:text-[#d4d4d4] hover:bg-[#383838]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </div>

                      {item.badge && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold shrink-0 ${
                          isActive
                            ? 'bg-white/20 text-white font-mono'
                            : item.badgeColor || 'bg-[#2d2d2d] text-[#9d9d9d] font-mono'
                        }`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 4. Verified Certificate Seal in Footer */}
      <div className="p-4 border-t border-[#3c3c3c] bg-[#1e1e1e] shrink-0">
        <div className="flex items-center gap-3 bg-[#252526] p-2.5 rounded-md border border-[#3c3c3c]">
          <img
            src={sprLegalBadge}
            alt="SPR Seal"
            className="w-9 h-9 object-contain rounded-md filter brightness-110 shrink-0"
            referrerPolicy="no-referrer"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-[#89d185] shrink-0" />
              <span className="text-[8px] font-mono font-bold text-[#cca700] uppercase tracking-wider block truncate">SPR Protocol Certified</span>
            </div>
            <span className="text-[10px] font-bold text-[#d4d4d4] mt-0.5 block truncate">Evidence workspace</span>
              <span className="text-[8px] text-[#9d9d9d] font-mono block mt-0.5 leading-none">Evidence status is shown per record</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
