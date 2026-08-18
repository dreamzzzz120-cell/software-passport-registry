/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Shield,
  Layers,
  Sparkles,
  Award,
  CreditCard,
  Settings,
  Cpu,
  ArrowUpRight,
  ChevronRight,
  Info,
  Compass,
  X,
  FileCheck,
  Zap,
  Activity,
  History,
  Lock,
  Download,
  Trash2
} from 'lucide-react';

export interface Extension {
  id: string;
  name: string;
  category: 'Discovery' | 'Security' | 'Compliance' | 'Vendor' | 'AI' | 'Executive' | 'Finance' | 'Operations';
  purpose: string;
  permissions: string[];
  dataSources: string[];
  dependencies: string[];
  version: string;
  publisher: string;
  trustRating: 'Trusted' | 'Needs Review' | 'Risk Identified';
  updateHistory: { version: string; date: string; change: string }[];
  activityLog: { time: string; event: string; status: 'info' | 'success' | 'warn' | 'error' }[];
  unlockedTabs: string[];
  icon: any;
  popularity: string;
}

interface ExtensionMarketplaceProps {
  installedExtensions: string[];
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onNavigateTab: (tabId: string) => void;
}

export default function ExtensionMarketplace({
  installedExtensions,
  onInstall,
  onUninstall,
  onNavigateTab
}: ExtensionMarketplaceProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedExtension, setSelectedExtension] = useState<Extension | null>(null);

  // Defining the extensions data
  const extensions: Extension[] = useMemo(() => [
    {
      id: 'disc-m365',
      name: 'Microsoft 365 Discovery',
      category: 'Discovery',
      purpose: 'Automatically scan and discover cloud assets, user registries, and collaboration pathways within the Microsoft 365 platform.',
      permissions: ['Directory.Read.All', 'Group.Read.All', 'AuditLog.Read.All'],
      dataSources: ['Azure AD Graph API', 'Office 365 Management Activity API'],
      dependencies: ['Core Discovery Engine'],
      version: '2.4.1',
      publisher: 'Microsoft Partners & SPR Core',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '2.4.1', date: '2026-06-12', change: 'Optimized Graph API page limits for larger enterprises.' },
        { version: '2.3.0', date: '2026-03-05', change: 'Added deep group membership path resolution.' }
      ],
      activityLog: [
        { time: '10 mins ago', event: 'Scanned 1,402 Microsoft Entra user registrations.', status: 'success' },
        { time: '1 hour ago', event: 'Synchronized Active Directory tenancy schema metadata.', status: 'info' }
      ],
      unlockedTabs: ['integrations'],
      icon: Compass,
      popularity: '98%'
    },
    {
      id: 'disc-github',
      name: 'GitHub Repository Discovery',
      category: 'Discovery',
      purpose: 'Continuous monitoring of enterprise organization repositories, branches, branch protection rules, and security metadata.',
      permissions: ['repo:read', 'read:org', 'security_events:read'],
      dataSources: ['GitHub GraphQL API v4', 'GitHub Webhooks'],
      dependencies: ['Core Discovery Engine', 'Secrets Scanner'],
      version: '1.9.3',
      publisher: 'SPR Labs',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '1.9.3', date: '2026-07-02', change: 'Added support for fine-grained personal access tokens.' },
        { version: '1.8.0', date: '2026-05-14', change: 'Improved branch protection scanning.' }
      ],
      activityLog: [
        { time: '4 mins ago', event: 'Detected 42 active code branches in core-monolith repo.', status: 'success' },
        { time: '2 hours ago', event: 'Scanned repository security settings for 14 workspace repos.', status: 'info' }
      ],
      unlockedTabs: ['integrations'],
      icon: Compass,
      popularity: '95%'
    },
    {
      id: 'sec-vuln',
      name: 'Vulnerability Intelligence',
      category: 'Security',
      purpose: 'Continuous ingestion of global CVE databases, threat vectors, and software flaws, mapping them in real-time to active Software Passports.',
      permissions: ['Asset.Read', 'Vulnerability.ReadWrite', 'Alert.Create'],
      dataSources: ['NVD NIST Database', 'GitHub Security Advisories', 'OSV DB'],
      dependencies: ['Core Classification Engine'],
      version: '4.2.0',
      publisher: 'SPR Cyber Threat Intelligence (CTI)',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '4.2.0', date: '2026-07-10', change: 'Integrated real-time streaming notifications for critical level zero flaws.' },
        { version: '4.1.2', date: '2026-06-25', change: 'Added EPSS score filtering.' }
      ],
      activityLog: [
        { time: '30s ago', event: 'Ingested 14 new CVE records from NIST National Vulnerability Database.', status: 'info' },
        { time: '15 mins ago', event: 'Flagged 1 potential prototype pollution flaw in active NPM packages.', status: 'warn' }
      ],
      unlockedTabs: ['security', 'alerts'],
      icon: Shield,
      popularity: '99%'
    },
    {
      id: 'sec-sbom',
      name: 'SBOM Analyzer',
      category: 'Security',
      purpose: 'Deep cryptographic parsing of SPDX and CycloneDX Software Bill of Materials (SBOM) manifests to guarantee absolute code lineage validation.',
      permissions: ['Passport.ReadWrite', 'CryptographicSignature.Verify'],
      dataSources: ['CycloneDX JSON manifests', 'SPDX RDF schema specifications'],
      dependencies: ['Core Software Passports Engine'],
      version: '3.1.0',
      publisher: 'Sovereign Protocol Core',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '3.1.0', date: '2026-05-20', change: 'Added automatic CycloneDX 1.5 schema validation support.' }
      ],
      activityLog: [
        { time: '5 mins ago', event: 'Verified signature of CycloneDX manifest for critical-payment-api.', status: 'success' }
      ],
      unlockedTabs: ['passports'],
      icon: Shield,
      popularity: '92%'
    },
    {
      id: 'comp-soc2',
      name: 'SOC 2 Audit Engine',
      category: 'Compliance',
      purpose: 'Automate evidence collection, auditor-ready report logging, and continuous compliance control mapping for the SOC 2 security framework.',
      permissions: ['ComplianceControl.ReadWrite', 'AuditorView.Enable'],
      dataSources: ['Internal Security Settings', 'MFA Status Indicators', 'Access Control logs'],
      dependencies: ['Vulnerability Intelligence'],
      version: '3.5.2',
      publisher: 'SPR GRC Systems',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '3.5.2', date: '2026-07-01', change: 'Added support for SOC 2 Type II automatic quarterly collection cycles.' }
      ],
      activityLog: [
        { time: '3 mins ago', event: 'Compiled quarterly MFA compliance proof log.', status: 'success' },
        { time: '4 hours ago', event: 'Audited user role changes for anomalous administrative elevations.', status: 'info' }
      ],
      unlockedTabs: ['compliance', 'enterprise-audit'],
      icon: Award,
      popularity: '97%'
    },
    {
      id: 'comp-iso',
      name: 'ISO 27001 Readiness',
      category: 'Compliance',
      purpose: 'Align organization security policies and physical/digital controls with the rigorous ISO/IEC 27001:2022 standards.',
      permissions: ['ISMS.Manage', 'AuditReport.Generate'],
      dataSources: ['Employee Access Audits', 'Vulnerability Scanner summaries'],
      dependencies: ['SOC 2 Audit Engine'],
      version: '1.2.0',
      publisher: 'SPR GRC Systems',
      trustRating: 'Needs Review',
      updateHistory: [
        { version: '1.2.0', date: '2026-04-18', change: 'First-class support for ISO 27001:2022 Annex A controls.' }
      ],
      activityLog: [
        { time: '1 day ago', event: 'Generated readiness scoring matrix. Current rating: 88%.', status: 'warn' }
      ],
      unlockedTabs: ['compliance'],
      icon: Award,
      popularity: '84%'
    },
    {
      id: 'vendor-risk',
      name: 'Vendor Risk Manager',
      category: 'Vendor',
      purpose: 'Track, risk-assess, and monitor third-party vendors and external SaaS suppliers to guarantee zero supply-chain leakage.',
      permissions: ['Vendor.ReadWrite', 'VendorAssessment.Trigger'],
      dataSources: ['Vendor questionnaires', 'Continuous open-source scanning feeds'],
      dependencies: ['Core Classification Engine'],
      version: '2.1.4',
      publisher: 'SPR Supply Chain Org',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '2.1.4', date: '2026-06-30', change: 'Added automated vendor onboarding assessment invitation triggers.' }
      ],
      activityLog: [
        { time: '12 mins ago', event: 'Ingested active risk assessment for vendor Salesforce. rating: 🟢 Trusted.', status: 'success' },
        { time: '1 day ago', event: 'Discovered unauthorized vendor usage: Trello by marketing dep.', status: 'warn' }
      ],
      unlockedTabs: ['vendors'],
      icon: Layers,
      popularity: '91%'
    },
    {
      id: 'ai-swarm',
      name: 'AI Security Swarm',
      category: 'AI',
      purpose: 'Deploy continuous, autonomous agents that collaborate, identify zero-day software threats, and verify trust protocols autonomously.',
      permissions: ['AgentSwarm.Spawn', 'AutonomousAction.Trigger', 'CodePatch.Propose'],
      dataSources: ['Sovereign Agent Communication Fabric', 'Active application code graphs'],
      dependencies: ['Vulnerability Intelligence', 'Trust Brain Cognitive Patching'],
      version: '5.0.1',
      publisher: 'SPR AI Operations',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '5.0.1', date: '2026-07-15', change: 'Migrated agents to ultra-fast Gemini 3.5 Flash context scaling.' }
      ],
      activityLog: [
        { time: '2s ago', event: 'Agent-02 (Signer) signed secure SLSA provenance attestations for api-service.', status: 'success' },
        { time: '1 min ago', event: 'Agent-05 (Audit) performed autonomous run-time telemetry health check.', status: 'info' }
      ],
      unlockedTabs: ['ai-swarm'],
      icon: Sparkles,
      popularity: '99%'
    },
    {
      id: 'ai-brain',
      name: 'Trust Brain Cognitive Patching',
      category: 'AI',
      purpose: 'State-of-the-art AI reasoning engine to ingest whole-project vulnerability contexts and automatically write and propose code-level security fixes.',
      permissions: ['Codebase.Write', 'PullRequest.Create', 'KnowledgeBase.Search'],
      dataSources: ['Gemini Enterprise reasoning models', 'Repository files'],
      dependencies: ['Vulnerability Intelligence'],
      version: '3.0.0',
      publisher: 'SPR AI Operations',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '3.0.0', date: '2026-07-20', change: 'Initial Release of the Trust Brain Cognitive system powered by Gemini.' }
      ],
      activityLog: [
        { time: '10 mins ago', event: 'Analyzed dependency tree and identified remediating package versions for active CVE-2026-1191.', status: 'success' }
      ],
      unlockedTabs: ['trust-brain'],
      icon: Sparkles,
      popularity: '96%'
    },
    {
      id: 'exec-board',
      name: 'Board Reports & KPI Center',
      category: 'Executive',
      purpose: 'Compile and translate technical security metrics, compliance scores, and risk mitigations into high-level business logic for executive boards.',
      permissions: ['Metrics.Aggregate', 'PDF.Export', 'Dashboard.Customise'],
      dataSources: ['All active compliance scoring models', 'CISO priorities registry'],
      dependencies: ['Core Trust Graph Engine'],
      version: '2.1.0',
      publisher: 'SPR Executive Core',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '2.1.0', date: '2026-06-05', change: 'Redesigned executive briefs layout for CEO and Board view clarity.' }
      ],
      activityLog: [
        { time: '2 mins ago', event: 'Generated quarterly risk mitigation briefing PDF.', status: 'success' }
      ],
      unlockedTabs: ['dashboard', 'reports'],
      icon: Award,
      popularity: '93%'
    },
    {
      id: 'fin-license',
      name: 'License Optimization Engine',
      category: 'Finance',
      purpose: 'Scan active SaaS registries and identify redundant employee subscriptions, overlapping product licensing, and optimization possibilities.',
      permissions: ['LicenseData.ReadWrite', 'SpendAudit.Create'],
      dataSources: ['Corporate credit card logs', 'M365 active user assignments'],
      dependencies: ['CMDB & Asset Lifecycle'],
      version: '1.4.0',
      publisher: 'SPR Finance Org',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '1.4.0', date: '2026-05-30', change: 'Improved Microsoft 365 E3 to E5 license overlap scanning rules.' }
      ],
      activityLog: [
        { time: '40 mins ago', event: 'Identified $1,420 monthly spend optimization in unused GitHub Enterprise licenses.', status: 'success' }
      ],
      unlockedTabs: ['billing'],
      icon: CreditCard,
      popularity: '89%'
    },
    {
      id: 'ops-cmdb',
      name: 'CMDB & Asset Lifecycle',
      category: 'Operations',
      purpose: 'Build a rigorous, single-source Configuration Management Database (CMDB) of all physical hardware, cloud servers, and virtual workloads.',
      permissions: ['Asset.ReadWrite', 'Infrastructure.Sync'],
      dataSources: ['AWS EC2 Discovery', 'Kubernetes clusters API', 'Corporate asset tags'],
      dependencies: ['Core Classification Engine'],
      version: '3.1.2',
      publisher: 'SPR Infrastructure Labs',
      trustRating: 'Trusted',
      updateHistory: [
        { version: '3.1.2', date: '2026-07-02', change: 'Integrated AWS auto-discovery clustering updates.' }
      ],
      activityLog: [
        { time: '1 min ago', event: 'Discovered and logged 4 new AWS microservice containers.', status: 'success' }
      ],
      unlockedTabs: ['clients'],
      icon: Settings,
      popularity: '94%'
    }
  ], []);

  const categories = ['All', 'Discovery', 'Security', 'Compliance', 'Vendor', 'AI', 'Executive', 'Finance', 'Operations'];

  // Filter extensions based on search query and category
  const filteredExtensions = useMemo(() => {
    return extensions.filter(ext => {
      const matchesCategory = selectedCategory === 'All' || ext.category === selectedCategory;
      const matchesSearch = ext.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            ext.purpose.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [extensions, selectedCategory, searchQuery]);

  return (
    <div className="space-y-6 text-slate-100" id="extension-marketplace-view">
      
      {/* Visual Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/65 pb-6">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs font-bold uppercase tracking-wider">
            <Cpu className="w-4 h-4 animate-spin text-indigo-400" />
            <span>Extensible Trust-OS Architecture</span>
          </div>
          <h1 className="text-2xl font-display font-black text-white mt-1 tracking-tight">
            Extension Marketplace
          </h1>
          <p className="text-xs text-slate-300 mt-1.5 max-w-2xl leading-relaxed">
            Browse capability previews, permissions, and dependencies. Installation changes local feature visibility; provider connections require separate configuration.
          </p>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-2.5 flex items-center gap-3">
          <Layers className="w-5 h-5 text-indigo-400" />
          <div className="text-left font-mono">
            <span className="text-[10px] text-slate-400 block uppercase font-bold leading-none">Active Extensions</span>
            <span className="text-base font-black text-white mt-0.5 block leading-none">
              {installedExtensions.length} <span className="text-xs text-slate-400">/ {extensions.length} Active</span>
            </span>
          </div>
        </div>
      </div>

      {/* Categories Bar and Search */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-[#111625] border border-slate-800/80 p-4 rounded-2xl">
        <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-[#1a2035]/60 text-slate-300 hover:text-white hover:bg-[#1a2035]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64 shrink-0">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search capabilities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#151b2d] border border-slate-750 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
          />
        </div>
      </div>

      {/* Grid of Extensions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredExtensions.map((ext) => {
          const isInstalled = installedExtensions.includes(ext.id);
          const Icon = ext.icon;

          return (
            <div
              key={ext.id}
              className={`group bg-[#111625] border transition-all rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden h-[240px] shadow-md hover:shadow-lg ${
                isInstalled 
                  ? 'border-indigo-600/60 shadow-indigo-950/20' 
                  : 'border-slate-800/80 hover:border-slate-750'
              }`}
            >
              <div>
                {/* Header info */}
                <div className="flex justify-between items-start">
                  <div className={`p-2.5 rounded-xl ${
                    isInstalled ? 'bg-indigo-600/10 text-indigo-400' : 'bg-[#1a2035] text-slate-400'
                  } border border-slate-800/60`}>
                    <Icon className="w-5 h-5" />
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Trust rating badge */}
                    <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-black uppercase tracking-wider ${
                      ext.trustRating === 'Trusted'
                        ? 'bg-emerald-500 text-white font-bold'
                        : ext.trustRating === 'Needs Review'
                        ? 'bg-amber-400 text-slate-950 font-black'
                        : 'bg-rose-600 text-white'
                    }`}>
                      {ext.trustRating === 'Trusted' ? '🟢 Trusted' : ext.trustRating === 'Needs Review' ? '🟡 Review' : '🔴 Risk'}
                    </span>
                    
                    {/* Installed badge */}
                    {isInstalled && (
                      <span className="bg-indigo-600 text-white text-[8px] font-mono font-black uppercase px-2 py-0.5 rounded tracking-wider animate-pulse">
                        Active
                      </span>
                    )}
                  </div>
                </div>

                {/* Name & description */}
                <div className="mt-4">
                  <h3 className="text-sm font-display font-black text-white group-hover:text-indigo-300 transition-colors">
                    {ext.name}
                  </h3>
                  <span className="text-[9px] font-mono text-slate-400 uppercase font-black tracking-widest mt-0.5 block">
                    {ext.category} • v{ext.version}
                  </span>
                  <p className="text-xs text-slate-300 mt-2.5 line-clamp-2 leading-relaxed">
                    {ext.purpose}
                  </p>
                </div>
              </div>

              {/* Bottom bar with action and passport button */}
              <div className="flex items-center justify-between border-t border-slate-800/70 pt-3 mt-4">
                <button
                  onClick={() => setSelectedExtension(ext)}
                  className="text-[10px] font-mono font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>View Passport</span>
                </button>

                {isInstalled ? (
                  <button
                    onClick={() => onUninstall(ext.id)}
                    className="flex items-center gap-1 bg-slate-900 hover:bg-rose-950/20 text-rose-400 hover:text-rose-300 border border-slate-800/80 hover:border-rose-900/40 px-3 py-1.5 rounded-xl text-[10px] font-bold cursor-pointer transition-all shadow-sm"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Deactivate</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onInstall(ext.id)}
                    className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-[10px] font-bold cursor-pointer transition-all shadow-sm"
                  >
                    <Download className="w-3 h-3" />
                    <span>Activate</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredExtensions.length === 0 && (
          <div className="col-span-full py-12 text-center bg-[#111625] border border-slate-800/80 rounded-2xl text-slate-400 font-medium">
            <AlertCircle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <p className="text-xs">No extensions found matching your criteria.</p>
          </div>
        )}
      </div>

      {/* EXTENSION PASSPORT DRAWER / POPUP */}
      {selectedExtension && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-xl h-full bg-[#0a0e1a] border-l border-slate-800 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-300">
            
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-800 bg-[#111625] flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-600/10 text-indigo-400 rounded-xl border border-indigo-500/20">
                    <FileCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-mono font-black text-slate-400 tracking-wider uppercase block">
                      CAPABILITY PASSPORT REGISTRY
                    </span>
                    <h2 className="text-base font-display font-black text-white leading-tight">
                      {selectedExtension.name}
                    </h2>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSelectedExtension(null)}
                className="p-1.5 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-xl cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Scrollable Passport details */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-none text-left">
              
              {/* Introduction Overview Card */}
              <div className="bg-[#111625] border border-slate-800/85 p-5 rounded-2xl space-y-3 shadow-md">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-300">Extension Meta State</span>
                  <span className={`px-2.5 py-1 rounded text-xs font-mono font-black uppercase tracking-wider ${
                    selectedExtension.trustRating === 'Trusted'
                      ? 'bg-emerald-600 text-white font-bold'
                      : selectedExtension.trustRating === 'Needs Review'
                      ? 'bg-amber-400 text-slate-950 font-black'
                      : 'bg-rose-600 text-white'
                  }`}>
                    Rating: {selectedExtension.trustRating === 'Trusted' ? '🟢 Trusted' : selectedExtension.trustRating === 'Needs Review' ? '🟡 Needs Review' : '🔴 Risk Identified'}
                  </span>
                </div>
                
                <div className="border-t border-slate-800/50 pt-3">
                  <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-wider block">PURPOSE</span>
                  <p className="text-xs text-slate-200 mt-1 leading-relaxed">
                    {selectedExtension.purpose}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-slate-800/50 pt-3 text-xs">
                  <div>
                    <span className="text-[10px] font-mono text-slate-400 block font-bold uppercase tracking-wide">PUBLISHER</span>
                    <span className="text-slate-200 font-bold">{selectedExtension.publisher}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-slate-400 block font-bold uppercase tracking-wide">STABLE VERSION</span>
                    <span className="text-slate-200 font-mono font-bold">v{selectedExtension.version}</span>
                  </div>
                </div>
              </div>

              {/* Security & Access Permissions Gate */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-rose-400" />
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                    REQUIRED SECURITY PERMISSIONS
                  </span>
                </div>
                <div className="bg-[#111625] border border-slate-800/80 rounded-2xl p-4.5 space-y-2.5">
                  <p className="text-[11px] text-slate-300 leading-normal">
                    To maintain strict zero-trust sandbox architecture, this capability requires the following tenant-level API permissions upon installation:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedExtension.permissions.map((p, idx) => (
                      <span key={idx} className="bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg text-[10px] font-mono text-rose-300 font-semibold">
                        🔑 {p}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Data Sources and Dependencies */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2.5">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
                    ACTIVE DATA SOURCES
                  </span>
                  <div className="bg-[#111625] border border-slate-800/80 rounded-2xl p-4 min-h-[90px] flex flex-col justify-center">
                    <ul className="text-xs space-y-1 text-slate-200">
                      {selectedExtension.dataSources.map((ds, idx) => (
                        <li key={idx} className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                          <span>{ds}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
                    PLATFORM DEPENDENCIES
                  </span>
                  <div className="bg-[#111625] border border-slate-800/80 rounded-2xl p-4 min-h-[90px] flex flex-col justify-center">
                    <ul className="text-xs space-y-1 text-slate-200">
                      {selectedExtension.dependencies.map((dep, idx) => (
                        <li key={idx} className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                          <span>{dep}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Update History Registry */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <History className="w-4 h-4 text-indigo-400" />
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                    METADATA UPDATE REGISTRY
                  </span>
                </div>
                <div className="bg-[#111625] border border-slate-800/80 rounded-2xl p-4 space-y-3">
                  {selectedExtension.updateHistory.map((h, idx) => (
                    <div key={idx} className="text-xs flex gap-3 items-start border-b border-slate-800/40 pb-2.5 last:border-0 last:pb-0">
                      <span className="bg-[#1a2035] px-2 py-0.5 rounded font-mono text-[10px] text-indigo-300 font-bold tracking-tight">
                        v{h.version}
                      </span>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-mono">{h.date}</span>
                        <p className="text-slate-200 mt-0.5 font-sans leading-relaxed">{h.change}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Illustrative activity examples, never presented as live telemetry. */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                    EXAMPLE ACTIVITY — NOT LIVE DATA
                  </span>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4.5 font-mono text-[10px] space-y-2 max-h-40 overflow-y-auto">
                  {selectedExtension.activityLog.map((log, idx) => (
                    <div key={idx} className="flex justify-between gap-4 py-0.5 text-slate-300 border-b border-slate-900/60 last:border-0">
                      <div className="flex gap-2 items-start">
                        <span className="text-slate-500">[{log.time}]</span>
                        <span className={
                          log.status === 'success' ? 'text-emerald-400' :
                          log.status === 'warn' ? 'text-amber-400 font-bold' :
                          log.status === 'error' ? 'text-rose-500 font-black' : 'text-slate-300'
                        }>
                          {log.event}
                        </span>
                      </div>
                      <span className="text-slate-600 font-bold text-[9px] uppercase tracking-wider">
                        {log.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Drawer Footer Actions */}
            <div className="p-6 border-t border-slate-800 bg-[#111625] flex justify-between items-center gap-4">
              <div className="text-left">
                <span className="text-[9px] font-mono text-slate-400 uppercase font-black block leading-none">Security Sign-Off</span>
                <span className="text-xs text-amber-400 font-bold mt-1 block leading-none">
                  ⚠️ Activation requires a configured backend connector
                </span>
              </div>

              <div className="flex gap-2.5">
                <button
                  onClick={() => setSelectedExtension(null)}
                  className="px-4 py-2 hover:bg-slate-900 border border-slate-800 rounded-xl text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>

                {installedExtensions.includes(selectedExtension.id) ? (
                  <button
                    onClick={() => {
                      onUninstall(selectedExtension.id);
                      setSelectedExtension(null);
                    }}
                    className="flex items-center gap-1.5 bg-rose-950/10 hover:bg-rose-950/20 text-rose-400 hover:text-rose-300 border border-rose-900/50 px-4.5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all shadow-sm"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Deactivate Module</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      onInstall(selectedExtension.id);
                      setSelectedExtension(null);
                    }}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-black cursor-pointer transition-all shadow-lg"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Activate Capability</span>
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
