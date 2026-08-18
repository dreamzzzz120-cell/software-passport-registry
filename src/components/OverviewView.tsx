/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Client, Scan, SoftwarePassport, Alert } from '../types';
import { Sparkles, ShieldCheck, FileText } from 'lucide-react';

interface OverviewViewProps {
  selectedClientId: string;
  clients: Client[];
  alerts: Alert[];
  scans: Scan[];
  passports: SoftwarePassport[];
  onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void;
}

export default function OverviewView({ selectedClientId, clients, alerts, scans, passports, onOpenQuickAction }: OverviewViewProps) {
  const selectedClient = clients.find(client => client.id === selectedClientId);
  const topClients = clients
    .slice()
    .sort((a, b) => b.riskLevel.localeCompare(a.riskLevel))
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-600">SPR MSP Command Center</div>
          <h1 className="text-3xl font-display font-bold text-slate-900 dark:text-zinc-100">Attention-first situational awareness</h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            See the highest-risk tenants, evidence requests, and operational signals for your managed service portfolio in one place.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full sm:w-auto">
          <button
            onClick={() => onOpenQuickAction('add-client')}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-indigo-300"
          >
            <div className="flex items-center gap-2 text-indigo-600"><Sparkles className="w-4 h-4" />
              <span className="text-xs uppercase tracking-[0.24em] font-bold">New Client</span>
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-900">Add tenant workspace</div>
          </button>

          <button
            onClick={() => onOpenQuickAction('register-passport')}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-indigo-300"
          >
            <div className="flex items-center gap-2 text-emerald-600"><ShieldCheck className="w-4 h-4" />
              <span className="text-xs uppercase tracking-[0.24em] font-bold">Evidence</span>
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-900">Register passport</div>
          </button>

          <button
            onClick={() => onOpenQuickAction('scan-sbom')}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-indigo-300"
          >
            <div className="flex items-center gap-2 text-sky-600"><FileText className="w-4 h-4" />
              <span className="text-xs uppercase tracking-[0.24em] font-bold">Ingest</span>
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-900">Scan SBOM</div>
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-[0.24em]">Portfolio risk score</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">{clients.length ? Math.round(clients.reduce((sum, c) => sum + c.trustScore, 0) / clients.length) : 0}</p>
              </div>
              <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-700">
                <Sparkles className="w-5 h-5" />
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-500">Active clients: {clients.length} • Alerts queued: {alerts.length}</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-[0.24em]">Operational signal</p>
            <div className="mt-4 text-3xl font-semibold text-slate-900">{scans.filter(scan => scan.status !== 'Success').length}</div>
            <p className="mt-2 text-sm text-slate-500">Scans requiring attention across active tenant workloads.</p>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-[0.24em]">Selected tenant</p>
          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              {selectedClient ? selectedClient.name.charAt(0) : 'G'}
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900">{selectedClient ? selectedClient.name : 'Global Multi-Tenant Hub'}</p>
              <p className="text-sm text-slate-500">{selectedClient ? selectedClient.subscriptionTier : 'Overview across all managed tenants'}</p>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Passports</p>
              <p className="mt-1 text-xs text-slate-500">{passports.length}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Alerts</p>
              <p className="mt-1 text-xs text-slate-500">{alerts.length}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Open scans</p>
              <p className="mt-1 text-xs text-slate-500">{scans.filter(scan => scan.status !== 'Success').length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {topClients.map(client => (
          <div key={client.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-[0.24em]">{client.name}</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">{client.trustScore}% trust</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-600">{client.riskLevel}</div>
            </div>
            <p className="mt-4 text-sm text-slate-500">{client.passportCount} passports · {client.complianceProgress}% compliance</p>
          </div>
        ))}
      </div>
    </div>
  );
}
