/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Radar, Upload, Clock, CheckCircle2, AlertCircle, FileCode, Sliders, Play, Calendar, Shield, ShieldCheck, Plus, Trash2, Pause, TrendingUp, Activity, Info } from 'lucide-react';
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
}

export default function ScansView({ scans, onTriggerNewScan, clients, assets, onBatchTagScans, passports }: ScansViewProps) {
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
    try {
      const response = await apiFetch(`/api/scans/schedules/${schedule.id}/run`, {
        method: 'POST'
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.schedule) {
          setSchedules(prev => prev.map(s => s.id === schedule.id ? result.schedule : s));
        }
      }
    } catch (err) {
      console.error('Error running schedule:', err);
    }

    // Redirect back to terminal console view
    setActiveSubTab('scanner');

    // Kick off actual security scan on that asset
    runActualScan(schedule.assetHostName, schedule.clientName);
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
      runActualScan(files[0].name, chosenClientName);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      runActualScan(files[0].name, chosenClientName);
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
  const runActualScan = async (targetName: string, chosenClient: string = 'Vanguard Grid Operators') => {
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
      const response = await apiFetch('/api/agent-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'comprehensive_scanner',
          passportId: matchedPassport.id,
          jobType: 'automated_compliance_check'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to dispatch secure scanning job to background queue.');
      }

      const job = await response.json();
      const jobId = job.id;

      // Start periodic real-evidence state polling
      const interval = setInterval(async () => {
        try {
          const [jobRes, logsRes] = await Promise.all([
            apiFetch('/api/agent-jobs'),
            apiFetch(`/api/agent-jobs/${jobId}/logs`)
          ]);

          if (jobRes.ok && logsRes.ok) {
            const jobsList = await jobRes.json();
            const currentJob = jobsList.find((j: any) => j.id === jobId);
            const logsList = await logsRes.json();

            if (currentJob) {
              setScanProgress(currentJob.progress || 0);
              setScanLogs(logsList.map((l: any) => `[${l.level.toUpperCase()}] ${l.message}`));

              if (currentJob.status === 'Success' || currentJob.status === 'Failed') {
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
        }
      }, 900);

    } catch (err: any) {
      console.error('Error in agent scanning execution:', err);
      setScanLogs(l => [...l, `[ERROR] Scanner job dispatch failed: ${err.message || err}`]);
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-6" id="msp-scans-uploader">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900">SBOM Scanning & Attestation</h1>
          <p className="text-xs text-slate-500 font-sans mt-1">
            Analyze JSON software manifests to compile trust indexes, and manage automated scanning schedules for critical production assets.
          </p>
        </div>
        {/* Toggle Button for Scheduling Form when on schedules sub-tab */}
        {activeSubTab === 'schedules' && (
          <button
            onClick={() => setShowAddSchedule(!showAddSchedule)}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ml-auto md:ml-0"
            id="btn-toggle-add-schedule"
          >
            {showAddSchedule ? <Sliders className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{showAddSchedule ? 'Cancel Config' : 'Configure Scan Schedule'}</span>
          </button>
        )}
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-slate-200 gap-1" id="scans-view-tabs">
        <button
          onClick={() => setActiveSubTab('scanner')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeSubTab === 'scanner'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/10'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          id="btn-subtab-scanner"
        >
          <div className="flex items-center gap-1.5">
            <Radar className="w-3.5 h-3.5" />
            <span>Direct Ingestion & Manual Scanner</span>
          </div>
        </button>
        <button
          onClick={() => setActiveSubTab('schedules')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeSubTab === 'schedules'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/10'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          id="btn-subtab-schedules"
        >
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            <span>Automated Scanning Schedules</span>
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold font-mono bg-indigo-100 text-indigo-800">
              {schedules.length}
            </span>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Columns */}
        <div className="lg:col-span-2 space-y-6">
          {activeSubTab === 'scanner' ? (
            <>
              {/* Drag & Drop Ingestion */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  isDragging ? 'border-indigo-600 bg-indigo-50/55' : 'border-slate-300 hover:border-indigo-400 bg-white'
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
                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-sm font-bold text-slate-800">Drag & Drop SBOM Manifest File Here</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  Supports CycloneDX JSON, SPDX, or digital binary attestations. Or <span className="text-indigo-600 font-semibold underline">click to browse</span>.
                </p>
              </div>

              {/* Universal Generic Scanner Panel */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Radar className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">Universal Software Trust Agent Scanner</h3>
                    <p className="text-[10px] text-slate-500 font-sans">Trigger the 8-engine AI Security pipeline and compile cryptographic evidence logs persistently in the database.</p>
                  </div>
                </div>

                <form onSubmit={handleCustomScanSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Software Passport Selector */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase font-mono">Software Passport Target</label>
                      <select
                        value={selectedPassportId}
                        onChange={(e) => setSelectedPassportId(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all font-sans font-bold text-slate-700"
                      >
                        {(passports || []).map(p => (
                          <option key={p.id} value={p.id}>{p.name} (v{p.version}) • {p.publisher}</option>
                        ))}
                      </select>
                    </div>

                    {/* Tenant Client Target */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase font-mono">Client (Tenant Context)</label>
                      <select
                        value={chosenClientName}
                        onChange={(e) => setChosenClientName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-all font-sans font-semibold text-slate-700"
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
                      <div className="p-3 bg-indigo-50/30 rounded-lg border border-indigo-100 text-xs flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-indigo-600" />
                          <span className="font-medium text-slate-600">Selected: <strong className="text-slate-800">{activeP.name}</strong> (v{activeP.version})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-slate-500">License: {activeP.licenseType}</span>
                          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[9px] font-bold font-mono">Verified Passport</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Action Button */}
                  <button
                    type="submit"
                    disabled={isScanning || !selectedPassportId}
                    className={`w-full py-2 px-4 rounded-lg text-xs font-bold text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      isScanning || !selectedPassportId
                        ? 'bg-slate-300 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700 shadow-sm'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Trigger Comprehensive Agent Audit & Ingestion</span>
                  </button>
                </form>
              </div>
            </>
          ) : (
            /* Automated Scanning Schedules Workspace */
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Stats Banner Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-mono font-bold text-slate-400 uppercase">Active Pipelines</div>
                    <div className="text-lg font-bold text-slate-800">
                      {schedules.filter(s => s.status === 'Active').length} / {schedules.length}
                    </div>
                    <div className="text-[9px] text-slate-500">Continuous background sweeps</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-mono font-bold text-slate-400 uppercase">Asset Coverage</div>
                    <div className="text-lg font-bold text-slate-800">
                      {(() => {
                        const uniqueProtected = new Set(schedules.filter(s => s.status === 'Active').map(s => s.assetHostName)).size;
                        return `${uniqueProtected} / ${prodAssets.length}`;
                      })()}
                    </div>
                    <div className="text-[9px] text-slate-500">Critical Production nodes covered</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
                  <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-mono font-bold text-slate-400 uppercase">Coverage Ratio</div>
                    <div className="text-lg font-bold text-slate-800">
                      {(() => {
                        const uniqueProtected = new Set(schedules.filter(s => s.status === 'Active').map(s => s.assetHostName)).size;
                        const pct = Math.round((uniqueProtected / prodAssets.length) * 100) || 0;
                        return `${pct}%`;
                      })()}
                    </div>
                    <div className="text-[9px] text-slate-500">Automated recurring security trust</div>
                  </div>
                </div>
              </div>

              {/* Configure New Scan Schedule Form */}
              {showAddSchedule && (
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-md space-y-4 animate-in slide-in-from-top duration-200" id="scan-schedule-creator-panel">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                      <Sliders className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">Configure Automated Scan Pipeline</h3>
                      <p className="text-[10px] text-slate-500 font-sans">Set up automated continuous SBOM scanning for critical tenant software endpoints.</p>
                    </div>
                  </div>

                  <form onSubmit={handleCreateSchedule} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Asset Select */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase font-mono">Target Production Asset</label>
                        <select
                          value={newScheduleAssetId}
                          onChange={(e) => setNewScheduleAssetId(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans text-slate-700 font-medium"
                        >
                          {prodAssets.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.hostName} ({a.activePassport})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Recurrence Frequency */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase font-mono">Scan Recurrence / Frequency</label>
                        <select
                          value={newScheduleFrequency}
                          onChange={(e) => setNewScheduleFrequency(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans text-slate-700 font-medium"
                        >
                          <option value="Hourly">Hourly (Continuous validation)</option>
                          <option value="Every 12 Hours">Every 12 Hours (High frequency)</option>
                          <option value="Daily">Daily (Recommended standard)</option>
                          <option value="Weekly">Weekly (Off-peak validation)</option>
                          <option value="Monthly">Monthly</option>
                        </select>
                      </div>

                      {/* Scanning Policy Rule */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase font-mono">Scanning Policy / Rule</label>
                        <select
                          value={newScheduleScanType}
                          onChange={(e) => setNewScheduleScanType(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans text-slate-700 font-medium"
                        >
                          <option value="SBOM Deep Verify">SBOM Deep Verify (CycloneDX analysis)</option>
                          <option value="Vulnerability Signature Sweep">Vulnerability Signature Sweep (Snyk matching)</option>
                          <option value="License Compliance Audit font-mono">License Compliance Audit (SPDX check)</option>
                          <option value="Cryptographic Hash Validation">Cryptographic Hash Validation (Cosign verify)</option>
                        </select>
                      </div>

                      {/* Target Run Time */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-500 uppercase font-mono">Preferred Run Window (Local Time)</label>
                        <input
                          type="text"
                          value={newScheduleStartTime}
                          onChange={(e) => setNewScheduleStartTime(e.target.value)}
                          placeholder="e.g. 02:00 AM, 11:30 PM"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans text-slate-700 font-bold"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2.5 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowAddSchedule(false)}
                        className="px-3.5 py-2 border border-slate-200 text-slate-500 font-semibold rounded-lg text-xs hover:bg-slate-50 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow-sm cursor-pointer"
                      >
                        Save Schedule Pipeline
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Active Schedules List Grid */}
              <div className="space-y-3">
                {schedules.length === 0 ? (
                  <div className="text-center p-12 bg-white border border-slate-200 rounded-xl space-y-3">
                    <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
                    <h3 className="text-sm font-bold text-slate-700">No Scanning Schedules Configured</h3>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      Automate continuous software passport and vulnerability attestation audits on your clients' production nodes. Click "Configure Scan Schedule" above to begin.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {schedules.map((schedule) => {
                      const isActive = schedule.status === 'Active';
                      return (
                        <div
                          key={schedule.id}
                          className={`p-5 bg-white border rounded-xl shadow-sm hover:shadow transition-all space-y-4 flex flex-col justify-between ${
                            isActive ? 'border-slate-200' : 'border-slate-150 opacity-75'
                          }`}
                        >
                          <div className="space-y-2.5">
                            <div className="flex items-start justify-between">
                              <div className="space-y-0.5">
                                <h4 className="font-bold text-slate-800 text-xs font-mono tracking-tight flex items-center gap-1.5">
                                  <Shield className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                  <span className="truncate max-w-[160px]" title={schedule.assetHostName}>
                                    {schedule.assetHostName}
                                  </span>
                                </h4>
                                <p className="text-[10px] text-slate-400 font-sans">
                                  Client: <strong className="text-slate-600">{schedule.clientName}</strong>
                                </p>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase font-mono ${
                                isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {schedule.status}
                              </span>
                            </div>

                            <div className="p-2.5 bg-slate-50 border border-slate-150/70 rounded-lg space-y-1.5 text-xs">
                              <div className="flex justify-between items-center text-[10px]">
                                <span className="text-slate-400 font-mono">Scanning Policy:</span>
                                <span className="font-bold text-slate-700 font-mono">{schedule.scanType}</span>
                              </div>
                              <div className="flex justify-between items-center text-[10px]">
                                <span className="text-slate-400 font-mono">Interval:</span>
                                <span className="font-semibold text-indigo-600 font-mono">{schedule.frequency}</span>
                              </div>
                            </div>

                            <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono border-t border-dashed border-slate-100 pt-2.5">
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span>Last run: <strong className="text-slate-600">{formatRunTime(schedule.lastRunAt)}</strong></span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-slate-400" />
                                <span>Next: <strong className="text-slate-600">{formatRunTime(schedule.nextRunAt)}</strong></span>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-2 pt-3 border-t border-slate-100 mt-2">
                            {/* Run Now Trigger */}
                            <button
                              onClick={() => handleRunScheduleNow(schedule)}
                              disabled={!isActive}
                              className={`flex-1 py-1.5 px-3 rounded-lg text-[10px] font-bold text-white transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                isActive ? 'bg-indigo-600 hover:bg-indigo-700 shadow-sm' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                              }`}
                              title="Trigger scanning routine immediately on this production target"
                            >
                              <Play className="w-3 h-3" />
                              <span>Run Now</span>
                            </button>

                            {/* Pause/Resume Toggle */}
                            <button
                              onClick={() => handleToggleScheduleStatus(schedule.id)}
                              className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-all text-[10px] font-semibold cursor-pointer flex items-center gap-1"
                              title={isActive ? 'Pause automated recurrences' : 'Resume automated recurrences'}
                            >
                              {isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              <span>{isActive ? 'Pause' : 'Activate'}</span>
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => handleDeleteSchedule(schedule.id)}
                              className="p-1.5 border border-slate-200 hover:border-rose-200 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-all cursor-pointer"
                              title="Delete this schedule pipeline"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scanner Console / Progress indicator */}
          {(isScanning || scanCompleted) && (
            <div className="bg-slate-950 rounded-xl p-5 border border-slate-850 shadow-md font-mono text-xs text-slate-300">
              <div className="flex justify-between items-center pb-3 border-b border-slate-800/80 mb-4">
                <span className="text-slate-400 font-bold text-[10px] uppercase">Compilation Terminal Console</span>
                <span className="text-indigo-400 text-[10px] font-bold">PROVENANCE PORT v1.0</span>
              </div>

              {/* Progress Bar */}
              {isScanning && (
                <div className="space-y-1.5 mb-4">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Attesting SBOM payload integrity...</span>
                    <span>{scanProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-indigo-500 h-full transition-all duration-100" style={{ width: `${scanProgress}%` }}></div>
                  </div>
                </div>
              )}

              {/* Console logs */}
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                {scanLogs.map((log, index) => (
                  <p
                    key={index}
                    className={
                      log.includes('[SUCCESS]') ? 'text-emerald-400 font-semibold' :
                      log.includes('[INFO]') ? 'text-slate-300' : 'text-slate-400'
                    }
                  >
                    {log}
                  </p>
                ))}
              </div>

              {scanCompleted && (
                <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between text-emerald-400 font-bold">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Dossier compiled successfully!</span>
                  </span>
                  <button
                    onClick={() => {
                      setIsScanning(false);
                      setScanCompleted(false);
                      setScanProgress(0);
                    }}
                    className="bg-indigo-600 text-white font-sans font-semibold text-[10px] uppercase px-3 py-1.5 rounded cursor-pointer hover:bg-indigo-700 transition-all"
                  >
                    Clear Console
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Scan History List */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col h-[520px]">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-xs font-bold text-slate-800 font-display">MSP Global Scan Logs</h3>
              <p className="text-[9px] text-slate-500 font-sans mt-0.5">Audit trail of system attestations</p>
            </div>
            {unclassifiedScans.length > 0 && (
              <button
                type="button"
                onClick={handleToggleSelectAllUnclassified}
                className={`px-2 py-1 rounded text-[9px] font-bold font-mono border transition-all cursor-pointer ${
                  allUnclassifiedSelected
                    ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {allUnclassifiedSelected ? 'Deselect All Unclassified' : 'Select All Unclassified'}
              </button>
            )}
          </div>

          <div className="flex-1 space-y-3.5 overflow-y-auto pr-1">
            {scans.map((s) => {
              const isUnclassified = s.scanType === 'Unclassified Attestation';
              const isSelected = selectedScanIds.includes(s.id);
              return (
                <div
                  key={s.id}
                  className={`p-3 bg-slate-50 border rounded-lg text-xs flex gap-3 items-center transition-all ${
                    isSelected ? 'border-indigo-400 bg-indigo-50/25' : 'border-slate-150'
                  }`}
                >
                  {isUnclassified && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectScan(s.id)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0 flex justify-between gap-2 items-start">
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-700 leading-snug truncate" title={s.targetName}>
                        {s.targetName}
                      </h4>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5 truncate">
                        Type: <span className={isUnclassified ? "text-amber-600 font-bold" : "text-slate-500 font-medium"}>{s.scanType}</span> • Owner: {s.clientName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold font-mono ${s.status === 'Success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {s.status}
                      </span>
                      <p className="text-[8px] font-mono text-slate-400 mt-1">{s.durationMs}ms</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Batch-tag action footer */}
          {selectedScanIds.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-150 bg-indigo-50/40 p-3 rounded-lg border border-indigo-100/70 space-y-2 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-indigo-900 uppercase font-mono tracking-wider">
                  Batch Tag {selectedScanIds.length} {selectedScanIds.length === 1 ? 'Record' : 'Records'} Selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedScanIds([])}
                  className="text-[9px] text-slate-500 hover:text-slate-800 underline cursor-pointer font-sans"
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
                  className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none font-sans font-medium text-slate-700"
                />
                <button
                  type="button"
                  onClick={handleApplyBatchTag}
                  disabled={!batchCategory.trim()}
                  className={`px-3 py-1.5 rounded text-xs font-bold text-white transition-all cursor-pointer shrink-0 ${
                    batchCategory.trim()
                      ? 'bg-indigo-600 hover:bg-indigo-700 shadow-sm'
                      : 'bg-slate-300 cursor-not-allowed'
                  }`}
                >
                  Apply & Sync
                </button>
              </div>
              <p className="text-[9px] text-slate-500 font-sans leading-tight">
                This will tag the selected records and trigger a bulk update to synchronize custom categories in the Assets inventory.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
