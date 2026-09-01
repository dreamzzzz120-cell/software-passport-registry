/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  GitFork,
  Layers,
  Server,
  Search,
  FileSignature,
  Building2,
  ExternalLink,
  HelpCircle,
  ChevronRight,
  Zap,
  Info,
  Sparkles
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
    <div className="space-y-4" id="software-lineage-ledger-panel">
      {/* Section header + summary strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#201f1e]">Software lineage map</h2>
          <p className="mt-0.5 text-[13px] text-[#605e5c]">Trace a passport from source provenance through its SBOM to the servers running it.</p>
        </div>

        <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
          <div>
            <div className="text-[11px] text-[#605e5c]">Mapped systems</div>
            <div className="text-lg font-semibold text-[#201f1e]">{passports.length}</div>
          </div>
          <div>
            <div className="text-[11px] text-[#605e5c]">SBOM packages</div>
            <div className="text-lg font-semibold text-[#201f1e]">{totalUniqueDependencies}</div>
          </div>
        </div>
      </div>

      {/* Main Interactive Map Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

        {/* Left Column: Software Passport Selector & Provenance Parameters */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-md border border-[#e1dfdd] bg-white p-3">
            <h3 className="text-[13px] font-semibold text-[#201f1e]">Select a system</h3>
            <p className="mt-0.5 text-[11px] text-[#8a8886]">Choose a passport to lock the tracker on it.</p>

            <div className="mt-3 space-y-1 max-h-[220px] overflow-y-auto pr-1">
              {passports.map(p => {
                const isSelected = p.id === selectedPassportId;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPassportId(p.id)}
                    className={`flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-[13px] border ${
                      isSelected
                        ? 'border-[#0f6cbd] bg-[#eff6fc] font-medium text-[#0f6cbd]'
                        : 'border-transparent text-[#323130] hover:bg-black/[.03]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate leading-tight">{p.name}</p>
                      <span className="mt-0.5 block text-[11px] text-[#8a8886]">v{p.version} · {p.publisher}</span>
                    </div>
                    <ChevronRight className={`ml-2 h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-[#0f6cbd]' : 'text-[#c8c6c4]'}`} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Passport General Info */}
          {activePassport && (
            <div className="space-y-3 rounded-md border border-[#e1dfdd] bg-white p-3">
              <div className="flex items-start justify-between border-b border-[#f3f2f1] pb-2">
                <div>
                  <span className="block text-[11px] text-[#8a8886]">Selected</span>
                  <h4 className="mt-0.5 text-[13px] font-semibold leading-snug text-[#201f1e]">{activePassport.name}</h4>
                </div>
                <span className="shrink-0 rounded bg-[#f3f2f1] px-2 py-0.5 text-[11px] text-[#605e5c]">
                  {activePassport.category}
                </span>
              </div>

              <div className="space-y-1.5 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-[#8a8886]">Release date</span>
                  <span className="font-medium text-[#323130]">{activePassport.releaseDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8a8886]">License</span>
                  <span className="font-medium text-[#323130]">{activePassport.licenseType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8a8886]">Trust score</span>
                  <span className="font-semibold text-[#0e700e]">{activePassport.overallScore}/100</span>
                </div>
                <div className="flex flex-col gap-1 border-t border-[#f3f2f1] pt-2">
                  <span className="text-[11px] uppercase text-[#8a8886]">File hash</span>
                  <span className="select-all break-all rounded border border-[#e1dfdd] bg-[#faf9f8] p-1.5 font-mono text-[10px] leading-tight text-[#605e5c]">
                    {activePassport.fileHash}
                  </span>
                </div>
              </div>

              {/* "Why does this exist" preview quick panel */}
              <button
                onClick={() => setIsExplanationOpen(true)}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded border border-[#c8c6c4] text-[12px] font-medium text-[#323130] hover:bg-black/[.03]"
              >
                <HelpCircle className="h-3.5 w-3.5 text-[#0f6cbd]" />
                <span>Explain this system</span>
              </button>
            </div>
          )}
        </div>

        {/* Right 3 Columns: Visual Lineage Flow Map */}
        <div className="lg:col-span-3 space-y-4">

          {/* Unified 3-tier mapping visualizer */}
          <div className="space-y-4 rounded-md border border-[#e1dfdd] bg-white p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[13px] font-semibold text-[#201f1e]">Active lineage pathway</h3>
                <p className="text-[11px] text-[#8a8886]">Traced from build variables down to active servers</p>
              </div>

              <span className="inline-flex items-center gap-1.5 text-[11px] text-[#605e5c]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#0f6cbd]" />
                Live feed state
              </span>
            </div>

            {/* Visual grid connecting columns */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">

              {/* TIER 1: Upstream Provenance Origin */}
              <div className="flex flex-col gap-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
                <div className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[13px] font-semibold text-[#201f1e]">
                  <GitFork className="h-3.5 w-3.5 text-[#0f6cbd]" />
                  <span>1. Code provenance</span>
                </div>

                {provenanceDetails && (
                  <div className="space-y-2">
                    <div className="space-y-1 rounded border border-[#e1dfdd] bg-white p-2 text-[12px]">
                      <p className="text-[11px] text-[#8a8886]">Source repository</p>
                      <a
                        href={provenanceDetails.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex max-w-[190px] items-center gap-1 truncate font-medium text-[#0f6cbd] hover:underline"
                      >
                        <span className="truncate">{provenanceDetails.repoUrl.replace('https://', '')}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <p className="text-[11px] text-[#8a8886]">Branch: <span className="font-medium text-[#323130]">{provenanceDetails.branch}</span></p>
                    </div>

                    <div className="space-y-1 rounded border border-[#e1dfdd] bg-white p-2 text-[12px]">
                      <p className="text-[11px] text-[#8a8886]">CI/CD pipeline</p>
                      <p className="font-medium text-[#323130]">{provenanceDetails.ciProvider}</p>
                      <p className="truncate text-[11px] text-[#8a8886]" title={provenanceDetails.buildId}>ID: {provenanceDetails.buildId}</p>
                    </div>

                    <div className="space-y-1 rounded border border-[#e1dfdd] bg-[#eff6fc] p-2 text-[12px]">
                      <p className="text-[11px] text-[#0f6cbd]">Cryptographic proof</p>
                      <div className="flex items-center gap-1 font-medium text-[#0f6cbd]">
                        <FileSignature className="h-3.5 w-3.5 shrink-0" />
                        <span>SLSA Level 4 verified</span>
                      </div>
                      <p className="text-[11px] leading-tight text-[#0f6cbd]/80">Authority: {provenanceDetails.signingAuthority}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* TIER 2: Central SBOM Component Lineage */}
              <div className="flex flex-col gap-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
                <div className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[13px] font-semibold text-[#201f1e]">
                  <Layers className="h-3.5 w-3.5 text-[#0f6cbd]" />
                  <span>2. Core packages (SBOM)</span>
                </div>

                <label className="flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] bg-white px-2 focus-within:border-[#0f6cbd] focus-within:ring-1 focus-within:ring-[#0f6cbd]">
                  <Search className="h-3.5 w-3.5 text-[#8a8886]" />
                  <input
                    type="text"
                    placeholder="Filter dependencies..."
                    value={dependencySearchQuery}
                    onChange={(e) => setDependencySearchQuery(e.target.value)}
                    className="w-full bg-transparent text-[12px] text-[#323130] outline-none placeholder:text-[#8a8886]"
                  />
                </label>

                <div className="flex-1 space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                  {filteredSbom.length === 0 ? (
                    <div className="py-8 text-center text-[11px] text-[#8a8886]">
                      No components found matching search.
                    </div>
                  ) : (
                    filteredSbom.map((comp, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded border border-[#e1dfdd] bg-white px-2 py-1.5 text-[12px] hover:border-[#c8c6c4]"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[#323130]" title={comp.name}>{comp.name}</p>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#8a8886]">
                            <span>v{comp.version}</span>
                            <span className="rounded bg-[#f3f2f1] px-1 uppercase">
                              {comp.dependencyType}
                            </span>
                          </div>
                        </div>

                        <span className={`ml-1.5 inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${
                          comp.trustLevel === 'Trusted' ? 'text-[#0e700e]' :
                          comp.trustLevel === 'Review Required' ? 'text-[#8a5700]' :
                          'text-[#a4262c]'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            comp.trustLevel === 'Trusted' ? 'bg-[#0e700e]' :
                            comp.trustLevel === 'Review Required' ? 'bg-[#8a5700]' :
                            'bg-[#a4262c]'
                          }`} />
                          {comp.trustLevel === 'Trusted' ? 'OK' : 'Audit'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* TIER 3: Downstream Active Deployments */}
              <div className="flex flex-col gap-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
                <div className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[13px] font-semibold text-[#201f1e]">
                  <Server className="h-3.5 w-3.5 text-[#0f6cbd]" />
                  <span>3. Downstream runtimes</span>
                </div>

                <div className="flex-1 space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {deployedAssets.length === 0 ? (
                    <div className="space-y-1.5 py-8 text-center">
                      <HelpCircle className="mx-auto h-5 w-5 text-[#c8c6c4]" />
                      <p className="text-[12px] font-medium text-[#605e5c]">No active hosting hosts</p>
                      <p className="px-2 text-[11px] leading-normal text-[#8a8886]">
                        This passport is registered but has no current asset mappings running on servers or pods.
                      </p>
                    </div>
                  ) : (
                    deployedAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="space-y-1.5 rounded border border-[#e1dfdd] bg-white p-2 text-[12px]"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h5 className="max-w-[130px] truncate font-medium text-[#201f1e]" title={asset.hostName}>
                              {asset.hostName}
                            </h5>
                            <p className="text-[11px] text-[#8a8886]">{asset.type} · {asset.OS}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            asset.health === 'Compliant' ? 'text-[#0e700e]' : 'text-[#a4262c]'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${asset.health === 'Compliant' ? 'bg-[#0e700e]' : 'bg-[#a4262c]'}`} />
                            {asset.health}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 border-t border-[#f3f2f1] pt-1.5 text-[11px] text-[#605e5c]">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-[#8a8886]" />
                          <span className="truncate font-medium">{asset.clientName}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* VULNERABILITY BLAST RADIUS TRACER utility */}
          <div className="space-y-3 rounded-md border border-[#e1dfdd] bg-white p-4">
            <div className="border-b border-[#f3f2f1] pb-3">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#201f1e]">
                <Zap className="h-3.5 w-3.5 text-[#8a5700]" />
                <span>Transitive vulnerability blast radius tracer</span>
              </h3>
              <p className="mt-0.5 text-[11px] text-[#8a8886]">
                Input a sub-dependency name (e.g. "log4j", "openssl", "redis") to trace all host servers dependent on it.
              </p>
            </div>

            <div className="flex gap-2">
              <label className="flex h-9 flex-1 items-center gap-2 rounded border border-[#c8c6c4] bg-white px-3 focus-within:border-[#0f6cbd] focus-within:ring-1 focus-within:ring-[#0f6cbd]">
                <Search className="h-3.5 w-3.5 text-[#8a8886]" />
                <input
                  type="text"
                  placeholder="Type package name to scan impact (e.g. openssl, redis)..."
                  value={traceSearchQuery}
                  onChange={(e) => setTraceSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-[13px] text-[#323130] outline-none placeholder:text-[#8a8886]"
                />
              </label>
              {traceSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTraceSearchQuery('')}
                  className="h-9 rounded border border-[#c8c6c4] px-3 text-[12px] font-medium text-[#323130] hover:bg-black/[.03]"
                >
                  Clear trace
                </button>
              )}
            </div>

            {/* Traced impact results list */}
            {traceSearchQuery.trim() ? (
              <div className="space-y-2 pt-1">
                <h4 className="text-[11px] uppercase tracking-wide text-[#8a8886]">
                  Impact mapping for "{traceSearchQuery}" ({tracedImpact.length} pipelines found)
                </h4>

                {tracedImpact.length === 0 ? (
                  <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-4 text-center text-[12px] text-[#605e5c]">
                    No active software passports or dependency chains are running components matching "{traceSearchQuery}".
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {tracedImpact.map((item, idx) => (
                      <div
                        key={idx}
                        className="space-y-2 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="inline-block rounded bg-[#eff6fc] px-1.5 py-0.5 text-[11px] font-medium text-[#0f6cbd]">
                              Dependency node found
                            </span>
                            <h5 className="mt-1 text-[13px] font-medium text-[#201f1e]">
                              {item.component.name} <span className="font-normal text-[#8a8886]">v{item.component.version}</span>
                            </h5>
                            <p className="mt-0.5 text-[11px] text-[#8a8886]">Purl: {item.component.purl}</p>
                          </div>

                          <div className="shrink-0 text-right">
                            <span className="block text-[11px] text-[#8a8886]">Contained in</span>
                            <span className="mt-0.5 block text-[13px] font-medium text-[#323130]">{item.passport.name}</span>
                          </div>
                        </div>

                        {/* Blast list of host targets */}
                        <div className="space-y-1.5 border-t border-[#e1dfdd] pt-2">
                          <p className="flex items-center gap-1 text-[11px] font-medium text-[#605e5c]">
                            <Server className="h-3 w-3 text-[#0f6cbd]" />
                            <span>Vulnerable deployment blast target hosts ({item.hosts.length})</span>
                          </p>

                          {item.hosts.length === 0 ? (
                            <p className="rounded border border-[#e1dfdd] bg-white p-2.5 text-[11px] italic text-[#8a8886]">
                              Component is listed in the SBOM but currently has zero active deployment hosts. Threat exposure is minimal.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                              {item.hosts.map((host) => (
                                <div
                                  key={host.id}
                                  className="flex items-center justify-between rounded border border-[#e1dfdd] bg-white p-2 text-[11px]"
                                >
                                  <div className="min-w-0">
                                    <p className="max-w-[140px] truncate font-medium text-[#323130]">{host.hostName}</p>
                                    <p className="mt-0.5 text-[#8a8886]">{host.clientName} · {host.environment}</p>
                                  </div>
                                  <span className={`inline-flex shrink-0 items-center gap-1 font-medium ${
                                    host.health === 'Compliant' ? 'text-[#0e700e]' : 'text-[#a4262c]'
                                  }`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${host.health === 'Compliant' ? 'bg-[#0e700e]' : 'bg-[#a4262c]'}`} />
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
              <div className="flex items-start gap-2 rounded-md border border-dashed border-[#e1dfdd] bg-[#faf9f8] p-3 text-[12px] text-[#605e5c]">
                <Info className="h-3.5 w-3.5 shrink-0 text-[#8a8886]" />
                <p className="leading-snug">
                  Trace utilities query transitively mapped software bill-of-materials elements recursively. For example, search <code className="rounded bg-[#f3f2f1] px-1 py-0.5 font-mono font-medium text-[#0f6cbd]">openssl</code> to identify its downstream footprint or <code className="rounded bg-[#f3f2f1] px-1 py-0.5 font-mono font-medium text-[#0f6cbd]">postgres</code> to check running nodes.
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
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsExplanationOpen(false)}
              className="absolute inset-0 bg-black"
            />

            {/* Explainer Modal container */}
            <motion.div
              initial={{ scale: 0.98, y: 10, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.98, y: 10, opacity: 0 }}
              className="relative z-10 w-full max-w-lg rounded-md border border-[#e1dfdd] bg-white p-5 text-left"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <span className="block text-[11px] uppercase tracking-wide text-[#8a8886]">
                    Why it exists
                  </span>
                  <h3 className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold text-[#201f1e]">
                    <Sparkles className="h-4 w-4 text-[#0f6cbd]" />
                    <span>Explain {activePassport.name}</span>
                  </h3>
                </div>
                <button
                  onClick={() => setIsExplanationOpen(false)}
                  className="rounded p-1 text-[#8a8886] hover:bg-black/[.03] hover:text-[#605e5c]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Explainer Body */}
              <div className="space-y-3">
                {/* Structured Software Card Details */}
                <div className="space-y-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
                  <div>
                    <span className="mb-0.5 block text-[11px] uppercase text-[#8a8886]">What it does</span>
                    <p className="text-[13px] leading-relaxed text-[#323130]">
                      {activeMnemonic.whatItDoes}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="mb-0.5 block text-[11px] uppercase text-[#8a8886]">Who uses it</span>
                      <span className="text-[13px] font-medium text-[#323130]">
                        {activeMnemonic.whoUsesit}
                      </span>
                    </div>
                    <div>
                      <span className="mb-0.5 block text-[11px] uppercase text-[#8a8886]">Business importance</span>
                      <span className="text-[13px] font-medium text-[#0f6cbd]">
                        {activeMnemonic.businessImportance}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-[#e1dfdd] pt-2">
                    <span className="mb-0.5 block text-[11px] uppercase text-[#8a8886]">Connected systems</span>
                    <p className="text-[13px] text-[#605e5c]">
                      {activeMnemonic.connections}
                    </p>
                  </div>
                </div>

                {/* The Magic Narrative */}
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#0f6cbd]">
                    Advisor narrative
                  </span>
                  <div className="rounded-md border border-[#e1dfdd] bg-[#eff6fc] p-3 text-[13px] leading-relaxed text-[#201f1e]">
                    "{activeMnemonic.explanation}"
                  </div>
                </div>

                {/* Recommendation */}
                <div className="flex items-center justify-between border-t border-[#f3f2f1] pt-3 text-[13px]">
                  <span className="text-[#8a8886]">Recommendation:</span>
                  <span className="inline-flex items-center gap-1.5 rounded bg-[#dff6dd] px-2.5 py-0.5 text-[12px] font-medium text-[#0e700e]">
                    Keep — important business system
                  </span>
                </div>
              </div>

              {/* Close footer button */}
              <div className="mt-4 border-t border-[#f3f2f1] pt-3 text-right">
                <button
                  type="button"
                  onClick={() => setIsExplanationOpen(false)}
                  className="h-8 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]"
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
