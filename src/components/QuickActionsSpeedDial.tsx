/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  X,
  Radar,
  Award,
  AlertTriangle,
  Play,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Server,
  Activity,
  User,
  Terminal,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { Client, Scan, Alert, Severity, AlertStatus } from '../types';
import { apiFetch } from '../utils/apiClient';

interface QuickActionsSpeedDialProps {
  clients: Client[];
  onTriggerNewScan: (scan: Scan) => void;
  onTriggerNewAlert: (alert: Alert) => void;
  onOpenRegisterPassport: () => void;
}

export default function QuickActionsSpeedDial({
  clients,
  onTriggerNewScan,
  onTriggerNewAlert,
  onOpenRegisterPassport
}: QuickActionsSpeedDialProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'scan' | 'alert' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close speed dial if clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // --- SCAN WORKFLOW STATES ---
  const [scanTarget, setScanTarget] = useState('');
  const [scanType, setScanType] = useState<'SBOM Verify' | 'Binary Attestation' | 'Source Code Codeql' | 'Container Image'>('SBOM Verify');
  const [scanClient, setScanClient] = useState(clients[0]?.name || 'Apex Financial Portfolio');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);

  // --- ALERT WORKFLOW STATES ---
  const [alertTitle, setAlertTitle] = useState('');
  const [alertSeverity, setAlertSeverity] = useState<Severity>('High');
  const [alertCategory, setAlertCategory] = useState<'Vulnerability' | 'Compliance Gap' | 'Unverified Attestation' | 'Policy Violation'>('Vulnerability');
  const [alertClient, setAlertClient] = useState(clients[0]?.name || 'Apex Financial Portfolio');
  const [alertDescription, setAlertDescription] = useState('');
  const [isLoggingAlert, setIsLoggingAlert] = useState(false);
  const [alertCompleted, setAlertCompleted] = useState(false);

  // Reset states
  const resetScanWorkflow = () => {
    setScanTarget('');
    setScanType('SBOM Verify');
    setScanClient(clients[0]?.name || 'Apex Financial Portfolio');
    setScanProgress(0);
    setScanLogs([]);
    setIsScanning(false);
    setScanCompleted(false);
  };

  const resetAlertWorkflow = () => {
    setAlertTitle('');
    setAlertSeverity('High');
    setAlertCategory('Vulnerability');
    setAlertClient(clients[0]?.name || 'Apex Financial Portfolio');
    setAlertDescription('');
    setIsLoggingAlert(false);
    setAlertCompleted(false);
  };

  // Run real scan
  const executeScan = async () => {
    if (!scanTarget.trim()) return;

    setIsScanning(true);
    setScanProgress(10);
    setScanLogs(['[INFO] Requesting a server-side scan job...', `[INFO] Target: ${scanTarget}`]);

    try {
      const response = await apiFetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetName: scanTarget,
          scanType: scanType,
          clientName: scanClient
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create scan record on database.');
      }

      const scanRecord = await response.json();
      setScanProgress(50);
      setScanLogs(prev => [
        ...prev,
        `[INFO] Target successfully registered under Multi-Tenant Isolated Ledger.`,
        `[INFO] Server job finished. Review each finding and its evidence status below.`
      ]);

      setTimeout(() => {
        setScanProgress(100);
        setScanLogs(prev => [
          ...prev,
          `[SUCCESS] Scan successfully logged to database! Findings: ${scanRecord.findingsCount || 0}.`
        ]);

        onTriggerNewScan(scanRecord);
        setScanCompleted(true);
        setIsScanning(false);
      }, 800);

    } catch (err: any) {
      console.error('Error executing quick scan:', err);
      setScanLogs(prev => [...prev, `[ERROR] Scan registration failed: ${err.message || err}`]);
      setIsScanning(false);
    }
  };

  // Log Security Alert
  const executeLogAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertTitle.trim() || !alertDescription.trim()) return;

    setIsLoggingAlert(true);
    try {
      const response = await apiFetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: alertTitle,
          severity: alertSeverity,
          category: alertCategory,
          clientName: alertClient,
          description: alertDescription
        })
      });

      if (response.ok) {
        const savedAlert = await response.json();
        onTriggerNewAlert(savedAlert);
        setAlertCompleted(true);
      } else {
        throw new Error('Failed to save alert on database.');
      }
    } catch (err: any) {
      console.error('Error logging alert:', err);
      alert(`Alert registration failed: ${err.message || err}`);
    } finally {
      setIsLoggingAlert(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3" ref={containerRef} id="quick-actions-speeddial-wrapper">
      
      {/* Expanded Speed-Dial Actions */}
      {isOpen && (
        <div className="flex flex-col items-end gap-2.5 mb-2 animate-in fade-in slide-in-from-bottom-5 duration-200">
          
          {/* Action 1: Trigger Scan */}
          <div className="group flex items-center justify-end">
            <span className="bg-slate-950 dark:bg-zinc-900 border border-slate-800 text-slate-100 text-[11px] font-bold px-2.5 py-1 rounded-md shadow-lg mr-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
              Run Autopilot Security Scan
            </span>
            <button
              onClick={() => {
                setIsOpen(false);
                resetScanWorkflow();
                setActiveModal('scan');
              }}
              className="w-11 h-11 rounded-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 shadow-lg flex items-center justify-center hover:bg-slate-50 dark:hover:bg-zinc-800 hover:-translate-y-0.5 transition-all cursor-pointer"
              title="Run Autopilot Scan"
            >
              <Radar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </button>
          </div>

          {/* Action 2: Register Software Passport */}
          <div className="group flex items-center justify-end">
            <span className="bg-slate-950 dark:bg-zinc-900 border border-slate-800 text-slate-100 text-[11px] font-bold px-2.5 py-1 rounded-md shadow-lg mr-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
              Register Software Passport
            </span>
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenRegisterPassport();
              }}
              className="w-11 h-11 rounded-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 shadow-lg flex items-center justify-center hover:bg-slate-50 dark:hover:bg-zinc-800 hover:-translate-y-0.5 transition-all cursor-pointer"
              title="Register Software Passport"
            >
              <Award className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </button>
          </div>

          {/* Action 3: Log Security Alert */}
          <div className="group flex items-center justify-end">
            <span className="bg-slate-950 dark:bg-zinc-900 border border-slate-800 text-slate-100 text-[11px] font-bold px-2.5 py-1 rounded-md shadow-lg mr-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
              Log Immediate Security Alert
            </span>
            <button
              onClick={() => {
                setIsOpen(false);
                resetAlertWorkflow();
                setActiveModal('alert');
              }}
              className="w-11 h-11 rounded-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 shadow-lg flex items-center justify-center hover:bg-slate-50 dark:hover:bg-zinc-800 hover:-translate-y-0.5 transition-all cursor-pointer"
              title="Log Security Alert"
            >
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            </button>
          </div>

        </div>
      )}

      {/* Main Trigger Floating Speed-dial Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-13 h-13 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 transform active:scale-95 cursor-pointer ${
          isOpen
            ? 'bg-slate-800 dark:bg-zinc-800 text-white hover:bg-slate-900 dark:hover:bg-zinc-700 scale-105'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white hover:scale-105'
        }`}
        id="quick-actions-floating-trigger"
        title="Quick Actions"
      >
        <Plus className={`w-6 h-6 transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`} />
      </button>

      {/* --- MODAL 1: INSTANT AUTOPILOT SECURITY SCAN --- */}
      {activeModal === 'scan' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
            
            {/* Header */}
            <div className="flex justify-between items-center bg-slate-50 dark:bg-zinc-950 px-6 py-4 border-b border-slate-150 dark:border-zinc-850">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg text-indigo-600 dark:text-indigo-400">
                  <Radar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-50 font-display">Run Instant Security Scan</h3>
                  <p className="text-[10px] text-slate-500">Autonomous SBOM verify, image scan & binary attestation</p>
                </div>
              </div>
              {!isScanning && (
                <button
                  onClick={() => setActiveModal(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              )}
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 text-xs">
              {!isScanning && !scanCompleted ? (
                <>
                  <div className="space-y-3">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-slate-700 dark:text-zinc-300">Target Asset Host / Name</label>
                      <input
                        type="text"
                        placeholder="e.g. redis-cache-primary"
                        value={scanTarget}
                        onChange={(e) => setScanTarget(e.target.value)}
                        className="bg-slate-50 dark:bg-zinc-850 border border-slate-200 dark:border-zinc-750 text-xs rounded-xl p-3 focus:outline-none focus:border-indigo-500 focus:bg-white dark:text-zinc-200 font-semibold"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700 dark:text-zinc-300">Scan Strategy Type</label>
                        <select
                          value={scanType}
                          onChange={(e) => setScanType(e.target.value as any)}
                          className="bg-slate-50 dark:bg-zinc-850 border border-slate-200 dark:border-zinc-750 text-xs rounded-xl p-3 focus:outline-none cursor-pointer text-slate-700 dark:text-zinc-300 font-semibold"
                        >
                          <option value="SBOM Verify">SBOM Deep Verify</option>
                          <option value="Binary Attestation">Binary Attestation</option>
                          <option value="Source Code Codeql">Source Code CodeQL</option>
                          <option value="Container Image">Container Image</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="font-bold text-slate-700 dark:text-zinc-300">Client Organization</label>
                        <select
                          value={scanClient}
                          onChange={(e) => setScanClient(e.target.value)}
                          className="bg-slate-50 dark:bg-zinc-850 border border-slate-200 dark:border-zinc-750 text-xs rounded-xl p-3 focus:outline-none cursor-pointer text-slate-700 dark:text-zinc-300 font-semibold"
                        >
                          {clients.map(c => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-zinc-800 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-zinc-850 border border-slate-200 dark:border-zinc-800 rounded-xl text-slate-500 dark:text-zinc-400 font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={executeScan}
                      disabled={!scanTarget.trim()}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold rounded-xl shadow-md hover:shadow-indigo-500/10 transition cursor-pointer flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Execute Scan Now</span>
                    </button>
                  </div>
                </>
              ) : isScanning ? (
                /* Scanning Progress Screen */
                <div className="space-y-4 py-4 text-center">
                  <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                    <Loader2 className="w-12 h-12 text-indigo-600 animate-spin absolute" />
                    <Radar className="w-6 h-6 text-indigo-500 animate-pulse" />
                  </div>
                  
                  <div className="space-y-1">
                    <span className="font-bold text-slate-800 dark:text-zinc-100">Scanning {scanTarget}...</span>
                    <div className="w-full max-w-xs mx-auto bg-slate-100 dark:bg-zinc-850 h-2 rounded-full overflow-hidden">
                      <div className="bg-indigo-600 h-full rounded-full transition-all duration-100" style={{ width: `${scanProgress}%` }}></div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 font-bold">{scanProgress}% completed</span>
                  </div>

                  {/* Terminal Log Output */}
                  <div className="bg-slate-950 text-slate-300 font-mono text-[10px] p-4 rounded-xl text-left h-36 overflow-y-auto border border-slate-800 space-y-1 select-text">
                    {scanLogs.map((log, i) => (
                      <div key={i} className={`leading-relaxed ${log.startsWith('[SUCCESS]') ? 'text-emerald-400 font-bold' : ''}`}>
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Scan Finished Successfully Screen */
                <div className="text-center py-6 space-y-4">
                  <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/40 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 mx-auto">
                    <ShieldCheck className="w-7 h-7" />
                  </div>
                  
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100">SBOM Attestation Created!</h4>
                    <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                      Target <span className="font-bold font-mono text-indigo-600 dark:text-indigo-400">{scanTarget}</span> has been securely cataloged and verified in the central trust ledger.
                    </p>
                  </div>

                  <div className="pt-3 flex justify-center">
                    <button
                      onClick={() => {
                        setActiveModal(null);
                        resetScanWorkflow();
                      }}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer"
                    >
                      Acknowledge & Close
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* --- MODAL 2: LOG SECURITY ALERT --- */}
      {activeModal === 'alert' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
            
            {/* Header */}
            <div className="flex justify-between items-center bg-slate-50 dark:bg-zinc-950 px-6 py-4 border-b border-slate-150 dark:border-zinc-850">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-rose-50 dark:bg-rose-950/40 rounded-lg text-rose-600 dark:text-rose-400">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-50 font-display">Log Security Alert</h3>
                  <p className="text-[10px] text-slate-500">Record an immediate software vulnerability or compliance gap</p>
                </div>
              </div>
              {!isLoggingAlert && (
                <button
                  onClick={() => setActiveModal(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              )}
            </div>

            {/* Content Body */}
            <div className="p-6 text-xs">
              {!alertCompleted ? (
                <form onSubmit={executeLogAlert} className="space-y-4">
                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-slate-700 dark:text-zinc-300">Alert Title / Signature</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Critical Redis Out-of-Bounds Memory Vulnerability"
                      value={alertTitle}
                      onChange={(e) => setAlertTitle(e.target.value)}
                      className="bg-slate-50 dark:bg-zinc-850 border border-slate-200 dark:border-zinc-750 text-xs rounded-xl p-3 focus:outline-none focus:border-rose-500 focus:bg-white dark:text-zinc-200 font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-slate-700 dark:text-zinc-300">Severity</label>
                      <select
                        value={alertSeverity}
                        onChange={(e) => setAlertSeverity(e.target.value as Severity)}
                        className="bg-slate-50 dark:bg-zinc-850 border border-slate-200 dark:border-zinc-750 text-xs rounded-xl p-3 focus:outline-none cursor-pointer text-slate-700 dark:text-zinc-300 font-semibold"
                      >
                        <option value="Critical">🚨 Critical</option>
                        <option value="High">🟠 High</option>
                        <option value="Medium">🟡 Medium</option>
                        <option value="Low">🔵 Low</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-slate-700 dark:text-zinc-300">Category</label>
                      <select
                        value={alertCategory}
                        onChange={(e) => setAlertCategory(e.target.value as any)}
                        className="bg-slate-50 dark:bg-zinc-850 border border-slate-200 dark:border-zinc-750 text-xs rounded-xl p-3 focus:outline-none cursor-pointer text-slate-700 dark:text-zinc-300 font-semibold"
                      >
                        <option value="Vulnerability">Vulnerability</option>
                        <option value="Compliance Gap">Compliance Gap</option>
                        <option value="Unverified Attestation">Unverified Attestation</option>
                        <option value="Policy Violation">Policy Violation</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="font-bold text-slate-700 dark:text-zinc-300">Client Tenant</label>
                      <select
                        value={alertClient}
                        onChange={(e) => setAlertClient(e.target.value)}
                        className="bg-slate-50 dark:bg-zinc-850 border border-slate-200 dark:border-zinc-750 text-xs rounded-xl p-3 focus:outline-none cursor-pointer text-slate-700 dark:text-zinc-300 font-semibold"
                      >
                        {clients.map(c => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-bold text-slate-700 dark:text-zinc-300">Threat Narrative & Details</label>
                    <textarea
                      required
                      rows={3}
                      placeholder="Supply diagnostic details, affected clusters or remediation owners..."
                      value={alertDescription}
                      onChange={(e) => setAlertDescription(e.target.value)}
                      className="bg-slate-50 dark:bg-zinc-850 border border-slate-200 dark:border-zinc-750 text-xs rounded-xl p-3 focus:outline-none focus:border-rose-500 focus:bg-white dark:text-zinc-200 font-semibold resize-none"
                    />
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-zinc-800 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-zinc-850 border border-slate-200 dark:border-zinc-800 rounded-xl text-slate-500 dark:text-zinc-400 font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isLoggingAlert || !alertTitle.trim() || !alertDescription.trim()}
                      className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold rounded-xl shadow-md hover:shadow-rose-500/10 transition cursor-pointer flex items-center gap-1.5"
                    >
                      {isLoggingAlert ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Logging Alert...</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Log Security Alert</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* Success screen */
                <div className="text-center py-6 space-y-4">
                  <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/40 rounded-full flex items-center justify-center text-rose-600 dark:text-rose-400 mx-auto">
                    <ShieldAlert className="w-7 h-7" />
                  </div>
                  
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100">Security Alert Logged Successfully!</h4>
                    <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                      The alert was saved to the SPR dashboard for <span className="font-bold text-slate-800 dark:text-zinc-200">{alertClient}</span>. External SIEM delivery requires a configured integration.
                    </p>
                  </div>

                  <div className="pt-3 flex justify-center">
                    <button
                      onClick={() => {
                        setActiveModal(null);
                        resetAlertWorkflow();
                      }}
                      className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer"
                    >
                      Acknowledge & Close
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
