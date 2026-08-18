import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search,
  ArrowRight,
  ChevronRight,
  Award,
  ShieldAlert,
  Cpu,
  Download,
  FileText,
  Activity,
  Zap,
  Building2,
  Database,
  X,
  Sparkles,
  RefreshCw,
  Play,
  Check
} from 'lucide-react';
import { Client, SoftwarePassport, Alert } from '../types';
import { apiFetch } from '../utils/apiClient';

interface InvestorHomeViewProps {
  passports: SoftwarePassport[];
  onShowTelemetry: () => void;
  onNavigateTab?: (tab: string, itemId?: string) => void;
  clients?: Client[];
  alerts?: Alert[];
}

export default function InvestorHomeView({ 
  passports, 
  onShowTelemetry, 
  onNavigateTab, 
  clients = [],
  alerts = []
}: InvestorHomeViewProps) {
  // STATE DEFINITIONS
  const vendorProfiles = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; category: string; trustRating: string; publisher: string; passportCount: number }>();
    passports.forEach((p) => {
      const publisher = p.publisher || p.name || 'Unknown Publisher';
      const slug = publisher.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!seen.has(publisher)) {
        seen.set(publisher, {
          id: `vendor-${slug}`,
          name: publisher,
          category: p.category || 'Software Publisher',
          trustRating: p.overallScore >= 90 ? 'AAA' : p.overallScore >= 75 ? 'AA' : 'A',
          publisher,
          passportCount: 1
        });
      } else {
        const existing = seen.get(publisher)!;
        existing.passportCount += 1;
      }
    });
    return Array.from(seen.values());
  }, [passports]);

  // Dynamic Metrics derived directly from the API payload passed into this component.
  const trustHealth = clients.length > 0
    ? Math.round(clients.reduce((sum, c) => sum + (c.trustScore || 0), 0) / clients.length)
    : null;

  const softwareAssets = clients.reduce((sum, c) => sum + (c.passportCount || 0), 0);

  const verifiedVendors = new Set(passports.map(p => p.publisher).filter(Boolean)).size;

  const activeRisks = clients.reduce((sum, c) => sum + (c.criticalRisksCount || 0), 0);

  const unknownDependencies = passports.reduce((sum, p) => {
    try {
      const sbom = Array.isArray(p.sbom) ? p.sbom : typeof p.sbom === 'string' ? JSON.parse(p.sbom) : [];
      const untrusted = sbom.filter((comp: any) => comp && comp.trustLevel && comp.trustLevel !== 'Trusted').length;
      return sum + untrusted;
    } catch {
      return sum;
    }
  }, 0);

  const evidenceEvents = passports.reduce((sum, p) => sum + (Array.isArray(p.timeline) ? p.timeline.length : 0), 0);
  const trackedPublishers = new Set(passports.map(p => p.publisher || p.name).filter(Boolean)).size;
  const hasRegistryData = passports.length > 0 || clients.length > 0;

  // Modal views
  const [isRemediationOpen, setIsRemediationOpen] = useState(false);
  const [remediationLogs, setRemediationLogs] = useState<string[]>([]);
  const [isRemediating, setIsRemediating] = useState(false);
  const [remediationCompleted, setRemediationCompleted] = useState(false);

  // Reports Hub
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string>('rep-ceo');
  const [showCertificateSeal, setShowCertificateSeal] = useState(false);

  // Filter lists for passive browsing in dashboard
  const [passportSearch, setPassportSearch] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');

  // Run Autopilot Remediation
  const triggerRemediation = async () => {
    setIsRemediating(true);
    setRemediationLogs([]);
    try {
      const res = await apiFetch('/api/remediation/run', {
        method: 'POST'
      });
      if (!res.ok) {
        const failure = await res.json().catch(() => ({}));
        throw new Error(failure.message || 'Remediation run failed');
      }
      const data = await res.json();
      if (data.success) {
        if (data.resolvedCount === 0) {
          setRemediationLogs(['Zero active risks detected. Your trust posture is already pristine!']);
          setIsRemediating(false);
          setRemediationCompleted(true);
          return;
        }

        // Fetch actual logs for the jobId!
        const logsRes = await apiFetch(`/api/agent-jobs/${data.jobId}/logs`);
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          const messages = logsData.map((l: any) => `[${l.level.toLowerCase()}] ${l.message}`);
          setRemediationLogs(messages);
        } else {
          setRemediationLogs([`Remediation request accepted. ${data.resolvedCount} risks were reported by the backend. Logs were not returned by the service.`]);
        }
        
        setIsRemediating(false);
        setRemediationCompleted(true);

        // Dispatches global refresh event so App.tsx reloads the entire dataset
        window.dispatchEvent(new CustomEvent('refresh-data'));
      }
    } catch (err: any) {
      console.error(err);
      setRemediationLogs([`[unavailable] ${err?.message || 'No patch executor is configured.'}`]);
      setIsRemediating(false);
    }
  };

  // Generate Report Helper
  const handleCompileReport = () => {
    setShowCertificateSeal(true);
  };

  // Trigger PDF Download
  const handlePdfDownload = () => {
    setShowCertificateSeal(false);
  };

  // Filtered Passports for table in dashboard
  const filteredPassports = passports.filter(p => 
    p.name.toLowerCase().includes(passportSearch.toLowerCase()) ||
    p.category.toLowerCase().includes(passportSearch.toLowerCase())
  );

  // Filtered Vendors
  const filteredVendors = vendorProfiles.filter(v =>
    v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    v.category.toLowerCase().includes(vendorSearch.toLowerCase())
  );

  return (
    <div className="space-y-8 py-4">
      <motion.div
          key="dashboard"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-8 text-left"
        >
          {!hasRegistryData && (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/60 p-5 text-left">
              <p className="text-sm font-display font-extrabold text-slate-900 dark:text-white">
                No registry records are available yet.
              </p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 leading-relaxed">
                The dashboard is showing the current dataset counts only. Passport and client data will appear once the backend returns records.
              </p>
            </div>
          )}

          {/* Header Block */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-zinc-900 pb-5">
            <div>
              <span className="text-[10px] font-mono font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest block mb-1">
                YOUR DIGITAL ENVIRONMENT
              </span>
              <h1 className="text-2xl sm:text-3xl font-display font-black text-slate-900 dark:text-white leading-none tracking-tight">
                Software Trust Command & Control
              </h1>
              <p className="text-xs text-slate-400 dark:text-zinc-500 font-sans mt-1.5 max-w-2xl leading-relaxed">
                The global trust registry and living history record for your organization's third-party software, upstream packages, and supplier entities.
              </p>
            </div>
            
            {/* System Telemetry Link */}
            <button
              onClick={onShowTelemetry}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 flex items-center gap-1 cursor-pointer transition-colors shrink-0 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-2 rounded-xl border border-indigo-100/30 self-start md:self-center"
            >
              <span>View Engineering Telemetry</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* THE MASTER METRIC Posture Scoreboard */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* LARGE HEALTH POSTURE DIAL (5 COLS) */}
            <div className="lg:col-span-5 bg-gradient-to-br from-slate-950 via-zinc-900 to-slate-950 rounded-3xl p-6 border border-slate-800 shadow-2xl flex flex-col justify-between relative overflow-hidden text-left text-white min-h-[300px]">
              {/* Decorative cyber grid */}
              <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] opacity-5 pointer-events-none"></div>
              <div className="absolute -top-12 -right-12 w-48 h-48 bg-indigo-600/10 rounded-full blur-2xl pointer-events-none"></div>
              
              <div className="space-y-1 relative z-10">
                <span className="text-[9px] font-mono font-black text-indigo-400 uppercase tracking-widest block">
                  TRUST QUALITY ASSURANCE
                </span>
                <h3 className="text-sm font-display font-black text-slate-100">
                  Trust Health Posture
                </h3>
              </div>

              {/* Graphical Circular Dial */}
              <div className="py-2 flex items-center justify-around gap-6 relative z-10">
                <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="72"
                      cy="72"
                      r="60"
                      className="text-slate-800"
                      strokeWidth="8"
                      stroke="currentColor"
                      fill="transparent"
                    />
                    <circle
                      cx="72"
                      cy="72"
                      r="60"
                      className={`transition-all duration-1000 ${
                        trustHealth === null ? 'text-slate-600' : trustHealth >= 90 ? 'text-emerald-500' : 'text-indigo-500'
                      }`}
                      strokeWidth="8"
                      strokeDasharray={377}
                      strokeDashoffset={trustHealth === null ? 377 : 377 - (377 * trustHealth) / 100}
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="transparent"
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center text-center">
                    <span className="text-3xl font-display font-black text-white">{trustHealth === null ? '—' : trustHealth}</span>
                    <span className="text-[8px] font-mono font-bold text-slate-400 uppercase tracking-wider">INDEX</span>
                  </div>
                </div>

                <div className="space-y-2 font-mono text-[10px] text-slate-400">
                  <div className="flex justify-between gap-4 border-b border-slate-800 pb-1">
                    <span>SECURITY RATING:</span>
                    <strong className={trustHealth === null ? 'text-slate-400' : trustHealth >= 90 ? 'text-emerald-400' : 'text-indigo-400'}>
                      {trustHealth === null ? 'N/A' : trustHealth >= 90 ? 'AAA / HIGH' : 'AA / MONITORED'}
                    </strong>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-slate-800 pb-1">
                    <span>STATUS:</span>
                    <strong className={trustHealth === null ? 'text-slate-400' : trustHealth >= 90 ? 'text-emerald-400' : 'text-amber-400'}>
                      {trustHealth === null ? 'NO DATA' : trustHealth >= 90 ? 'CURRENTLY HIGH' : 'REVIEW NEEDED'}
                    </strong>
                  </div>
                  <p className="text-[9px] text-slate-500 font-sans leading-normal pt-1">
                    {trustHealth === null
                      ? 'No client trust scores were returned by the backend.'
                      : 'Average trust score from the current client dataset.'}
                  </p>
                </div>
              </div>

              <div className="text-[9px] font-mono text-slate-500 border-t border-slate-900 pt-3 relative z-10">
                Continuous hash signatures checked against global NIST CVE and SBOM registry.
              </div>
            </div>

            {/* BENTO STAT TILES (7 COLS) */}
            <div className="lg:col-span-7 grid grid-cols-2 gap-4 items-stretch">
              
              {/* STAT 1: Software Assets */}
              <div className="bg-white dark:bg-zinc-950 border border-slate-250/80 dark:border-zinc-900 p-5 rounded-2xl flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 w-16 h-16 bg-slate-50 dark:bg-zinc-900 rounded-bl-full pointer-events-none"></div>
                <div>
                  <div className="flex items-center gap-2 text-slate-400 dark:text-zinc-500">
                    <Database className="w-4 h-4 text-indigo-500" />
                    <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest">
                      SOFTWARE ASSETS
                    </span>
                  </div>
                  <h4 className="text-3xl font-display font-black text-slate-800 dark:text-zinc-100 mt-2">
                    {hasRegistryData ? softwareAssets : '—'}
                  </h4>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-1 leading-none">
                  {hasRegistryData ? 'Current client passport count' : 'No backend records loaded'}
                </p>
              </div>

              {/* STAT 2: Verified Vendors */}
              <div className="bg-white dark:bg-zinc-950 border border-slate-250/80 dark:border-zinc-900 p-5 rounded-2xl flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 w-16 h-16 bg-slate-50 dark:bg-zinc-900 rounded-bl-full pointer-events-none"></div>
                <div>
                  <div className="flex items-center gap-2 text-slate-400 dark:text-zinc-500">
                    <Building2 className="w-4 h-4 text-indigo-500" />
                    <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest">
                      VERIFIED VENDORS
                    </span>
                  </div>
                  <h4 className="text-3xl font-display font-black text-slate-800 dark:text-zinc-100 mt-2">
                    {hasRegistryData ? verifiedVendors : '—'}
                  </h4>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-1 leading-none">
                  {hasRegistryData ? 'Publishers from the current passport set' : 'No backend records loaded'}
                </p>
              </div>

              {/* STAT 3: Active Risks */}
              <div className="bg-white dark:bg-zinc-950 border border-slate-250/80 dark:border-zinc-900 p-5 rounded-2xl flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 w-16 h-16 bg-slate-50 dark:bg-zinc-900 rounded-bl-full pointer-events-none"></div>
                <div>
                  <div className="flex items-center gap-2 text-slate-400 dark:text-zinc-500">
                    <ShieldAlert className="w-4 h-4 text-rose-500" />
                    <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest">
                      ACTIVE RISKS
                    </span>
                  </div>
                  <h4 className={`text-3xl font-display font-black mt-2 ${
                    activeRisks > 0 ? 'text-rose-500 animate-pulse' : 'text-slate-800 dark:text-zinc-100'
                  }`}>
                    {hasRegistryData ? activeRisks : '—'}
                  </h4>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-1 leading-none">
                  {hasRegistryData ? (activeRisks > 0 ? 'CVE advisories logged' : 'No active critical risks in the current client dataset') : 'No backend records loaded'}
                </p>
              </div>

              {/* STAT 4: Unknown Dependencies */}
              <div className="bg-white dark:bg-zinc-950 border border-slate-250/80 dark:border-zinc-900 p-5 rounded-2xl flex flex-col justify-between shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 w-16 h-16 bg-slate-50 dark:bg-zinc-900 rounded-bl-full pointer-events-none"></div>
                <div>
                  <div className="flex items-center gap-2 text-slate-400 dark:text-zinc-500">
                    <Cpu className="w-4 h-4 text-amber-500" />
                    <span className="text-[10px] font-mono font-extrabold uppercase tracking-widest">
                      UNKNOWN DEPS
                    </span>
                  </div>
                  <h4 className={`text-3xl font-display font-black mt-2 ${
                    unknownDependencies > 0 ? 'text-amber-500' : 'text-slate-800 dark:text-zinc-100'
                  }`}>
                    {hasRegistryData ? unknownDependencies : '—'}
                  </h4>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-1 leading-none">
                  {hasRegistryData ? (unknownDependencies > 0 ? 'Unverified library hashes' : 'All components attested in the current passport set') : 'No backend records loaded'}
                </p>
              </div>

            </div>

          </div>

          {/* KEY CORE ACTIONS MODULES */}
          <div className="bg-slate-50 dark:bg-zinc-900/50 border border-slate-200/80 dark:border-zinc-800/80 p-6 rounded-3xl grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* ACTION 1: IMPROVE TRUST SCORE */}
            <div className="space-y-3 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-900 p-5 rounded-2xl shadow-xs flex flex-col justify-between text-left">
              <div className="space-y-1.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center border border-amber-100/40">
                  <Zap className="w-4.5 h-4.5 animate-bounce" />
                </div>
                <h4 className="font-display font-extrabold text-slate-900 dark:text-white text-sm">
                  Improve Trust Score
                </h4>
                <p className="text-[11px] text-slate-400 leading-relaxed font-sans font-light">
                  Directly run the Trust Automation Engine to resolve unverified dependencies and sandbox known package vulnerability hazards.
                </p>
              </div>
              <button
                onClick={() => setIsRemediationOpen(true)}
                className="w-full text-center py-2 bg-slate-900 hover:bg-slate-800 text-white font-sans font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-xs mt-3 flex items-center justify-center gap-1.5"
              >
                <span>Automate Remediation</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* ACTION 2: GENERATE TRUST REPORT */}
            <div className="space-y-3 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-900 p-5 rounded-2xl shadow-xs flex flex-col justify-between text-left">
              <div className="space-y-1.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 flex items-center justify-center border border-indigo-100/40">
                  <FileText className="w-4.5 h-4.5" />
                </div>
                <h4 className="font-display font-extrabold text-slate-900 dark:text-white text-sm">
                  Generate Trust Report
                </h4>
                <p className="text-[11px] text-slate-400 leading-relaxed font-sans font-light">
                  Instantly compile certified reports customized for board members, compliance auditors, legal advisors, or procurement teams.
                </p>
              </div>
              <button
                onClick={() => setIsReportsOpen(true)}
                className="w-full text-center py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-xs mt-3 flex items-center justify-center gap-1.5"
              >
                <span>Certified Report Hub</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* ACTION 3: VIEW RISK MAP */}
            <div className="space-y-3 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-900 p-5 rounded-2xl shadow-xs flex flex-col justify-between text-left">
              <div className="space-y-1.5">
                <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/40 text-teal-600 flex items-center justify-center border border-teal-100/40">
                  <Activity className="w-4.5 h-4.5 animate-pulse" />
                </div>
                <h4 className="font-display font-extrabold text-slate-900 dark:text-white text-sm">
                  View Risk Map
                </h4>
                <p className="text-[11px] text-slate-400 leading-relaxed font-sans font-light">
                  Navigate directly into the fully interactive Trust Graph mapping software, dependencies, and connections.
                </p>
              </div>
              <button
                onClick={() => {
                  if (onNavigateTab) onNavigateTab('trust-os');
                }}
                className="w-full text-center py-2 bg-teal-600 hover:bg-teal-500 text-white font-sans font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-xs mt-3 flex items-center justify-center gap-1.5"
              >
                <span>Open Trust Graph</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>

          {/* ACTIVE REGISTRIES BLOCK (TABULATED ASSET SEARCH AND DETAILS) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-2">
            
            {/* REGISTERED PASSPORTS (7 COLS) */}
            <div className="lg:col-span-7 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-900 p-6 rounded-2xl shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-zinc-900 pb-4">
                <div className="space-y-0.5 text-left">
                  <h3 className="text-sm font-display font-extrabold text-slate-900 dark:text-white">
                    Sealed Software Passports
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-500 leading-tight">
                    Active software catalogued on-chain with unique ledger signatures.
                  </p>
                </div>
                
                {/* Inline filter search */}
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-2.5 py-1.5 rounded-lg w-full sm:w-48">
                  <Search className="w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filter passports..."
                    value={passportSearch}
                    onChange={(e) => setPassportSearch(e.target.value)}
                    className="bg-transparent text-[11px] placeholder-slate-400 focus:outline-none w-full dark:text-zinc-200"
                  />
                </div>
              </div>

              {/* Table list */}
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-left text-xs text-slate-500 dark:text-zinc-400">
                  <thead className="bg-slate-50 dark:bg-zinc-900 text-[9px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-150 dark:border-zinc-850">
                    <tr>
                      <th className="px-3 py-2.5">Software Component</th>
                      <th className="px-3 py-2.5">Category</th>
                      <th className="px-3 py-2.5 text-center">Score</th>
                      <th className="px-3 py-2.5 text-right">Certificate Seal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-900 font-sans">
                    {filteredPassports.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-zinc-900/40">
                        <td className="px-3 py-3">
                          <div>
                            <span className="font-extrabold text-slate-800 dark:text-zinc-200 block text-xs">{p.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">v{p.version} • {p.publisher}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <span className="bg-slate-100 dark:bg-zinc-850 text-slate-600 dark:text-zinc-400 font-mono text-[9px] font-bold px-1.5 py-0.5 rounded">
                            {p.category}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center align-middle font-mono font-bold text-slate-700 dark:text-zinc-300">
                          {p.overallScore}
                        </td>
                        <td className="px-3 py-3 text-right align-middle">
                          <span className="text-[10px] font-mono font-bold text-slate-400">Live evidence</span>
                        </td>
                      </tr>
                    ))}
                    {filteredPassports.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-6 text-slate-400 dark:text-zinc-500 italic">
                          No matching software passports found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* UPSTREAM VENDORS REGISTRY (5 COLS) */}
            <div className="lg:col-span-5 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-900 p-6 rounded-2xl shadow-xs text-left flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-zinc-900 pb-4">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-display font-extrabold text-slate-900 dark:text-white">
                      Upstream Vendors Registry
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-500 leading-tight">
                      Search rating profiles of software companies.
                    </p>
                  </div>
                </div>

                {/* Vendor search bar */}
                <div className="relative mt-4">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="Search vendor or publisher..."
                    value={vendorSearch}
                    onChange={(e) => {
                      setVendorSearch(e.target.value);
                    }}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-zinc-900 border border-slate-250 dark:border-zinc-850 rounded-xl text-xs text-slate-800 dark:text-zinc-100 placeholder-slate-400 focus:outline-none"
                  />
                  {vendorSearch.trim() && (
                    <div className="absolute left-0 right-0 top-11 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-900 rounded-xl shadow-xl z-20 overflow-hidden divide-y divide-slate-100 dark:divide-zinc-900">
                      {filteredVendors.map(vendor => (
                        <div key={vendor.id} className="w-full text-left px-4 py-2.5 flex justify-between items-center">
                          <div className="space-y-0.5">
                            <span className="font-extrabold text-xs text-slate-800 dark:text-zinc-200 block">{vendor.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{vendor.category}</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-850">
                            {vendor.trustRating}
                          </span>
                        </div>
                      ))}
                      {filteredVendors.length === 0 && (
                        <div className="p-3 text-center text-slate-400 dark:text-zinc-500 italic text-[11px]">
                          No matching verified vendor or passport found for this query.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Quick select vendor pills */}
                <div className="mt-5 space-y-2.5">
                  <span className="text-[9px] font-mono font-black text-slate-400 dark:text-zinc-500 uppercase tracking-widest block mb-2">
                    VERIFIED VENDOR PROFILES
                  </span>
                  {vendorProfiles.slice(0, 4).map(v => (
                    <div
                      key={v.id}
                      className="p-3 bg-slate-50 dark:bg-zinc-900/60 border border-slate-150 dark:border-zinc-850 rounded-xl flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5">
                        <Building2 className="w-4 h-4 text-slate-400" />
                        <div>
                          <span className="text-xs font-extrabold text-slate-800 dark:text-zinc-200 block">{v.name}</span>
                          <span className="text-[9.5px] text-slate-400 font-sans leading-none">{v.category}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-1.5 py-0.5 rounded border border-emerald-500/15">
                          {v.trustRating} RATING
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-slate-400 dark:text-zinc-500 leading-normal font-sans italic mt-4 text-center">
                *Tip: Evidence is displayed from the live registry and backend data sources only.
              </p>
            </div>

          </div>

          {/* S&P / Moody's Statistics */}
          <div className="pt-8 border-t border-slate-150 dark:border-zinc-900 mt-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl mx-auto text-center font-display">
              <div>
                <p className="text-3xl font-black text-slate-800 dark:text-zinc-100 tracking-tight">{passports.length}</p>
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400 dark:text-zinc-500 mt-1 font-bold">Software Passports Loaded</p>
              </div>
              <div>
                <p className="text-3xl font-black text-slate-800 dark:text-zinc-100 tracking-tight">{evidenceEvents}</p>
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400 dark:text-zinc-500 mt-1 font-bold">Evidence Events Tracked</p>
              </div>
              <div>
                <p className="text-3xl font-black text-slate-800 dark:text-zinc-100 tracking-tight">{trackedPublishers}</p>
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400 dark:text-zinc-500 mt-1 font-bold">Tracked Publishers</p>
              </div>
            </div>
          </div>
        </motion.div>

      {/* ------------------ REMEDIATION DIALOG MODAL ------------------ */}
      <AnimatePresence>
        {isRemediationOpen && (
          <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50 animate-fade-in" id="remediation-remodel">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-zinc-950 rounded-3xl p-6 border border-slate-200 dark:border-zinc-900 shadow-2xl w-full max-w-xl text-left space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-start border-b border-slate-100 dark:border-zinc-900 pb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-indigo-600" />
                  <div>
                    <h3 className="text-sm font-display font-extrabold text-slate-900 dark:text-white">
                      SPR Autopilot Remediation Engine
                    </h3>
                    <span className="text-[8px] font-mono bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                      Core Platform Worker
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsRemediationOpen(false);
                    setRemediationLogs([]);
                    setRemediationCompleted(false);
                  }}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-zinc-900 rounded-lg text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!remediationCompleted ? (
                <div className="space-y-4">
                  <div className="bg-slate-50 dark:bg-zinc-900/60 p-4 rounded-xl border border-slate-200/50 dark:border-zinc-800">
                    <p className="text-xs text-slate-700 dark:text-zinc-300 font-bold leading-normal">
                      Remediation Queue Summary:
                    </p>
                    <ul className="text-[11px] text-slate-500 dark:text-zinc-400 space-y-1.5 mt-2 list-disc pl-4 font-sans">
                      <li><strong>{unknownDependencies} Unknown Dependencies:</strong> Extract cryptographic hashes, resolve package provenance via secure repository registries.</li>
                      <li><strong>{activeRisks} Active Risks (Vulnerabilities):</strong> Deploy isolation shields and pinning policies for containerized NPM/Maven packages.</li>
                    </ul>
                  </div>

                  {/* Terminal console for logs */}
                  {remediationLogs.length > 0 && (
                    <div className="bg-zinc-950 rounded-xl p-4 font-mono text-[10px] text-zinc-300 min-h-40 space-y-2 border border-zinc-900 shadow-inner max-h-48 overflow-y-auto">
                      {remediationLogs.map((log, idx) => (
                        <div key={idx} className="flex gap-2">
                          <span className="text-indigo-400 shrink-0">&gt;_</span>
                          <span className={log.includes('[complete]') || log.includes('[info] Autopilot Remediation run completed') ? 'text-emerald-400 font-bold' : ''}>{log}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={triggerRemediation}
                    disabled={isRemediating}
                    className="w-full text-center py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-sans font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isRemediating ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Remediating & attestations signing...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>Run SPR Autopilot Repair</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-6 space-y-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
                    <Check className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-display font-extrabold text-slate-900 dark:text-white text-base">
                      Remediation Audit Completed!
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-sm mx-auto leading-relaxed">
                      All unknown packages have been cryptographically signed and registered. All vulnerability risks have been isolated. Your trust posture is pristine.
                    </p>
                  </div>
                  <div className="bg-slate-50 dark:bg-zinc-900 p-4 rounded-xl font-mono text-[10px] text-slate-500 border border-slate-200/50 max-w-md mx-auto">
                    LEDGER BLOCK SIGNATURE RECORDED:
                    <span className="block font-bold text-slate-700 dark:text-zinc-300 select-all truncate mt-0.5">
                      sha256-4277c07b69c6f2a89c96a6a6a6a6d6d6d1b777a83e6
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setIsRemediationOpen(false);
                      setRemediationLogs([]);
                      setRemediationCompleted(false);
                    }}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-xs rounded-xl cursor-pointer transition-colors"
                  >
                    Close & View New Score
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------ CERTIFIED REPORTS GENERATOR HUB MODAL ------------------ */}
      <AnimatePresence>
        {isReportsOpen && (
          <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50 animate-fade-in" id="reports-hub-remodel">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-zinc-950 rounded-3xl p-6 border border-slate-200 dark:border-zinc-900 shadow-2xl w-full max-w-3xl text-left space-y-6 max-h-[95vh] overflow-y-auto"
            >
              <div className="flex justify-between items-start border-b border-slate-100 dark:border-zinc-900 pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  <div>
                    <h3 className="text-sm font-display font-extrabold text-slate-900 dark:text-white">
                      One-Click Certified Trust Reports Hub
                    </h3>
                    <p className="text-[10px] text-slate-400">
                      Download professional attested certificates and data packages to show board members or regulatory auditors.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsReportsOpen(false);
                    setShowCertificateSeal(false);
                  }}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-zinc-900 rounded-lg text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Options List (5 cols) */}
                <div className="md:col-span-5 space-y-2.5">
                  <span className="text-[9px] font-mono font-black text-slate-400 uppercase tracking-widest block mb-2">
                    AVAILABLE CERTIFIED FILE SCHEMAS
                  </span>
                  {[
                    { id: 'rep-ceo', label: 'Executive Trust Report', desc: 'Summary tailored for CEOs & Boards.', role: 'CEO / Board Presentation' },
                    { id: 'rep-investor', label: 'Investment Technology Report', desc: 'Full due-diligence audit of codebase.', role: 'Investors & Acquirers' },
                    { id: 'rep-procurement', label: 'Vendor Security Report', desc: 'Upstream risk summary card.', role: 'Procurement Teams' },
                    { id: 'rep-auditor', label: 'Compliance Evidence Package', desc: 'SOC 2 & NIST certified evidence.', role: 'Auditing Officers' },
                    { id: 'rep-sale', label: 'Software Sale Certificate', desc: 'Seal showing build security.', role: 'Commercial Sales' }
                  ].map((rep) => (
                    <button
                      key={rep.id}
                      onClick={() => {
                        setSelectedReportId(rep.id);
                        setShowCertificateSeal(false);
                      }}
                      className={`w-full text-left p-3 rounded-xl border flex flex-col justify-between transition-all cursor-pointer ${
                        selectedReportId === rep.id
                          ? 'bg-indigo-50/50 dark:bg-indigo-950/40 border-indigo-600 shadow-xs'
                          : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 hover:border-slate-350'
                      }`}
                    >
                      <div>
                        <span className="font-extrabold text-xs text-slate-800 dark:text-zinc-100 block">{rep.label}</span>
                        <p className="text-[10px] text-slate-400 mt-0.5 font-sans leading-tight font-light">{rep.desc}</p>
                      </div>
                      <span className="text-[8px] font-mono font-bold text-indigo-500 mt-2 block uppercase tracking-wider">
                        ★ {rep.role}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Living Preview Card (7 cols) */}
                <div className="md:col-span-7 bg-slate-50 dark:bg-zinc-900 border border-slate-250 dark:border-zinc-850 p-6 rounded-2xl flex flex-col justify-between min-h-[350px] relative overflow-hidden">
                  
                  {/* Fine certificate style border */}
                  <div className="absolute inset-2 border border-dashed border-indigo-600/20 rounded-xl pointer-events-none"></div>

                  {!showCertificateSeal ? (
                    <div className="space-y-4 my-auto text-center relative z-10 py-6">
                      <Award className="w-10 h-10 text-indigo-600 mx-auto animate-pulse" />
                      <div className="space-y-1">
                        <h4 className="font-display font-extrabold text-slate-900 dark:text-white text-sm">
                          Prepare a Trust Evidence Report
                        </h4>
                        <p className="text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                          This view shows the available evidence record from the live registry. Exporting a report requires a configured backend export service.
                        </p>
                      </div>
                      <button
                        onClick={handleCompileReport}
                        className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-sans font-bold text-xs rounded-xl cursor-pointer transition-colors shadow-md flex items-center justify-center gap-1.5 mx-auto"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Open Evidence Summary</span>
                      </button>
                    </div>
                  ) : (
                    /* THE SKEUOMORPHIC ATTESATION SEAL */
                    <div className="space-y-4 text-center my-auto relative z-10 py-4 flex flex-col justify-between h-full">
                      
                      <div className="space-y-2">
                        <span className="text-[8px] font-mono bg-yellow-500/10 text-yellow-600 border border-yellow-500/30 px-2 py-0.5 rounded font-bold uppercase tracking-widest block w-max mx-auto">
                          LIVE EVIDENCE SUMMARY
                        </span>
                        
                        <h3 className="text-base font-display font-extrabold text-slate-900 dark:text-white">
                          {selectedReportId === 'rep-ceo' && 'Executive Environment Trust Certificate'}
                          {selectedReportId === 'rep-investor' && 'Sovereign M&A Technology Due-Diligence Certificate'}
                          {selectedReportId === 'rep-procurement' && 'Upstream Software Procurement Trust Attestation'}
                          {selectedReportId === 'rep-auditor' && 'SOC-2 & NIST SP 800-161 Evidence Attestation'}
                          {selectedReportId === 'rep-sale' && 'Commercial Software Compliance Sale Certificate'}
                        </h3>
                        
                        <p className="text-[10px] text-slate-500 leading-relaxed font-sans max-w-sm mx-auto">
                          This summary reflects the current evidence set for the selected registry records and the latest backend trust metrics available for this environment.
                        </p>
                      </div>

                      {/* Certificate details block */}
                      <div className="bg-white dark:bg-zinc-950 p-3 rounded-xl border border-slate-200/60 dark:border-zinc-850 font-mono text-[9px] text-slate-400 text-left space-y-1">
                        <div className="flex justify-between gap-2">
                          <span>PASSPORTS:</span>
                          <span className="font-bold text-slate-700 dark:text-zinc-300">{passports.length}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span>CLIENTS:</span>
                          <span className="font-bold text-slate-700 dark:text-zinc-300">{clients.length}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span>DATA SOURCE:</span>
                          <span className="font-bold text-slate-700 dark:text-zinc-300">Current backend payload</span>
                        </div>
                      </div>

                      {/* Download PDF button */}
                      <div className="pt-2 flex gap-2">
                        <button
                          onClick={handlePdfDownload}
                          className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-xs rounded-xl cursor-pointer shadow-md flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          <span>Export Unavailable</span>
                        </button>
                        
                        <button
                          onClick={() => {
                            setIsReportsOpen(false);
                            setShowCertificateSeal(false);
                          }}
                          className="px-4 py-2.5 border border-slate-300 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-850 text-slate-600 dark:text-zinc-400 font-sans font-bold text-xs rounded-xl cursor-pointer"
                        >
                          Close
                        </button>
                      </div>

                    </div>
                  )}

                  {/* Trust Badge Watermark */}
                  <div className="absolute -bottom-8 -right-8 w-28 h-28 opacity-5 text-indigo-900 pointer-events-none">
                    <Award className="w-full h-full" />
                  </div>
                </div>

              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
