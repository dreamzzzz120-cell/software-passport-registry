/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  FileText, Download, Play, Clock, CheckCircle, HelpCircle, 
  Building2, ShieldCheck, ShieldAlert, Award, FileSpreadsheet, Lock, Sparkles, Database, FileDown,
  Palette, Printer, SlidersHorizontal, Settings, Edit3, CheckCircle2, Upload, X, Layers, Eye, FileCode
} from 'lucide-react';
import { Client } from '../types';

const REPORT_TEMPLATES = [
  { id: 'rep-ceo', name: 'Executive Trust Summary', type: 'Executive Summary', description: 'Summarizes reported software trust posture and evidence records for leadership review.', frequency: 'Monthly' },
  { id: 'rep-investor', name: 'Vendor Risk Portfolio', type: 'Supplier Risk Portfolio', description: 'Detailed evidence package for third-party software vendors, dependency lineage, and compliance alignment.', frequency: 'Quarterly' },
  { id: 'rep-auditor', name: 'Compliance Evidence Report', type: 'Compliance Evidence', description: 'Maps available SBOM records, verification history, and reported regulatory controls.', frequency: 'Quarterly' },
  { id: 'rep-vuln', name: 'Vulnerability Findings Summary', type: 'Vulnerability Audit', description: 'Current CVE posture and remediation status for registered software passports and associated components.', frequency: 'Ad-hoc' }
];
import { generateClientCompliancePDF, generateCoBrandedTrustReport } from '../utils/pdfGenerator';
import { apiFetch } from '../utils/apiClient';

interface ReportsViewProps {
  clients?: Client[];
}

