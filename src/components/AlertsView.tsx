/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Bell, 
  ShieldAlert, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Filter, 
  Search, 
  X, 
  ShieldCheck, 
  ChevronRight, 
  Activity, 
  Key, 
  Award,
  ExternalLink
} from 'lucide-react';
import { Alert, Severity, AlertStatus } from '../types';

interface AlertsViewProps {
  alerts: Alert[];
  onUpdateAlertStatus: (id: string, status: AlertStatus) => void;
}

export default function AlertsView({ alerts, onUpdateAlertStatus }: AlertsViewProps) {
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  const filteredAlerts = alerts.filter(a => {
    const matchesSeverity = severityFilter === 'all' || a.severity === severityFilter;
    const matchesCategory = categoryFilter === 'all' || a.category === categoryFilter;
    return matchesSeverity && matchesCategory;
  });

  const selectedAlert = alerts.find(a => a.id === selectedAlertId);

  return (
    <div className="space-y-6" id="msp-alerts-hub">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-display font-extrabold text-slate-900 dark:text-zinc-50">Security & Posture Alerts</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
            Real-time supply chain vulnerabilities, signature failures, and compliance gaps. Click any alert to inspect.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-850 border border-slate-200 dark:border-zinc-800 px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-zinc-300">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Severity:</span>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-transparent focus:outline-none font-semibold cursor-pointer text-slate-800 dark:text-zinc-250"
            >
              <option value="all">All Tiers</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-850 border border-slate-200 dark:border-zinc-800 px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-zinc-300">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent focus:outline-none font-semibold cursor-pointer text-slate-800 dark:text-zinc-250"
            >
              <option value="all">All Types</option>
              <option value="Vulnerability">Vulnerabilities</option>
              <option value="Compliance Gap">Compliance Gaps</option>
              <option value="Unverified Attestation">Attestations</option>
              <option value="Policy Violation">Policy Violations</option>
            </select>
          </div>
        </div>
      </div>

      {/* Live Alerts List */}
      <div className="space-y-4">
        {filteredAlerts.map((alert) => (
          <div
            key={alert.id}
            onClick={() => setSelectedAlertId(alert.id)}
            className={`bg-white dark:bg-zinc-950 rounded-xl border p-5 shadow-sm flex flex-col md:flex-row justify-between gap-4 transition-all hover:shadow-md cursor-pointer group ${
              selectedAlertId === alert.id ? 'ring-2 ring-indigo-500/20 border-indigo-500' : 'border-slate-200 dark:border-zinc-850'
            } ${alert.status === 'Resolved' ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start gap-3.5 flex-1">
              <span className={`p-2.5 rounded-lg mt-0.5 shrink-0 ${
                alert.status === 'Resolved' ? 'bg-slate-100 dark:bg-zinc-800 text-slate-400' :
                alert.severity === 'Critical' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400' :
                alert.severity === 'High' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400' :
                'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
              }`}>
                {alert.severity === 'Critical' ? <ShieldAlert className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              </span>

              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-mono font-bold bg-indigo-50 border border-indigo-200/50 text-indigo-700 dark:bg-indigo-950/30 dark:border-indigo-900/40 dark:text-indigo-450 px-2 py-0.5 rounded">
                    {alert.clientName}
                  </span>
                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
                    alert.severity === 'Critical' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-400' :
                    alert.severity === 'High' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400' :
                    'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-400'
                  }`}>
                    {alert.severity} Risk
                  </span>
                  <span className="text-[9px] font-mono font-bold bg-slate-100 border border-slate-200 text-slate-600 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded">
                    {alert.category}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-450 transition-colors">
                  {alert.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed max-w-2xl">{alert.description}</p>
                <span className="text-[9px] text-slate-400 dark:text-zinc-500 font-mono block pt-1">Identified: {alert.timestamp}</span>
              </div>
            </div>

            {/* Quick status pill */}
            <div className="flex md:flex-col justify-end items-end gap-2 shrink-0 font-mono text-[10px]">
              <span className={`px-2.5 py-0.5 rounded font-bold uppercase border mb-1 block ${
                alert.status === 'Active' ? 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-450' :
                alert.status === 'Snoozed' ? 'bg-slate-100 border-slate-200 text-slate-500 dark:bg-zinc-800 dark:border-zinc-750 dark:text-zinc-400' :
                'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-450'
              }`}>
                {alert.status}
              </span>
              
              <span className="text-indigo-600 dark:text-indigo-400 text-[11px] font-bold flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span>Remediate</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Slide-out Alert Details and Remediation Drawer */}
      <AnimatePresence>
        {selectedAlertId && selectedAlert && (
          <>
            {/* Backdrop with blur */}
            <motion.div
              key="alerts-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedAlertId(null)}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 cursor-pointer"
            />

            {/* Slide-out Panel */}
            <motion.div
              key="alerts-drawer-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 180 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-slate-50 dark:bg-zinc-900 border-l border-slate-200 dark:border-zinc-800 shadow-2xl z-50 overflow-y-auto p-6 flex flex-col space-y-6"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    selectedAlert.status === 'Resolved' ? 'bg-slate-100 text-slate-400' :
                    selectedAlert.severity === 'Critical' ? 'bg-rose-50 dark:bg-rose-950 text-rose-600' :
                    'bg-amber-50 dark:bg-amber-950 text-amber-600'
                  }`}>
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
                      THREAT MITIGATION HUB
                    </span>
                    <h2 className="text-sm font-display font-extrabold text-slate-900 dark:text-zinc-50 leading-tight">
                      {selectedAlert.id} : Threat Context
                    </h2>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedAlertId(null)}
                  className="p-1.8 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 rounded-lg text-slate-400 hover:text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-200 cursor-pointer transition-colors"
                  title="Close Drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Alert Meta Tags */}
              <div className="flex flex-wrap gap-2 text-[10px] font-mono shrink-0">
                <span className="bg-slate-100 dark:bg-zinc-850 text-slate-600 dark:text-zinc-300 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-zinc-800">
                  Tenant: {selectedAlert.clientName}
                </span>
                <span className="bg-slate-100 dark:bg-zinc-850 text-slate-600 dark:text-zinc-300 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-zinc-800">
                  Type: {selectedAlert.category}
                </span>
                <span className={`px-2.5 py-1.5 rounded-md font-bold border ${
                  selectedAlert.severity === 'Critical' ? 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-400' :
                  'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400'
                }`}>
                  Severity: {selectedAlert.severity}
                </span>
              </div>

              {/* Body Content Scroll area */}
              <div className="flex-1 overflow-y-auto space-y-6">
                
                {/* Visual CVE CVSS Score Dial Card */}
                <div className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded-xl p-5 shadow-xs space-y-3.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase">CVSS Threat Intensity Vector</span>
                    <span className="text-[9px] bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 text-rose-600 dark:text-rose-400 px-2 py-0.5 rounded font-mono font-bold">
                      Advisory status unavailable
                    </span>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Ring indicator */}
                    <div className="relative w-16 h-16 shrink-0 flex items-center justify-center font-mono rounded-full bg-rose-50 dark:bg-rose-950/20 border-2 border-rose-500 text-rose-600 dark:text-rose-400">
                      <span className="text-xl font-extrabold">{selectedAlert.severity === 'Critical' ? '9.8' : '7.5'}</span>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200">{selectedAlert.title}</h4>
                      <p className="text-[11px] text-slate-400 dark:text-zinc-500 leading-relaxed mt-1 font-mono">
                        CVE-2024 active signature exploit is weaponized inside secondary builds.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Threat description */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 font-mono uppercase tracking-wider">Detailed Threat Intelligence Analysis</h3>
                  <div className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-slate-200 dark:border-zinc-850 text-xs leading-relaxed text-slate-600 dark:text-zinc-300">
                    <p>{selectedAlert.description}</p>
                    <p className="mt-3 text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                      Impact profile: This threat allows execution container bypass, resulting in potential host level compromise if not mitigated within the 48-hour SLA period.
                    </p>
                  </div>
                </div>

                {/* Mitigate action selector */}
                <div className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded-xl p-5 space-y-4">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display">Sovereign SLA Resolution Controls</h4>
                  
                  {selectedAlert.status === 'Active' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => {
                          onUpdateAlertStatus(selectedAlert.id, 'Snoozed');
                          setSelectedAlertId(null);
                        }}
                        className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-850 text-slate-700 dark:text-zinc-300 font-mono font-bold text-xs py-2.5 rounded-lg transition-colors cursor-pointer text-center"
                      >
                        Snooze Threat (24h)
                      </button>
                      <button
                        onClick={() => {
                          onUpdateAlertStatus(selectedAlert.id, 'Resolved');
                          setSelectedAlertId(null);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-bold text-xs py-2.5 rounded-lg transition-colors cursor-pointer text-center"
                      >
                        Sign Mitigation Proof
                      </button>
                    </div>
                  ) : selectedAlert.status === 'Snoozed' ? (
                    <button
                      onClick={() => {
                        onUpdateAlertStatus(selectedAlert.id, 'Active');
                        setSelectedAlertId(null);
                      }}
                      className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-zinc-850 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-750 text-slate-700 dark:text-zinc-300 font-mono font-bold text-xs py-2.5 rounded-lg transition-colors cursor-pointer text-center"
                    >
                      Restore Active Threat Level
                    </button>
                  ) : (
                    <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/60 p-4 rounded-lg flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs">
                      <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
                      <div>
                        <p className="font-bold">Remediation task resolved</p>
                        <p className="text-[10px] text-emerald-500 mt-0.5">Resolution is recorded. New evidence is still required to verify the finding is no longer detected.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
