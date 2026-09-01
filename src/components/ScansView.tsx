/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Radar, Upload, CheckCircle2, Sliders, Play, Calendar, Shield, Plus, Trash2, Pause } from 'lucide-react';
import { Scan, Client } from '../types';
import { apiFetch } from '../utils/apiClient';

export interface ScanSchedule {
  id: string;
  assetId: string;
  assetHostName: string;
  assetType: string;
  clientName: string;
  frequency: string;
  scanType: string;
  status: 'Active' | 'Paused';
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
}

interface ScansViewProps {
  scans: Scan[];
  onTriggerNewScan: (scan: Scan) => void;
  clients?: Client[];
  assets?: any[];
  onBatchTagScans?: (scanIds: string[], customCategory: string) => void;
  passports?: any[];
  role?: string;
}

export default function ScansView({ scans, onTriggerNewScan, clients, assets, onBatchTagScans, passports, role = 'Viewer' }: ScansViewProps) {
  // Matches server.ts /api/scans/schedules* and /api/agent-jobs backend
  // gating: requireRole(['Owner','Admin','Operator']).
  const canManageSchedules = ['Owner', 'Admin', 'Operator'].includes(role);
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [scanCompleted, setScanCompleted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatRunTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return isoString;
    }
  };

  // Sub-tab Navigation: 'scanner' | 'schedules'
  const [activeSubTab, setActiveSubTab] = useState<'scanner' | 'schedules'>('scanner');

  // Filter out production assets (or critical assets) for scheduling
  const productionAssets = useMemo(() => {
    return (assets || []).filter(a => a.environment === 'Production');
  }, [assets]);

  // Default production assets if dynamic list is empty
  const prodAssets = useMemo(() => {
    return productionAssets;
  }, [productionAssets]);

  // Scanning Schedules State and backend persistence
  const [schedules, setSchedules] = useState<ScanSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [errorSchedules, setErrorSchedules] = useState('');

  const fetchSchedules = async () => {
    setLoadingSchedules(true);
    try {
      const response = await apiFetch('/api/scans/schedules');
      if (response.ok) {
        const data = await response.json();
        setSchedules(data);
      } else {
        setErrorSchedules('Failed to load scan schedules.');
      }
    } catch (err) {
      console.error('Failed to fetch schedules:', err);
      setErrorSchedules('Failed to fetch schedules.');
    } finally {
      setLoadingSchedules(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  // Form states
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [newScheduleAssetId, setNewScheduleAssetId] = useState('');
  const [newScheduleFrequency, setNewScheduleFrequency] = useState('Daily');
  const [newScheduleScanType, setNewScheduleScanType] = useState('SBOM Deep Verify');
  const [newScheduleStartTime, setNewScheduleStartTime] = useState('02:00 AM');

  // Set default asset ID in form
  useEffect(() => {
    if (prodAssets.length > 0 && !newScheduleAssetId) {
      setNewScheduleAssetId(prodAssets[0].id);
    }
  }, [prodAssets, newScheduleAssetId]);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const asset = prodAssets.find(a => a.id === newScheduleAssetId) || prodAssets[0];
    if (!asset) return;

    const payload = {
      assetId: asset.id,
      assetHostName: asset.hostName,
      assetType: asset.type,
      clientName: asset.clientName,
      frequency: newScheduleFrequency,
      scanType: newScheduleScanType,
    };

    try {
      const response = await apiFetch('/api/scans/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const created = await response.json();
        setSchedules(prev => [created, ...prev]);
        setShowAddSchedule(false);
      } else {
        alert('Failed to save the new schedule.');
      }
    } catch (err) {
      console.error('Error creating schedule:', err);
      alert('Error creating schedule.');
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      const response = await apiFetch(`/api/scans/schedules/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setSchedules(prev => prev.filter(s => s.id !== id));
      } else {
        alert('Failed to delete schedule.');
      }
    } catch (err) {
      console.error('Error deleting schedule:', err);
    }
  };

  const handleToggleScheduleStatus = async (id: string) => {
    const schedule = schedules.find(s => s.id === id);
    if (!schedule) return;
    const nextStatus = schedule.status === 'Active' ? 'Paused' : 'Active';

    try {
      const response = await apiFetch(`/api/scans/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      if (response.ok) {
        const updated = await response.json();
        setSchedules(prev => prev.map(s => s.id === id ? updated : s));
      } else {
        alert('Failed to update status.');
      }
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleRunScheduleNow = async (schedule: ScanSchedule) => {
    // Previously this also unconditionally called runActualScan(...) below,
    // which independently created a second, separately-tracked job via a
    // fuzzy passport-name match — one click produced two backend jobs, and
    // only the untracked duplicate showed in the terminal console. The
    // schedule's own /run response is the authoritative result; nothing
    // else should fire from this action.
    try {
      const response = await apiFetch(`/api/scans/schedules/${schedule.id}/run`, {
        method: 'POST'
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.schedule) {
          setSchedules(prev => prev.map(s => s.id === schedule.id ? result.schedule : s));
        }
      } else {
        alert('Failed to run schedule now.');
      }
    } catch (err) {
      console.error('Error running schedule:', err);
      alert('Failed to run schedule now.');
    }
  };

  // Universal Scanner State Variables
  const [customInputName, setCustomInputName] = useState('');
  const [chosenClientName, setChosenClientName] = useState(() => (clients && clients.length > 0 ? clients[0].name : ''));
  const [selectedPassportId, setSelectedPassportId] = useState('');

  useEffect(() => {
    if (clients && clients.length > 0 && !chosenClientName) {
      setChosenClientName(clients[0].name);
    }
  }, [clients, chosenClientName]);

  // Set default passport ID
  useEffect(() => {
    if (passports && passports.length > 0 && !selectedPassportId) {
      setSelectedPassportId(passports[0].id);
    }
  }, [passports, selectedPassportId]);

  // Batch-tagging State Variables
  const [selectedScanIds, setSelectedScanIds] = useState<string[]>([]);
  const [batchCategory, setBatchCategory] = useState<string>('');

  const toggleSelectScan = (id: string) => {
    setSelectedScanIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const unclassifiedScans = scans.filter(s => s.scanType === 'Unclassified Attestation');
  const allUnclassifiedSelected = unclassifiedScans.length > 0 && unclassifiedScans.every(s => selectedScanIds.includes(s.id));

  const handleToggleSelectAllUnclassified = () => {
    if (allUnclassifiedSelected) {
      setSelectedScanIds(prev => prev.filter(id => !unclassifiedScans.some(u => u.id === id)));
    } else {
      const unclassifiedIds = unclassifiedScans.map(u => u.id);
      setSelectedScanIds(prev => Array.from(new Set([...prev, ...unclassifiedIds])));
    }
  };

  const handleApplyBatchTag = () => {
    if (!batchCategory.trim() || selectedScanIds.length === 0) return;
    if (onBatchTagScans) {
      onBatchTagScans(selectedScanIds, batchCategory.trim());
    }
    setSelectedScanIds([]);
    setBatchCategory('');
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      runActualScan(files[0].name, chosenClientName, files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      runActualScan(files[0].name, chosenClientName, files[0]);
    }
  };

  // Real-time Regex/Signature Matching Helper
  const getLiveMatch = (name: string) => {
    if (!name.trim()) return null;
    const targetLower = name.toLowerCase();
    const signatures = [
      { regex: /postgres|postgresql|psql|db|mysql|sqlite|oracle|mongo|database/i, category: 'Database & Persistent Store', badge: 'Database Signature' },
      { regex: /k8s|kubernetes|kube|docker|container|runc/i, category: 'Kubernetes Cluster Daemon', badge: 'Container Signature' },
      { regex: /nginx|apache|httpd|iis|express|haproxy|web/i, category: 'Nginx Edge Proxy', badge: 'Web Server Signature' },
      { regex: /redis|memcached|cache/i, category: 'Redis In-Memory Store', badge: 'In-Memory Cache Signature' },
      { regex: /log4j|logging|logger/i, category: 'Apache Log4j Core', badge: 'Log/Snyk Signature' },
      { regex: /billing|payment|stripe|invoice|checkout/i, category: 'Legacy Billing Connector', badge: 'Financial/Snyk Signature' }
    ];
    const matched = signatures.find(s => s.regex.test(targetLower));
    return matched || { category: 'Custom/Generic Asset Bucket', badge: 'Custom/Generic (Unclassified)' };
  };

  const handleCustomScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPassportId) {
      const p = (passports || []).find(x => x.id === selectedPassportId);
      runActualScan(p ? p.name : (customInputName || 'Generic Engine'), chosenClientName);
    } else if (customInputName.trim()) {
      runActualScan(customInputName.trim(), chosenClientName);
      setCustomInputName('');
    }
  };

  // Executing actual backend AI Agent scanner with real-time logs polling
  const runActualScan = async (targetName: string, chosenClient: string = 'Vanguard Grid Operators', sbomFile?: File) => {
    setIsScanning(true);
    setScanCompleted(false);
    setScanProgress(0);
    setScanLogs([`[INFO] Locating software trust record for "${targetName}"...`]);

    const targetLower = targetName.toLowerCase();
    const matchedPassport = (passports || []).find(p =>
      targetLower.includes(p.name.toLowerCase()) ||
      p.name.toLowerCase().includes(targetLower)
    ) || (passports && passports.find(p => p.id === selectedPassportId)) || (passports && passports[0]);

    if (!matchedPassport) {
      setScanLogs(l => [...l, `[ERROR] No active Software Passports found. Register a software passport first.`]);
      setIsScanning(false);
      return;
    }

    setScanLogs(l => [
      ...l,
      `[INFO] Target matched to verified Passport: ${matchedPassport.name} (v${matchedPassport.version})`,
      `[INFO] Initiating comprehensive full-stack 8-engine scan queue...`
    ]);

    try {
      let sbom: string | undefined;
      if (sbomFile) {
        if (sbomFile.size > 5_000_000) {
          throw new Error('SBOM file is too large. Files must be 5 MB or smaller.');
        }
        sbom = await sbomFile.text();
        let document: unknown;
        try {
          document = JSON.parse(sbom);
        } catch {
          throw new Error('SBOM file must contain valid JSON.');
        }
        const components = Array.isArray((document as { components?: unknown })?.components)
          ? (document as { components: unknown[] }).components
          : Array.isArray((document as { packages?: unknown })?.packages)
            ? (document as { packages: unknown[] }).packages
            : [];
        if (components.length === 0) {
          throw new Error('JSON does not contain a versioned SBOM component list.');
        }
      }
      const response = await apiFetch('/api/agent-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'comprehensive_scanner',
          passportId: matchedPassport.id,
          jobType: 'automated_compliance_check',
          ...(sbom !== undefined ? { sbom } : {})
        })
      });

      if (!response.ok) {
        let message = 'Failed to dispatch secure scanning job to background queue.';
        try {
          const error = await response.json();
          if (typeof error?.error === 'string') message = error.error;
        } catch {
          // Keep the actionable default when the backend does not return JSON.
        }
        throw new Error(message);
      }

      const job = await response.json();
      const jobId = job.id;

      // Start periodic real-evidence state polling
      let pollInFlight = false;
      const interval = setInterval(async () => {
        if (pollInFlight) return;
        pollInFlight = true;
        try {
          const [jobRes, logsRes] = await Promise.all([
            apiFetch(`/api/agent-jobs/${jobId}`),
            apiFetch(`/api/agent-jobs/${jobId}/logs`)
          ]);

          if (jobRes.ok && logsRes.ok) {
            const currentJob = await jobRes.json();
            const logsList = await logsRes.json();

            if (currentJob) {
              setScanProgress(currentJob.progress || 0);
              setScanLogs(logsList.map((l: any) => `[${l.level.toUpperCase()}] ${l.message}`));

              if (currentJob.status === 'Success' || currentJob.status === 'Completed' || currentJob.status === 'Failed') {
                clearInterval(interval);
                setIsScanning(false);
                setScanCompleted(true);

                // Fetch latest scans list from backend and trigger state update
                const refreshScansRes = await apiFetch('/api/scans');
                if (refreshScansRes.ok) {
                  const updatedScans = await refreshScansRes.json();
                  const compiledScan = updatedScans[0];
                  if (compiledScan) {
                    onTriggerNewScan(compiledScan);
                  }
                }
              }
            }
          }
        } catch (pollErr) {
          console.error('Error polling agent job progress:', pollErr);
        } finally {
          pollInFlight = false;
        }
      }, 1500);

    } catch (err: unknown) {
      console.error('Error in agent scanning execution:', err);
      setScanLogs(l => [...l, `[ERROR] Scanner job dispatch failed: ${err instanceof Error ? err.message : 'Unable to start scan.'}`]);
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-4" id="msp-scans-uploader">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e]">SBOM Scanning & Attestation</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">
            Analyze software manifests to compile trust indexes and manage automated scanning schedules for production assets.
          </p>
        </div>
        {/* Toggle Button for Scheduling Form when on schedules sub-tab */}
        {activeSubTab === 'schedules' && (
          <button
            onClick={() => setShowAddSchedule(!showAddSchedule)}
            className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] cursor-pointer"
            id="btn-toggle-add-schedule"
          >
            {showAddSchedule ? <Sliders className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            <span>{showAddSchedule ? 'Cancel Config' : 'Configure Scan Schedule'}</span>
          </button>
        )}
      </div>

      {/* About this page */}
      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Upload an SBOM manifest or run the universal scanner to compile cryptographic evidence for a software passport. Automated schedules keep production assets continuously re-verified.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Drag in an SBOM file, or pick a passport and client to scan directly.</li>
            <li>The agent scanner dispatches a background job and streams progress and logs below.</li>
            <li>Switch to Automated Scanning Schedules to set up recurring scans on production assets.</li>
          </ol>
        </div>
      </details>

      {/* Tab Switcher */}
      <div className="flex gap-4 border-b border-[#e1dfdd]" id="scans-view-tabs">
        <button
          onClick={() => setActiveSubTab('scanner')}
          className={`flex items-center gap-1.5 border-b-2 px-1 py-2 text-[13px] font-medium cursor-pointer ${
            activeSubTab === 'scanner'
              ? 'border-[#0f6cbd] text-[#0f6cbd]'
              : 'border-transparent text-[#605e5c] hover:text-[#323130]'
          }`}
          id="btn-subtab-scanner"
        >
          <Radar className="h-3.5 w-3.5" />
          <span>Direct Ingestion & Manual Scanner</span>
        </button>
        <button
          onClick={() => setActiveSubTab('schedules')}
          className={`flex items-center gap-1.5 border-b-2 px-1 py-2 text-[13px] font-medium cursor-pointer ${
            activeSubTab === 'schedules'
              ? 'border-[#0f6cbd] text-[#0f6cbd]'
              : 'border-transparent text-[#605e5c] hover:text-[#323130]'
          }`}
          id="btn-subtab-schedules"
        >
          <Calendar className="h-3.5 w-3.5" />
          <span>Automated Scanning Schedules</span>
          <span className="rounded-full bg-[#f3f2f1] px-1.5 py-0.5 text-[11px] font-medium text-[#605e5c]">
            {schedules.length}
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Columns */}
        <div className="lg:col-span-2 space-y-4">
          {activeSubTab === 'scanner' ? (
            <>
              {/* Drag & Drop Ingestion */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-md border-2 border-dashed p-6 text-center transition-colors ${
                  isDragging ? 'border-[#0f6cbd] bg-[#eff6fc]' : 'border-[#c8c6c4] bg-white hover:border-[#0f6cbd]'
                }`}
                id="drag-drop-uploader-widget"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept=".json,.xml,.spdx"
                  className="hidden"
                />
                <Upload className="mx-auto mb-2 h-8 w-8 text-[#8a8886]" />
                <h3 className="text-[13px] font-semibold text-[#323130]">Drag & Drop SBOM Manifest File Here</h3>
                <p className="mx-auto mt-1 max-w-sm text-[12px] text-[#8a8886]">
                  Supports CycloneDX JSON, SPDX, or digital binary attestations. Or <span className="font-medium text-[#0f6cbd] underline">click to browse</span>.
                </p>
              </div>

              {/* Universal Generic Scanner Panel */}
              <div className="space-y-3 rounded-md border border-[#e1dfdd] bg-white p-4">
                <div className="flex items-center gap-2 border-b border-[#e1dfdd] pb-3">
                  <div className="rounded bg-[#eff6fc] p-1.5 text-[#0f6cbd]">
                    <Radar className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-[13px] font-semibold text-[#323130]">Universal Software Trust Agent Scanner</h3>
                    <p className="text-[12px] text-[#605e5c]">Trigger the 8-engine AI security pipeline and compile cryptographic evidence logs persistently in the database.</p>
                  </div>
                </div>

                <form onSubmit={handleCustomScanSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {/* Software Passport Selector */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">Software Passport Target</label>
                      <select
                        value={selectedPassportId}
                        onChange={(e) => setSelectedPassportId(e.target.value)}
                        className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                      >
                        {(passports || []).map(p => (
                          <option key={p.id} value={p.id}>{p.name} (v{p.version}) • {p.publisher}</option>
                        ))}
                      </select>
                    </div>

                    {/* Tenant Client Target */}
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">Client (Tenant Context)</label>
                      <select
                        value={chosenClientName}
                        onChange={(e) => setChosenClientName(e.target.value)}
                        className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                      >
                        {clients && clients.length > 0 ? (
                          clients.map(c => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))
                        ) : (
                          <>
                            <option value="Vanguard Grid Operators">Vanguard Grid Operators</option>
                            <option value="Apex Financial Portfolio">Apex Financial Portfolio</option>
                            <option value="Nexus Healthcare Systems">Nexus Healthcare Systems</option>
                            <option value="Acme Corporate Technologies">Acme Corporate Technologies</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Real-time Selected Passport Metadata */}
                  {(() => {
                    const activeP = (passports || []).find(p => p.id === selectedPassportId);
                    if (!activeP) return null;
                    return (
                      <div className="flex items-center justify-between rounded border border-[#e1dfdd] bg-[#eff6fc] p-2.5 text-[13px]">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-[#0f6cbd]" />
                          <span className="text-[#605e5c]">Selected: <strong className="text-[#201f1e]">{activeP.name}</strong> (v{activeP.version})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-[#605e5c]">License: {activeP.licenseType}</span>
                          <span className="rounded border border-[#c8c6c4] bg-white px-2 py-0.5 text-[11px] font-medium text-[#0f6cbd]">Verified Passport</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Action Button */}
                  <button
                    type="submit"
                    disabled={isScanning || !selectedPassportId}
                    className={`flex h-9 w-full items-center justify-center gap-1.5 rounded px-4 text-[13px] font-medium text-white transition-colors cursor-pointer ${
                      isScanning || !selectedPassportId
                        ? 'bg-[#c8c6c4] cursor-not-allowed'
                        : 'bg-[#0f6cbd] hover:bg-[#004578]'
                    }`}
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Trigger Comprehensive Agent Audit & Ingestion</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            /* Automated Scanning Schedules Workspace */
            <div className="space-y-4">
              {/* Stats Strip */}
              <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
                <div>
                  <div className="text-[11px] text-[#605e5c]">Active Pipelines</div>
                  <div className="text-lg font-semibold text-[#201f1e]">
                    {schedules.filter(s => s.status === 'Active').length} / {schedules.length}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#605e5c]">Asset Coverage</div>
                  <div className="text-lg font-semibold text-[#201f1e]">
                    {(() => {
                      const uniqueProtected = new Set(schedules.filter(s => s.status === 'Active').map(s => s.assetHostName)).size;
                      return `${uniqueProtected} / ${prodAssets.length}`;
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#605e5c]">Coverage Ratio</div>
                  <div className="text-lg font-semibold text-[#201f1e]">
                    {(() => {
                      const uniqueProtected = new Set(schedules.filter(s => s.status === 'Active').map(s => s.assetHostName)).size;
                      const pct = Math.round((uniqueProtected / prodAssets.length) * 100) || 0;
                      return `${pct}%`;
                    })()}
                  </div>
                </div>
              </div>

              {/* Configure New Scan Schedule Form */}
              {showAddSchedule && (
                <div className="space-y-3 rounded-md border border-[#e1dfdd] bg-white p-4" id="scan-schedule-creator-panel">
                  <div className="flex items-center gap-2 border-b border-[#e1dfdd] pb-3">
                    <div className="rounded bg-[#eff6fc] p-1.5 text-[#0f6cbd]">
                      <Sliders className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-[13px] font-semibold text-[#323130]">Configure Automated Scan Pipeline</h3>
                      <p className="text-[12px] text-[#605e5c]">Set up automated continuous SBOM scanning for critical tenant software endpoints.</p>
                    </div>
                  </div>

                  <form onSubmit={handleCreateSchedule} className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {/* Asset Select */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">Target Production Asset</label>
                        <select
                          value={newScheduleAssetId}
                          onChange={(e) => setNewScheduleAssetId(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        >
                          {prodAssets.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.hostName} ({a.activePassport})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Recurrence Frequency */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">Scan Recurrence / Frequency</label>
                        <select
                          value={newScheduleFrequency}
                          onChange={(e) => setNewScheduleFrequency(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        >
                          <option value="Hourly">Hourly (Continuous validation)</option>
                          <option value="Every 12 Hours">Every 12 Hours (High frequency)</option>
                          <option value="Daily">Daily (Recommended standard)</option>
                          <option value="Weekly">Weekly (Off-peak validation)</option>
                          <option value="Monthly">Monthly</option>
                        </select>
                      </div>

                      {/* Scanning Policy Rule */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">Scanning Policy / Rule</label>
                        <select
                          value={newScheduleScanType}
                          onChange={(e) => setNewScheduleScanType(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        >
                          <option value="SBOM Deep Verify">SBOM Deep Verify (CycloneDX analysis)</option>
                          <option value="Vulnerability Signature Sweep">Vulnerability Signature Sweep (Snyk matching)</option>
                          <option value="License Compliance Audit font-mono">License Compliance Audit (SPDX check)</option>
                          <option value="Cryptographic Hash Validation">Cryptographic Hash Validation (Cosign verify)</option>
                        </select>
                      </div>

                      {/* Target Run Time */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">Preferred Run Window (Local Time)</label>
                        <input
                          type="text"
                          value={newScheduleStartTime}
                          onChange={(e) => setNewScheduleStartTime(e.target.value)}
                          placeholder="e.g. 02:00 AM, 11:30 PM"
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddSchedule(false)}
                        className="h-9 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!canManageSchedules}
                        title={!canManageSchedules ? `Your ${role} role cannot create schedules.` : undefined}
                        className="h-9 rounded bg-[#0f6cbd] px-4 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      >
                        Save Schedule Pipeline
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Active Schedules List */}
              <div>
                {loadingSchedules ? (
                  <div className="space-y-2">
                    <div className="h-9 animate-pulse rounded border border-[#e1dfdd] bg-[#f3f2f1]" />
                    <div className="h-9 animate-pulse rounded border border-[#e1dfdd] bg-[#f3f2f1]" />
                  </div>
                ) : schedules.length === 0 ? (
                  <div className="space-y-2 rounded-md border border-[#e1dfdd] bg-white p-8 text-center">
                    <Calendar className="mx-auto h-8 w-8 text-[#c8c6c4]" />
                    <h3 className="text-[13px] font-semibold text-[#323130]">No Scanning Schedules Configured</h3>
                    <p className="mx-auto max-w-sm text-[12px] text-[#8a8886]">
                      Automate continuous software passport and vulnerability attestation audits on your clients' production nodes. Click "Configure Scan Schedule" above to begin.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-[#e1dfdd] bg-white">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-[#e1dfdd] text-left text-[11px] uppercase tracking-wide text-[#605e5c]">
                          <th className="px-3 py-2 font-medium">Asset</th>
                          <th className="px-3 py-2 font-medium">Policy</th>
                          <th className="px-3 py-2 font-medium">Interval</th>
                          <th className="px-3 py-2 font-medium">Last Run</th>
                          <th className="px-3 py-2 font-medium">Next Run</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedules.map((schedule) => {
                          const isActive = schedule.status === 'Active';
                          return (
                            <tr key={schedule.id} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                              <td className="px-3 py-2.5 align-top">
                                <div className="flex items-center gap-1.5 font-medium text-[#201f1e]">
                                  <Shield className="h-3.5 w-3.5 shrink-0 text-[#0f6cbd]" />
                                  <span className="max-w-[160px] truncate" title={schedule.assetHostName}>
                                    {schedule.assetHostName}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-[11px] text-[#8a8886]">Client: {schedule.clientName}</div>
                              </td>
                              <td className="px-3 py-2.5 align-top text-[#323130]">{schedule.scanType}</td>
                              <td className="px-3 py-2.5 align-top text-[#323130]">{schedule.frequency}</td>
                              <td className="px-3 py-2.5 align-top text-[#605e5c]">{formatRunTime(schedule.lastRunAt)}</td>
                              <td className="px-3 py-2.5 align-top text-[#605e5c]">{formatRunTime(schedule.nextRunAt)}</td>
                              <td className="px-3 py-2.5 align-top">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-[#0e700e]' : 'bg-[#605e5c]'}`} />
                                  {schedule.status}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 align-top">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Run Now Trigger */}
                                  <button
                                    onClick={() => handleRunScheduleNow(schedule)}
                                    disabled={!canManageSchedules || !isActive}
                                    className="inline-flex h-7 items-center gap-1 rounded border border-[#c8c6c4] px-2 text-[12px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                    title={!canManageSchedules ? `Your ${role} role cannot run schedules.` : 'Trigger scanning routine immediately on this production target'}
                                  >
                                    <Play className="h-3 w-3" />
                                    <span>Run Now</span>
                                  </button>

                                  {/* Pause/Resume Toggle */}
                                  <button
                                    onClick={() => handleToggleScheduleStatus(schedule.id)}
                                    disabled={!canManageSchedules}
                                    className="inline-flex h-7 items-center gap-1 rounded border border-[#c8c6c4] px-2 text-[12px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                    title={!canManageSchedules ? `Your ${role} role cannot change schedules.` : isActive ? 'Pause automated recurrences' : 'Resume automated recurrences'}
                                  >
                                    {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                                    <span>{isActive ? 'Pause' : 'Activate'}</span>
                                  </button>

                                  {/* Delete */}
                                  <button
                                    onClick={() => handleDeleteSchedule(schedule.id)}
                                    disabled={!canManageSchedules}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-[#c8c6c4] text-[#605e5c] hover:border-[#a4262c] hover:text-[#a4262c] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                                    title={!canManageSchedules ? `Your ${role} role cannot delete schedules.` : 'Delete this schedule pipeline'}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scanner Console / Progress indicator */}
          {(isScanning || scanCompleted) && (
            <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-4 font-mono text-[12px] text-[#323130]">
              <div className="mb-3 flex items-center justify-between border-b border-[#e1dfdd] pb-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[#605e5c]">Compilation Terminal Console</span>
                <span className="text-[11px] font-medium text-[#0f6cbd]">PROVENANCE PORT v1.0</span>
              </div>

              {/* Progress Bar */}
              {isScanning && (
                <div className="mb-3 space-y-1.5">
                  <div className="flex justify-between text-[11px] text-[#605e5c]">
                    <span>Attesting SBOM payload integrity...</span>
                    <span>{scanProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e1dfdd]">
                    <div className="h-full bg-[#0f6cbd] transition-all duration-100" style={{ width: `${scanProgress}%` }}></div>
                  </div>
                </div>
              )}

              {/* Console logs */}
              <div className="max-h-[180px] space-y-1 overflow-y-auto pr-1">
                {scanLogs.map((log, index) => (
                  <p
                    key={index}
                    className={
                      log.includes('[SUCCESS]') ? 'font-medium text-[#0e700e]' :
                      log.includes('[INFO]') ? 'text-[#323130]' : 'text-[#605e5c]'
                    }
                  >
                    {log}
                  </p>
                ))}
              </div>

              {scanCompleted && (
                <div className="mt-4 flex items-center justify-between border-t border-[#e1dfdd] pt-3 font-medium text-[#0e700e]">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Dossier compiled successfully!</span>
                  </span>
                  <button
                    onClick={() => {
                      setIsScanning(false);
                      setScanCompleted(false);
                      setScanProgress(0);
                    }}
                    className="h-8 rounded bg-[#0f6cbd] px-3 text-[12px] font-medium text-white hover:bg-[#004578] cursor-pointer"
                  >
                    Clear Console
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Scan History List */}
        <div className="flex h-[520px] flex-col rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="mb-3 flex items-center justify-between border-b border-[#e1dfdd] pb-2">
            <div>
              <h3 className="text-[13px] font-semibold text-[#323130]">MSP Global Scan Logs</h3>
              <p className="mt-0.5 text-[11px] text-[#8a8886]">Audit trail of system attestations</p>
            </div>
            {unclassifiedScans.length > 0 && (
              <button
                type="button"
                onClick={handleToggleSelectAllUnclassified}
                className={`rounded border px-2 py-1 text-[11px] font-medium cursor-pointer ${
                  allUnclassifiedSelected
                    ? 'border-[#e1dfdd] bg-[#fff4ce] text-[#8a5700] hover:bg-[#ffe9a3]'
                    : 'border-[#c8c6c4] bg-white text-[#605e5c] hover:bg-black/[.03]'
                }`}
              >
                {allUnclassifiedSelected ? 'Deselect All Unclassified' : 'Select All Unclassified'}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {scans.length === 0 ? (
              <div className="rounded-md border border-dashed border-[#e1dfdd] px-4 py-10 text-center">
                <p className="text-[13px] font-medium text-[#605e5c]">No scans recorded yet</p>
                <p className="mt-1 text-[11px] text-[#8a8886]">Scan logs will appear here once a scan or scheduled run completes.</p>
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#e1dfdd] text-left text-[11px] uppercase tracking-wide text-[#605e5c]">
                    <th className="w-6 px-2 py-2"></th>
                    <th className="px-2 py-2 font-medium">Target</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 text-right font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => {
                    const isUnclassified = s.scanType === 'Unclassified Attestation';
                    const isSelected = selectedScanIds.includes(s.id);
                    return (
                      <tr
                        key={s.id}
                        className={`border-b border-[#f3f2f1] hover:bg-black/[.02] ${isSelected ? 'bg-[#eff6fc]' : ''}`}
                      >
                        <td className="px-2 py-2 align-top">
                          {isUnclassified && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectScan(s.id)}
                              className="h-3.5 w-3.5 cursor-pointer rounded border-[#c8c6c4] text-[#0f6cbd] focus:ring-[#0f6cbd]"
                            />
                          )}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="truncate font-medium text-[#201f1e]" title={s.targetName}>
                            {s.targetName}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-[#8a8886]">
                            Type: <span className={isUnclassified ? 'font-medium text-[#8a5700]' : 'text-[#605e5c]'}>{s.scanType}</span> • Owner: {s.clientName}
                          </div>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${s.status === 'Success' ? 'bg-[#0e700e]' : 'bg-[#a4262c]'}`} />
                            {s.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 align-top text-right text-[11px] text-[#8a8886]">{s.durationMs}ms</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Batch-tag action footer */}
          {selectedScanIds.length > 0 && (
            <div className="mt-3 shrink-0 space-y-2 rounded-md border border-[#e1dfdd] bg-[#eff6fc] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[#0f6cbd]">
                  Batch Tag {selectedScanIds.length} {selectedScanIds.length === 1 ? 'Record' : 'Records'} Selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedScanIds([])}
                  className="text-[11px] text-[#605e5c] underline hover:text-[#323130] cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Custom Category name..."
                  value={batchCategory}
                  onChange={(e) => setBatchCategory(e.target.value)}
                  className="h-9 flex-1 rounded border border-[#c8c6c4] bg-white px-2.5 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                />
                <button
                  type="button"
                  onClick={handleApplyBatchTag}
                  disabled={!batchCategory.trim()}
                  className={`h-9 shrink-0 rounded px-3 text-[13px] font-medium text-white cursor-pointer ${
                    batchCategory.trim()
                      ? 'bg-[#0f6cbd] hover:bg-[#004578]'
                      : 'bg-[#c8c6c4] cursor-not-allowed'
                  }`}
                >
                  Apply & Sync
                </button>
              </div>
              <p className="text-[11px] leading-tight text-[#605e5c]">
                This will tag the selected records and trigger a bulk update to synchronize custom categories in the Assets inventory.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
