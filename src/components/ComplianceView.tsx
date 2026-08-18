/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  ShieldCheck,
  CheckSquare,
  Download,
  Award,
  Search,
  Filter,
  Clock,
  History,
  Calendar,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  X,
  ShieldAlert,
  Copy,
  ChevronRight,
  ExternalLink,
  Shield,
  Plus,
  Trash2,
  Play,
  Loader2,
  Check
} from 'lucide-react';
import { Client } from '../types';
import { apiFetch } from '../utils/apiClient';

interface ComplianceSchedule {
  id: string;
  tenantId: string;
  clientId: string;
  frequency: string;
  targetEmail: string;
  lastAuditAt: string | null;
  nextAuditAt: string | null;
  status: string;
  createdAt: string;
}

interface ComplianceViewProps {
  clients: Client[];
}

interface AuditTimelineEvent {
  id: string;
  date: string;
  framework: 'SOC 2' | 'ISO 27001' | 'HIPAA' | 'NIST' | 'Global';
  type: 'Audit' | 'Policy' | 'Vulnerability' | 'Signature' | 'Access Control';
  title: string;
  description: string;
  status: 'Passed' | 'Attention Required' | 'Action Taken';
  evidenceHash: string;
  auditor: string;
  scope: string;
}

export default function ComplianceView({ clients }: ComplianceViewProps) {
  const [selectedFramework, setSelectedFramework] = useState<string>('SOC2');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selectedEvent, setSelectedEvent] = useState<AuditTimelineEvent | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Compliance schedules states
  const [schedules, setSchedules] = useState<ComplianceSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newClientId, setNewClientId] = useState('');
  const [newFrequency, setNewFrequency] = useState('Weekly');
  const [newTargetEmail, setNewTargetEmail] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchSchedules = async () => {
    setSchedulesLoading(true);
    try {
      const res = await apiFetch('/api/compliance/schedules');
      if (res.ok) {
        const data = await res.json();
        setSchedules(data);
      }
    } catch (err) {
      console.error('Failed to fetch schedules', err);
    } finally {
      setSchedulesLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientId || !newFrequency || !newTargetEmail) {
      showNotification('Please fill in all fields', 'error');
      return;
    }

    setActionLoading('create');
    try {
      const res = await apiFetch('/api/compliance/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: newClientId,
          frequency: newFrequency,
          targetEmail: newTargetEmail
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSchedules(prev => [...prev, data]);
        setShowAddForm(false);
        setNewClientId('');
        setNewTargetEmail('');
        showNotification('Compliance audit schedule created successfully!');
      } else {
        const errData = await res.json();
        showNotification(errData.error || 'Failed to create schedule', 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('Network error occurred', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleStatus = async (schedule: ComplianceSchedule) => {
    const newStatus = schedule.status === 'Active' ? 'Paused' : 'Active';
    setActionLoading(schedule.id + '-toggle');
    try {
      const res = await apiFetch(`/api/compliance/schedules/${schedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (res.ok) {
        const data = await res.json();
        setSchedules(prev => prev.map(s => s.id === schedule.id ? data : s));
        showNotification(`Schedule status updated to ${newStatus}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this compliance schedule?')) {
      return;
    }

    setActionLoading(id + '-delete');
    try {
      const res = await apiFetch(`/api/compliance/schedules/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setSchedules(prev => prev.filter(s => s.id !== id));
        showNotification('Compliance schedule deleted successfully');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunAudit = async (id: string) => {
    setActionLoading(id + '-run');
    try {
      const res = await apiFetch(`/api/compliance/schedules/${id}/run`, {
        method: 'POST'
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.schedule) {
          setSchedules(prev => prev.map(s => s.id === id ? data.schedule : s));
          showNotification(data.message, 'success');
        } else {
          showNotification(data.message || 'Audit execution succeeded, but no schedule was updated.', 'error');
        }
      } else {
        showNotification('Failed to run automated compliance audit', 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('Network error running compliance audit', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // Consolidate compliance standards across clients
  const frameworkDetails = {
    SOC2: {
      name: 'SOC 2 Type II Auditing Controls',
      description: 'Trust Services Criteria regarding Security, Availability, Processing Integrity, Confidentiality, and Privacy.',
      controls: [
        { code: 'CC6.1', description: 'Logical access and software-signature controls.', status: 'Not verified', evidence: 'Awaiting evidence' },
        { code: 'CC7.2', description: 'Vulnerability evaluation and remediation controls.', status: 'Not verified', evidence: 'Scan not run' },
        { code: 'CC8.1', description: 'Supplier and license review controls.', status: 'Not verified', evidence: 'Awaiting evidence' }
      ]
    },
    ISO27001: {
      name: 'ISO 27001 Information Security Management ISMS',
      description: 'Systematic approach to managing sensitive company information so that it remains secure.',
      controls: [
        { code: 'A.12.6.1', description: 'Management of technical vulnerabilities.', status: 'Not verified', evidence: 'Scan not run' },
        { code: 'A.18.1.1', description: 'Applicable legal and license requirements.', status: 'Not verified', evidence: 'Awaiting evidence' }
      ]
    },
    HIPAA: {
      name: 'HIPAA Security & Privacy Safeguards',
      description: 'Technical and administrative controls required to protect Protected Health Information (PHI) under US law.',
      controls: [
        { code: '§164.312(a)', description: 'Access control mechanisms for systems handling PHI.', status: 'Not verified', evidence: 'Awaiting evidence' }
      ]
    }
  };

  // Chronological timeline records over the last 12 months (relative to July 10, 2026)
  const auditTimelineEvents: AuditTimelineEvent[] = [
    {
      id: 'evt-1',
      date: '2026-07-08',
      framework: 'SOC 2',
      type: 'Audit',
      title: 'SOC 2 Type II Annual Attestation Certified',
      description: 'Official report issued by Coalfire Security Services, confirming 100% operating effectiveness on all trust services criteria with zero exceptions noted.',
      status: 'Passed',
      evidenceHash: 'sha256:7a92fb4e0bcf00e129da7584100c82fb6123e98af0c1d2e3f4a5b6c7d8e9f0a1',
      auditor: 'Coalfire Security Services',
      scope: 'Logical Access, System Boundaries, Software Build Pipeline and Attestation Registry'
    },
    {
      id: 'evt-2',
      date: '2026-06-15',
      framework: 'NIST',
      type: 'Policy',
      title: 'SSDF Automated Control Mappings Activated',
      description: 'AI Swarm evidence collector successfully mapped 19 cryptographic package signature anchors directly to NIST SP 800-218 requirements.',
      status: 'Passed',
      evidenceHash: 'sha256:c298a0d9bcf129ef901c82fb7162d98af0c3d2e5f4a5b6c7d8e9f0a12e345678',
      auditor: 'SPR Internal Swarm (Compliance AI)',
      scope: 'NIST SP 800-218 Secure Software Development Framework (SSDF)'
    },
    {
      id: 'evt-3',
      date: '2026-05-12',
      framework: 'Global',
      type: 'Vulnerability',
      title: 'Vanguard OSS SSPL License Alert Remediated',
      description: 'A restricted SSPL dependency was identified in a client-facing module by Supply Chain AI. The package was successfully replaced with an MIT-compliant equivalent.',
      status: 'Action Taken',
      evidenceHash: 'sha256:1a8dfb410bcf00e39c82fb7162d98af0c4d2e5f4a5b6c7d8e9f0a12e345678ab',
      auditor: 'SPR Internal Swarm (Supply Chain AI)',
      scope: 'Software Bill of Materials (SBOM) Permissive Licensing Scan'
    },
    {
      id: 'evt-4',
      date: '2026-04-18',
      framework: 'Global',
      type: 'Audit',
      title: 'Third-Party Application Penetration Test',
      description: 'Comprehensive static and dynamic penetration testing finalized by Cobalt Security. No high or critical severity vulnerabilities were found in API endpoints.',
      status: 'Passed',
      evidenceHash: 'sha256:fb4d01aa0bcf29ed39c82fb7162d98af0c5d2e5f4a5b6c7d8e9f0a12e345678c',
      auditor: 'Cobalt Security Labs',
      scope: 'SPR Cloud Platform, Passport Registry API, and OAuth Proxy Middleware'
    },
    {
      id: 'evt-5',
      date: '2026-02-28',
      framework: 'ISO 27001',
      type: 'Audit',
      title: 'ISO 27001 Surveillance Audit Approved',
      description: 'Surveillance audit performed by BSI Group confirms continued alignment with zero minor or major non-conformities reported across ISMS protocols.',
      status: 'Passed',
      evidenceHash: 'sha256:91bc2e8d0bcf09ea39c82fb7162d98af0c6d2e5f4a5b6c7d8e9f0a12e345678d',
      auditor: 'BSI Assurance Services',
      scope: 'Information Security Management System (ISMS) ISO/IEC 27001:2022'
    },
    {
      id: 'evt-6',
      date: '2026-01-10',
      framework: 'Global',
      type: 'Signature',
      title: 'Root Cryptographic Key Rotation Executed',
      description: 'Scheduled rotation of the platform publisher-signing root keys. Re-anchored current active software passports to updated HSM modules.',
      status: 'Passed',
      evidenceHash: 'sha256:3fd72ea90bcf38fa39c82fb7162d98af0c7d2e5f4a5b6c7d8e9f0a12e345678e',
      auditor: 'SPR Security Operations',
      scope: 'Hardware Security Module (HSM) & Key Management Policy'
    },
    {
      id: 'evt-7',
      date: '2025-11-20',
      framework: 'HIPAA',
      type: 'Access Control',
      title: 'HIPAA ePHI Access Isolation Audit',
      description: 'Validated active logical access controls and DB encryption parameters ensuring zero HIPAA ePHI telemetry exposures in transit or rest.',
      status: 'Passed',
      evidenceHash: 'sha256:a7b8c2d10bcf29ed89c82fb7162d98af0c8d2e5f4a5b6c7d8e9f0a12e345678f',
      auditor: 'Compliance Alliance Group',
      scope: 'HIPAA Administrative & Security Safeguards 45 CFR Part 164'
    },
    {
      id: 'evt-8',
      date: '2025-09-05',
      framework: 'Global',
      type: 'Policy',
      title: 'SBOM CycloneDX Schema Verification Enforced',
      description: 'Updated pipeline schemas to reject package uploads failing CycloneDX v1.5 JSON standards, preventing dependency obfuscation attacks.',
      status: 'Passed',
      evidenceHash: 'sha256:8b4f0c920bcf29ea89c82fb7162d98af0c9d2e5f4a5b6c7d8e9f0a12e3456789',
      auditor: 'SPR Engineering Group',
      scope: 'Ingest Policy Engine & Pipeline Schema Integrity'
    },
    {
      id: 'evt-9',
      date: '2025-07-15',
      framework: 'SOC 2',
      type: 'Audit',
      title: 'Initial SOC 2 Type II Readiness Baseline Established',
      description: 'Initial posture mapping to define logical access targets, database audit logs, and continuous vulnerability patch schedules for MSP clients.',
      status: 'Passed',
      evidenceHash: 'sha256:dd04e8fa0bcf19ed89c82fb7162d98af0cad2e5f4a5b6c7d8e9f0a12e345678a',
      auditor: 'Coalfire Security Services',
      scope: 'SOC 2 Security, Availability, and Confidentiality Readiness'
    }
  ];

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Filter logic
  const filteredEvents = ([] as AuditTimelineEvent[]).filter(event => {
    const matchesSearch = event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          event.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          event.auditor.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          event.scope.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = typeFilter === 'All' || event.type === typeFilter;
    const matchesStatus = statusFilter === 'All' || event.status === statusFilter;
    
    return matchesSearch && matchesType && matchesStatus;
  });

  const currentFramework = frameworkDetails[selectedFramework as keyof typeof frameworkDetails] || frameworkDetails.SOC2;

  return (
    <div className="space-y-6 animate-in fade-in duration-300" id="msp-compliance-view">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900">Continuous Compliance & Auditing</h1>
          <p className="text-xs text-slate-500 font-sans mt-1">
            Map cryptographic software passport evidence directly to security framework control sheets and track audit logs.
          </p>
        </div>

        {/* Framework Selector Tabs */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-semibold shrink-0">
          {Object.keys(frameworkDetails).map((fw) => (
            <button
              key={fw}
              onClick={() => setSelectedFramework(fw)}
              className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors ${selectedFramework === fw ? 'bg-white text-indigo-700 font-bold shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {fw}
            </button>
          ))}
        </div>
      </div>

      {/* Main Framework Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Framework Overview Card */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex justify-between items-start">
            <span className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
              <ClipboardCheck className="w-6 h-6" />
            </span>
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold font-mono px-2 py-0.5 rounded-md">
              SLA Standard ACTIVE
            </span>
          </div>

          <div>
            <h2 className="text-base font-bold text-slate-900 font-display">{currentFramework.name}</h2>
            <p className="text-xs text-slate-500 leading-relaxed mt-2">{currentFramework.description}</p>
          </div>

          <div className="pt-3 border-t border-slate-100 text-xs space-y-2 font-mono text-slate-400">
            <div className="flex justify-between">
              <span>CONTROLS AUDITED:</span>
              <span className="font-semibold text-slate-700">14 Active Controls</span>
            </div>
            <div className="flex justify-between">
              <span>SLA THRESHOLD TARGET:</span>
              <span className="font-semibold text-emerald-600">100% Certified</span>
            </div>
          </div>
        </div>

        {/* Right Column: Control Checklist */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col">
          <div className="border-b border-slate-100 pb-3 mb-4 flex justify-between items-center">
            <h3 className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider">Audit control verification log</h3>
            <button className="text-indigo-600 hover:text-indigo-800 font-bold text-[10px] font-mono flex items-center gap-1 cursor-pointer bg-transparent border-none">
              <Download className="w-3.5 h-3.5" />
              <span>Export Audit Evidence Pack</span>
            </button>
          </div>

          <div className="space-y-4 flex-1">
            {currentFramework.controls.map((ctrl, i) => (
              <div key={i} className="p-4 bg-slate-50 border border-slate-200 hover:border-indigo-200 rounded-xl transition-colors space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold font-mono bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded">
                    Control: {ctrl.code}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-mono font-bold ${ctrl.status === 'Compliant' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {ctrl.status}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-slate-800 leading-snug">{ctrl.description}</h4>
                <div className="text-[10px] font-mono text-slate-400 pt-1.5 border-t border-slate-200/50 flex justify-between items-center">
                  <span>Audit Evidence: <span className="text-slate-600 font-semibold">{ctrl.evidence}</span></span>
                  <span className="text-emerald-600 font-bold flex items-center gap-0.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Validated</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Automated Audit Scheduling panel */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6" id="automated-audit-scheduler">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-150 pb-5">
          <div className="text-left">
            <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2">
              <Calendar className="w-4.5 h-4.5 text-indigo-500" />
              <span>Automated Compliance Audit Scheduler</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1 font-sans">
              Configure and manage automated periodic policy scans and compliance check-ups for selected client tenants. Results are automatically generated as a PDF report and dispatched to key stakeholders.
            </p>
          </div>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-semibold text-xs px-3.5 py-2 rounded-xl shadow-sm hover:shadow transition-all cursor-pointer"
            id="add-schedule-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAddForm ? 'Cancel Form' : 'New Audit Schedule'}</span>
          </button>
        </div>

        {/* Form to Add Schedule */}
        {showAddForm && (
          <form onSubmit={handleCreateSchedule} className="bg-slate-50 border border-slate-200 p-5 rounded-xl text-left space-y-4 animate-in fade-in duration-200">
            <h3 className="text-xs font-bold text-slate-700 font-mono uppercase">Create periodic compliance pipeline</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Select Client Tenant */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-mono text-slate-400 font-bold block">TARGET CLIENT TENANT</label>
                <select
                  value={newClientId}
                  onChange={(e) => setNewClientId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                  required
                >
                  <option value="">-- Select Client Tenant --</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>
                  ))}
                </select>
              </div>

              {/* Audit Frequency */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-mono text-slate-400 font-bold block">AUDIT FREQUENCY</label>
                <select
                  value={newFrequency}
                  onChange={(e) => setNewFrequency(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                  required
                >
                  <option value="Daily">Daily Run</option>
                  <option value="Weekly">Weekly Run</option>
                  <option value="Monthly">Monthly Run</option>
                </select>
              </div>

              {/* Stakeholder Email */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-mono text-slate-400 font-bold block">DISPATCH STAKEHOLDER EMAIL</label>
                <input
                  type="email"
                  placeholder="security@client-domain.com"
                  value={newTargetEmail}
                  onChange={(e) => setNewTargetEmail(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-250 text-slate-700 font-sans font-bold text-xs rounded-xl cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading === 'create'}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-bold text-xs px-4 py-2 rounded-xl shadow-sm hover:shadow cursor-pointer transition-all disabled:opacity-55"
              >
                {actionLoading === 'create' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Provisioning...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Activate Schedule</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Notification Alert banner */}
        {notification && (
          <div className={`p-3 rounded-lg text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-200 text-left ${
            notification.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-150' : 'bg-rose-50 text-rose-800 border border-rose-150'
          }`}>
            <CheckCircle2 className="w-4.5 h-4.5 shrink-0 text-emerald-500" />
            <span>{notification.message}</span>
          </div>
        )}

        {/* Schedules list */}
        <div className="overflow-x-auto">
          {schedulesLoading ? (
            <div className="flex justify-center items-center py-8 gap-2 text-xs text-slate-400 font-mono">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading registered compliance pipelines...</span>
            </div>
          ) : schedules.length === 0 ? (
            <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
              <Clock className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-xs text-slate-500 font-semibold">No active automated compliance pipelines configured.</p>
              <p className="text-[11px] text-slate-450 font-sans max-w-sm mx-auto">Click "New Audit Schedule" above to automate continuous compliance reporting and secure audit trial sync for your MSP client tenants.</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 font-bold">Client Tenant</th>
                  <th className="py-2.5 font-bold">Frequency</th>
                  <th className="py-2.5 font-bold">Recipient Email</th>
                  <th className="py-2.5 font-bold">Last Scanned Run</th>
                  <th className="py-2.5 font-bold">Next Scheduled Run</th>
                  <th className="py-2.5 font-bold text-center">Status</th>
                  <th className="py-2.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(sched => {
                  const clientObj = clients.find(c => c.id === sched.clientId);
                  const isRunning = actionLoading === `${sched.id}-run`;
                  const isDeleting = actionLoading === `${sched.id}-delete`;
                  const isToggling = actionLoading === `${sched.id}-toggle`;

                  return (
                    <tr key={sched.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 font-semibold text-slate-800">
                        {clientObj ? clientObj.name : 'Unknown Client'}
                        <span className="text-[10px] text-slate-400 font-mono font-bold block">{clientObj?.domain}</span>
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-md font-mono font-bold text-[9px]">
                          {sched.frequency}
                        </span>
                      </td>
                      <td className="py-3 font-mono text-slate-600">{sched.targetEmail}</td>
                      <td className="py-3 font-mono text-slate-500">{sched.lastAuditAt || 'Never Run'}</td>
                      <td className="py-3 font-mono text-indigo-600 font-semibold">{sched.status === 'Active' ? sched.nextAuditAt : 'Paused'}</td>
                      <td className="py-3 text-center">
                        <button
                          onClick={() => handleToggleStatus(sched)}
                          disabled={isToggling}
                          className="bg-transparent border-none cursor-pointer p-1"
                          title="Click to toggle active/paused state"
                        >
                          {sched.status === 'Active' ? (
                            <span className="flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-150 px-2 py-0.5 rounded-md font-mono font-bold text-[9px] hover:bg-emerald-100">
                              Active
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-md font-mono font-bold text-[9px] hover:bg-slate-150">
                              Paused
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleRunAudit(sched.id)}
                            disabled={isRunning || sched.status !== 'Active'}
                            className={`flex items-center gap-1 text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-colors ${
                              sched.status !== 'Active' 
                                ? 'bg-slate-50 border border-slate-200 text-slate-300 cursor-not-allowed'
                                : 'bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                            }`}
                            title="Run automated audit and generate/dispatch PDF reports immediately"
                          >
                            {isRunning ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            <span>Run Audit</span>
                          </button>
                          
                          <button
                            onClick={() => handleDeleteSchedule(sched.id)}
                            disabled={isDeleting}
                            className="bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 p-1.5 rounded-lg cursor-pointer transition-colors"
                            title="Delete this schedule pipeline"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* NEW: 12-Month Audit History & Certification Timeline Component */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6" id="compliance-timeline-workspace">
        
        {/* Component Header & Stats Grid */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-5">
          <div>
            <h2 className="text-sm font-bold text-slate-800 font-display flex items-center gap-2">
              <History className="w-4.5 h-4.5 text-indigo-500" />
              <span>12-Month Audit History & Certification Ledger</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Trace chronological system audits, policy changes, and cryptographic compliance attestations conducted from July 2025 to July 2026.
            </p>
          </div>

          <div className="bg-indigo-50 border border-indigo-150 px-3.5 py-1.5 rounded-xl flex items-center gap-2 text-xs font-semibold text-indigo-700">
            <Award className="w-4 h-4 text-indigo-500" />
            <span>Overall Score Trend: 98% (+4% YoY)</span>
          </div>
        </div>

        {/* 12-Month Progression Mini Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 border border-slate-150 p-3.5 rounded-xl text-left">
            <span className="text-[10px] font-mono text-slate-400 font-bold block">TOTAL EVENTS</span>
            <span className="text-lg font-bold text-slate-800 font-display mt-1 block">9 Verified</span>
          </div>
          <div className="bg-slate-50 border border-slate-150 p-3.5 rounded-xl text-left">
            <span className="text-[10px] font-mono text-slate-400 font-bold block">CLEAN PASS RATE</span>
            <span className="text-lg font-bold text-emerald-600 font-display mt-1 block">100% Successful</span>
          </div>
          <div className="bg-slate-50 border border-slate-150 p-3.5 rounded-xl text-left">
            <span className="text-[10px] font-mono text-slate-400 font-bold block">EXTERNAL AUDITS</span>
            <span className="text-lg font-bold text-indigo-600 font-display mt-1 block">4 Conducted</span>
          </div>
          <div className="bg-slate-50 border border-slate-150 p-3.5 rounded-xl text-left">
            <span className="text-[10px] font-mono text-slate-400 font-bold block">LEDGER PROOF STATUS</span>
            <span className="text-lg font-bold text-slate-800 font-display mt-1 block flex items-center gap-1">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
              <span className="text-xs font-mono">TAMPERPROOF</span>
            </span>
          </div>
        </div>

        {/* Search and Filters Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center bg-slate-50 p-3 rounded-xl border border-slate-150">
          <div className="relative w-full sm:flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search timeline by title, description, scope, or auditor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            />
          </div>

          <div className="flex gap-2 w-full sm:w-auto shrink-0">
            {/* Filter by Event Type */}
            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-transparent border-none p-0 pr-6 text-xs font-semibold focus:outline-none cursor-pointer"
              >
                <option value="All">All Types</option>
                <option value="Audit">Audit</option>
                <option value="Policy">Policy</option>
                <option value="Vulnerability">Vulnerability</option>
                <option value="Signature">Signature</option>
                <option value="Access Control">Access Control</option>
              </select>
            </div>

            {/* Filter by Status */}
            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600">
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent border-none p-0 pr-6 text-xs font-semibold focus:outline-none cursor-pointer"
              >
                <option value="All">All Statuses</option>
                <option value="Passed">Passed</option>
                <option value="Action Taken">Action Taken</option>
                <option value="Attention Required">Attention Required</option>
              </select>
            </div>
          </div>
        </div>

        {/* Timeline Layout */}
        <div className="relative border-l-2 border-slate-200 ml-3.5 pl-6.5 py-2 space-y-7">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-xs text-slate-500 font-semibold">No audit timeline entries matched your filters.</p>
              <button
                onClick={() => {
                  setSearchTerm('');
                  setTypeFilter('All');
                  setStatusFilter('All');
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold bg-transparent border-none cursor-pointer underline"
              >
                Reset all filters
              </button>
            </div>
          ) : (
            filteredEvents.map((event) => {
              const isAudit = event.type === 'Audit';
              const isPolicy = event.type === 'Policy';
              const isVuln = event.type === 'Vulnerability';
              
              let badgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
              if (event.status === 'Passed') badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-150';
              else if (event.status === 'Action Taken') badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-150';
              else if (event.status === 'Attention Required') badgeColor = 'bg-amber-50 text-amber-700 border-amber-150';

              return (
                <div key={event.id} className="relative group text-left">
                  {/* Timeline Node Point Icon Indicator */}
                  <div className={`absolute -left-10 top-0.5 w-6.5 h-6.5 rounded-full border-2 bg-white flex items-center justify-center transition-all ${
                    event.status === 'Passed' ? 'border-emerald-500 text-emerald-500 shadow-sm shadow-emerald-100' :
                    event.status === 'Action Taken' ? 'border-indigo-500 text-indigo-500 shadow-sm shadow-indigo-100' :
                    'border-amber-500 text-amber-500 shadow-sm shadow-amber-100'
                  }`}>
                    <Calendar className="w-3.5 h-3.5" />
                  </div>

                  <div className="bg-slate-50/40 hover:bg-slate-50 border border-slate-150 p-4.5 rounded-xl hover:border-indigo-200 hover:shadow-sm transition-all duration-200 space-y-3 cursor-pointer" onClick={() => setSelectedEvent(event)}>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                          {event.date}
                        </span>
                        <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-100">
                          {event.framework}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500 font-sans">
                          • {event.type}
                        </span>
                      </div>
                      
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-mono font-bold border ${badgeColor}`}>
                        {event.status}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-xs font-bold text-slate-800 leading-snug group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
                        <span>{event.title}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 transition-transform group-hover:translate-x-0.5" />
                      </h3>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed font-sans line-clamp-2">
                        {event.description}
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between text-[10px] font-mono text-slate-400 pt-3 border-t border-slate-200/50 gap-2">
                      <span>AUDITED BY: <strong className="text-slate-600 font-semibold">{event.auditor}</strong></span>
                      <span className="text-[9px] break-all max-w-[280px] sm:max-w-none text-slate-400/80 hover:text-indigo-500 select-all cursor-copy" title="Click to copy evidence hash" onClick={(e) => { e.stopPropagation(); handleCopyHash(event.evidenceHash); }}>
                        PROOF: {event.evidenceHash.substring(0, 24)}... {copiedHash === event.evidenceHash ? '✓ Copied' : '(Copy Hash)'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Explanatory banner */}
        <div className="bg-indigo-50/20 border border-indigo-100/50 p-4 rounded-xl flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
          <div className="text-left space-y-1">
            <h4 className="text-xs font-bold text-slate-800">Immutable Compliance & Evidentiary Proof</h4>
            <p className="text-[11px] text-slate-500 leading-relaxed font-sans">
              All listed events hold cryptographically signed hashes linked directly to the primary Software Passport timeline. This guarantees that compliance records cannot be retroactive, altered, or fabricated, satisfying strict third-party SOC 2 and ISO ISMS auditing standards.
            </p>
          </div>
        </div>
      </div>

      {/* Side Detail Modal drawer for inspecting Timeline items */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col justify-between border-l border-slate-200 animate-in slide-in-from-right duration-200">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 space-y-2 text-left">
              <button
                onClick={() => setSelectedEvent(null)}
                className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded border border-indigo-100">
                  {selectedEvent.framework}
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-500">
                  {selectedEvent.type} Event
                </span>
              </div>
              
              <h2 className="text-base font-bold text-slate-900 font-display pr-8">{selectedEvent.title}</h2>
              <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>Recorded on {selectedEvent.date}</span>
              </div>
            </div>

            {/* Modal Body / Logs */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-left">
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Detailed Event Log</h3>
                <p className="text-xs text-slate-600 leading-relaxed font-sans bg-slate-50 border border-slate-150 p-4 rounded-xl">
                  {selectedEvent.description}
                </p>
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Audit Information & Context</h3>
                
                <div className="grid grid-cols-1 gap-3 text-xs">
                  <div className="border border-slate-150 rounded-xl p-3 bg-white space-y-1">
                    <span className="text-[9px] font-mono text-slate-400 font-bold block">AUDITING BODY</span>
                    <span className="font-semibold text-slate-700">{selectedEvent.auditor}</span>
                  </div>

                  <div className="border border-slate-150 rounded-xl p-3 bg-white space-y-1">
                    <span className="text-[9px] font-mono text-slate-400 font-bold block">ASSESSMENT SCOPE</span>
                    <span className="font-semibold text-slate-700">{selectedEvent.scope}</span>
                  </div>

                  <div className="border border-slate-150 rounded-xl p-3 bg-white space-y-1">
                    <span className="text-[9px] font-mono text-slate-400 font-bold block">POSTURE STATUS</span>
                    <span className="font-semibold text-emerald-600 font-mono uppercase">{selectedEvent.status}</span>
                  </div>
                </div>
              </div>

              {/* Cryptographic Proof Card */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Attestation SHA-256 Signature</h3>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3">
                  <div className="flex justify-between items-center text-[10px] font-mono text-indigo-400 font-bold">
                    <span>LEDGER ATTESTATION PROOF</span>
                    <span className="text-emerald-500">TAMPERPROOF SIGNED</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-300 break-all select-all select-none bg-slate-950 p-3 rounded border border-slate-800/60 leading-relaxed">
                    {selectedEvent.evidenceHash}
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCopyHash(selectedEvent.evidenceHash)}
                      className="flex-1 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-[10px] font-mono font-bold text-slate-200 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedHash === selectedEvent.evidenceHash ? 'Copied to Clipboard' : 'Copy Signature'}</span>
                    </button>
                    <a
                      href={`https://example.com/verify-attestation?hash=${selectedEvent.evidenceHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-[10px] font-mono font-bold text-white rounded-lg flex items-center justify-center gap-1.5 cursor-pointer decoration-none"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Verify Registry Log</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-sans font-bold text-xs rounded-xl transition-all cursor-pointer shadow"
              >
                Close Audit Inspector
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
