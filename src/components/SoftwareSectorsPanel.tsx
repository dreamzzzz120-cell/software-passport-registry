/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Globe,
  Database,
  Code,
  Layers,
  Cpu,
  GitBranch,
  Lock,
  Activity,
  Server,
  Sparkles,
  Plug,
  ShieldCheck,
  Search,
  Plus,
  ArrowRight,
  ShieldAlert,
  AlertTriangle,
  Award,
  ChevronRight,
  CheckCircle,
  FileText,
  X,
  TrendingUp,
  BarChart2,
  BookOpen,
  Eye,
  Settings
} from 'lucide-react';
import { SoftwarePassport } from '../types';

export interface SectorProfile {
  id: string;
  name: string;
  iconName: string;
  description: string;
  threatProfile: string;
  hardeningBlueprint: string;
  complianceMandate: string;
  vulnerabilityClass: string;
}

const DEFAULT_SECTORS: SectorProfile[] = [
  {
    id: 'networking',
    name: 'Networking & Web Servers',
    iconName: 'Globe',
    description: 'Edge proxies, reverse proxies, web servers, and software-defined load balancers that manage external ingress and TLS termination.',
    threatProfile: 'Denial of Service (DoS/DDoS), TLS renegotiation attacks, request smuggling, and HTTP parsing vulnerabilities.',
    hardeningBlueprint: 'Enable rate-limiting, isolate using unprivileged container users (e.g. alpine non-root), and configure strict TLS 1.3-only cipher suites.',
    complianceMandate: 'NIST SP 800-52 (TLS Guidelines), SOC 2 CC6.1 (Boundary Protections).',
    vulnerabilityClass: 'Infiltration, DDoS, Traffic interception'
  },
  {
    id: 'databases',
    name: 'Databases & Storage',
    iconName: 'Database',
    description: 'Relational databases, key-value stores, document databases, and persistence layers holding critical multi-tenant data logs.',
    threatProfile: 'SQL Injections, unauthorized read replicas, data-at-rest exfiltration, and privilege escalation on system catalogs.',
    hardeningBlueprint: 'Enforce AES-256 transparent data encryption (TDE), pin internal service communication to encrypted TLS, and run on dedicated private subnets.',
    complianceMandate: 'HIPAA Security Rule (Encryption), ISO 27001 Control A.18 (Data Protection).',
    vulnerabilityClass: 'Data Leaks, Catalog Privilege Escalation'
  },
  {
    id: 'libraries',
    name: 'Software Libraries & SDKs',
    iconName: 'Code',
    description: 'Third-party open-source packages, runtime packages, SDK dependencies, and shared binary utility libraries compiled into applications.',
    threatProfile: 'Dependency confusion, malicious transit injections, remote code execution (RCE) via insecure deserialization, and prototype pollution.',
    hardeningBlueprint: 'Integrate automated SBOM audits in CI/CD, lock all transit versions with cryptographic hashes, and verify official GPG/Cosign signatures.',
    complianceMandate: 'SLSA Level 3/4 (Build Provenance), Executive Order 14028 (Software Supply Chain Security).',
    vulnerabilityClass: 'Prototype Pollution, RCE Deserialization'
  },
  {
    id: 'infrastructure',
    name: 'Infrastructure & Containerization',
    iconName: 'Layers',
    description: 'Orchestrators, runtime engines, container daemons, hypervisors, and serverless compute planes controlling physical resources.',
    threatProfile: 'Container breakout, file descriptor leaks, kernel-level privilege escalation, and side-channel host execution.',
    hardeningBlueprint: 'Run containers using gVisor or Firecracker runtimes, enforce read-only host root filesystems, and apply strict Seccomp & AppArmor profiles.',
    complianceMandate: 'CIS Kubernetes Benchmarks, SOC 2 CC7.1 (System Operations Security).',
    vulnerabilityClass: 'Container Escape, Host Privilege Escalation'
  },
  {
    id: 'operating-systems',
    name: 'Operating Systems & Kernels',
    iconName: 'Cpu',
    description: 'Base distribution images, OS-level binaries, package managers, and kernel packages providing the underlying runtime execution environments.',
    threatProfile: 'Local privilege escalation (LPE), backdoored upstream system libraries, and memory safety exploits in kernel subsystems.',
    hardeningBlueprint: 'Use minimal distroless or Alpine images, run daily automated base-image rebuilds, and apply live kernel security patching.',
    complianceMandate: 'NIST SP 800-123 (Server Security Guidelines), CIS Benchmarks for Linux.',
    vulnerabilityClass: 'Local Privilege Escalation, Kernel Exploits'
  },
  {
    id: 'devops',
    name: 'CI/CD & DevOps Tooling',
    iconName: 'GitBranch',
    description: 'Build servers, runners, pipeline automation scripts, deployment agents, and artifact registries.',
    threatProfile: 'Pipeline poisoning, raw API/OAuth secret exposure in logs, supply chain injection of compiler backdoors (e.g. Ken Thompson Hack).',
    hardeningBlueprint: 'Use ephemeral build environments, enforce multi-party approval for pull request mergers, and use OIDC tokens for secretless authentication.',
    complianceMandate: 'ISO 27001 Control A.14 (Secure Development), CIS Software Supply Chain Guidelines.',
    vulnerabilityClass: 'Secret Leaks, Pipeline Poisoning'
  },
  {
    id: 'security-identity',
    name: 'Security & Identity Management',
    iconName: 'Lock',
    description: 'Key vaults, OAuth2/OIDC servers, single-sign-on controllers, directory systems, and role-based access gateways.',
    threatProfile: 'MFA bypass, cryptographic key leakage, token replay attacks, and offline password database brute-forcing.',
    hardeningBlueprint: 'Rotate keys automatically using hardware security modules (HSM), enforce Phishing-Resistant MFA, and isolate credentials behind zero-trust vaults.',
    complianceMandate: 'NIST SP 800-63 (Digital Identity Guidelines), HIPAA Access Controls.',
    vulnerabilityClass: 'Credential Theft, Auth Bypass'
  },
  {
    id: 'observability',
    name: 'Monitoring & Observability',
    iconName: 'Activity',
    description: 'Log aggregators, metrics scraping daemons, tracing libraries, APM clients, and performance dashboard routers.',
    threatProfile: 'Sensitive data log pollution (e.g. leaking PII, passwords, or API keys), remote command injection on telemetry endpoints.',
    hardeningBlueprint: 'Implement pre-ingest log redaction filters, encrypt metrics transit via Mutual TLS, and strictly restrict dashboard view permissions.',
    complianceMandate: 'GDPR (PII Redaction in Logs), SOC 2 CC6.5 (Logging & Monitoring).',
    vulnerabilityClass: 'PII Leakage, Telemetry Exploits'
  },
  {
    id: 'cloud-serverless',
    name: 'Cloud & Serverless Runtimes',
    iconName: 'Server',
    description: 'Function-as-a-Service executors, cloud API gateways, storage buckets, and dynamic cloud resource schedulers.',
    threatProfile: 'Denial of Wallet, cloud account takeovers, storage bucket misconfigurations, and function injection attacks.',
    hardeningBlueprint: 'Apply strict Principle of Least Privilege to IAM execution roles, enforce storage bucket private-by-default access, and set execution timeout caps.',
    complianceMandate: 'NIST SP 800-210 (General Cloud Security), CIS Cloud Provider Foundation Benchmarks.',
    vulnerabilityClass: 'IAM Privilege Abuse, Public S3 Buckets'
  },
  {
    id: 'ai-ml',
    name: 'AI & Machine Learning Frameworks',
    iconName: 'Sparkles',
    description: 'Neural network training libraries, model serving pipelines, vector databases, and LLM orchestration wrappers.',
    threatProfile: 'Prompt injection, training data poisoning, model extraction, and arbitrary code execution via compromised model weights (e.g. Pickle files).',
    hardeningBlueprint: 'Strictly use safe weight serialization formats (e.g. Safetensors), sanitize all incoming context window inputs, and audit vector indexes.',
    complianceMandate: 'NIST AI Risk Management Framework, OWASP Top 10 for LLM Applications.',
    vulnerabilityClass: 'Arbitrary Code Execution, Prompt Injection'
  },
  {
    id: 'apis-middleware',
    name: 'APIs & Integration Middleware',
    iconName: 'Plug',
    description: 'Message brokers, GraphQL servers, enterprise service buses, and third-party integration gateways.',
    threatProfile: 'Message queue poisoning, excessive data exposure (GraphQL query depth limits exceeded), and authentication bypass on proxy layers.',
    hardeningBlueprint: 'Define strict GraphQL query depth and complexity limits, sign all message payloads, and restrict broker ports from public egress.',
    complianceMandate: 'OWASP API Security Top 10, SOC 2 CC6.6 (Safe Web App Protection).',
    vulnerabilityClass: 'GraphQL Denial of Service, Queue Poisoning'
  },
  {
    id: 'virtualization',
    name: 'Virtualization & Hypervisors',
    iconName: 'Layers',
    description: 'Bare-metal hypervisors, virtualization managers, and cloud-native MicroVM runtimes.',
    threatProfile: 'Hypervisor breakout, guest-to-host execution side channels (e.g. Spectre/Meltdown), CPU caching leaks.',
    hardeningBlueprint: 'Apply core pinning, enable microarchitectural hardware mitigations in boot configs, and restrict physical host administration channels.',
    complianceMandate: 'NIST SP 800-125 (Virtualization Security), PCI DSS Section 2 (System Hardening).',
    vulnerabilityClass: 'Hypervisor Breakout, Side Channel Leaks'
  }
];

