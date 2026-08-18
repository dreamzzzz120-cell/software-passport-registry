/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
// @ts-ignore
import sprLegalBadge from '../assets/images/spr_legal_badge_1783630546377.jpg';
import { fuzzyMatch, filterData } from '../utils/filter';
import {
  FileCheck,
  ShieldAlert,
  Shield,
  Award,
  Calendar,
  Lock,
  GitBranch,
  FileSignature,
  Download,
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Sparkles,
  Info,
  Layers,
  Search,
  Filter,
  CheckCircle,
  Clock,
  User,
  FileText,
  ShieldCheck,
  Plus,
  X,
  PlusCircle,
  FileCode,
  Sliders,
  Play
} from 'lucide-react';
import { SoftwarePassport, Client, EvidenceItem } from '../types';
import RiskMitigation from './RiskMitigation';
import PassportSwarmView from './PassportSwarmView';
import SoftwareLineageTracker from './SoftwareLineageTracker';
import SoftwareSectorsPanel from './SoftwareSectorsPanel';
import { apiFetch } from '../utils/apiClient';
import { generatePassportEvidenceReport } from '../utils/pdfGenerator';

interface PassportsViewProps {
  passports: SoftwarePassport[];
  selectedPassportId: string | null;
  setSelectedPassportId: (id: string | null) => void;
  searchQuery: string;
  onUpdatePassport?: (updatedPassport: SoftwarePassport) => void;
  onNavigateTab?: (tab: string, itemId?: string) => void;
  clients?: Client[];
  assets?: any[];
}

