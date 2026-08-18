/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { fuzzyMatch, filterData } from '../utils/filter';
import { Server, ShieldCheck, ShieldAlert, Cpu, HardDrive, Search, Filter, Wrench } from 'lucide-react';
import { Client } from '../types';

interface AssetsViewProps {
  clients: Client[];
  searchQuery: string;
  assets?: any[];
  onUpdateAssets?: React.Dispatch<React.SetStateAction<any[]>>;
}

export default function AssetsView({ clients, searchQuery, assets, onUpdateAssets }: AssetsViewProps) {
  const [tenantFilter, setTenantFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const systemAssets = assets ?? [];

  // Filter assets using useMemo and filterData utility
  const filteredAssets = useMemo(() => {
    const fuzzyFiltered = filterData(systemAssets, searchQuery, ['hostName', 'activePassport', 'type', 'OS', 'clientName']);
    return fuzzyFiltered.filter(asset => {
      const matchesTenant = tenantFilter === 'all' || asset.clientName === tenantFilter;
      return matchesTenant;
    });
  }, [systemAssets, searchQuery, tenantFilter]);

  // Reset selected IDs when search query or tenant filter changes to prevent accidental out-of-view bulk actions
  useEffect(() => {
    setSelectedIds([]);
  }, [searchQuery, tenantFilter]);

  // Helper selectors
  const isAllSelected = filteredAssets.length > 0 && filteredAssets.every(a => selectedIds.includes(a.id));
  const isSomeSelected = filteredAssets.length > 0 && filteredAssets.some(a => selectedIds.includes(a.id)) && !isAllSelected;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const visibleIds = filteredAssets.map(a => a.id);
      setSelectedIds(visibleIds);
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(item => item !== id));
    }
  };

  const handleBulkRemediate = () => {
    if (selectedIds.length === 0) return;

    // Update the health status of selected assets to 'Under Remediation'
    const updatedAssets = systemAssets.map(asset => {
      if (selectedIds.includes(asset.id)) {
        return {
          ...asset,
          health: 'Under Remediation'
        };
      }
      return asset;
    });

    if (onUpdateAssets) {
      onUpdateAssets(updatedAssets);
    }

    setSuccessMessage(`Successfully flagged ${selectedIds.length} ${selectedIds.length === 1 ? 'asset' : 'assets'} for remediation!`);
    setSelectedIds([]);

    setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);
  };

  return (
    <div className="space-y-6" id="msp-assets-view">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900">Infrastructure Asset Mapping</h1>
          <p className="text-xs text-slate-500 font-sans mt-1">
            Track host servers, virtual containers, and bare-metal nodes executing registered software passports.
          </p>
        </div>

        {/* Tenant Filter */}
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs text-slate-600">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span>Tenant Context:</span>
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="bg-transparent focus:outline-none font-semibold cursor-pointer text-slate-800"
          >
            <option value="all">All Tenants</option>
            {clients.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Local Notification Alert banner */}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3.5 text-xs flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-500 hover:text-emerald-700 text-xs font-bold font-mono px-1 transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {/* Assets Grid Ledger */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Bulk Action Header Bar */}
        {selectedIds.length > 0 && (
          <div className="bg-indigo-50/80 border-b border-indigo-100 px-5 py-3 flex flex-col sm:flex-row justify-between items-center gap-3 transition-all">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              <span className="text-xs font-bold text-indigo-900 font-mono">
                {selectedIds.length} {selectedIds.length === 1 ? 'Asset' : 'Assets'} Selected
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2.5 py-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              >
                Clear Selection
              </button>
              <button
                type="button"
                onClick={handleBulkRemediate}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Flag for Remediation</span>
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-mono text-slate-400 font-bold uppercase">
                <th className="px-5 py-3 w-10">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = isSomeSelected;
                        }
                      }}
                      onChange={handleSelectAll}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                    />
                  </div>
                </th>
                <th className="px-5 py-3">Server Endpoint (Host FQDN)</th>
                <th className="px-5 py-3">Infrastructure Type</th>
                <th className="px-5 py-3">Owner Tenant</th>
                <th className="px-5 py-3">Environment</th>
                <th className="px-5 py-3">Host Operating System</th>
                <th className="px-5 py-3">Running Software Passport</th>
                <th className="px-5 py-3">Compliance Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400 font-sans text-xs">
                    No infrastructure assets matched your current search and filters.
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => {
                  const isSelected = selectedIds.includes(asset.id);
                  return (
                    <tr 
                      key={asset.id} 
                      className={`hover:bg-slate-50/50 transition-colors ${isSelected ? 'bg-indigo-50/30' : ''}`}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => handleSelectRow(asset.id, e.target.checked)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                          />
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <Server className="w-4 h-4 text-slate-400 font-bold" />
                          <span className="font-mono font-bold text-slate-700">{asset.hostName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 font-semibold">{asset.type}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-700">{asset.clientName}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                          asset.environment === 'Production' ? 'bg-indigo-50 border border-indigo-200 text-indigo-700' : 'bg-slate-50 border border-slate-200 text-slate-500'
                        }`}>
                          {asset.environment}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 font-semibold">{asset.OS}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-800 flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                        <span>{asset.activePassport}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold ${
                          asset.health === 'Compliant' 
                            ? 'bg-emerald-100 text-emerald-800' 
                            : asset.health === 'Under Remediation' || asset.health === 'Remediating' || asset.health === 'Flagged'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {asset.health}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