const getIconComponent = (iconName: string) => {
  const map: Record<string, React.ComponentType<any>> = {
    Globe,
    Database,
    Code,
    Layers,
    Cpu,
    GitBranch,
    Lock,
    Activity,
    Server,
    Sparkles,
    Plug,
    ShieldCheck,
    FileText
  };
  return map[iconName] || Code;
};

interface SoftwareSectorsPanelProps {
  passports: SoftwarePassport[];
  onFilterCategory: (category: string) => void;
  onNavigateTab?: (tab: string, itemId?: string) => void;
  setSelectedPassportId: (id: string | null) => void;
}

export default function SoftwareSectorsPanel({
  passports,
  onFilterCategory,
  onNavigateTab,
  setSelectedPassportId
}: SoftwareSectorsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Load custom sectors from local storage to persist registered sectors
  const [customSectors, setCustomSectors] = useState<SectorProfile[]>(() => {
    try {
      const saved = localStorage.getItem('msp_custom_sectors');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Form states for new sector
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('Cpu');
  const [newDescription, setNewDescription] = useState('');
  const [newThreat, setNewThreat] = useState('');
  const [newHardening, setNewHardening] = useState('');
  const [newCompliance, setNewCompliance] = useState('');
  const [newVulClass, setNewVulClass] = useState('');

  const allSectors = useMemo(() => {
    return [...DEFAULT_SECTORS, ...customSectors];
  }, [customSectors]);

  // Sector metrics calculation: active passports, average trust index, total CVE count, total SBOM components count
  const sectorMetrics = useMemo(() => {
    const metrics: Record<string, {
      count: number;
      avgTrust: number;
      totalCves: number;
      totalSboms: number;
      matchedPassports: SoftwarePassport[];
    }> = {};

    allSectors.forEach(sector => {
      // Find matching passports for this category
      const matched = passports.filter(p => p.category.toLowerCase().trim() === sector.name.toLowerCase().trim());
      
      const count = matched.length;
      const avgTrust = count > 0 
        ? Math.round(matched.reduce((acc, p) => acc + p.overallScore, 0) / count)
        : 0;
      const totalCves = matched.reduce((acc, p) => acc + p.vulnerabilities.length, 0);
      const totalSboms = matched.reduce((acc, p) => acc + p.sbom.length, 0);

      metrics[sector.id] = {
        count,
        avgTrust,
        totalCves,
        totalSboms,
        matchedPassports: matched
      };
    });

    return metrics;
  }, [allSectors, passports]);

  // Filtered sectors list based on search bar
  const filteredSectors = useMemo(() => {
    if (!searchQuery.trim()) return allSectors;
    return allSectors.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.vulnerabilityClass.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allSectors, searchQuery]);

  // Aggregate metrics across all software sectors
  const aggregateStats = useMemo(() => {
    const totalTrackedPassports = passports.length;
    const sectorsWithActivePassports = (Object.values(sectorMetrics) as { count: number }[]).filter(m => m.count > 0).length;
    const totalCvesAcrossSectors = passports.reduce((acc, p) => acc + p.vulnerabilities.length, 0);
    const overallEcosystemTrust = passports.length > 0
      ? Math.round(passports.reduce((acc, p) => acc + p.overallScore, 0) / passports.length)
      : 90;

    return {
      totalTrackedPassports,
      sectorsWithActivePassports,
      totalCvesAcrossSectors,
      overallEcosystemTrust
    };
  }, [passports, sectorMetrics]);

  // Handles adding a new custom sector (category)
  const handleAddSector = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newDescription.trim()) return;

    const sectorId = 'sect-' + Date.now();
    const newSector: SectorProfile = {
      id: sectorId,
      name: newName.trim(),
      iconName: newIcon,
      description: newDescription.trim(),
      threatProfile: newThreat.trim() || 'General access breach and package substitution in pipeline.',
      hardeningBlueprint: newHardening.trim() || 'Enforce multi-tenant access restriction and strict verification of digital cryptographic hashes.',
      complianceMandate: newCompliance.trim() || 'SOC 2 Core Controls.',
      vulnerabilityClass: newVulClass.trim() || 'General Software Security Vulnerability'
    };

    const updated = [...customSectors, newSector];
    setCustomSectors(updated);
    localStorage.setItem('msp_custom_sectors', JSON.stringify(updated));

    // Reset fields
    setNewName('');
    setNewDescription('');
    setNewThreat('');
    setNewHardening('');
    setNewCompliance('');
    setNewVulClass('');
    setNewIcon('Cpu');
    setShowAddForm(false);
    setSelectedSectorId(sectorId);
  };

  const selectedSector = allSectors.find(s => s.id === selectedSectorId);
  const selectedMetrics = selectedSectorId ? sectorMetrics[selectedSectorId] : null;

  return (
    <div className="space-y-6" id="software-sectors-explorer">
      
      {/* Sector Analysis Header Summary Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="studio-card p-4.5 flex flex-col justify-between">
          <div>
            <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Tracked Sectors</span>
            <span className="text-xl font-bold text-slate-800 font-mono mt-1 block">{allSectors.length} Sectors</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-2 font-sans">
            Comprehensively cataloged software classifications protecting your enterprise pipeline.
          </p>
        </div>

        <div className="studio-card p-4.5 flex flex-col justify-between">
          <div>
            <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Ecosystem Health</span>
            <span className="text-xl font-bold text-emerald-600 font-mono mt-1 block">{aggregateStats.overallEcosystemTrust}/100</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-2 font-sans">
            Average cryptographic trust rating across all active verified passports.
          </p>
        </div>

        <div className="studio-card p-4.5 flex flex-col justify-between">
          <div>
            <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Covered Footprint</span>
            <span className="text-xl font-bold text-indigo-600 font-mono mt-1 block">
              {aggregateStats.sectorsWithActivePassports} / {allSectors.length}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 mt-2 font-sans">
            Proportion of technology sectors actively monitored with cryptographic passports.
          </p>
        </div>

        <div className="studio-card p-4.5 flex flex-col justify-between">
          <div>
            <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Active Sector CVEs</span>
            <span className={`text-xl font-bold font-mono mt-1 block ${aggregateStats.totalCvesAcrossSectors > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {aggregateStats.totalCvesAcrossSectors} Threats
            </span>
          </div>
          <p className="text-[10px] text-slate-500 mt-2 font-sans">
            Total open vulnerabilities flagged in tracked software bill-of-materials.
          </p>
        </div>
      </div>

      {/* Directory Control Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search software sectors, vulnerability classes, compliance standards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 pl-9 pr-4 py-2 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
        </div>

        <button
          onClick={() => setShowAddForm(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-sm transition-colors cursor-pointer flex items-center gap-1.5 self-stretch sm:self-auto justify-center"
        >
          <Plus className="w-4 h-4" />
          <span>Register Software Sector</span>
        </button>
      </div>

      {/* Main Layout Grid: Directories Grid on left, drilldown details on right if selected */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Sectors Grid */}
        <div className={`${selectedSectorId ? 'lg:col-span-7' : 'lg:col-span-12'} grid grid-cols-1 md:grid-cols-2 gap-4`}>
          {filteredSectors.map(sector => {
            const Icon = getIconComponent(sector.iconName);
            const metrics = sectorMetrics[sector.id];
            const isSelected = sector.id === selectedSectorId;

            return (
              <div
                key={sector.id}
                onClick={() => setSelectedSectorId(sector.id === selectedSectorId ? null : sector.id)}
                className={`studio-card p-4.5 cursor-pointer text-left transition-all relative border flex flex-col justify-between h-48 group hover:shadow-md ${
                  isSelected 
                    ? 'border-indigo-600 ring-1 ring-indigo-500/10 bg-indigo-50/5' 
                    : 'border-slate-200 hover:border-slate-350'
                }`}
              >
                <div>
                  <div className="flex justify-between items-start">
                    <div className="p-2 bg-slate-50 border border-slate-150 rounded-lg text-slate-700 group-hover:bg-indigo-50 group-hover:text-indigo-600 group-hover:border-indigo-100 transition-colors">
                      <Icon className="w-4.5 h-4.5" />
                    </div>

                    {/* Sector Passport Trust Index pill */}
                    {metrics.count > 0 ? (
                      <span className={`text-[9px] font-mono font-bold px-2 py-0.8 rounded-full border ${
                        metrics.avgTrust >= 90 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        metrics.avgTrust >= 80 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        'bg-rose-50 text-rose-700 border-rose-200'
                      }`}>
                        {metrics.avgTrust}% Avg Trust
                      </span>
                    ) : (
                      <span className="text-[8px] font-mono font-bold text-slate-400 uppercase bg-slate-100/75 border border-slate-200 px-2 py-0.8 rounded-full">
                        Empty Sector
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-slate-800 text-xs mt-3.5 group-hover:text-indigo-600 transition-colors">
                    {sector.name}
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed line-clamp-2">
                    {sector.description}
                  </p>
                </div>

                <div className="flex justify-between items-center border-t border-slate-100 dark:border-zinc-800 pt-2.5 mt-2.5 text-[9px] font-mono text-slate-500">
                  <div className="flex gap-4">
                    <span>
                      PASSPORTS: <strong className="text-slate-700 font-bold">{metrics.count}</strong>
                    </span>
                    {metrics.count > 0 && (
                      <span>
                        CVEs: <strong className={`font-bold ${metrics.totalCves > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{metrics.totalCves}</strong>
                      </span>
                    )}
                  </div>

                  <span className="text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-0.5">
                    <span>Analyze Sector</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Drilldown Detailed Panel (Sticky-like sidebar) */}
        {selectedSector && selectedMetrics && (
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-5 text-left sticky top-4">
            
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl">
                  {React.createElement(getIconComponent(selectedSector.iconName), { className: 'w-5 h-5' })}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{selectedSector.name}</h3>
                  <span className="text-[9px] font-mono text-slate-400 uppercase font-bold tracking-wider">Sector ID: {selectedSector.id}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedSectorId(null)}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                title="Close Analysis"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-150">
              {selectedSector.description}
            </p>

            {/* Sector Statistics List */}
            <div className="grid grid-cols-2 gap-3 font-mono text-[9px] text-slate-500">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-150">
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wide block">Active Passports</span>
                <span className="text-xs font-bold text-slate-700 mt-1 block">{selectedMetrics.count} monitored</span>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-150">
                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wide block">Total Dependencies</span>
                <span className="text-xs font-bold text-slate-700 mt-1 block">{selectedMetrics.totalSboms} SBOM nodes</span>
              </div>
            </div>

            {/* Profile specifications */}
            <div className="space-y-3.5 text-xs">
              <div>
                <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[9px] font-mono border-b border-slate-100 pb-1.5 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-indigo-500" /> Major Threat Vector
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-1">{selectedSector.threatProfile}</p>
              </div>

              <div>
                <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[9px] font-mono border-b border-slate-100 pb-1.5 flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-indigo-500" /> Sector Compliance Target
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-1 font-semibold text-indigo-600">{selectedSector.complianceMandate}</p>
              </div>

              <div>
                <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[9px] font-mono border-b border-slate-100 pb-1.5 flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5 text-indigo-500" /> Security Hardening Blueprint
                </h4>
                <p className="text-[11px] text-slate-500 leading-relaxed mt-1 bg-indigo-50/20 border border-indigo-100/30 p-2.5 rounded text-indigo-950 font-sans font-medium">{selectedSector.hardeningBlueprint}</p>
              </div>
            </div>

            {/* Matched Passports block */}
            <div className="space-y-2 border-t border-slate-150 pt-4">
              <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Verified Passports inside Sector</span>
              
              {selectedMetrics.count === 0 ? (
                <div className="text-center py-6 bg-slate-50 border border-slate-150 border-dashed rounded-xl space-y-2">
                  <p className="text-[11px] text-slate-400 italic">No software passports registered in this category.</p>
                  <button
                    onClick={() => onFilterCategory(selectedSector.name)}
                    className="px-3 py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 rounded text-[10px] font-semibold cursor-pointer transition-colors"
                  >
                    View Empty Catalog Filter
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedMetrics.matchedPassports.map(p => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPassportId(p.id)}
                      className="p-3 bg-slate-50 hover:bg-slate-100 border border-slate-150 hover:border-slate-250 rounded-xl flex justify-between items-center cursor-pointer transition-all"
                    >
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-slate-800 truncate">{p.name}</h4>
                        <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">Version: {p.version} | {p.publisher}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`w-8 h-8 rounded-full border flex items-center justify-center font-mono text-[10px] font-bold ${
                          p.overallScore >= 90 ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-amber-50 text-amber-700 border-amber-300'
                        }`}>
                          {p.overallScore}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="pt-3 border-t border-slate-150 flex gap-3">
              <button
                onClick={() => onFilterCategory(selectedSector.name)}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl shadow-sm transition-colors cursor-pointer text-center flex items-center justify-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Filter Catalog Grid</span>
              </button>
            </div>

          </div>
        )}

      </div>

      {/* Registration Overlay Popup for New Software Sector */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 font-display flex items-center gap-1.5">
                <Cpu className="w-5 h-5 text-indigo-500 shrink-0" />
                <span>Register Custom Software Sector</span>
              </h3>
              <button
                onClick={() => setShowAddForm(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSector} className="space-y-4 text-left mt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* Sector Name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Sector / Category Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Identity Providers & IAM"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-1.8 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                </div>

                {/* Icon Selection */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Assigned Sector Icon</label>
                  <select
                    value={newIcon}
                    onChange={(e) => setNewIcon(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-1.8 rounded-xl text-xs text-slate-800 focus:outline-none cursor-pointer"
                  >
                    <option value="Cpu">Processor (CPU)</option>
                    <option value="Globe">Web / Networking (Globe)</option>
                    <option value="Database">Data Storage (Database)</option>
                    <option value="Code">Library / SDK (Code)</option>
                    <option value="Layers">Hypervisor / Base (Layers)</option>
                    <option value="Lock">Security / SSO (Lock)</option>
                    <option value="Activity">Monitoring (Activity)</option>
                    <option value="Server">Cloud Computing (Server)</option>
                    <option value="Sparkles">AI / ML Model (Sparkles)</option>
                    <option value="Plug">API Gateway (Plug)</option>
                    <option value="ShieldCheck">Digital Attestation (ShieldCheck)</option>
                    <option value="FileText">Document Registry (FileText)</option>
                  </select>
                </div>

              </div>

              {/* Sector Description */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Sector Description</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Summarize the technological boundaries and function of this software sector..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 px-3 py-1.8 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Threat Profile */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Primary Threat Vector</label>
                  <input
                    type="text"
                    placeholder="e.g. Session hijacking, side-channel leakage"
                    value={newThreat}
                    onChange={(e) => setNewThreat(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-1.8 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                </div>

                {/* Vulnerability Class */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Core Vulnerability Class</label>
                  <input
                    type="text"
                    placeholder="e.g. Memory Corruption, Injection"
                    value={newVulClass}
                    onChange={(e) => setNewVulClass(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-1.8 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Compliance Target */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Compliance Mandate Target</label>
                  <input
                    type="text"
                    placeholder="e.g. NIST CSF Access Control 3.1"
                    value={newCompliance}
                    onChange={(e) => setNewCompliance(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-1.8 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                </div>

                {/* Hardening Blueprint */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold text-slate-400 uppercase block">Hardening Blueprint</label>
                  <input
                    type="text"
                    placeholder="e.g. Mandatory MFA, short-lived tokens"
                    value={newHardening}
                    onChange={(e) => setNewHardening(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 px-3 py-1.8 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                >
                  Confirm Registration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