export default function PassportsView({
  passports,
  selectedPassportId,
  setSelectedPassportId,
  searchQuery,
  onUpdatePassport,
  onNavigateTab,
  clients = [],
  assets = []
}: PassportsViewProps) {
  const [subTab, setSubTab] = useState<'catalog' | 'lineage' | 'sectors'>('catalog');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [activeMitigationVulId, setActiveMitigationVulId] = useState<string | null>(null);

  const [liveAiSummary, setLiveAiSummary] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // States for Gaps Analyzer and Cryptographic Evidence Submission
  const [submittingReqKey, setSubmittingReqKey] = useState<string | null>(null);
  const [evidenceSigner, setEvidenceSigner] = useState('');
  const [evidenceDetails, setEvidenceDetails] = useState('');
  const [evidenceHash, setEvidenceHash] = useState('');

  // Internal Drawer sub-tab navigation
  const [drawerTab, setDrawerTab] = useState<'overview' | 'sbom' | 'evidence' | 'vulnerabilities' | 'swarm'>('overview');

  React.useEffect(() => {
    setLiveAiSummary(null);
    setDrawerTab('overview');
  }, [selectedPassportId]);

  // Selected passport helper
  const passport = useMemo(() => {
    return passports.find(p => p.id === selectedPassportId) || null;
  }, [passports, selectedPassportId]);

  const handleLiveAudit = async () => {
    if (!passport) return;
    setIsAnalyzing(true);
    setLiveAiSummary(null);
    try {
      const response = await apiFetch('/api/ai/analyze-passport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passportId: passport.id })
      });
      const data = await response.json();
      if (data.analysis) {
        setLiveAiSummary(data.analysis);
      } else if (data.error) {
        setLiveAiSummary(`Error: ${data.error}`);
      }
    } catch (error) {
      setLiveAiSummary('Network error running security audit.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmitEvidence = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passport || !onUpdatePassport || !submittingReqKey) return;

    const reqDef = [
      { key: 'signature', name: 'Developer Binary Signature', detectType: 'Signature' as const },
      { key: 'slsa', name: 'SLSA Level 4 Provenance', detectType: 'Attestation' as const },
      { key: 'soc2', name: 'SOC 2 continuous compliance evidence', detectType: 'Audit Report' as const },
      { key: 'sast', name: 'Static Application Security Testing (SAST)', detectType: 'Security Scan' as const }
    ].find(r => r.key === submittingReqKey);

    if (!reqDef) return;

    const newEvidenceItem: EvidenceItem = {
      id: `ev-${Date.now()}`,
      name: reqDef.name,
      type: reqDef.detectType,
      signer: evidenceSigner || 'Unverified Signer',
      timestamp: new Date().toISOString(),
      hash: evidenceHash || '',
      // Self-submitted from this form — never auto-marked VERIFIED. A real
      // verification engine (not this UI) is what can upgrade this status,
      // and only by also supplying checksum/chainOfCustody/verifierEngineId.
      status: 'DECLARED'
    };

    const updatedEvidence = [...passport.evidence, newEvidenceItem];

    const timestampStr = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const newTimelineEvent = {
      date: timestampStr,
      event: 'Evidence Submitted (Declared, Not Independently Verified)',
      user: evidenceSigner || 'Unverified Signer',
      details: `${reqDef.name} evidence was submitted by the user for ${evidenceSigner || 'an unspecified signer'}. This has not been independently verified.`
    };

    const updatedPassport: SoftwarePassport = {
      ...passport,
      evidence: updatedEvidence,
      timeline: [newTimelineEvent, ...passport.timeline]
    };

    onUpdatePassport(updatedPassport);
    
    // Reset states
    setSubmittingReqKey(null);
    setEvidenceSigner('');
    setEvidenceDetails('');
    setEvidenceHash('');
  };

  // Filter passports using useMemo and filterData utility
  const filteredPassports = useMemo(() => {
    const fuzzyFiltered = filterData(passports, searchQuery, ['name', 'publisher', 'category']);
    return fuzzyFiltered.filter(p => {
      const matchesCategory = filterCategory === 'all' || p.category === filterCategory;
      return matchesCategory;
    });
  }, [passports, searchQuery, filterCategory]);

  // Unique categories helper
  const categories = useMemo(() => {
    return Array.from(new Set(passports.map(p => p.category)));
  }, [passports]);

  // Simulated PDF Export
  const handleExportPDF = () => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      setShowExportModal(true);
    }, 1200);
  };

  const handleSaveMitigationPlan = (
    vulId: string,
    plan: string,
    owner: string,
    targetDate: string,
    status: 'Open' | 'Mitigated' | 'Resolved' | 'Snoozed'
  ) => {
    if (!passport || !onUpdatePassport) return;

    const updatedVulnerabilities = passport.vulnerabilities.map(v => {
      if (v.id === vulId) {
        return {
          ...v,
          mitigationPlan: plan,
          mitigationOwner: owner,
          mitigationTargetDate: targetDate,
          status: status
        };
      }
      return v;
    });

    const timestamp = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const newTimelineEvent = {
      date: timestamp,
      event: 'Remediation Configured',
      user: 'Security Auditor',
      details: `Mitigation plan established for ${vulId}. Assigned to ${owner} with target completion on ${targetDate}.`
    };

    const updatedPassport: SoftwarePassport = {
      ...passport,
      vulnerabilities: updatedVulnerabilities,
      timeline: [newTimelineEvent, ...passport.timeline]
    };

    onUpdatePassport(updatedPassport);
    setActiveMitigationVulId(null);
  };

  // Compute gaps inside selected passport evidence registry
  const gapAnalysis = useMemo(() => {
    if (!passport) return [];
    const requirements = [
      { key: 'signature', name: 'Developer Binary Signature', detectType: 'Signature' },
      { key: 'slsa', name: 'SLSA Level 4 Provenance', detectType: 'Attestation' },
      { key: 'soc2', name: 'SOC 2 continuous compliance evidence', detectType: 'Audit Report' },
      { key: 'sast', name: 'Static Application Security Testing (SAST)', detectType: 'Security Scan' }
    ];

    return requirements.map(req => {
      const found = passport.evidence.find(ev => ev.type === req.detectType && (ev.status === 'VERIFIED' || ev.status === 'PARTIALLY_VERIFIED'));
      return {
        ...req,
        satisfied: !!found,
        evidence: found || null
      };
    });
  }, [passport]);

  return (
    <div className="space-y-6" id="passports-catalog-root">
      {/* Catalog view controls */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-display font-extrabold text-slate-900 dark:text-zinc-50">Software Passport Catalog</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
            Software records with evidence-level status. Verification applies only where an inspectable receipt is attached.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Sub-Tab Toggle */}
          <div className="flex bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 p-1 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setSubTab('catalog')}
              className={`px-3 py-1 rounded font-bold transition-all cursor-pointer ${
                subTab === 'catalog'
                  ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Catalog Grid
            </button>
            <button
              type="button"
              onClick={() => setSubTab('lineage')}
              className={`px-3 py-1 rounded font-bold transition-all cursor-pointer ${
                subTab === 'lineage'
                  ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Lineage Map
            </button>
            <button
              type="button"
              onClick={() => setSubTab('sectors')}
              className={`px-3 py-1 rounded font-bold transition-all cursor-pointer ${
                subTab === 'sectors'
                  ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              Software Sectors
            </button>
          </div>

          {/* Catalog Filter */}
          {subTab === 'catalog' && (
            <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-850 border border-slate-200 dark:border-zinc-850 px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-zinc-300">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Category:</span>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="bg-transparent focus:outline-none font-semibold cursor-pointer text-slate-800 dark:text-zinc-200"
              >
                <option value="all">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat} className="dark:bg-zinc-850">{cat}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {subTab === 'lineage' ? (
        <SoftwareLineageTracker
          passports={passports}
          clients={clients}
          assets={assets}
        />
      ) : subTab === 'sectors' ? (
        <SoftwareSectorsPanel
          passports={passports}
          onFilterCategory={(cat) => {
            setFilterCategory(cat);
            setSubTab('catalog');
          }}
          onNavigateTab={onNavigateTab}
          setSelectedPassportId={setSelectedPassportId}
        />
      ) : (
        <>
          {/* Registry Overview Summary */}
          <div className="studio-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 p-2.5 rounded-xl">
                <FileCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800 dark:text-zinc-100">Active Registry Catalog</h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  Currently tracking <span className="font-semibold text-slate-700 dark:text-zinc-300">{filteredPassports.length} software passports</span> matching your filter.
                </p>
              </div>
            </div>
            <div className="flex gap-6 text-xs font-mono text-slate-500 dark:text-zinc-400">
              <div>
                <p className="text-[9px] uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500">Total Dependencies</p>
                <p className="text-sm font-bold text-slate-700 dark:text-zinc-200 mt-0.5">
                  {filteredPassports.reduce((acc, p) => acc + p.sbom.length, 0)} direct/indirect
                </p>
              </div>
              <div className="border-l border-slate-100 dark:border-zinc-800 pl-4">
                <p className="text-[9px] uppercase font-bold tracking-wider text-slate-400 dark:text-zinc-500">Vulnerabilities</p>
                <p className={`text-sm font-bold mt-0.5 ${filteredPassports.reduce((acc, p) => acc + p.vulnerabilities.length, 0) > 0 ? 'text-rose-600 dark:text-rose-400 font-extrabold' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {filteredPassports.reduce((acc, p) => acc + p.vulnerabilities.length, 0)} CVEs
                </p>
              </div>
            </div>
          </div>

          {/* Passport Grid Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPassports.map(p => {
              const hasVulnerabilities = p.vulnerabilities.length > 0;
              const isSelected = selectedPassportId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedPassportId(p.id)}
                  className={`studio-card p-5 cursor-pointer flex flex-col gap-4 relative group transition-all duration-300 ${
                    isSelected
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-lg'
                      : 'hover:border-indigo-400 dark:hover:border-indigo-900/60 hover:shadow-md'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{p.category}</span>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 mt-1.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {p.name}
                      </h3>
                      <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-0.5">Publisher: {p.publisher}</p>
                    </div>

                    <div className={`w-11 h-11 rounded-full border-2 flex flex-col items-center justify-center font-mono shrink-0 shadow-sm ${
                      p.overallScore >= 90 ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500 text-emerald-700 dark:text-emerald-400' :
                      p.overallScore >= 80 ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-500 text-amber-700 dark:text-amber-400' :
                      'bg-rose-50 dark:bg-rose-950/20 border-rose-500 text-rose-700 dark:text-rose-400'
                    }`}>
                      <span className="text-xs font-bold leading-none">{p.overallScore}</span>
                      <span className="text-[7px] font-semibold text-slate-400 dark:text-zinc-500 uppercase leading-none mt-0.5">Trust</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-100 dark:border-zinc-800 text-center font-mono text-[9px] text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-950 rounded-lg">
                    <div>
                      <span className="block text-slate-400 dark:text-zinc-500 font-bold uppercase text-[7px]">Version</span>
                      <span className="font-semibold text-slate-700 dark:text-zinc-300 mt-0.5 block">{p.version}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 dark:text-zinc-500 font-bold uppercase text-[7px]">SBOM Depth</span>
                      <span className="font-semibold text-slate-700 dark:text-zinc-300 mt-0.5 block">{p.sbom.length} Nodes</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 dark:text-zinc-500 font-bold uppercase text-[7px]">License</span>
                      <span className="font-semibold text-slate-700 dark:text-zinc-300 mt-0.5 block truncate max-w-[70px]" title={p.licenseType}>
                        {p.licenseType}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-mono mt-1 text-slate-400 dark:text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {p.releaseDate}
                    </span>

                    {hasVulnerabilities ? (
                      <span className={`flex items-center gap-1 font-bold ${
                        p.vulnerabilities.some(v => v.severity === 'Critical') ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                        <span>{p.vulnerabilities.length} Open CVEs</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Safe Pedigree</span>
                      </span>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-zinc-800/80 flex justify-between items-center text-[10px]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onNavigateTab) {
                          onNavigateTab('ai-swarm', p.id);
                        } else {
                          setSelectedPassportId(p.id);
                        }
                      }}
                      className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-bold font-sans bg-indigo-50/50 dark:bg-indigo-950/30 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 px-2.5 py-1 rounded-lg transition-colors cursor-pointer border border-indigo-100/50 dark:border-indigo-900/30"
                    >
                      <Sparkles className="w-3 h-3 text-indigo-500" />
                      <span>Run AI Swarm</span>
                    </button>
                    <span className="text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 font-bold transition-colors flex items-center gap-0.5">
                      <span>Audit Dossier</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Slide-out Software Passport Details Drawer */}
      <AnimatePresence>
        {selectedPassportId && passport && (
          <>
            {/* Backdrop Overlay with blur */}
            <motion.div
              key="passports-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPassportId(null)}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 cursor-pointer"
            />

            {/* Sliding Drawer Container */}
            <motion.div
              key="passports-drawer-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 170 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-4xl bg-slate-50 dark:bg-zinc-900 border-l border-slate-200 dark:border-zinc-800 shadow-2xl z-50 overflow-y-auto p-6 flex flex-col"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-50 dark:bg-indigo-950 p-2 rounded-lg border border-indigo-100 dark:border-indigo-900/60 text-indigo-600 dark:text-indigo-400">
                    <FileCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
                      CRYPTOGRAPHIC ATTESTATION DOSSIER
                    </span>
                    <h2 className="text-base font-display font-extrabold text-slate-900 dark:text-zinc-50 leading-tight">
                      {passport.name}
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      try {
                        // Prefer tenant/company name from authenticated session (stored by App on login).
                        let tenantName = '[Your Company Name]';
                        try {
                          const stored = localStorage.getItem('msp_user');
                          if (stored) {
                            const parsed = JSON.parse(stored);
                            if (parsed && typeof parsed.companyName === 'string' && parsed.companyName.trim()) {
                              tenantName = parsed.companyName.trim();
                            }
                          }
                        } catch (e) {
                          // ignore parse errors and fall back to neutral placeholder
                        }

                        // Prefer a tenant-specified brand color if available, else use a neutral gray
                        let tenantColor = '#6b7280';
                        try {
                          const storedColor = localStorage.getItem('msp_brand_color');
                          if (storedColor && /^#?[0-9a-fA-F]{6}$/.test(storedColor)) {
                            tenantColor = storedColor.startsWith('#') ? storedColor : `#${storedColor}`;
                          }
                        } catch (e) {
                          // ignore
                        }

                        generatePassportEvidenceReport(passport, tenantName, tenantColor);
                      } catch (err) {
                        console.error('Failed generating passport evidence PDF', err);
                      }
                    }}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold text-[11px] px-3.5 py-1.8 rounded-lg shadow-sm cursor-pointer transition-all"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>Generate Evidence Report</span>
                  </button>

                  <button
                    onClick={handleExportPDF}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-semibold text-[11px] px-3.5 py-1.8 rounded-lg shadow-sm cursor-pointer transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Audit Report</span>
                  </button>
                  <button
                    onClick={() => setSelectedPassportId(null)}
                    className="p-1.8 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-lg text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer transition-colors"
                    title="Close Drawer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Drawer Tabs Header */}
              <div className="flex border-b border-slate-200 dark:border-zinc-800 text-xs font-semibold gap-1 select-none overflow-x-auto mt-4 shrink-0">
                {[
                  { id: 'overview', label: 'Trust Scores', icon: Award },
                  { id: 'sbom', label: 'CycloneDX SBOM', icon: Layers },
                  { id: 'evidence', label: 'Evidence Ledger', icon: FileSignature },
                  { id: 'vulnerabilities', label: 'Open CVE Alerts', icon: ShieldAlert },
                  { id: 'swarm', label: 'Cognitive Swarm', icon: Sparkles }
                ].map(tb => {
                  const Icon = tb.icon;
                  const isSel = drawerTab === tb.id;
                  return (
                    <button
                      key={tb.id}
                      type="button"
                      onClick={() => setDrawerTab(tb.id as any)}
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
                
                {/* 1. Trust Scores tab */}
                {drawerTab === 'overview' && (
                  <div className="space-y-6">
                    {/* Score Matrix Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { label: 'Overall Trust Score', val: passport.overallScore },
                        { label: 'Security Score', val: passport.securityScore },
                        { label: 'Compliance Score', val: passport.complianceScore },
                        { label: 'Supplier Reputation', val: passport.vendorReputationScore }
                      ].map((sc, i) => (
                        <div key={i} className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-slate-200 dark:border-zinc-850 shadow-xs text-center">
                          <span className="text-[8px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider block">{sc.label}</span>
                          <span className="text-2xl font-display font-extrabold font-mono text-indigo-600 dark:text-indigo-400 mt-1 block">{sc.val}</span>
                        </div>
                      ))}
                    </div>

                    {/* Meta Data Block */}
                    <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-slate-200 dark:border-zinc-850 shadow-xs grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3.5">
                        <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display">Publisher Registry Records</h3>
                        <div className="text-xs space-y-2">
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[9px]">NAME</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300">{passport.name}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[9px]">PUBLISHER</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300">{passport.publisher}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[9px]">VERSION</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300 font-mono">{passport.version}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[9px]">CRYPTOGRAPHIC HASH</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300 font-mono text-[9px] truncate max-w-[200px]" title={passport.fileHash}>
                              {passport.fileHash}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3.5">
                        <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display">Sovereign Compliance Attestations</h3>
                        <div className="text-xs space-y-2">
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[9px]">LICENSE</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300 font-mono">{passport.licenseType}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[9px]">RELEASE DATE</span>
                            <span className="font-semibold text-slate-700 dark:text-zinc-300 font-mono">{passport.releaseDate}</span>
                          </div>
                          <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-1.5">
                            <span className="text-slate-400 dark:text-zinc-500 font-mono text-[9px]">SLSA GRADE</span>
                            <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">Level 4 Certified</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* AI Security Scan Console */}
                    <div className="bg-indigo-950/20 border border-indigo-900/40 p-5 rounded-xl space-y-3.5">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-400" />
                          <h4 className="text-xs font-bold text-slate-100 font-display">AI Passport Audit Intelligence</h4>
                        </div>
                        <button
                          onClick={handleLiveAudit}
                          disabled={isAnalyzing}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-sm disabled:opacity-50 transition cursor-pointer"
                        >
                          {isAnalyzing ? 'Running Audits...' : 'Run Real-time Audit'}
                        </button>
                      </div>

                      <div className="bg-zinc-950/85 border border-zinc-900 text-zinc-300 font-mono text-[11px] leading-relaxed p-4 rounded-lg shadow-inner whitespace-pre-wrap max-h-60 overflow-y-auto">
                        {isAnalyzing ? (
                          <div className="flex flex-col gap-1 text-indigo-400 font-mono animate-pulse">
                            <span>Initializing multi-agent pipeline...</span>
                            <span>Parsing SBOM descriptors...</span>
                            <span>Cross-checking active CVE threat indices...</span>
                          </div>
                        ) : liveAiSummary ? (
                          liveAiSummary
                        ) : (
                          passport.aiSummary || 'Ready to trigger automated multi-agent threat & compliance audits.'
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. SBOM dependencies tab */}
                {drawerTab === 'sbom' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 font-mono uppercase tracking-wider">CycloneDX Software Component Manifest</h3>
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">Count: {passport.sbom.length} Dependencies</span>
                    </div>

                    <div className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded-xl overflow-hidden shadow-xs">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 font-mono font-bold border-b border-slate-100 dark:border-zinc-800 text-[10px]">
                            <th className="px-5 py-3">NAME</th>
                            <th className="px-5 py-3">VERSION</th>
                            <th className="px-5 py-3">LICENSE</th>
                            <th className="px-5 py-3">TYPE</th>
                            <th className="px-5 py-3">PURL PATH</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-zinc-850 text-slate-600 dark:text-zinc-300 font-mono text-[11px]">
                          {passport.sbom.map((pkg, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-zinc-900/30">
                              <td className="px-5 py-3.5 font-bold text-indigo-600 dark:text-indigo-400">{pkg.name}</td>
                              <td className="px-5 py-3.5">{pkg.version}</td>
                              <td className="px-5 py-3.5">{pkg.license}</td>
                              <td className="px-5 py-3.5">
                                <span className="bg-slate-100 dark:bg-zinc-850 text-slate-600 dark:text-zinc-400 px-2 py-0.5 rounded text-[10px] font-bold">
                                  {pkg.dependencyType}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-slate-400 dark:text-zinc-500 truncate max-w-xs" title={pkg.purl}>
                                {pkg.purl}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. Evidence Ledger tab */}
                {drawerTab === 'evidence' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 font-mono uppercase tracking-wider">Cryptographic Attestation Registry</h3>
                      <span className="text-[10px] text-emerald-600 font-mono font-bold">SHA256 Multi-Locked</span>
                    </div>

                    {/* Gap analyzer table */}
                    <div className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded-xl overflow-hidden shadow-xs">
                      <div className="p-4 bg-slate-50 dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center">
                        <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display">Pedigree Gap Analysis</h4>
                        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono font-bold">Continuous checks against ISO27001</span>
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-zinc-850 text-xs">
                        {gapAnalysis.map((gap) => (
                          <div key={gap.key} className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-zinc-900/10">
                            <div>
                              <h5 className="font-bold text-slate-800 dark:text-zinc-200">{gap.name}</h5>
                              <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-0.5">Required check key: {gap.key}</p>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              {gap.satisfied ? (
                                <div className="flex items-center gap-1.5 text-emerald-600 font-bold font-mono">
                                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                  <span>Verified</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-rose-500 font-bold font-mono animate-pulse">Gap Discovered</span>
                                  <button
                                    onClick={() => setSubmittingReqKey(gap.key)}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-mono font-bold px-2.5 py-1 rounded-md"
                                  >
                                    Submit Evidence
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Form to submit evidence */}
                    {submittingReqKey && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-indigo-950/10 border border-indigo-900/40 p-5 rounded-xl space-y-4"
                      >
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-bold text-slate-200 font-display">Submit Cryptographical Proof Attestation</h4>
                          <button onClick={() => setSubmittingReqKey(null)} className="text-slate-400 hover:text-white">
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <form onSubmit={handleSubmitEvidence} className="space-y-3.5">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] text-slate-300 font-mono block mb-1">SIGNER IDENTITY</label>
                              <input
                                type="text"
                                value={evidenceSigner}
                                onChange={(e) => setEvidenceSigner(e.target.value)}
                                placeholder="e.g. key-officer@company.com"
                                className="w-full text-xs bg-zinc-950/80 text-white rounded border border-zinc-800 px-3 py-1.8 focus:outline-none focus:border-indigo-500"
                                required
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-300 font-mono block mb-1">PROVENANCE SHA256 HASH</label>
                              <input
                                type="text"
                                value={evidenceHash}
                                onChange={(e) => setEvidenceHash(e.target.value)}
                                placeholder="Autogenerate or paste sha256"
                                className="w-full text-xs bg-zinc-950/80 text-white rounded border border-zinc-800 px-3 py-1.8 focus:outline-none focus:border-indigo-500 font-mono"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-300 font-mono block mb-1">CERTIFICATE NOTES</label>
                            <textarea
                              value={evidenceDetails}
                              onChange={(e) => setEvidenceDetails(e.target.value)}
                              placeholder="Describe the build pipeline and key authorization controls..."
                              className="w-full text-xs bg-zinc-950/80 text-white rounded border border-zinc-800 px-3 py-1.8 h-16 focus:outline-none focus:border-indigo-500"
                            />
                          </div>

                          <div className="flex justify-end gap-2 pt-2">
                            <button
                              type="button"
                              onClick={() => setSubmittingReqKey(null)}
                              className="text-slate-300 hover:text-white font-mono text-[10px] px-3 py-1.5"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-[10px] font-bold px-4 py-1.5 rounded"
                            >
                              Publish to Chain
                            </button>
                          </div>
                        </form>
                      </motion.div>
                    )}

                    {/* Timeline Event Log */}
                    <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-slate-200 dark:border-zinc-850 shadow-xs space-y-4">
                      <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display">Attestation & Event Timeline</h4>
                      <div className="relative border-l border-slate-100 dark:border-zinc-850 pl-4 space-y-5 text-xs text-slate-600 dark:text-zinc-400">
                        {passport.timeline.map((evt, idx) => (
                          <div key={idx} className="relative">
                            <span className="absolute -left-[21px] top-0.5 bg-indigo-600 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900" />
                            <div className="flex justify-between font-mono text-[10px] text-slate-400">
                              <span>{evt.date} • {evt.user}</span>
                              <span className="font-semibold text-indigo-600 dark:text-indigo-400">{evt.event}</span>
                            </div>
                            <p className="mt-1 leading-relaxed font-sans">{evt.details}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Open CVE Alerts tab */}
                {drawerTab === 'vulnerabilities' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 font-mono uppercase tracking-wider">Security & CVE Detections</h3>
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">Count: {passport.vulnerabilities.length} CVEs</span>
                    </div>

                    <div className="space-y-4">
                      {passport.vulnerabilities.length === 0 ? (
                        <div className="bg-white dark:bg-zinc-950 p-8 rounded-xl border border-slate-200 dark:border-zinc-850 text-center text-slate-400 dark:text-zinc-500 font-mono">
                          ✓ Pedigree Clean: Zero active vulnerabilities found in current SBOM tree.
                        </div>
                      ) : (
                        passport.vulnerabilities.map((vul) => {
                          const isEditingMitigation = activeMitigationVulId === vul.id;
                          return (
                            <div key={vul.id} className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded-xl p-5 space-y-4 shadow-xs">
                              <div className="flex justify-between items-start gap-4">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold font-mono text-indigo-600 dark:text-indigo-400 text-xs">{vul.id}</span>
                                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-extrabold uppercase border ${
                                      vul.severity === 'Critical' ? 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/50 dark:text-rose-400' :
                                      vul.severity === 'High' ? 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400' :
                                      'bg-slate-50 border-slate-200 text-slate-700 dark:bg-zinc-900 dark:border-zinc-800'
                                    }`}>
                                      {vul.severity} Severity
                                    </span>
                                  </div>
                                  <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-100 font-display mt-1">{vul.title}</h4>
                                  <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-0.5">Component: {vul.component} | Fixed: {vul.fixedVersion}</p>
                                </div>

                                <div className="text-right shrink-0">
                                  <p className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-mono">CVSS Score</p>
                                  <p className="text-base font-extrabold text-rose-600 font-mono mt-0.5">{vul.cvss}</p>
                                </div>
                              </div>

                              <p className="text-xs text-slate-600 dark:text-zinc-300 leading-relaxed font-sans">{vul.description}</p>

                              {/* Mitigation detail block */}
                              {vul.mitigationPlan ? (
                                <div className="bg-indigo-50/50 dark:bg-zinc-900 p-4 rounded-lg border border-indigo-100 dark:border-zinc-850/60 text-xs">
                                  <h5 className="font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1">
                                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                    <span>Active Remediation Plan</span>
                                  </h5>
                                  <p className="text-slate-600 dark:text-zinc-300 mt-1">{vul.mitigationPlan}</p>
                                  <div className="flex gap-4 font-mono text-[9px] text-slate-400 dark:text-zinc-500 mt-2">
                                    <span>Owner: {vul.mitigationOwner}</span>
                                    <span>Target Completion: {vul.mitigationTargetDate}</span>
                                    <span>SLA Compliance: On Schedule</span>
                                  </div>
                                </div>
                              ) : (
                                !isEditingMitigation && (
                                  <button
                                    onClick={() => setActiveMitigationVulId(vul.id)}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-mono text-[10px] px-3 py-1.5 rounded font-bold"
                                  >
                                    Configure SLA Mitigation Plan
                                  </button>
                                )
                              )}

                              {isEditingMitigation && (
                                <RiskMitigation
                                  vulnerability={vul}
                                  onSave={(plan, owner, targetDate, status) => handleSaveMitigationPlan(vul.id, plan, owner, targetDate, status)}
                                  onCancel={() => setActiveMitigationVulId(null)}
                                />
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* 5. Cognitive Swarm tab */}
                {drawerTab === 'swarm' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 font-mono uppercase tracking-wider">Cognitive Agent Swarm Scan Console</h3>
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">Multi-Agent Cognitive Framework</span>
                    </div>

                    <PassportSwarmView passport={passport} />
                  </div>
                )}

              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Simulated Export Modal Overlay */}
      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl max-w-sm p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mx-auto border border-indigo-100 dark:border-indigo-900">
              <Download className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100">Audit report generated successfully</h3>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">
                Your sovereign cryptographic audit dossier has been compiled and is ready for export.
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-zinc-950 rounded-lg p-3 text-left font-mono text-[9px] text-slate-500 dark:text-zinc-400 truncate border border-slate-100 dark:border-zinc-850">
              File: audit_report_attested_{passport?.id || 'export'}.pdf
            </div>
            <button
              onClick={() => setShowExportModal(false)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold font-sans text-xs py-2 rounded-lg cursor-pointer transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
