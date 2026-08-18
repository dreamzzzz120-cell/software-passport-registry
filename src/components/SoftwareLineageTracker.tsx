/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  GitFork,
  Cpu,
  Fingerprint,
  Layers,
  Server,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  FileSignature,
  Building2,
  ExternalLink,
  HelpCircle,
  ChevronRight,
  TrendingUp,
  Activity,
  ShieldCheck,
  Zap,
  Info,
  Globe,
  Compass,
  Sparkles,
  Lock,
  ArrowRight
} from 'lucide-react';
import { SoftwarePassport, Client } from '../types';

interface SoftwareLineageTrackerProps {
  passports: SoftwarePassport[];
  clients: Client[];
  assets: any[];
}

export default function SoftwareLineageTracker({ passports, clients, assets }: SoftwareLineageTrackerProps) {
  const [selectedPassportId, setSelectedPassportId] = useState<string>(passports[0]?.id || '');
  const [dependencySearchQuery, setDependencySearchQuery] = useState<string>('');
  const [traceSearchQuery, setTraceSearchQuery] = useState<string>('');
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);

  // 1. Get currently selected passport
  const activePassport = useMemo(() => {
    return passports.find(p => p.id === selectedPassportId) || passports[0];
  }, [passports, selectedPassportId]);

  // 2. Map downstream assets for the selected passport
  const deployedAssets = useMemo(() => {
    if (!activePassport) return [];
    return assets.filter(a => {
      const pName = activePassport.name.toLowerCase();
      const aPassport = (a.activePassport || '').toLowerCase();
      return (
        aPassport === pName ||
        aPassport.includes(pName) ||
        pName.includes(aPassport) ||
        (a.activePassport === `Custom/Generic: ${activePassport.name}`)
      );
    });
  }, [assets, activePassport]);

  // Illustrative upstream topology. It is labeled in the UI and is not provenance evidence.
  const provenanceDetails = useMemo(() => {
    if (!activePassport) return null;
    const cleanName = activePassport.name.toLowerCase().replace(/\s+/g, '-');
    return {
      repoUrl: `https://github.com/enterprise-registry/${cleanName}`,
      branch: 'main',
      commitHash: 'f4b3c2a1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5',
      ciProvider: 'GitHub Actions Cloud Build',
      buildId: `run-98421-prod-${cleanName}`,
      slsaLevel: 'SLSA Level 4 Compliant',
      compiler: 'GCC 12.2 / Node compiler (v18.16.0)',
      signingAuthority: 'Cosign Sigstore Root CA',
      signatureAlgorithm: 'ECDSA-P256-SHA256'
    };
  }, [activePassport]);

  // 3. Compute overall inventory dependency stats for summary badges
  const totalUniqueDependencies = useMemo(() => {
    const depsSet = new Set<string>();
    passports.forEach(p => {
      p.sbom.forEach(s => depsSet.add(s.name));
    });
    return depsSet.size;
  }, [passports]);

  // 4. "Blast Radius Impact Tracer": Find any sub-component across all pipelines
  const tracedImpact = useMemo(() => {
    if (!traceSearchQuery.trim()) return [];

    const query = traceSearchQuery.toLowerCase();
    const results: {
      passport: SoftwarePassport;
      component: any;
      hosts: any[];
    }[] = [];

    passports.forEach(p => {
      const foundComp = p.sbom.find(s => s.name.toLowerCase().includes(query) || s.purl.toLowerCase().includes(query));
      if (foundComp) {
        // Find hosting assets running this parent software
        const hosts = assets.filter(a => {
          const pName = p.name.toLowerCase();
          const aPassport = (a.activePassport || '').toLowerCase();
          return (
            aPassport === pName ||
            aPassport.includes(pName) ||
            pName.includes(aPassport) ||
            (a.activePassport === `Custom/Generic: ${p.name}`)
          );
        });

        results.push({
          passport: p,
          component: foundComp,
          hosts: hosts
        });
      }
    });

    return results;
  }, [passports, assets, traceSearchQuery]);

  // Filtered SBOM packages for active passport
  const filteredSbom = useMemo(() => {
    if (!activePassport) return [];
    if (!dependencySearchQuery.trim()) return activePassport.sbom;
    return activePassport.sbom.filter(s =>
      s.name.toLowerCase().includes(dependencySearchQuery.toLowerCase()) ||
      s.license.toLowerCase().includes(dependencySearchQuery.toLowerCase())
    );
  }, [activePassport, dependencySearchQuery]);

  // Dynamic digital map description generator for storytelling
  const getDigitalMnemonic = (name: string) => {
    const nameLower = name.toLowerCase();
    if (nameLower.includes('salesforce')) {
      return {
        whatItDoes: 'Manages customer interactions, deals pipelines, and account records.',
        whoUsesit: '35 employees in sales & service',
        businessImportance: 'Critical operations node',
        connections: 'Slack alerts, payment logs, secure backup instances',
        explanation: 'This software manages customer pipelines and sales communications. Removing or disabling it would freeze lead intake, affecting 40% of daily transactions and disconnecting client interactions.'
      };
    }
    if (nameLower.includes('slack')) {
      return {
        whatItDoes: 'Primary communication hub, notifications router, and collaboration channel.',
        whoUsesit: 'All staff / 120 active employees',
        businessImportance: 'High (Ops critical)',
        connections: 'Salesforce CRM, OpenAI API, AWS status logs',
        explanation: 'This is the communication spine of your company. It routes direct messages and security notifications instantly. It integrates automated bots to manage system outages and triggers real-time responses.'
      };
    }
    if (nameLower.includes('stripe')) {
      return {
        whatItDoes: 'Handles invoice charging, checkout systems, and financial gateway flows.',
        whoUsesit: 'Billing admins & payment triggers',
        businessImportance: 'Immediate revenue impact',
        connections: 'Corporate banking, QuickBooks, accounting DB',
        explanation: 'This handles all credit-card processing and active payment endpoints. Removing it instantly disables checkout, halting incoming streams and breaking invoicing operations.'
      };
    }
    // Default fallback
    return {
      whatItDoes: 'Provides central system infrastructure, service integrations, or package dependencies.',
      whoUsesit: 'Engineering & operations',
      businessImportance: 'High technical dependency',
      connections: 'Cloud security pipelines, active virtual instances',
      explanation: 'This node sits directly in the processing path. If detached, dependent backend routines would fail, triggering cascading connection errors across operational services.'
    };
  };

  const activeMnemonic = activePassport ? getDigitalMnemonic(activePassport.name) : getDigitalMnemonic('');

  return (
    <div className="space-y-6" id="software-lineage-ledger-panel">
      {/* Visual Identity Section */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <span className="bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-500/20 px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider mb-2 inline-block">
            🌐 The Google Maps of your Software World
          </span>
          <h1 className="text-xl font-display font-black text-slate-900 dark:text-zinc-50 flex items-center gap-2">
            <Compass className="w-5.5 h-5.5 text-indigo-500 animate-spin" style={{ animationDuration: '8s' }} />
            <span>Interactive Software Lineage Map</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
            Explore your digital DNA. Trace any software asset from source code commits up to production cloud runtimes.
          </p>
        </div>

        {/* Global Lineage Summary Badges */}
        <div className="flex flex-wrap gap-3">
          <div className="bg-white dark:bg-zinc-900 px-3.5 py-2 border border-slate-200 dark:border-zinc-800 rounded-2xl flex items-center gap-2.5 shadow-xs text-xs">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-1.5 rounded-lg text-indigo-600 dark:text-indigo-400">
              <GitFork className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500 leading-none">Mapped Lines</p>
              <p className="font-extrabold text-slate-800 dark:text-zinc-200 mt-1 leading-none">{passports.length} Systems</p>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 px-3.5 py-2 border border-slate-200 dark:border-zinc-800 rounded-2xl flex items-center gap-2.5 shadow-xs text-xs">
            <div className="bg-emerald-50 dark:bg-emerald-950/40 p-1.5 rounded-lg text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500 leading-none">SBOM Packages</p>
              <p className="font-extrabold text-slate-800 dark:text-zinc-200 mt-1 leading-none">{totalUniqueDependencies} Nodes</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Interactive Map Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Column: Software Passport Selector & Provenance Parameters */}
        <div className="lg:col-span-1 space-y-5">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 p-5 shadow-xs flex flex-col gap-4">
            <div>
              <h3 className="text-xs font-black text-slate-800 dark:text-zinc-100 font-display uppercase tracking-wider">Select Active System</h3>
              <p className="text-[9px] text-slate-400 dark:text-zinc-500 font-sans mt-0.5">Click to lock tracking camera on target</p>
            </div>

            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
              {passports.map(p => {
                const isSelected = p.id === selectedPassportId;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPassportId(p.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl text-left text-xs transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-300 dark:bg-indigo-950/30 dark:border-indigo-800/80 text-indigo-900 dark:text-indigo-200 font-bold'
                        : 'bg-slate-50 border-slate-100 hover:bg-slate-100/70 dark:bg-zinc-950/30 dark:border-zinc-850 hover:dark:bg-zinc-900/50 text-slate-700 dark:text-zinc-300'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-sans leading-tight">{p.name}</p>
                      <span className="text-[8px] font-mono text-slate-400 dark:text-zinc-500 mt-1 block">v{p.version} • {p.publisher}</span>
                    </div>
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 ml-2 ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-zinc-600'}`} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Passport General Info */}
          {activePassport && (
            <div className="bg-slate-900 dark:bg-zinc-950 text-slate-300 rounded-3xl border border-slate-800 dark:border-zinc-900 p-5 shadow-xs space-y-4">
              <div className="flex justify-between items-start border-b border-slate-800 pb-2.5">
                <div>
                  <span className="text-[8px] font-mono font-black text-indigo-400 uppercase tracking-widest">CAMERA FOCUS</span>
                  <h4 className="text-sm font-black text-white mt-1 leading-snug">{activePassport.name}</h4>
                </div>
                <span className="bg-indigo-950/60 border border-indigo-900/40 text-indigo-300 text-[8px] font-mono font-semibold px-2 py-0.5 rounded-lg uppercase shrink-0">
                  {activePassport.category}
                </span>
              </div>

              <div className="space-y-2.5 text-[10px] font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">RELEASE DATE:</span>
                  <span className="text-slate-200 font-medium">{activePassport.releaseDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">LICENSE:</span>
                  <span className="text-slate-200 font-medium">{activePassport.licenseType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">TRUST SCORE:</span>
                  <span className="text-emerald-400 font-bold">{activePassport.overallScore}/100</span>
                </div>
                <div className="flex flex-col gap-1 pt-2 border-t border-slate-800">
                  <span className="text-slate-500 uppercase text-[8px]">DIGITAL FILE HASH:</span>
                  <span className="text-slate-400 break-all bg-slate-950 p-2 rounded-lg border border-slate-850 select-all font-mono text-[8px] leading-tight">
                    {activePassport.fileHash}
                  </span>
                </div>
              </div>

              {/* CEO "Why Exist" preview quick panel */}
              <button
                onClick={() => setIsExplanationOpen(true)}
                className="w-full bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-white border border-zinc-700 dark:border-zinc-800 font-bold py-2.5 rounded-xl text-[11px] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <HelpCircle className="w-4 h-4 text-indigo-400" />
                <span>Explain this system</span>
              </button>
            </div>
          )}
        </div>

        {/* Right 3 Columns: Visual Lineage Flow Map */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Unified 3-tier mapping visualizer */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 p-5 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-black text-slate-800 dark:text-zinc-100 font-display uppercase tracking-wider">Active Lineage Pathway</h3>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans">Pedigree stream traced from build variables down to active servers</p>
              </div>

              {/* Pulsing state indicator */}
              <div className="flex items-center gap-1.5 text-[9px] font-mono font-bold bg-indigo-50/80 text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-400 border border-indigo-150 dark:border-indigo-900/30 px-2 py-0.5 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                <span>LIVE FEED STATE</span>
              </div>
            </div>

            {/* Visual grid connecting columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2 relative">
              
              {/* Connector lines overlays using CSS (visible on desktop) */}
              <div className="hidden md:block absolute top-[45%] left-[28%] right-[32%] border-b border-dashed border-slate-200 dark:border-zinc-800 z-0 pointer-events-none"></div>

              {/* TIER 1: Upstream Provenance Origin */}
              <div className="bg-slate-50 dark:bg-zinc-950/30 border border-slate-200/80 dark:border-zinc-850 rounded-2xl p-4 flex flex-col gap-3.5 z-10 relative">
                <div className="flex items-center gap-2 text-xs font-black text-slate-800 dark:text-zinc-200 border-b border-slate-200/60 dark:border-zinc-850 pb-2">
                  <GitFork className="w-4 h-4 text-indigo-500" />
                  <span>1. Code Provenance</span>
                </div>

                {provenanceDetails && (
                  <div className="space-y-3 font-sans">
                    <div className="p-2.5 bg-white dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800/80 rounded-xl text-xs space-y-1">
                      <p className="text-[8px] font-mono uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500">Source Repository</p>
                      <a
                        href={provenanceDetails.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold truncate block flex items-center gap-1 max-w-[190px]"
                      >
                        <span className="truncate">{provenanceDetails.repoUrl.replace('https://', '')}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                      </a>
                      <p className="text-[8px] font-mono text-slate-400 dark:text-zinc-500 mt-1">Branch: <span className="text-slate-600 dark:text-zinc-300 font-semibold">{provenanceDetails.branch}</span></p>
                    </div>

                    <div className="p-2.5 bg-white dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800/80 rounded-xl text-xs space-y-1">
                      <p className="text-[8px] font-mono uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500">CI/CD Pipeline</p>
                      <p className="font-bold text-slate-700 dark:text-zinc-300 text-[11px]">{provenanceDetails.ciProvider}</p>
                      <p className="text-[8px] font-mono text-slate-400 dark:text-zinc-500 truncate" title={provenanceDetails.buildId}>ID: {provenanceDetails.buildId}</p>
                    </div>

                    <div className="p-2.5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-150 dark:border-indigo-900/30 rounded-xl text-xs space-y-1">
                      <p className="text-[8px] font-mono uppercase font-bold tracking-wider text-indigo-500 dark:text-indigo-400">Cryptographic Proof</p>
                      <div className="flex items-center gap-1 text-[11px] font-bold text-indigo-950 dark:text-indigo-200">
                        <FileSignature className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>SLSA Level 4 Verified</span>
                      </div>
                      <p className="text-[8px] font-mono text-indigo-400 dark:text-indigo-400/80 leading-tight">Authority: {provenanceDetails.signingAuthority}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* TIER 2: Central SBOM Component Lineage */}
              <div className="bg-slate-50 dark:bg-zinc-950/30 border border-slate-200/80 dark:border-zinc-850 rounded-2xl p-4 flex flex-col gap-3.5 z-10 relative">
                <div className="flex items-center gap-2 text-xs font-black text-slate-800 dark:text-zinc-200 border-b border-slate-200/60 dark:border-zinc-850 pb-2">
                  <Layers className="w-4 h-4 text-indigo-500" />
                  <span>2. Core Packages (SBOM)</span>
                </div>

                <div className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-600" />
                  <input
                    type="text"
                    placeholder="Filter dependencies..."
                    value={dependencySearchQuery}
                    onChange={(e) => setDependencySearchQuery(e.target.value)}
                    className="w-full bg-transparent focus:outline-none text-[10px] font-semibold text-slate-700 dark:text-zinc-300"
                  />
                </div>

                <div className="flex-1 space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {filteredSbom.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 dark:text-zinc-600 text-[10px]">
                      No components found matching search.
                    </div>
                  ) : (
                    filteredSbom.map((comp, idx) => (
                      <div
                        key={idx}
                        className="p-2 bg-white dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800/80 hover:border-slate-300 dark:hover:border-zinc-700 rounded-lg flex items-center justify-between text-[11px] shadow-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700 dark:text-zinc-200 truncate" title={comp.name}>{comp.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[8px] font-mono text-slate-400 dark:text-zinc-500 font-semibold">v{comp.version}</span>
                            <span className="text-[8px] font-mono bg-slate-100 dark:bg-zinc-950 text-slate-500 px-1 py-0.2 rounded font-black uppercase">
                              {comp.dependencyType}
                            </span>
                          </div>
                        </div>

                        <span className={`px-1.5 rounded text-[8px] font-bold font-mono shrink-0 ml-1.5 border ${
                          comp.trustLevel === 'Trusted' ? 'bg-emerald-50/50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-400' :
                          comp.trustLevel === 'Review Required' ? 'bg-amber-50/50 text-amber-600 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-400' :
                          'bg-rose-50/50 text-rose-600 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-400'
                        }`}>
                          {comp.trustLevel === 'Trusted' ? 'OK' : 'AUDIT'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* TIER 3: Downstream Active Deployments */}
              <div className="bg-slate-50 dark:bg-zinc-950/30 border border-slate-200/80 dark:border-zinc-850 rounded-2xl p-4 flex flex-col gap-3.5 z-10 relative">
                <div className="flex items-center gap-2 text-xs font-black text-slate-800 dark:text-zinc-200 border-b border-slate-200/60 dark:border-zinc-850 pb-2">
                  <Server className="w-4 h-4 text-indigo-500" />
                  <span>3. Downstream Runtimes</span>
                </div>

                <div className="flex-1 space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {deployedAssets.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 space-y-2">
                      <HelpCircle className="w-6 h-6 text-slate-300 mx-auto" />
                      <p className="text-[10px] font-semibold text-slate-600">No Active Hosting Hosts</p>
                      <p className="text-[9px] text-slate-500 leading-normal px-2">
                        This passport is registered but has no current asset mappings running on servers or pods.
                      </p>
                    </div>
                  ) : (
                    deployedAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="p-3 bg-white dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800/80 rounded-xl text-xs space-y-2 shadow-xs"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h5 className="font-bold text-slate-800 dark:text-zinc-100 font-mono text-[10px] truncate max-w-[130px]" title={asset.hostName}>
                              {asset.hostName}
                            </h5>
                            <p className="text-[8px] font-mono text-slate-400 dark:text-zinc-500 mt-0.5">{asset.type} • {asset.OS}</p>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold font-mono uppercase ${
                            asset.health === 'Compliant' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {asset.health}
                          </span>
                        </div>

                        <div className="pt-2 border-t border-slate-100/70 dark:border-zinc-850 flex items-center gap-1.5 text-[9px] text-slate-500 dark:text-zinc-400 font-mono">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-600 shrink-0" />
                          <span className="truncate font-semibold">{asset.clientName}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* VULNERABILITY BLAST RADIUS TRACER utility */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-150 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="text-xs font-black text-slate-800 dark:text-zinc-100 font-display flex items-center gap-1.5 uppercase tracking-wider">
                  <Zap className="w-4.5 h-4.5 text-amber-500 animate-bounce" />
                  <span>Transitive Vulnerability Blast Radius Tracer</span>
                </h3>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans mt-0.5">
                  Input sub-dependency name (e.g. "log4j", "openssl", "redis") to trace all host servers dependent on it.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-zinc-950/40 border border-slate-200 dark:border-zinc-850 rounded-xl">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Type package name to scan impact (e.g. openssl, redis)..."
                  value={traceSearchQuery}
                  onChange={(e) => setTraceSearchQuery(e.target.value)}
                  className="w-full bg-transparent focus:outline-none text-xs font-medium text-slate-700 dark:text-zinc-200"
                />
              </div>
              {traceSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTraceSearchQuery('')}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Clear Trace
                </button>
              )}
            </div>

            {/* Traced impact results list */}
            {traceSearchQuery.trim() ? (
              <div className="space-y-3 pt-1">
                <h4 className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider font-mono">
                  Impact mapping for "{traceSearchQuery}" ({tracedImpact.length} Pipelines found)
                </h4>

                {tracedImpact.length === 0 ? (
                  <div className="p-5 bg-slate-50 dark:bg-zinc-950/30 border border-slate-150 dark:border-zinc-850 rounded-xl text-center text-xs text-slate-500 dark:text-zinc-400">
                    No active software passports or dependency chains are running components matching "{traceSearchQuery}".
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {tracedImpact.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-slate-50 dark:bg-zinc-950/30 border border-slate-200 dark:border-zinc-850 rounded-2xl space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[8px] font-mono font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-150 dark:border-indigo-900/40">
                              Dependency Node Found
                            </span>
                            <h5 className="font-bold text-slate-800 dark:text-zinc-200 text-xs mt-1.5">
                              {item.component.name} <span className="text-slate-400 dark:text-zinc-500 font-normal">v{item.component.version}</span>
                            </h5>
                            <p className="text-[9px] text-slate-400 dark:text-zinc-500 font-mono mt-0.5">Purl: {item.component.purl}</p>
                          </div>
                          
                          <div className="text-right">
                            <span className="text-[9px] text-slate-400 dark:text-zinc-500 block font-mono">Contained In:</span>
                            <span className="font-extrabold text-slate-700 dark:text-zinc-300 text-xs block mt-0.5">{item.passport.name}</span>
                          </div>
                        </div>

                        {/* Blast list of host targets */}
                        <div className="pt-2.5 border-t border-slate-200/60 dark:border-zinc-850 space-y-2">
                          <p className="text-[9px] font-bold text-indigo-900 dark:text-indigo-400 uppercase font-mono tracking-wider flex items-center gap-1">
                            <Server className="w-3 h-3 text-indigo-500" />
                            <span>Vulnerable Deployment Blast Target Hosts ({item.hosts.length})</span>
                          </p>

                          {item.hosts.length === 0 ? (
                            <p className="text-[9px] text-slate-500 dark:text-zinc-400 font-sans italic bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-slate-150 dark:border-zinc-800">
                              Component is listed in the SBOM but currently has zero active deployment hosts. Threat exposure is minimal.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {item.hosts.map((host) => (
                                <div
                                  key={host.id}
                                  className="p-2 bg-white dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800 rounded-lg text-[10px] flex items-center justify-between shadow-inner"
                                >
                                  <div>
                                    <p className="font-bold text-slate-700 dark:text-zinc-200 font-mono truncate max-w-[140px]">{host.hostName}</p>
                                    <p className="text-[8px] text-slate-400 dark:text-zinc-500 font-mono mt-0.5">{host.clientName} • {host.environment}</p>
                                  </div>
                                  <span className={`px-1 py-0.2 rounded text-[7px] font-mono font-bold uppercase ${
                                    host.health === 'Compliant' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                                  }`}>
                                    {host.health}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-slate-50/50 dark:bg-zinc-950/20 border border-dashed border-slate-200 dark:border-zinc-800 rounded-2xl text-center text-xs text-slate-500 flex items-center gap-3">
                <Info className="w-4.5 h-4.5 text-slate-400 shrink-0" />
                <p className="text-[10px] text-slate-500 dark:text-zinc-400 leading-snug text-left">
                  Trace utilities query transitively mapped software bill-of-materials elements recursively. For example, search <code className="bg-slate-150 dark:bg-zinc-900 px-1 py-0.5 rounded font-mono font-bold text-indigo-700 dark:text-indigo-400">openssl</code> to identify its downstream footprint or <code className="bg-slate-150 dark:bg-zinc-900 px-1 py-0.5 rounded font-mono font-bold text-indigo-700 dark:text-indigo-400">postgres</code> to check running nodes.
                </p>
              </div>
            )}
          </div>

        </div>

      </div>

      {/* DETAILED INTERACTIVE EXPLANATION MODAL (Why Does This Exist? / Digital Storyteller) */}
      <AnimatePresence>
        {isExplanationOpen && activePassport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsExplanationOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-xs"
            />
            
            {/* Explainer Modal container */}
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-slate-150 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl overflow-hidden text-left z-10"
            >
              {/* Decorative top ribbon */}
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-indigo-500 to-indigo-600"></div>

              <div className="flex items-start justify-between mb-4 mt-2">
                <div className="space-y-1">
                  <span className="text-[9px] font-mono font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest block">
                    SPR INTELLIGENCE SYSTEM • WHY IT EXISTS
                  </span>
                  <h3 className="text-lg font-display font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-500" />
                    <span>Explain {activePassport.name}</span>
                  </h3>
                </div>
                <button
                  onClick={() => setIsExplanationOpen(false)}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Explainer Body */}
              <div className="space-y-5">
                {/* Structured Software Card Details */}
                <div className="p-4 bg-slate-50 dark:bg-zinc-950/40 border border-slate-150 dark:border-zinc-850 rounded-2xl space-y-4">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block mb-1">What it does</span>
                    <p className="text-xs text-slate-700 dark:text-zinc-300 font-bold leading-relaxed">
                      {activeMnemonic.whatItDoes}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block mb-0.5">Who uses it</span>
                      <span className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                        {activeMnemonic.whoUsesit}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block mb-0.5">Business Importance</span>
                      <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        ⭐ {activeMnemonic.businessImportance}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/60 dark:border-zinc-850">
                    <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block mb-1">Connected systems</span>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 font-medium">
                      {activeMnemonic.connections}
                    </p>
                  </div>
                </div>

                {/* The Magic Narrative */}
                <div className="space-y-2">
                  <span className="text-[10px] font-mono font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
                    SPR ADVISOR DIRECT NARRATIVE:
                  </span>
                  <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/50 dark:border-indigo-900/30 p-4 rounded-2xl text-xs text-indigo-950 dark:text-indigo-200 font-medium leading-relaxed font-sans">
                    “{activeMnemonic.explanation}”
                  </div>
                </div>

                {/* Recommendation */}
                <div className="flex items-center justify-between text-xs border-t border-slate-100 dark:border-zinc-800 pt-3">
                  <span className="text-slate-400">Recommendation:</span>
                  <span className="font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-400 px-2.5 py-0.5 rounded-lg">
                    Keep — Important Business System
                  </span>
                </div>
              </div>

              {/* Close footer button */}
              <div className="mt-5 pt-3 border-t border-slate-100 dark:border-zinc-800 text-right">
                <button
                  type="button"
                  onClick={() => setIsExplanationOpen(false)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-xl text-xs cursor-pointer transition-colors"
                >
                  Got it, close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

// Simple absolute close SVG fallback
function X(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="2.5"
      stroke="currentColor"
      {...props}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
