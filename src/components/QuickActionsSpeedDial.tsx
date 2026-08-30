/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Award, CheckCircle2, Loader2, Play, Plus, Radar, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { Client, Scan, Alert, Severity } from '../types';
import { apiFetch } from '../utils/apiClient';

interface QuickActionsSpeedDialProps {
  clients: Client[];
  onTriggerNewScan: (scan: Scan) => void;
  onTriggerNewAlert: (alert: Alert) => void;
  onOpenRegisterPassport: () => void;
}

type Job = {
  id: string;
  status: string;
  progress?: number;
  result?: { findingsCount?: number | null } | null;
  error?: string | null;
};

const TERMINAL = new Set(['Completed', 'Failed']);

export default function QuickActionsSpeedDial({ clients, onTriggerNewScan, onTriggerNewAlert, onOpenRegisterPassport }: QuickActionsSpeedDialProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'scan' | 'alert' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scanTarget, setScanTarget] = useState('');
  const [scanClient, setScanClient] = useState(clients[0]?.name || '');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertSeverity, setAlertSeverity] = useState<Severity>('High');
  const [alertCategory, setAlertCategory] = useState<'Vulnerability' | 'Compliance Gap' | 'Unverified Attestation' | 'Policy Violation'>('Vulnerability');
  const [alertClient, setAlertClient] = useState(clients[0]?.name || '');
  const [alertDescription, setAlertDescription] = useState('');
  const [isLoggingAlert, setIsLoggingAlert] = useState(false);
  const [alertCompleted, setAlertCompleted] = useState(false);

  useEffect(() => {
    if (!scanClient && clients[0]) setScanClient(clients[0].name);
    if (!alertClient && clients[0]) setAlertClient(clients[0].name);
  }, [clients, scanClient, alertClient]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resetScan = () => {
    setScanTarget('');
    setScanClient(clients[0]?.name || '');
    setScanProgress(0);
    setScanLogs([]);
    setIsScanning(false);
    setScanCompleted(false);
  };

  const resetAlert = () => {
    setAlertTitle('');
    setAlertSeverity('High');
    setAlertCategory('Vulnerability');
    setAlertClient(clients[0]?.name || '');
    setAlertDescription('');
    setIsLoggingAlert(false);
    setAlertCompleted(false);
  };

  const pollJob = async (jobId: string): Promise<Job> => {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const response = await apiFetch(`/api/agent-jobs/${encodeURIComponent(jobId)}`);
      const job = await response.json().catch(() => null) as Job | null;
      if (!response.ok || !job) throw new Error(job?.error || 'Unable to read scan job status.');
      const progress = Number(job.progress);
      setScanProgress(Number.isFinite(progress) ? Math.max(20, Math.min(95, progress)) : 20);
      if (TERMINAL.has(job.status)) return job;
    }
    throw new Error('Scan remains queued or running after the 10-minute UI wait. Check the scan history for its server-side status.');
  };

  const executeScan = async () => {
    if (!scanTarget.trim() || !scanClient) return;
    setIsScanning(true);
    setScanCompleted(false);
    setScanProgress(10);
    setScanLogs(['[INFO] Requesting the server-side OSV dependency scan.', `[INFO] Target: ${scanTarget}`]);
    try {
      const response = await apiFetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetName: scanTarget.trim(), scanType: 'SBOM Verify', clientName: scanClient })
      });
      const scanRecord = await response.json().catch(() => null);
      if (!response.ok) throw new Error(scanRecord?.error || 'Failed to create the scan record.');
      if (scanRecord?.status === 'Failed') {
        setScanProgress(100);
        setScanLogs(prev => [...prev, `[ERROR] ${scanRecord.error || 'No matching Software Passport exists for this target.'}`]);
        return;
      }
      if (!scanRecord?.jobId) throw new Error('Server accepted the scan but did not return a job ID.');
      setScanProgress(20);
      setScanLogs(prev => [...prev, `[INFO] Job queued: ${scanRecord.jobId}`, '[INFO] Waiting for the worker to reach a terminal state.']);
      const job = await pollJob(scanRecord.jobId);
      if (job.status === 'Failed') {
        setScanProgress(100);
        setScanLogs(prev => [...prev, `[ERROR] Worker failed the scan: ${job.error || 'No failure reason was recorded.'}`]);
        return;
      }
      setScanProgress(100);
      setScanLogs(prev => [...prev, '[SUCCESS] Worker reached Completed. Review the resulting evidence before making a trust decision.']);
      onTriggerNewScan({ ...scanRecord, status: 'Completed', jobId: scanRecord.jobId, findingsCount: job.result?.findingsCount ?? scanRecord.findingsCount ?? null });
      setScanCompleted(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scan error';
      setScanLogs(prev => [...prev, `[ERROR] ${message}`]);
    } finally {
      setIsScanning(false);
    }
  };

  const executeLogAlert = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!alertTitle.trim() || !alertDescription.trim() || !alertClient) return;
    setIsLoggingAlert(true);
    try {
      const response = await apiFetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: alertTitle.trim(), severity: alertSeverity, category: alertCategory, clientName: alertClient, description: alertDescription.trim() })
      });
      const saved = await response.json().catch(() => null);
      if (!response.ok) throw new Error(saved?.error || 'Failed to save the alert.');
      onTriggerNewAlert(saved);
      setAlertCompleted(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown alert error';
      window.alert(`Alert registration failed: ${message}`);
    } finally {
      setIsLoggingAlert(false);
    }
  };

  return (
    <div ref={containerRef} className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
      {isOpen && <div className="flex flex-col items-end gap-2.5 mb-2">
        <button onClick={() => { setIsOpen(false); resetScan(); setActiveModal('scan'); }} className="w-11 h-11 rounded-full bg-[var(--spr-surface)] border border-[var(--spr-border)] shadow-lg flex items-center justify-center" title="Run OSV dependency scan"><Radar className="w-5 h-5 text-[var(--spr-highlight)]" /></button>
        <button onClick={() => { setIsOpen(false); onOpenRegisterPassport(); }} className="w-11 h-11 rounded-full bg-[var(--spr-surface)] border border-[var(--spr-border)] shadow-lg flex items-center justify-center" title="Register Software Passport"><Award className="w-5 h-5 text-[var(--spr-green)]" /></button>
        <button onClick={() => { setIsOpen(false); resetAlert(); setActiveModal('alert'); }} className="w-11 h-11 rounded-full bg-[var(--spr-surface)] border border-[var(--spr-border)] shadow-lg flex items-center justify-center" title="Log security alert"><AlertTriangle className="w-5 h-5 text-[var(--spr-red)]" /></button>
      </div>}
      <button onClick={() => setIsOpen(value => !value)} className="w-13 h-13 rounded-full bg-[var(--spr-accent)] text-white flex items-center justify-center shadow-2xl" title="Quick Actions"><Plus className={`w-6 h-6 transition-transform ${isOpen ? 'rotate-45' : ''}`} /></button>

      {activeModal === 'scan' && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md max-w-lg w-full shadow-2xl overflow-hidden">
          <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--spr-border)]">
            <div><h3 className="text-sm font-bold">Run OSV Dependency Scan</h3><p className="text-[10px] text-[var(--spr-text-muted)]">Only the server-side OSV worker is represented here.</p></div>
            {!isScanning && <button onClick={() => setActiveModal(null)}><X className="w-4 h-4" /></button>}
          </div>
          <div className="p-6 space-y-4 text-xs">
            {!isScanning && !scanCompleted ? <>
              <div className="flex flex-col gap-1"><label className="font-bold">Software Passport target</label><input value={scanTarget} onChange={e => setScanTarget(e.target.value)} placeholder="Passport name or ID" className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-xl p-3" /></div>
              <div className="flex flex-col gap-1"><label className="font-bold">Client tenant</label><select value={scanClient} onChange={e => setScanClient(e.target.value)} disabled={!clients.length} className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-xl p-3"><option value="">Select a client</option>{clients.map(client => <option key={client.id} value={client.name}>{client.name}</option>)}</select></div>
              {!clients.length && <p className="text-[var(--spr-amber)]">No client records are available for this tenant. A scan cannot be submitted until a client is loaded.</p>}
              <div className="flex justify-end gap-2"><button onClick={() => setActiveModal(null)} className="px-4 py-2 border border-[var(--spr-border)] rounded-xl">Cancel</button><button onClick={executeScan} disabled={!scanTarget.trim() || !scanClient} className="px-5 py-2 bg-[var(--spr-accent)] text-white rounded-xl disabled:opacity-50 flex items-center gap-2"><Play className="w-3.5 h-3.5" />Run OSV Scan</button></div>
            </> : isScanning ? <div className="space-y-4 text-center py-6"><Loader2 className="w-10 h-10 mx-auto animate-spin text-[var(--spr-highlight)]" /><div className="font-bold">Worker scan in progress</div><div className="w-full bg-[var(--spr-surface-sunken)] h-2 rounded-full overflow-hidden"><div className="bg-[var(--spr-accent)] h-full" style={{ width: `${scanProgress}%` }} /></div><div className="text-[10px] text-[var(--spr-text-muted)]">{scanProgress}% reported by the job</div><div className="bg-[var(--spr-surface-deep)] text-[var(--spr-text)] font-mono text-[10px] p-4 rounded-xl text-left h-32 overflow-y-auto">{scanLogs.map((log, index) => <div key={index}>{log}</div>)}</div></div> : <div className="text-center py-6 space-y-4"><CheckCircle2 className="w-10 h-10 mx-auto text-[var(--spr-green)]" /><h4 className="font-bold">Scan completed</h4><p className="text-[10px] text-[var(--spr-text-muted)]">The worker reached Completed. Findings and evidence must be reviewed before a trust decision.</p><button onClick={() => { setActiveModal(null); resetScan(); }} className="px-6 py-2.5 bg-[var(--spr-green)] text-[var(--spr-surface)] rounded-xl">Close</button></div>}
          </div>
        </div>
      </div>}

      {activeModal === 'alert' && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md max-w-lg w-full shadow-2xl overflow-hidden">
          <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--spr-border)]"><div><h3 className="text-sm font-bold">Log Security Alert</h3><p className="text-[10px] text-[var(--spr-text-muted)]">Record a user-supplied alert; it is not treated as scanner evidence.</p></div>{!isLoggingAlert && <button onClick={() => setActiveModal(null)}><X className="w-4 h-4" /></button>}</div>
          <div className="p-6 text-xs">
            {!alertCompleted ? <form onSubmit={executeLogAlert} className="space-y-4">
              <input required value={alertTitle} onChange={e => setAlertTitle(e.target.value)} placeholder="Alert title" className="w-full bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-xl p-3" />
              <div className="grid grid-cols-3 gap-3"><select value={alertSeverity} onChange={e => setAlertSeverity(e.target.value as Severity)} className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-xl p-3"><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select><select value={alertCategory} onChange={e => setAlertCategory(e.target.value as typeof alertCategory)} className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-xl p-3"><option>Vulnerability</option><option>Compliance Gap</option><option>Unverified Attestation</option><option>Policy Violation</option></select><select value={alertClient} onChange={e => setAlertClient(e.target.value)} disabled={!clients.length} className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-xl p-3"><option value="">Select client</option>{clients.map(client => <option key={client.id} value={client.name}>{client.name}</option>)}</select></div>
              <textarea required rows={4} value={alertDescription} onChange={e => setAlertDescription(e.target.value)} placeholder="Describe the observation or user-reported concern." className="w-full bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] rounded-xl p-3" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setActiveModal(null)} className="px-4 py-2 border border-[var(--spr-border)] rounded-xl">Cancel</button><button type="submit" disabled={isLoggingAlert || !alertClient} className="px-5 py-2 bg-[var(--spr-red)] text-white rounded-xl disabled:opacity-50 flex items-center gap-2">{isLoggingAlert ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}Log Alert</button></div>
            </form> : <div className="text-center py-6 space-y-4"><ShieldCheck className="w-10 h-10 mx-auto text-[var(--spr-red)]" /><h4 className="font-bold">Alert recorded</h4><p className="text-[10px] text-[var(--spr-text-muted)]">The alert was saved as a user-entered record. External SIEM delivery requires a configured integration.</p><button onClick={() => { setActiveModal(null); resetAlert(); }} className="px-6 py-2.5 bg-[var(--spr-red)] text-white rounded-xl">Close</button></div>}
          </div>
        </div>
      </div>}
    </div>
  );
}
