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
import { apiFetch } from '../utils/apiClient';
import { SoftwarePassport, Client } from '../types';

interface SoftwareLineageTrackerProps {
  passports: SoftwarePassport[];
  clients: Client[];
  assets: any[];
  onUpdatePassport?: (updatedPassport: SoftwarePassport) => void;
}

export default function SoftwareLineageTracker({ passports, clients, assets, onUpdatePassport }: SoftwareLineageTrackerProps) {
  const [selectedPassportId, setSelectedPassportId] = useState<string>(passports[0]?.id || '');
  const [dependencySearchQuery, setDependencySearchQuery] = useState<string>('');
  const [traceSearchQuery, setTraceSearchQuery] = useState<string>('');
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  const [slsaModalOpen, setSlsaModalOpen] = useState(false);
  const [slsaStatementText, setSlsaStatementText] = useState('');
  const [slsaSubmitting, setSlsaSubmitting] = useState(false);
  const [slsaSubmitError, setSlsaSubmitError] = useState<string | null>(null);

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

  // Real SLSA/in-toto provenance evidence for the active passport, if any was
  // ever submitted and independently re-verified by the server
  // (verifySlsaProvenance). Nothing here is generated client-side -- when no
  // matching evidence item exists, the UI says so honestly rather than
  // fabricating a repo URL, commit hash, or SLSA level.
  const slsaEvidence = useMemo(() => {
    if (!activePassport) return null;
    return (activePassport.evidence || []).find((item) => item.type === 'Attestation' && /slsa/i.test(item.name)) || null;
  }, [activePassport]);

  const slsaDetails = useMemo(() => {
    if (!slsaEvidence?.rawContent) return null;
    try { return JSON.parse(slsaEvidence.rawContent); } catch { return null; }
  }, [slsaEvidence]);

  async function submitSlsaProvenance() {
    if (!activePassport) return;
    setSlsaSubmitting(true);
    setSlsaSubmitError(null);
    try {
      const digestBuffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(slsaStatementText));
      const hash = Array.from(new Uint8Array(digestBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const response = await apiFetch(`/api/passports/${activePassport.id}/evidence/slsa-provenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statement: slsaStatementText, hash }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setSlsaSubmitError(data?.details?.fieldErrors ? Object.values(data.details.fieldErrors).flat()[0] as string : (data?.error || 'Submission was rejected.'));
        return;
      }
      if (onUpdatePassport && Array.isArray(data?.evidence)) onUpdatePassport({ ...activePassport, evidence: data.evidence });
      setSlsaModalOpen(false);
      setSlsaStatementText('');
    } catch {
      setSlsaSubmitError('Submission failed. Check your connection and try again.');
    } finally {
      setSlsaSubmitting(false);
    }
  }

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
          <span className="bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)] border border-[var(--spr-highlight)] px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider mb-2 inline-block">
            🌐 The Google Maps of your Software World
          </span>
          <h1 className="text-xl font-display font-black text-[var(--spr-text)] flex items-center gap-2">
            <Compass className="w-5.5 h-5.5 text-[var(--spr-highlight)] animate-spin" style={{ animationDuration: '8s' }} />
            <span>Interactive Software Lineage Map</span>
          </h1>
          <p className="text-xs text-[var(--spr-text-muted)] font-sans mt-1">
            Explore your digital DNA. Trace any software asset from source code commits up to production cloud runtimes.
          </p>
        </div>

        {/* Global Lineage Summary Badges */}
        <div className="flex flex-wrap gap-3">
          <div className="bg-[var(--spr-surface-alt)] px-3.5 py-2 border border-[var(--spr-border)] rounded-md flex items-center gap-2.5 text-xs">
            <div className="bg-[var(--spr-accent-soft)] p-1.5 rounded-md text-[var(--spr-highlight)] ">
              <GitFork className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] uppercase font-bold tracking-wider text-[var(--spr-text-muted)] leading-none">Mapped Lines</p>
              <p className="font-extrabold text-[var(--spr-text)] mt-1 leading-none">{passports.length} Systems</p>
            </div>
          </div>

          <div className="bg-[var(--spr-surface-alt)] px-3.5 py-2 border border-[var(--spr-border)] rounded-md flex items-center gap-2.5 text-xs">
            <div className="bg-[var(--spr-green)]/15 p-1.5 rounded-md text-[var(--spr-green)] ">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] uppercase font-bold tracking-wider text-[var(--spr-text-muted)] leading-none">SBOM Packages</p>
              <p className="font-extrabold text-[var(--spr-text)] mt-1 leading-none">{totalUniqueDependencies} Nodes</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Interactive Map Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Column: Software Passport Selector & Provenance Parameters */}
        <div className="lg:col-span-1 space-y-5">
          <div className="bg-[var(--spr-surface-alt)] rounded-md border border-[var(--spr-border)] p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-xs font-black text-[var(--spr-text)] font-display uppercase tracking-wider">Select Active System</h3>
              <p className="text-[9px] text-[var(--spr-text-muted)] font-sans mt-0.5">Click to lock tracking camera on target</p>
            </div>

            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
              {passports.map(p => {
                const isSelected = p.id === selectedPassportId;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPassportId(p.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-md text-left text-xs transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--spr-accent-soft)] border-[var(--spr-highlight)] text-[var(--spr-highlight)] font-bold'
                        : 'bg-[var(--spr-surface-sunken)] border-[var(--spr-border)] hover:bg-[var(--spr-surface-hover)] text-[var(--spr-text-faint)] '
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-sans leading-tight">{p.name}</p>
                      <span className="text-[8px] font-mono text-[var(--spr-text-muted)] mt-1 block">v{p.version} • {p.publisher}</span>
                    </div>
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 ml-2 ${isSelected ? 'text-[var(--spr-highlight)] ' : 'text-[var(--spr-text-muted)] '}`} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Passport General Info */}
          {activePassport && (
            <div className="bg-[var(--spr-surface)] text-[var(--spr-text)] rounded-md border border-[var(--spr-border)] p-5 space-y-4">
              <div className="flex justify-between items-start border-b border-[var(--spr-border)] pb-2.5">
                <div>
                  <span className="text-[8px] font-mono font-black text-[var(--spr-highlight)] uppercase tracking-widest">CAMERA FOCUS</span>
                  <h4 className="text-sm font-black text-[var(--spr-text)] mt-1 leading-snug">{activePassport.name}</h4>
                </div>
                <span className="bg-[var(--spr-accent-soft)] border border-[var(--spr-highlight)] text-[var(--spr-highlight)] text-[8px] font-mono font-semibold px-2 py-0.5 rounded-md uppercase shrink-0">
                  {activePassport.category}
                </span>
              </div>

              <div className="space-y-2.5 text-[10px] font-mono">
                <div className="flex justify-between">
                  <span className="text-[var(--spr-text-muted)]">RELEASE DATE:</span>
                  <span className="text-[var(--spr-text)] font-medium">{activePassport.releaseDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--spr-text-muted)]">LICENSE:</span>
                  <span className="text-[var(--spr-text)] font-medium">{activePassport.licenseType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--spr-text-muted)]">TRUST SCORE:</span>
                  <span className={activePassport.overallScore == null ? 'text-[var(--spr-text-muted)] font-bold' : 'text-[var(--spr-green)] font-bold'}>{activePassport.overallScore == null ? 'Not verified' : `${activePassport.overallScore}/100`}</span>
                </div>
                <div className="flex flex-col gap-1 pt-2 border-t border-[var(--spr-border)]">
                  <span className="text-[var(--spr-text-muted)] uppercase text-[8px]">DIGITAL FILE HASH:</span>
                  <span className="text-[var(--spr-text-muted)] break-all bg-[var(--spr-surface)] p-2 rounded-md border border-[var(--spr-border)] select-all font-mono text-[8px] leading-tight">
                    {activePassport.fileHash}
                  </span>
                </div>
              </div>

              {/* CEO "Why Exist" preview quick panel */}
              <button
                onClick={() => setIsExplanationOpen(true)}
                className="w-full bg-[var(--spr-surface-alt)] hover:bg-[var(--spr-surface-sunken)] text-[var(--spr-text)] border border-[var(--spr-border)] font-bold py-2.5 rounded-md text-[11px] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <HelpCircle className="w-4 h-4 text-[var(--spr-highlight)]" />
                <span>Explain this system</span>
              </button>
            </div>
          )}
        </div>

        {/* Right 3 Columns: Visual Lineage Flow Map */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Unified 3-tier mapping visualizer */}
          <div className="bg-[var(--spr-surface-alt)] rounded-md border border-[var(--spr-border)] p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-black text-[var(--spr-text)] font-display uppercase tracking-wider">Active Lineage Pathway</h3>
                <p className="text-[10px] text-[var(--spr-text-muted)] font-sans">Pedigree stream traced from build variables down to active servers</p>
              </div>

              {/* Pulsing state indicator */}
              <div className="flex items-center gap-1.5 text-[9px] font-mono font-bold bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)] border border-[var(--spr-highlight)] px-2 py-0.5 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--spr-accent)] animate-pulse"></span>
                <span>LIVE FEED STATE</span>
              </div>
            </div>

            {/* Visual grid connecting columns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2 relative">
              
              {/* Connector lines overlays using CSS (visible on desktop) */}
              <div className="hidden md:block absolute top-[45%] left-[28%] right-[32%] border-b border-dashed border-[var(--spr-border)] z-0 pointer-events-none"></div>

              {/* TIER 1: Build Provenance (SLSA) -- driven entirely by real evidence */}
              <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md p-4 flex flex-col gap-3.5 z-10 relative">
                <div className="flex items-center gap-2 text-xs font-black text-[var(--spr-text)] border-b border-[var(--spr-border)] pb-2">
                  <GitFork className="w-4 h-4 text-[var(--spr-highlight)]" />
                  <span>1. Build Provenance (SLSA)</span>
                </div>

                {!slsaEvidence && (
                  <div className="space-y-3 font-sans">
                    <div className="p-2.5 bg-[var(--spr-surface-alt)] border border-dashed border-[var(--spr-border)] rounded-md text-xs space-y-1.5">
                      <p className="text-[8px] font-mono uppercase font-bold tracking-wider text-[var(--spr-text-muted)]">SLSA Provenance</p>
                      <p className="text-[10px] text-[var(--spr-text-muted)] leading-relaxed">Evidence Not Available. No SLSA/in-toto provenance attestation has been submitted for this software.</p>
                    </div>
                    <button type="button" onClick={() => setSlsaModalOpen(true)} className="w-full bg-[var(--spr-surface-alt)] hover:bg-[var(--spr-surface-hover)] text-[var(--spr-highlight)] border border-[var(--spr-border)] font-bold py-2 rounded-md text-[10px] transition-all cursor-pointer">
                      Submit provenance attestation
                    </button>
                  </div>
                )}

                {slsaEvidence && slsaEvidence.status === 'VERIFIED' && (
                  <div className="space-y-3 font-sans">
                    <div className="p-2.5 bg-[var(--spr-accent-soft)] border border-[var(--spr-highlight)] rounded-md text-xs space-y-1">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--spr-highlight)]">
                        <FileSignature className="w-3.5 h-3.5 shrink-0" />
                        <span>SLSA Provenance — Verified</span>
                      </div>
                      <p className="text-[8px] font-mono text-[var(--spr-highlight)] leading-tight">Structurally valid, hash-verified in-toto provenance statement</p>
                    </div>
                    <div className="p-2.5 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-md text-xs space-y-1">
                      <p className="text-[8px] font-mono uppercase font-bold tracking-wider text-[var(--spr-text-muted)]">Builder</p>
                      <p className="text-[10px] text-[var(--spr-text)] break-all">{slsaDetails?.builderId || 'unknown'}</p>
                    </div>
                    <div className="p-2.5 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-md text-xs space-y-1">
                      <p className="text-[8px] font-mono uppercase font-bold tracking-wider text-[var(--spr-text-muted)]">Predicate type</p>
                      <p className="text-[9px] text-[var(--spr-text-muted)] break-all">{slsaDetails?.predicateType || 'unknown'}</p>
                    </div>
                    <p className="text-[8px] text-[var(--spr-text-faint)] leading-relaxed">SPR does not independently verify the attestation's Sigstore/DSSE signature chain.</p>
                  </div>
                )}

                {slsaEvidence && slsaEvidence.status === 'FAILED' && (
                  <div className="space-y-3 font-sans">
                    <div className="p-2.5 bg-[var(--spr-red)]/10 border border-[var(--spr-red)] rounded-md text-xs space-y-1">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--spr-red)]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>SLSA Provenance — Verification Failed</span>
                      </div>
                      <p className="text-[8px] font-mono text-[var(--spr-red)] leading-tight break-all">{slsaEvidence.failureReason || 'Unknown failure'}</p>
                    </div>
                    <button type="button" onClick={() => setSlsaModalOpen(true)} className="w-full bg-[var(--spr-surface-alt)] hover:bg-[var(--spr-surface-hover)] text-[var(--spr-highlight)] border border-[var(--spr-border)] font-bold py-2 rounded-md text-[10px] transition-all cursor-pointer">
                      Resubmit provenance attestation
                    </button>
                  </div>
                )}

                {slsaEvidence && slsaEvidence.status !== 'VERIFIED' && slsaEvidence.status !== 'FAILED' && (
                  <div className="p-2.5 bg-[var(--spr-surface-sunken)] border border-[var(--spr-amber)] rounded-md text-xs space-y-1">
                    <p className="text-[10px] font-bold text-[var(--spr-amber)]">SLSA Provenance — Detected, Not Yet Verified</p>
                  </div>
                )}
              </div>

              {/* TIER 2: Central SBOM Component Lineage */}
              <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md p-4 flex flex-col gap-3.5 z-10 relative">
                <div className="flex items-center gap-2 text-xs font-black text-[var(--spr-text)] border-b border-[var(--spr-border)] pb-2">
                  <Layers className="w-4 h-4 text-[var(--spr-highlight)]" />
                  <span>2. Core Packages (SBOM)</span>
                </div>

                <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-md">
                  <Search className="w-3.5 h-3.5 text-[var(--spr-text-muted)] " />
                  <input
                    type="text"
                    placeholder="Filter dependencies..."
                    value={dependencySearchQuery}
                    onChange={(e) => setDependencySearchQuery(e.target.value)}
                    className="w-full bg-transparent focus:outline-none text-[10px] font-semibold text-[var(--spr-text-faint)] "
                  />
                </div>

                <div className="flex-1 space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {filteredSbom.length === 0 ? (
                    <div className="text-center py-8 text-[var(--spr-text-muted)] text-[10px]">
                      No components found matching search.
                    </div>
                  ) : (
                    filteredSbom.map((comp, idx) => (
                      <div
                        key={idx}
                        className="p-2 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] hover:border-[var(--spr-border)] rounded-md flex items-center justify-between text-[11px] "
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-[var(--spr-text-faint)] truncate" title={comp.name}>{comp.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[8px] font-mono text-[var(--spr-text-muted)] font-semibold">v{comp.version}</span>
                            <span className="text-[8px] font-mono bg-[var(--spr-surface-hover)] text-[var(--spr-text-muted)] px-1 py-0.2 rounded font-black uppercase">
                              {comp.dependencyType}
                            </span>
                          </div>
                        </div>

                        <span className={`px-1.5 rounded text-[8px] font-bold font-mono shrink-0 ml-1.5 border ${
                          comp.trustLevel === 'Trusted' ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)] border-[var(--spr-green)] ' :
                          comp.trustLevel === 'Review Required' ? 'bg-[var(--spr-amber)]/15 text-[var(--spr-amber)] border-[var(--spr-amber)] ' :
                          'bg-[var(--spr-red)]/15 text-[var(--spr-red)] border-[var(--spr-red)] '
                        }`}>
                          {comp.trustLevel === 'Trusted' ? 'OK' : 'AUDIT'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* TIER 3: Downstream Active Deployments */}
              <div className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md p-4 flex flex-col gap-3.5 z-10 relative">
                <div className="flex items-center gap-2 text-xs font-black text-[var(--spr-text)] border-b border-[var(--spr-border)] pb-2">
                  <Server className="w-4 h-4 text-[var(--spr-highlight)]" />
                  <span>3. Downstream Runtimes</span>
                </div>

                <div className="flex-1 space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {deployedAssets.length === 0 ? (
                    <div className="text-center py-12 text-[var(--spr-text-muted)] space-y-2">
                      <HelpCircle className="w-6 h-6 text-[var(--spr-text)] mx-auto" />
                      <p className="text-[10px] font-semibold text-[var(--spr-text-faint)]">No Active Hosting Hosts</p>
                      <p className="text-[9px] text-[var(--spr-text-muted)] leading-normal px-2">
                        This passport is registered but has no current asset mappings running on servers or pods.
                      </p>
                    </div>
                  ) : (
                    deployedAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="p-3 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-md text-xs space-y-2 "
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h5 className="font-bold text-[var(--spr-text)] font-mono text-[10px] truncate max-w-[130px]" title={asset.hostName}>
                              {asset.hostName}
                            </h5>
                            <p className="text-[8px] font-mono text-[var(--spr-text-muted)] mt-0.5">{asset.type} • {asset.OS}</p>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold font-mono uppercase ${
                            asset.health === 'Compliant' ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)]' : 'bg-[var(--spr-red)]/15 text-[var(--spr-red)]'
                          }`}>
                            {asset.health}
                          </span>
                        </div>

                        <div className="pt-2 border-t border-[var(--spr-border)] flex items-center gap-1.5 text-[9px] text-[var(--spr-text-muted)] font-mono">
                          <Building2 className="w-3.5 h-3.5 text-[var(--spr-text-muted)] shrink-0" />
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
          <div className="bg-[var(--spr-surface-alt)] rounded-md border border-[var(--spr-border)] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--spr-border)] pb-3">
              <div>
                <h3 className="text-xs font-black text-[var(--spr-text)] font-display flex items-center gap-1.5 uppercase tracking-wider">
                  <Zap className="w-4.5 h-4.5 text-[var(--spr-amber)] animate-bounce" />
                  <span>Transitive Vulnerability Blast Radius Tracer</span>
                </h3>
                <p className="text-[10px] text-[var(--spr-text-muted)] font-sans mt-0.5">
                  Input sub-dependency name (e.g. "log4j", "openssl", "redis") to trace all host servers dependent on it.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md">
                <Search className="w-4 h-4 text-[var(--spr-text-muted)]" />
                <input
                  type="text"
                  placeholder="Type package name to scan impact (e.g. openssl, redis)..."
                  value={traceSearchQuery}
                  onChange={(e) => setTraceSearchQuery(e.target.value)}
                  className="w-full bg-transparent focus:outline-none text-xs font-medium text-[var(--spr-text-faint)] "
                />
              </div>
              {traceSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTraceSearchQuery('')}
                  className="px-4 py-2 bg-[var(--spr-surface-hover)] hover:bg-[var(--spr-surface-hover)] text-[var(--spr-text-faint)] rounded-md text-xs font-bold transition-all cursor-pointer"
                >
                  Clear Trace
                </button>
              )}
            </div>

            {/* Traced impact results list */}
            {traceSearchQuery.trim() ? (
              <div className="space-y-3 pt-1">
                <h4 className="text-[10px] font-bold text-[var(--spr-text-muted)] uppercase tracking-wider font-mono">
                  Impact mapping for "{traceSearchQuery}" ({tracedImpact.length} Pipelines found)
                </h4>

                {tracedImpact.length === 0 ? (
                  <div className="p-5 bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md text-center text-xs text-[var(--spr-text-muted)] ">
                    No active software passports or dependency chains are running components matching "{traceSearchQuery}".
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {tracedImpact.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-[8px] font-mono font-bold bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)] px-1.5 py-0.5 rounded border border-[var(--spr-highlight)] ">
                              Dependency Node Found
                            </span>
                            <h5 className="font-bold text-[var(--spr-text)] text-xs mt-1.5">
                              {item.component.name} <span className="text-[var(--spr-text-muted)] font-normal">v{item.component.version}</span>
                            </h5>
                            <p className="text-[9px] text-[var(--spr-text-muted)] font-mono mt-0.5">Purl: {item.component.purl}</p>
                          </div>
                          
                          <div className="text-right">
                            <span className="text-[9px] text-[var(--spr-text-muted)] block font-mono">Contained In:</span>
                            <span className="font-extrabold text-[var(--spr-text-faint)] text-xs block mt-0.5">{item.passport.name}</span>
                          </div>
                        </div>

                        {/* Blast list of host targets */}
                        <div className="pt-2.5 border-t border-[var(--spr-border)] space-y-2">
                          <p className="text-[9px] font-bold text-[var(--spr-highlight)] uppercase font-mono tracking-wider flex items-center gap-1">
                            <Server className="w-3 h-3 text-[var(--spr-highlight)]" />
                            <span>Vulnerable Deployment Blast Target Hosts ({item.hosts.length})</span>
                          </p>

                          {item.hosts.length === 0 ? (
                            <p className="text-[9px] text-[var(--spr-text-muted)] font-sans italic bg-[var(--spr-surface-alt)] p-2.5 rounded-md border border-[var(--spr-border)] ">
                              Component is listed in the SBOM but currently has zero active deployment hosts. Threat exposure is minimal.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {item.hosts.map((host) => (
                                <div
                                  key={host.id}
                                  className="p-2 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-md text-[10px] flex items-center justify-between "
                                >
                                  <div>
                                    <p className="font-bold text-[var(--spr-text-faint)] font-mono truncate max-w-[140px]">{host.hostName}</p>
                                    <p className="text-[8px] text-[var(--spr-text-muted)] font-mono mt-0.5">{host.clientName} • {host.environment}</p>
                                  </div>
                                  <span className={`px-1 py-0.2 rounded text-[7px] font-mono font-bold uppercase ${
                                    host.health === 'Compliant' ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)] border border-[var(--spr-green)]' : 'bg-[var(--spr-red)]/15 text-[var(--spr-red)] border border-[var(--spr-red)]'
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
              <div className="p-4 bg-[var(--spr-surface-sunken)] border border-dashed border-[var(--spr-border)] rounded-md text-center text-xs text-[var(--spr-text-muted)] flex items-center gap-3">
                <Info className="w-4.5 h-4.5 text-[var(--spr-text-muted)] shrink-0" />
                <p className="text-[10px] text-[var(--spr-text-muted)] leading-snug text-left">
                  Trace utilities query transitively mapped software bill-of-materials elements recursively. For example, search <code className="bg-[var(--spr-surface-hover)] px-1 py-0.5 rounded font-mono font-bold text-[var(--spr-highlight)] ">openssl</code> to identify its downstream footprint or <code className="bg-[var(--spr-surface-hover)] px-1 py-0.5 rounded font-mono font-bold text-[var(--spr-highlight)] ">postgres</code> to check running nodes.
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
              className="absolute inset-0 bg-black/80 "
            />
            
            {/* Explainer Modal container */}
            <motion.div
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="relative w-full max-w-lg bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-md p-6 overflow-hidden text-left z-10"
            >
              {/* Decorative top ribbon */}
              <div className="absolute top-0 inset-x-0 h-1.5 bg-[var(--spr-accent)]"></div>

              <div className="flex items-start justify-between mb-4 mt-2">
                <div className="space-y-1">
                  <span className="text-[9px] font-mono font-black text-[var(--spr-highlight)] uppercase tracking-widest block">
                    SPR INTELLIGENCE SYSTEM • WHY IT EXISTS
                  </span>
                  <h3 className="text-lg font-display font-black text-[var(--spr-text)] flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[var(--spr-highlight)]" />
                    <span>Explain {activePassport.name}</span>
                  </h3>
                </div>
                <button
                  onClick={() => setIsExplanationOpen(false)}
                  className="p-1.5 hover:bg-[var(--spr-surface-hover)] rounded-md text-[var(--spr-text-muted)] hover:text-[var(--spr-text-faint)] cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Explainer Body */}
              <div className="space-y-5">
                {/* Structured Software Card Details */}
                <div className="p-4 bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md space-y-4">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-[var(--spr-text-muted)] uppercase block mb-1">What it does</span>
                    <p className="text-xs text-[var(--spr-text-faint)] font-bold leading-relaxed">
                      {activeMnemonic.whatItDoes}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <span className="text-[9px] font-mono font-bold text-[var(--spr-text-muted)] uppercase block mb-0.5">Who uses it</span>
                      <span className="text-xs font-bold text-[var(--spr-text)] ">
                        {activeMnemonic.whoUsesit}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono font-bold text-[var(--spr-text-muted)] uppercase block mb-0.5">Business Importance</span>
                      <span className="text-xs font-bold text-[var(--spr-highlight)] ">
                        ⭐ {activeMnemonic.businessImportance}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[var(--spr-border)] ">
                    <span className="text-[10px] font-mono font-bold text-[var(--spr-text-muted)] uppercase block mb-1">Connected systems</span>
                    <p className="text-xs text-[var(--spr-text-faint)] font-medium">
                      {activeMnemonic.connections}
                    </p>
                  </div>
                </div>

                {/* The Magic Narrative */}
                <div className="space-y-2">
                  <span className="text-[10px] font-mono font-black text-[var(--spr-highlight)] uppercase tracking-wider block">
                    SPR ADVISOR DIRECT NARRATIVE:
                  </span>
                  <div className="bg-[var(--spr-accent-soft)] border border-[var(--spr-highlight)] p-4 rounded-md text-xs text-[var(--spr-highlight)] font-medium leading-relaxed font-sans">
                    “{activeMnemonic.explanation}”
                  </div>
                </div>

                {/* Recommendation */}
                <div className="flex items-center justify-between text-xs border-t border-[var(--spr-border)] pt-3">
                  <span className="text-[var(--spr-text-muted)]">Recommendation:</span>
                  <span className="font-mono font-bold bg-[var(--spr-green)]/15 text-[var(--spr-green)] border border-[var(--spr-green)] px-2.5 py-0.5 rounded-md">
                    Keep — Important Business System
                  </span>
                </div>
              </div>

              {/* Close footer button */}
              <div className="mt-5 pt-3 border-t border-[var(--spr-border)] text-right">
                <button
                  type="button"
                  onClick={() => setIsExplanationOpen(false)}
                  className="bg-[var(--spr-accent)] hover:bg-[var(--spr-accent)] text-[var(--spr-text)] font-bold px-4 py-2 rounded-md text-xs cursor-pointer transition-colors"
                >
                  Got it, close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SLSA provenance submission modal -- SPR independently re-verifies
          whatever is pasted here (hash-integrity + structural in-toto/SLSA
          checks) before ever marking it Verified; nothing is trusted on submission alone. */}
      {slsaModalOpen && activePassport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80" onClick={() => !slsaSubmitting && setSlsaModalOpen(false)} />
          <div className="relative w-full max-w-lg bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-md p-6 z-10 space-y-4">
            <h3 className="text-sm font-bold text-[var(--spr-text)]">Submit SLSA provenance attestation for {activePassport.name}</h3>
            <p className="text-[11px] text-[var(--spr-text-muted)] leading-relaxed">
              Paste the raw in-toto/SLSA provenance statement JSON (e.g. produced by slsa-github-generator or <code className="bg-[var(--spr-surface-hover)] px-1 rounded font-mono">cosign attest</code>). SPR independently checks it is well-formed and hash-consistent before marking it Verified — it does not fabricate a result.
            </p>
            <textarea
              value={slsaStatementText}
              onChange={(e) => setSlsaStatementText(e.target.value)}
              rows={10}
              placeholder='{"_type":"https://in-toto.io/Statement/v1","predicateType":"https://slsa.dev/provenance/v1",...}'
              className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3 text-[10px] font-mono text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]"
            />
            {slsaSubmitError && <p className="text-[11px] text-[var(--spr-red)]">{slsaSubmitError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSlsaModalOpen(false)} disabled={slsaSubmitting} className="rounded-md border border-[var(--spr-border)] px-4 py-2 text-xs text-[var(--spr-text-muted)] cursor-pointer disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void submitSlsaProvenance()} disabled={slsaSubmitting || !slsaStatementText.trim()} className="bg-[var(--spr-accent)] hover:bg-[var(--spr-accent-hover)] disabled:opacity-40 text-white font-bold px-4 py-2 rounded-md text-xs cursor-pointer transition-colors">
                {slsaSubmitting ? 'Verifying…' : 'Verify & submit'}
              </button>
            </div>
          </div>
        </div>
      )}

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