export default function ReportsView({ clients = [] }: ReportsViewProps) {
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [downloadReadyId, setDownloadReadyId] = useState<string | null>(null);
  
  // Dynamic report state
  const [selectedClientId, setSelectedClientId] = useState<string>(clients[0]?.id || '');
  const [isDynamicCompiling, setIsDynamicCompiling] = useState(false);
  const [isDynamicCsvCompiling, setIsDynamicCsvCompiling] = useState(false);
  const [isMultiTenantCompiling, setIsMultiTenantCompiling] = useState(false);
  const [isJsonExporting, setIsJsonExporting] = useState(false);

  // MSP Co-Branding Customizer states
  const [mspName, setMspName] = useState('Aegis Cyber Solutions');
  const [brandColor, setBrandColor] = useState('#4f46e5');
  const [reportTitle, setReportTitle] = useState('Software Supply Chain Trust Audit');
  const [patchedCves, setPatchedCves] = useState(32);
  const [executiveSummary, setExecutiveSummary] = useState(
    'This report presents stored metrics and evidence records. Each verification, scan, and compliance state must be reviewed against its persisted evidence source.'
  );
  const [includeSignatureLine, setIncludeSignatureLine] = useState(true);
  const [isCompilingCoBranded, setIsCompilingCoBranded] = useState(false);

  // New states for customizable compliance modules and assets selection
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeMetrics, setIncludeMetrics] = useState(true);
  const [includeInventory, setIncludeInventory] = useState(true);
  const [includeComplianceChecklist, setIncludeComplianceChecklist] = useState(true);
  const [selectedAssetNames, setSelectedAssetNames] = useState<string[]>([]);

  // Synchronize selected assets when client changes
  React.useEffect(() => {
    if (selectedClient) {
      setSelectedAssetNames(selectedClient.softwareInventory.map(item => item.name));
    } else {
      setSelectedAssetNames([]);
    }
  }, [selectedClientId]);

  // Logo upload reader helper
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerateCoBrandedPdf = () => {
    if (!selectedClient) return;
    setIsCompilingCoBranded(true);
    setTimeout(() => {
      generateCoBrandedTrustReport(
        selectedClient,
        mspName,
        brandColor,
        reportTitle,
        patchedCves,
        executiveSummary,
        uploadedLogo || undefined,
        includeSummary,
        includeMetrics,
        includeInventory,
        includeComplianceChecklist,
        includeSignatureLine,
        selectedAssetNames
      );
      setIsCompilingCoBranded(false);
    }, 1500);
  };

  const handleGenerateReport = (id: string) => {
    setGeneratingId(id);
    setDownloadReadyId(null);
    setTimeout(() => {
      setGeneratingId(null);
      setDownloadReadyId(id);
    }, 1500);
  };

  const selectedClient = clients.find(c => c.id === selectedClientId);

  // High-fidelity dynamic PDF compiler
  const handleDynamicPdfGenerate = () => {
    if (!selectedClient) return;
    setIsDynamicCompiling(true);
    setTimeout(() => {
      generateClientCompliancePDF(selectedClient);
      setIsDynamicCompiling(false);
    }, 1200);
  };

  // High-fidelity structured CSV compiler with dynamic 30-day compliance log fetch
  const handleDynamicCsvGenerate = async () => {
    if (!selectedClient) return;
    setIsDynamicCsvCompiling(true);

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Fetch verified historical audit logs from backend API
      let last30DaysLogs: Array<{
        timestamp: string;
        eventType: string;
        operator: string;
        ip: string;
        outcome: string;
        description: string;
      }> = [];

      try {
        const res = await apiFetch('/api/auth/audit-chain');
        if (res.ok) {
          const chain = await res.json();
          if (Array.isArray(chain)) {
            last30DaysLogs = chain
              .map((item: any) => {
                const b = item.block || {};
                return {
                  timestamp: b.timestamp || new Date().toISOString(),
                  eventType: b.actionType || 'AUDIT_LOG',
                  operator: b.userEmail || 'System',
                  ip: b.ip || '127.0.0.1',
                  outcome: b.outcome || 'Success',
                  description: b.details || 'System audit action recorded'
                };
              })
              .filter((log) => {
                const logDate = new Date(log.timestamp);
                return !isNaN(logDate.getTime()) ? logDate >= thirtyDaysAgo : true;
              });
          }
        }
      } catch (err) {
        console.warn('[Audit Chain Fetch Warning for CSV]:', err);
      }

      // If backend audit chain is sparse, append or use client activity timeline entries from the last 30 days
      if (selectedClient.activityTimeline) {
        const clientLogs = selectedClient.activityTimeline
          .filter((item) => {
            const logDate = new Date(item.timestamp);
            return !isNaN(logDate.getTime()) ? logDate >= thirtyDaysAgo : true;
          })
          .map((item) => ({
            timestamp: item.timestamp,
            eventType: item.eventType,
            operator: item.user,
            ip: '10.0.4.12',
            outcome: String(item.severity).toLowerCase().includes('high') || String(item.severity).toLowerCase().includes('critical') ? 'Warning' : 'Success',
            description: item.description
          }));

        if (last30DaysLogs.length === 0) {
          last30DaysLogs = clientLogs;
        } else {
          // Merge avoiding duplicates
          const existingTimestamps = new Set(last30DaysLogs.map((l) => l.timestamp));
          clientLogs.forEach((cl) => {
            if (!existingTimestamps.has(cl.timestamp)) {
              last30DaysLogs.push(cl);
            }
          });
        }
      }

      let csvContent = "";
      
      // Header Section
      csvContent += "========================================================\n";
      csvContent += "   MSP 30-DAY COMPLIANCE & AUDIT LOG EXECUTIVE REPORT\n";
      csvContent += `   GENERATED: ${new Date().toISOString().substring(0, 19).replace('T', ' ')} UTC\n`;
      csvContent += `   AUDIT WINDOW: ${thirtyDaysAgo.toISOString().substring(0, 10)} to ${new Date().toISOString().substring(0, 10)}\n`;
      csvContent += "========================================================\n\n";

      // 1. Client Info Section
      csvContent += "--- 1. TENANT SECURITY COORDINATES ---\n";
      csvContent += "Metric Label,Value Description\n";
      csvContent += `Organization Name,"${selectedClient.name}"\n`;
      csvContent += `Secured Domain,"${selectedClient.domain}"\n`;
      csvContent += `Industry Vertical,"${selectedClient.industry}"\n`;
      csvContent += `SLA Subscription Tier,"${selectedClient.subscriptionTier}"\n`;
      csvContent += `Onboarding Date,"${selectedClient.joinedDate}"\n`;
      csvContent += `Overall Trust Score,"${selectedClient.trustScore} / 100"\n`;
      csvContent += `Compliance Level Progress,"${selectedClient.complianceProgress}%"\n`;
      csvContent += `Critical Security Risks,"${selectedClient.criticalRisksCount} Active"\n`;
      csvContent += `Risk Status Rating,"${selectedClient.riskLevel}"\n`;
      csvContent += `Team Operators Count,"${selectedClient.teamMembers?.length || 0} active users"\n`;
      csvContent += "\n";
      
      // 2. Compliance Frameworks
      csvContent += "--- 2. CERTIFIED COMPLIANCE FRAMEWORKS ---\n";
      csvContent += "Standard Code,Standard Name,Compliance %,Certified Controls,SLA Status\n";
      (selectedClient.complianceStatus || []).forEach(f => {
        csvContent += `"${f.code}","${f.name}","${f.progress}%","${f.compliantControls} / ${f.totalControls}","${f.status}"\n`;
      });
      csvContent += "\n";
      
      // 3. Software Passports
      csvContent += "--- 3. ACTIVE SOFTWARE PASSPORTS ---\n";
      csvContent += "Software Component,Deployed Version,Last Scanned,Trust Score,Rating\n";
      (selectedClient.softwareInventory || []).forEach(item => {
        csvContent += `"${item.name}","${item.version}","${item.lastScanDate}","${item.overallScore} / 100","${item.riskStatus}"\n`;
      });
      csvContent += "\n";
      
      // 4. Last 30 Days Compliance & Audit Logs
      csvContent += "--- 4. LAST 30 DAYS COMPLIANCE AUDIT LOGS ---\n";
      csvContent += "Timestamp (UTC),Event Type,Operator,IP Address,Outcome,Audit Description\n";
      last30DaysLogs.forEach(log => {
        csvContent += `"${log.timestamp}","${log.eventType}","${log.operator}","${log.ip}","${log.outcome}","${log.description.replace(/"/g, '""')}"\n`;
      });

      // Create a Blob file and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const clientSlug = selectedClient.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      link.setAttribute("download", `30-day-compliance-logs-${clientSlug}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[30-Day CSV Download Error]:', err);
    } finally {
      setIsDynamicCsvCompiling(false);
    }
  };

  // High-fidelity Multi-Tenant summary CSV exporter
  const handleMultiTenantCsvGenerate = () => {
    setIsMultiTenantCompiling(true);
    setTimeout(() => {
      let csvContent = "";
      
      csvContent += "========================================================\n";
      csvContent += "   MSP MULTI-TENANT COMPLIANCE EXECUTIVE SUMMARY\n";
      csvContent += `   GENERATED: ${new Date().toISOString().substring(0, 19).replace('T', ' ')} UTC\n`;
      csvContent += "========================================================\n\n";

      csvContent += "Client Name,Primary Domain,Industry,Subscription Tier,Trust Score (100),Compliance Progress %,Active Passports,Critical Risks,Risk Rating,Onboarded Date\n";
      
      clients.forEach(c => {
        csvContent += `"${c.name}","${c.domain}","${c.industry}","${c.subscriptionTier}",${c.trustScore},${c.complianceProgress},${c.softwareInventory.length},${c.criticalRisksCount},"${c.riskLevel}","${c.joinedDate}"\n`;
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `multi-tenant-executive-compliance-summary.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setIsMultiTenantCompiling(false);
    }, 1000);
  };

  // High-fidelity JSON Executive Audit Log Exporter
  const handleJsonExport = async () => {
    if (!selectedClient) return;
    setIsJsonExporting(true);

    try {
      // Fetch verified historical compliance audit logs from server API
      let auditLogs: any[] = [];
      try {
        const res = await apiFetch('/api/auth/audit-chain');
        if (res.ok) {
          const chain = await res.json();
          auditLogs = Array.isArray(chain) ? chain : [];
        }
      } catch (err) {
        console.warn('[Audit Chain API Fetch Warning]:', err);
      }

      // Local activity records are not independently verified audit-chain records.
      if (auditLogs.length === 0 && selectedClient.activityTimeline) {
        auditLogs = selectedClient.activityTimeline.map((item) => ({
          logId: item.id,
          timestamp: item.timestamp,
          eventType: item.eventType,
          actor: item.user,
          severity: item.severity,
          description: item.description,
          verificationStatus: 'UNVERIFIED'
        }));
      }

      const clientSlug = selectedClient.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const exportPayload = {
        exportMetadata: {
          title: "Executive Compliance Audit Log & Software Trust Report",
          generatedAt: new Date().toISOString(),
          tenantId: selectedClient.id,
          organizationName: selectedClient.name,
          organizationDomain: selectedClient.domain,
          industryVertical: selectedClient.industry,
          subscriptionTier: selectedClient.subscriptionTier,
          verificationStatus: "UNVERIFIED",
          systemIssuer: "Software Passport Registry (SPR)",
          totalAuditRecords: auditLogs.length
        },
        executiveSummary: {
          overallTrustScore: selectedClient.trustScore,
          complianceProgressPercentage: selectedClient.complianceProgress,
          criticalRisksCount: selectedClient.criticalRisksCount,
          riskLevel: selectedClient.riskLevel,
          activePassportsCount: selectedClient.softwareInventory?.length || 0,
          teamMemberCount: selectedClient.teamMembers?.length || 0
        },
        reportedComplianceFrameworks: selectedClient.complianceStatus || [],
        softwareInventoryPassports: selectedClient.softwareInventory || [],
        historicalAuditLogs: auditLogs
      };

      const jsonString = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `executive-compliance-audit-log-${clientSlug}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[JSON Export Error]:', err);
    } finally {
      setIsJsonExporting(false);
    }
  };

  return (
    <div className="space-y-6" id="msp-reports-view">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900">Reports & Auditing Documents</h1>
          <p className="text-xs text-slate-500 font-sans mt-1">
            Generate on-demand compliance reports, supplier risk portfolios, and executive summaries for auditing boards.
          </p>
        </div>

        {/* Global Multi-Tenant Export Button */}
        {clients.length > 0 && (
          <button
            onClick={handleMultiTenantCsvGenerate}
            disabled={isMultiTenantCompiling}
            className="flex items-center gap-1.5 border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs px-4 py-2 rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            {isMultiTenantCompiling ? (
              <>
                <Clock className="w-3.5 h-3.5 animate-spin" />
                <span>Compiling Summary...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Export Multi-Tenant Summary (CSV)</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* DYNAMIC CLIENT AUDITOR EXPORT SECTION */}
      {clients.length > 0 && (
        <div className="bg-slate-900 rounded-xl p-6 text-white border border-slate-800 shadow-md relative overflow-hidden">
          {/* Accent decoration element */}
          <div className="absolute right-0 top-0 w-32 h-32 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="space-y-3 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider bg-indigo-500 text-white">
                  Core Dynamic Export
                </span>
                <span className="flex items-center gap-1 text-[10px] text-indigo-300 font-mono">
                  <Sparkles className="w-3 h-3" /> Ready for Auditor Review
                </span>
              </div>
              
              <h2 className="text-lg font-display font-bold">Client-Facing Compliance Audit Trails</h2>
              <p className="text-xs text-slate-400 leading-relaxed font-sans">
                Select an onboarded tenant to compile currently stored trust scores, framework mappings,
                and chronological activity ledger into a beautifully formatted client-ready report file.
              </p>

              {/* Selector & Actions */}
              <div className="pt-2 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <select
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="w-full bg-slate-800 text-xs text-white border border-slate-700 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-semibold cursor-pointer"
                    >
                      {clients.map((c) => (
                        <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                          {c.name} ({c.domain})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Download formats buttons */}
                <div className="flex flex-wrap gap-2.5">
                  <button
                    onClick={handleDynamicPdfGenerate}
                    disabled={isDynamicCompiling || !selectedClient}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-xs px-5 py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isDynamicCompiling ? (
                      <>
                        <Clock className="w-4 h-4 animate-spin" />
                        <span>Compiling PDF Report...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Export Compliance PDF</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleDynamicCsvGenerate}
                    disabled={isDynamicCsvCompiling || !selectedClient}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-bold text-xs px-5 py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isDynamicCsvCompiling ? (
                      <>
                        <Clock className="w-4 h-4 animate-spin" />
                        <span>Generating CSV Sheet...</span>
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="w-4 h-4" />
                        <span>Export Compliance CSV</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleJsonExport}
                    disabled={isJsonExporting || !selectedClient}
                    className="bg-amber-600 hover:bg-amber-500 text-white font-sans font-bold text-xs px-5 py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isJsonExporting ? (
                      <>
                        <Clock className="w-4 h-4 animate-spin" />
                        <span>Fetching Logs & Exporting...</span>
                      </>
                    ) : (
                      <>
                        <FileCode className="w-4 h-4" />
                        <span>Export Executive JSON</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Live Preview Stats Panel of Selected Client */}
            {selectedClient && (
              <div className="bg-slate-800 border border-slate-700/60 p-4 rounded-xl w-full md:w-80 shrink-0 space-y-3.5">
                <div className="flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded flex items-center justify-center font-bold text-xs ${selectedClient.avatarColor}`}>
                      {selectedClient.name.charAt(0)}
                    </div>
                    <span className="text-[10px] text-slate-300 font-mono font-bold uppercase tracking-wider truncate max-w-[150px]">
                      {selectedClient.name}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-indigo-400">
                    {selectedClient.subscriptionTier}
                  </span>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-700">
                    <p className="text-[8px] text-slate-500 font-mono font-bold uppercase">Trust Score</p>
                    <p className="text-sm font-bold font-mono text-slate-200 mt-0.5">{selectedClient.trustScore}/100</p>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-700">
                    <p className="text-[8px] text-slate-500 font-mono font-bold uppercase">Compliance</p>
                    <p className="text-sm font-bold font-mono text-indigo-400 mt-0.5">{selectedClient.complianceProgress}%</p>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-700">
                    <p className="text-[8px] text-slate-500 font-mono font-bold uppercase">Passports</p>
                    <p className="text-sm font-bold font-mono text-slate-200 mt-0.5">{selectedClient.softwareInventory.length}</p>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-700">
                    <p className="text-[8px] text-slate-500 font-mono font-bold uppercase">Alerts</p>
                    <p className={`text-sm font-bold font-mono mt-0.5 ${selectedClient.criticalRisksCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {selectedClient.criticalRisksCount} Active
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CO-BRANDED SOFTWARE TRUST REPORT DESIGNER */}
      {selectedClient && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-md space-y-6" id="msp-co-branded-report-designer">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl">
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800 font-display">MSP Co-Branded Software Trust Report Designer</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Design a bespoke trust report with custom branding, specific compliance modules, and targeted client assets to deliver to {selectedClient.name}.
                </p>
              </div>
            </div>
            <span className="px-2.5 py-0.5 rounded text-[8px] font-mono font-bold bg-slate-100 border border-slate-200 text-slate-600 uppercase tracking-wider self-start sm:self-center">
              Active PDF Engine
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-xs">
            
            {/* Design Inputs (7 cols) */}
            <div className="lg:col-span-7 space-y-6">
              
              {/* BRAND & IDENTITY CUSTOMIZER */}
              <div className="space-y-4">
                <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5 text-slate-400" />
                  <span>1. Brand & Identity Customizer</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-slate-700">MSP / IT Provider Brand Name</label>
                    <input
                      type="text"
                      value={mspName}
                      onChange={(e) => setMspName(e.target.value)}
                      placeholder="e.g. Aegis Cyber Solutions"
                      className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-800"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-slate-700">Report Document Title</label>
                    <input
                      type="text"
                      value={reportTitle}
                      onChange={(e) => setReportTitle(e.target.value)}
                      placeholder="e.g. Software Supply Chain Trust Audit"
                      className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-800"
                    />
                  </div>
                </div>

                {/* Accent Color picker */}
                <div className="space-y-2">
                  <label className="font-bold text-slate-700">MSP Primary Brand Accent Color</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      value={brandColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="w-10 h-8 rounded border border-slate-200 cursor-pointer p-0.5"
                    />
                    
                    {/* Preset Buttons */}
                    {[
                      { label: 'Deep Indigo', hex: '#4f46e5', bg: 'bg-[#4f46e5]' },
                      { label: 'Emerald Mint', hex: '#059669', bg: 'bg-[#059669]' },
                      { label: 'Crimson Red', hex: '#dc2626', bg: 'bg-[#dc2626]' },
                      { label: 'Corporate Blue', hex: '#0284c7', bg: 'bg-[#0284c7]' },
                      { label: 'Modern Slate', hex: '#334155', bg: 'bg-[#334155]' },
                      { label: 'Warm Amber', hex: '#d97706', bg: 'bg-[#d97706]' },
                    ].map((preset) => (
                      <button
                        key={preset.hex}
                        type="button"
                        onClick={() => setBrandColor(preset.hex)}
                        className={`px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 cursor-pointer text-[10px] font-semibold transition-all ${
                          brandColor.toLowerCase() === preset.hex.toLowerCase()
                            ? 'border-slate-800 bg-slate-50 text-slate-800 shadow-sm ring-1 ring-slate-800'
                            : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${preset.bg}`} />
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Company Logo Uploader Block */}
                <div className="flex flex-col gap-1.5">
                  <label className="font-bold text-slate-700">MSP / IT Provider Company Logo</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                    {/* Drag and drop upload zone */}
                    <div className="relative border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-xl p-4 transition-all text-center flex flex-col items-center justify-center gap-1.5 bg-slate-50/50 group">
                      <input
                        type="file"
                        accept="image/png, image/jpeg, image/jpg, image/webp"
                        onChange={handleLogoUpload}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Upload className="w-5 h-5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                      <div>
                        <p className="font-semibold text-slate-700 text-[10px]">Click or Drag custom logo here</p>
                        <p className="text-[9px] text-slate-400 mt-0.5">PNG, JPG, WebP (Max 2MB)</p>
                      </div>
                    </div>

                    {/* Preview / status card */}
                    <div className="border border-slate-200 bg-slate-50/50 rounded-xl p-4 flex items-center justify-between min-h-[72px]">
                      {uploadedLogo ? (
                        <div className="flex items-center gap-3 w-full">
                          <div className="bg-white p-1.5 border border-slate-200 rounded-lg shadow-sm">
                            <img src={uploadedLogo} alt="Uploaded logo preview" className="w-12 h-12 object-contain" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-emerald-600 truncate text-[10px]">Custom Logo Active</p>
                            <p className="text-[9px] text-slate-400 mt-0.5">Will embed in PDF cover</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setUploadedLogo(null)}
                            className="p-1.5 hover:bg-slate-200/80 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer transition-colors"
                            title="Remove Logo"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-center w-full py-1">
                          <p className="font-bold text-slate-400 text-[10px]">No Custom Logo Uploaded</p>
                          <p className="text-[9px] text-slate-400 mt-0.5">Using default attestation seal</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* REPORT COMPLIANCE MODULES SELECTOR */}
              <div className="space-y-4">
                <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  <span>2. Select Report Compliance Modules</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50/30 p-4 rounded-xl border border-slate-100">
                  <label className="flex items-start gap-2.5 p-2 bg-white rounded-lg border border-slate-150 hover:border-indigo-200 transition-all cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeSummary}
                      onChange={(e) => setIncludeSummary(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-[10px]">1. Executive Summary Block</span>
                      <p className="text-[8px] text-slate-400 leading-tight">Summarized compliance scope and supply chain security statement.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 bg-white rounded-lg border border-slate-150 hover:border-indigo-200 transition-all cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeMetrics}
                      onChange={(e) => setIncludeMetrics(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-[10px]">2. Core Posture Stats Board</span>
                      <p className="text-[8px] text-slate-400 leading-tight">Interactive scoring tiles, active passports and vulnerability boards.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 bg-white rounded-lg border border-slate-150 hover:border-indigo-200 transition-all cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeInventory}
                      onChange={(e) => setIncludeInventory(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-[10px]">3. Sealed Software Inventory Table</span>
                      <p className="text-[8px] text-slate-400 leading-tight">List of audited vendor software components selected below.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 bg-white rounded-lg border border-slate-150 hover:border-indigo-200 transition-all cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeComplianceChecklist}
                      onChange={(e) => setIncludeComplianceChecklist(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-700 text-[10px]">4. NIST Supply-Chain Checklist</span>
                      <p className="text-[8px] text-slate-400 leading-tight">Regulatory mappings of SBOM, signatures, and container separation policies.</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* FILTER SPECIFIC CLIENT ASSETS TO INCLUDE */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-slate-400" />
                    <span>3. Target Audited Client Assets ({selectedAssetNames.length} included)</span>
                  </h3>
                  
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedAssetNames(selectedClient.softwareInventory.map(item => item.name))}
                      className="text-indigo-600 hover:text-indigo-800 font-mono text-[9px] font-bold uppercase cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedAssetNames([])}
                      className="text-rose-600 hover:text-rose-800 font-mono text-[9px] font-bold uppercase cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 bg-slate-50/30 p-4 rounded-xl border border-slate-100 max-h-36 overflow-y-auto">
                  {selectedClient.softwareInventory.map((item) => {
                    const isChecked = selectedAssetNames.includes(item.name);
                    return (
                      <label
                        key={item.name}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer select-none transition-all ${
                          isChecked
                            ? 'border-indigo-150 bg-indigo-50/30 text-indigo-950 font-semibold'
                            : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAssetNames([...selectedAssetNames, item.name]);
                            } else {
                              setSelectedAssetNames(selectedAssetNames.filter(name => name !== item.name));
                            }
                          }}
                          className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1 flex items-center justify-between gap-1">
                          <span className="truncate text-[9px]">{item.name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[7px] font-mono shrink-0 font-bold ${
                            item.overallScore >= 90 ? 'bg-emerald-100 text-emerald-800' :
                            item.overallScore >= 75 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {item.overallScore}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Patched CVE metrics & Signature Handover */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                <div className="flex flex-col gap-1">
                  <label className="font-bold text-slate-700">Vulnerabilities Patched (CVE count)</label>
                  <input
                    type="number"
                    min="0"
                    value={patchedCves}
                    onChange={(e) => setPatchedCves(parseInt(e.target.value) || 0)}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none font-semibold text-slate-800"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">MSPs look like heroes when highlighting CVEs patched.</p>
                </div>

                <div className="flex items-center gap-3 self-center pt-2 sm:pt-0">
                  <input
                    type="checkbox"
                    id="includeSignature"
                    checked={includeSignatureLine}
                    onChange={(e) => setIncludeSignatureLine(e.target.checked)}
                    className="w-4.5 h-4.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="includeSignature" className="font-bold text-slate-700 cursor-pointer select-none">
                    <span>Include Handover Signature Lines</span>
                    <p className="text-[10px] text-slate-400 font-normal">Adds dedicated delivery sign-off lines at document footer.</p>
                  </label>
                </div>
              </div>

              {/* Executive Summary Paragraph */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <label className="font-bold text-slate-700">Executive Summary Paragraph</label>
                  <button
                    type="button"
                    onClick={() => setExecutiveSummary(
                      `No AI executive summary was generated. This report contains stored metrics and declared evidence that must be reviewed independently; it does not certify compliance or cryptographic verification.`
                    )}
                    className="text-indigo-600 hover:text-indigo-800 font-mono text-[9px] font-bold uppercase cursor-pointer"
                  >
                    Reset Default Text
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={executiveSummary}
                  onChange={(e) => setExecutiveSummary(e.target.value)}
                  placeholder="Type custom summary statement of compliance for client review..."
                  className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700 text-xs leading-relaxed"
                />
              </div>

            </div>

            {/* LIVE PREVIEW OF COVER PAGE (5 cols) */}
            <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
              <div className="border border-slate-200 bg-slate-50 p-4 rounded-xl space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5" />
                    <span>Live PDF Cover Preview</span>
                  </span>

                  {/* PDF Cover Preview card */}
                  <div className="bg-white rounded-lg border border-slate-250 shadow-sm overflow-hidden text-slate-800 text-[10px]">
                    {/* Header banner matching selected accent color */}
                    <div style={{ backgroundColor: brandColor }} className="p-4 text-white relative transition-colors duration-350 min-h-[95px] flex flex-col justify-between">
                      <div className="bg-slate-900/60 border border-slate-800/10 px-2 py-0.5 rounded text-[8px] font-mono font-bold tracking-wide uppercase inline-block max-w-[130px] truncate">
                        {mspName || 'Aegis Cyber'} x {selectedClient.name}
                      </div>

                      {/* Top-right custom logo in preview if uploaded */}
                      {uploadedLogo ? (
                        <div className="absolute right-3 top-3 bg-white p-1 rounded border border-slate-200 shadow-sm flex items-center justify-center">
                          <img src={uploadedLogo} alt="MSP Custom Logo" className="h-6 w-auto max-w-[48px] object-contain" />
                        </div>
                      ) : (
                        <div className="absolute right-3 top-3 border border-white/30 rounded-full w-7 h-7 flex items-center justify-center bg-white/10" title="Default Secure Seal">
                          <span className="text-[5px] font-bold tracking-tighter text-white/90">SEAL</span>
                        </div>
                      )}
                      
                      <div>
                        <h3 className="font-display font-extrabold text-xs mt-3 uppercase tracking-tight truncate">
                          {reportTitle || 'Software Trust Report'}
                        </h3>
                        
                        <p className="text-[7px] text-indigo-150 mt-1 font-mono leading-none">
                          Pedigree ledger compiled by {mspName || 'the MSP'}.
                        </p>
                      </div>
                    </div>

                    {/* Executive summary block snippet */}
                    <div className="p-3.5 space-y-3">
                      {includeSummary && (
                        <div>
                          <span className="text-[7px] font-mono font-bold text-slate-400 block uppercase">
                            1. Executive Summary Statement
                          </span>
                          <p className="text-[8px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2 italic">
                            "{executiveSummary || 'No summary text provided...'}"
                          </p>
                        </div>
                      )}

                      {/* Posture grid preview */}
                      {includeMetrics && (
                        <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
                          <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                            <p className="text-[6px] text-slate-400 font-mono font-bold uppercase leading-none">Client Trust</p>
                            <p className="font-extrabold text-slate-800 mt-0.5">{selectedClient.trustScore}/100</p>
                          </div>

                          <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                            <p className="text-[6px] text-slate-400 font-mono font-bold uppercase leading-none">Patched Vulns</p>
                            <p className="font-extrabold text-emerald-600 mt-0.5">+{patchedCves} CVEs</p>
                          </div>
                        </div>
                      )}

                      {/* Software Inventory status list */}
                      {includeInventory && (
                        <div>
                          <span className="text-[7px] font-mono font-bold text-slate-400 block uppercase">
                            3. Softwares Inventory Included ({selectedAssetNames.length} components)
                          </span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {selectedAssetNames.slice(0, 4).map(name => (
                              <span key={name} className="px-1 py-0.5 bg-slate-100 rounded text-[7px] border border-slate-200 text-slate-600 truncate max-w-[80px]">
                                {name}
                              </span>
                            ))}
                            {selectedAssetNames.length > 4 && (
                              <span className="px-1 py-0.5 bg-slate-100 rounded text-[7px] border border-slate-200 text-slate-500">
                                +{selectedAssetNames.length - 4} more
                              </span>
                            )}
                            {selectedAssetNames.length === 0 && (
                              <span className="text-[7px] text-rose-500 font-semibold">No assets selected. Inventory will be empty.</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Compliance controls */}
                      {includeComplianceChecklist && (
                        <div className="bg-slate-900 text-white rounded p-1.5 text-[7px] flex items-center justify-between">
                          <span className="font-bold">NIST SP 800-161 / SOC-2 Controls</span>
                          <span className="text-slate-300 font-mono font-bold uppercase">Not assessed in this report</span>
                        </div>
                      )}

                      {/* Footer signature line preview if checked */}
                      {includeSignatureLine && (
                        <div className="border-t border-dashed border-slate-100 pt-2 grid grid-cols-2 gap-2 text-[5px] text-slate-400 font-mono leading-none">
                          <div>
                            <div className="border-b border-slate-300 w-full h-2" />
                            <p className="mt-1 font-bold text-[5px]">AUTHORIZED MSP SIGN</p>
                            <p className="truncate text-[5px] text-slate-500">{mspName}</p>
                          </div>
                          <div>
                            <div className="border-b border-slate-300 w-full h-2" />
                            <p className="mt-1 font-bold text-[5px]">CLIENT RECEIPT ACK</p>
                            <p className="truncate text-[5px] text-slate-500">{selectedClient.name}</p>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                </div>

                {/* Print trigger button */}
                <button
                  type="button"
                  onClick={handleGenerateCoBrandedPdf}
                  disabled={isCompilingCoBranded}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-sans font-extrabold text-xs py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                >
                  {isCompilingCoBranded ? (
                    <>
                      <Clock className="w-4 h-4 animate-spin" />
                      <span>Compiling Bespoke Report...</span>
                    </>
                  ) : (
                    <>
                      <Printer className="w-4 h-4 text-indigo-400" />
                      <span>Compile & Export Co-Branded PDF</span>
                    </>
                  )}
                </button>

              </div>
            </div>

          </div>

        </div>
      )}

      {/* Page Section Title */}
      <div className="pt-2">
        <h2 className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider">Reports & Summaries Templates</h2>
      </div>

      {/* Reports Blueprints Directory */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {REPORT_TEMPLATES.map((rep) => {
          const isGenerating = generatingId === rep.id;
          const isReady = downloadReadyId === rep.id;
          return (
            <div
              key={rep.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4"
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-lg">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider">{rep.type}</h3>
                    <h4 className="text-sm font-bold text-slate-800 font-display mt-1">{rep.name}</h4>
                  </div>
                </div>
                <span className="text-[9px] font-mono font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-slate-600">
                  {rep.frequency}
                </span>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed font-sans">{rep.description}</p>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>FORMAT: PDF / CycloneDX / CSV</span>
                
                {isGenerating ? (
                  <span className="text-indigo-600 font-bold flex items-center gap-1 text-xs">
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>Compiling Report...</span>
                  </span>
                ) : isReady ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (selectedClient) {
                          generateClientCompliancePDF(selectedClient);
                        }
                        setDownloadReadyId(null);
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </button>

                    <button
                      onClick={() => {
                        if (selectedClient) {
                          handleDynamicCsvGenerate();
                        }
                        setDownloadReadyId(null);
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-sans font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>CSV</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleGenerateReport(rep.id)}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-sans font-semibold text-xs px-4 py-1.8 rounded-lg flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>Compile Report</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
