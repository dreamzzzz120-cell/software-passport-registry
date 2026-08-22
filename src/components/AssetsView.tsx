import React, { useMemo, useState } from 'react';
import { Server, Filter } from 'lucide-react';
import { Client } from '../types';
import { filterData } from '../utils/filter';

interface AssetsViewProps {
  clients: Client[];
  searchQuery: string;
  assets?: any[];
}

export default function AssetsView({ clients, searchQuery, assets }: AssetsViewProps) {
  const [tenantFilter, setTenantFilter] = useState('all');
  const systemAssets = assets ?? [];

  const filteredAssets = useMemo(() => {
    const fuzzyFiltered = filterData(systemAssets, searchQuery, ['hostName', 'activePassport', 'type', 'OS', 'clientName']);
    return fuzzyFiltered.filter((asset) => tenantFilter === 'all' || asset.clientName === tenantFilter);
  }, [systemAssets, searchQuery, tenantFilter]);

  return (
    <div className="space-y-6" id="msp-assets-view">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900">Infrastructure Asset Mapping</h1>
          <p className="mt-1 text-xs font-sans text-slate-500">Observed infrastructure assets derived from the current passport dataset. Missing infrastructure evidence remains unverified.</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <span>Tenant Context:</span>
          <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} aria-label="Tenant context" className="cursor-pointer bg-transparent font-semibold text-slate-800 outline-none">
            <option value="all">All Tenants</option>
            {clients.map((client) => <option key={client.id} value={client.name}>{client.name}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-mono font-bold uppercase text-slate-400">
                <th className="px-5 py-3">Server Endpoint</th>
                <th className="px-5 py-3">Infrastructure Type</th>
                <th className="px-5 py-3">Owner Tenant</th>
                <th className="px-5 py-3">Environment</th>
                <th className="px-5 py-3">Host OS</th>
                <th className="px-5 py-3">Software Passport</th>
                <th className="px-5 py-3">Evidence Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filteredAssets.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-xs text-slate-400">No observed infrastructure assets matched the current filters.</td></tr>
              ) : filteredAssets.map((asset) => (
                <tr key={asset.id} className="transition-colors hover:bg-slate-50/50">
                  <td className="px-5 py-3.5"><div className="flex items-center gap-2"><Server className="h-4 w-4 text-slate-400" /><span className="font-mono font-bold text-slate-700">{asset.hostName || 'Not verified'}</span></div></td>
                  <td className="px-5 py-3.5 font-semibold text-slate-500">{asset.type || 'Not verified'}</td>
                  <td className="px-5 py-3.5 font-bold text-slate-700">{asset.clientName || 'Not verified'}</td>
                  <td className="px-5 py-3.5">{asset.environment || 'Not verified'}</td>
                  <td className="px-5 py-3.5 font-semibold text-slate-500">{asset.OS || 'Not verified'}</td>
                  <td className="px-5 py-3.5 font-bold text-slate-800">{asset.activePassport || asset.name || 'Not verified'}</td>
                  <td className="px-5 py-3.5"><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[9px] font-bold text-slate-600">Observed data only</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
