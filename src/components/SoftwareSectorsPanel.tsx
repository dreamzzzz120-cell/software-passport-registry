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
  ShieldAlert,
  Award,
  ChevronRight,
  FileText,
  X,
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
    <div className="space-y-4" id="software-sectors-explorer">

      {/* Section header + KPI strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#201f1e]">Software sectors</h2>
          <p className="mt-0.5 text-[13px] text-[#605e5c]">Technology sector classifications, threat profiles and hardening guidance mapped to your catalog.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div>
          <div className="text-[11px] text-[#605e5c]">Tracked sectors</div>
          <div className="text-lg font-semibold text-[#201f1e]">{allSectors.length}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">Ecosystem trust</div>
          <div className="text-lg font-semibold text-[#0e700e]">{aggregateStats.overallEcosystemTrust}/100</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">Covered footprint</div>
          <div className="text-lg font-semibold text-[#201f1e]">{aggregateStats.sectorsWithActivePassports} / {allSectors.length}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">Active sector findings</div>
          <div className={`text-lg font-semibold ${aggregateStats.totalCvesAcrossSectors > 0 ? 'text-[#a4262c]' : 'text-[#0e700e]'}`}>{aggregateStats.totalCvesAcrossSectors}</div>
        </div>
      </div>

      {/* Directory Control Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-9 w-full items-center gap-2 rounded border border-[#c8c6c4] bg-white px-3 focus-within:border-[#0f6cbd] focus-within:ring-1 focus-within:ring-[#0f6cbd] sm:max-w-md">
          <Search className="h-3.5 w-3.5 text-[#8a8886]" />
          <input
            type="text"
            placeholder="Search sectors, vulnerability classes, compliance standards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-[13px] text-[#323130] outline-none placeholder:text-[#8a8886]"
          />
        </label>

        <button
          onClick={() => setShowAddForm(true)}
          className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Register software sector</span>
        </button>
      </div>

      {/* Main Layout Grid: Directories Grid on left, drilldown details on right if selected */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">

        {/* Sectors Grid */}
        <div className={`${selectedSectorId ? 'lg:col-span-7' : 'lg:col-span-12'} grid grid-cols-1 gap-3 md:grid-cols-2`}>
          {filteredSectors.map(sector => {
            const Icon = getIconComponent(sector.iconName);
            const metrics = sectorMetrics[sector.id];
            const isSelected = sector.id === selectedSectorId;

            return (
              <div
                key={sector.id}
                onClick={() => setSelectedSectorId(sector.id === selectedSectorId ? null : sector.id)}
                className={`flex h-44 cursor-pointer flex-col justify-between rounded-md border bg-white p-3 text-left transition-colors ${
                  isSelected
                    ? 'border-[#0f6cbd] bg-[#eff6fc]'
                    : 'border-[#e1dfdd] hover:border-[#c8c6c4]'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="rounded bg-[#f3f2f1] p-1.5 text-[#605e5c]">
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Sector Passport Trust Index badge */}
                    {metrics.count > 0 ? (
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        metrics.avgTrust >= 90 ? 'text-[#0e700e]' :
                        metrics.avgTrust >= 80 ? 'text-[#8a5700]' :
                        'text-[#a4262c]'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          metrics.avgTrust >= 90 ? 'bg-[#0e700e]' :
                          metrics.avgTrust >= 80 ? 'bg-[#8a5700]' :
                          'bg-[#a4262c]'
                        }`} />
                        {metrics.avgTrust}% avg trust
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#8a8886]">Empty sector</span>
                    )}
                  </div>

                  <h3 className="mt-2.5 text-[13px] font-semibold text-[#201f1e]">
                    {sector.name}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#8a8886]">
                    {sector.description}
                  </p>
                </div>

                <div className="mt-2.5 flex items-center justify-between border-t border-[#f3f2f1] pt-2 text-[11px] text-[#605e5c]">
                  <div className="flex gap-3">
                    <span>Passports <strong className="font-semibold text-[#323130]">{metrics.count}</strong></span>
                    {metrics.count > 0 && (
                      <span>Findings <strong className={`font-semibold ${metrics.totalCves > 0 ? 'text-[#a4262c]' : 'text-[#0e700e]'}`}>{metrics.totalCves}</strong></span>
                    )}
                  </div>

                  <span className="flex items-center gap-0.5 font-medium text-[#0f6cbd]">
                    <span>Analyze</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Drilldown Detailed Panel (Sticky-like sidebar) */}
        {selectedSector && selectedMetrics && (
          <div className="sticky top-4 space-y-4 rounded-md border border-[#e1dfdd] bg-white p-4 text-left lg:col-span-5">

            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded bg-[#eff6fc] p-2 text-[#0f6cbd]">
                  {React.createElement(getIconComponent(selectedSector.iconName), { className: 'w-4 h-4' })}
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-[#201f1e]">{selectedSector.name}</h3>
                  <span className="text-[11px] text-[#8a8886]">Sector ID: {selectedSector.id}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedSectorId(null)}
                className="rounded p-1 text-[#8a8886] hover:bg-black/[.03] hover:text-[#605e5c]"
                title="Close analysis"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <p className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[12px] leading-relaxed text-[#605e5c]">
              {selectedSector.description}
            </p>

            {/* Sector Statistics List */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-[#e1dfdd] bg-[#faf9f8] p-2">
                <span className="block text-[11px] text-[#8a8886]">Active passports</span>
                <span className="text-[13px] font-semibold text-[#323130]">{selectedMetrics.count} monitored</span>
              </div>
              <div className="rounded border border-[#e1dfdd] bg-[#faf9f8] p-2">
                <span className="block text-[11px] text-[#8a8886]">Total dependencies</span>
                <span className="text-[13px] font-semibold text-[#323130]">{selectedMetrics.totalSboms} SBOM nodes</span>
              </div>
            </div>

            {/* Profile specifications */}
            <div className="space-y-3">
              <div>
                <h4 className="flex items-center gap-1.5 border-b border-[#f3f2f1] pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#605e5c]">
                  <ShieldAlert className="h-3.5 w-3.5 text-[#0f6cbd]" /> Major threat vector
                </h4>
                <p className="mt-1 text-[12px] leading-relaxed text-[#605e5c]">{selectedSector.threatProfile}</p>
              </div>

              <div>
                <h4 className="flex items-center gap-1.5 border-b border-[#f3f2f1] pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#605e5c]">
                  <Award className="h-3.5 w-3.5 text-[#0f6cbd]" /> Sector compliance target
                </h4>
                <p className="mt-1 text-[12px] font-medium leading-relaxed text-[#0f6cbd]">{selectedSector.complianceMandate}</p>
              </div>

              <div>
                <h4 className="flex items-center gap-1.5 border-b border-[#f3f2f1] pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#605e5c]">
                  <Settings className="h-3.5 w-3.5 text-[#0f6cbd]" /> Security hardening blueprint
                </h4>
                <p className="mt-1 rounded border border-[#e1dfdd] bg-[#eff6fc] p-2 text-[12px] leading-relaxed text-[#201f1e]">{selectedSector.hardeningBlueprint}</p>
              </div>
            </div>

            {/* Matched Passports block */}
            <div className="space-y-2 border-t border-[#f3f2f1] pt-3">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#8a8886]">Verified passports in sector</span>

              {selectedMetrics.count === 0 ? (
                <div className="space-y-2 rounded-md border border-dashed border-[#e1dfdd] bg-[#faf9f8] py-5 text-center">
                  <p className="text-[12px] italic text-[#8a8886]">No software passports registered in this category.</p>
                  <button
                    onClick={() => onFilterCategory(selectedSector.name)}
                    className="h-8 rounded border border-[#c8c6c4] px-3 text-[12px] font-medium text-[#323130] hover:bg-black/[.03]"
                  >
                    View empty catalog filter
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selectedMetrics.matchedPassports.map(p => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPassportId(p.id)}
                      className="flex cursor-pointer items-center justify-between rounded border border-[#e1dfdd] bg-[#faf9f8] p-2.5 hover:border-[#c8c6c4]"
                    >
                      <div className="min-w-0">
                        <h4 className="truncate text-[13px] font-medium text-[#201f1e]">{p.name}</h4>
                        <span className="mt-0.5 block text-[11px] text-[#8a8886]">Version {p.version} · {p.publisher}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold ${
                          p.overallScore >= 90 ? 'border-[#0e700e]/30 bg-[#dff6dd] text-[#0e700e]' : 'border-[#8a5700]/30 bg-[#fff4ce] text-[#8a5700]'
                        }`}>
                          {p.overallScore}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-[#8a8886]" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="border-t border-[#f3f2f1] pt-3">
              <button
                onClick={() => onFilterCategory(selectedSector.name)}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Filter catalog grid</span>
              </button>
            </div>

          </div>
        )}

      </div>

      {/* Registration Overlay Popup for New Software Sector */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-md border border-[#e1dfdd] bg-white p-5">

            <div className="flex items-start justify-between border-b border-[#f3f2f1] pb-3">
              <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-[#201f1e]">
                <Cpu className="h-4 w-4 shrink-0 text-[#0f6cbd]" />
                <span>Register custom software sector</span>
              </h3>
              <button
                onClick={() => setShowAddForm(false)}
                className="rounded p-1 text-[#8a8886] hover:bg-black/[.03] hover:text-[#605e5c]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <form onSubmit={handleAddSector} className="mt-4 space-y-3 text-left">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

                {/* Sector Name */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[#605e5c]">Sector / category name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Identity Providers & IAM"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                  />
                </div>

                {/* Icon Selection */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[#605e5c]">Assigned sector icon</label>
                  <select
                    value={newIcon}
                    onChange={(e) => setNewIcon(e.target.value)}
                    className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
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
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-[#605e5c]">Sector description</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Summarize the technological boundaries and function of this software sector..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full resize-none rounded border border-[#c8c6c4] bg-white px-3 py-2 text-[13px] text-[#323130] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Threat Profile */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[#605e5c]">Primary threat vector</label>
                  <input
                    type="text"
                    placeholder="e.g. Session hijacking, side-channel leakage"
                    value={newThreat}
                    onChange={(e) => setNewThreat(e.target.value)}
                    className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                  />
                </div>

                {/* Vulnerability Class */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[#605e5c]">Core vulnerability class</label>
                  <input
                    type="text"
                    placeholder="e.g. Memory Corruption, Injection"
                    value={newVulClass}
                    onChange={(e) => setNewVulClass(e.target.value)}
                    className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Compliance Target */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[#605e5c]">Compliance mandate target</label>
                  <input
                    type="text"
                    placeholder="e.g. NIST CSF Access Control 3.1"
                    value={newCompliance}
                    onChange={(e) => setNewCompliance(e.target.value)}
                    className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                  />
                </div>

                {/* Hardening Blueprint */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-[#605e5c]">Hardening blueprint</label>
                  <input
                    type="text"
                    placeholder="e.g. Mandatory MFA, short-lived tokens"
                    value={newHardening}
                    onChange={(e) => setNewHardening(e.target.value)}
                    className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2 border-t border-[#f3f2f1] pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="h-9 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-9 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]"
                >
                  Confirm registration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
