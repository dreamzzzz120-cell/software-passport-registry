import { useMemo, useState } from 'react';
import { Filter, Server } from 'lucide-react';
import type { Client } from '../types';
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
    const fuzzyFiltered = filterData(systemAssets, searchQuery, ['hostName', 'activePassport', 'name', 'type', 'OS', 'clientName']);
    return fuzzyFiltered.filter((asset) => tenantFilter === 'all' || asset.clientName === tenantFilter);
  }, [systemAssets, searchQuery, tenantFilter]);
  const observedTypes = new Set(systemAssets.map((asset) => asset.type).filter(Boolean)).size;

  return (
    <section className="space-y-4 pb-8" id="msp-assets-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e]">Asset Map</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[#605e5c]">Infrastructure records derived from the current passport dataset. Unobserved fields remain visible as unknown instead of being filled with assumptions.</p>
        </div>
        <label className="flex h-9 items-center gap-2 rounded border border-[#c8c6c4] px-3 text-[13px] text-[#323130]">
          <Filter className="h-3.5 w-3.5 text-[#8a8886]" />
          <span className="sr-only">Tenant context</span>
          <select value={tenantFilter} onChange={(event) => setTenantFilter(event.target.value)} aria-label="Tenant context" className="bg-transparent outline-none">
            <option value="all">All tenants</option>
            {clients.map((client) => <option key={client.id} value={client.name}>{client.name}</option>)}
          </select>
        </label>
      </div>

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>This is a read-only view of infrastructure asset records that were observed alongside your software passports.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Filter by tenant to scope the view to one client.</li>
            <li>Fields with no observed value are shown as "Not observed" rather than a guess.</li>
          </ol>
        </div>
      </details>

      <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <MetricItem label="Observed assets" value={systemAssets.length} />
        <MetricItem label="Asset types" value={observedTypes} />
        <MetricItem label="Evidence posture" value={systemAssets.length ? 'Observed' : 'Not observed'} />
      </div>

      <section className="rounded-md border border-[#e1dfdd] bg-white">
        <div className="flex items-center justify-between border-b border-[#e1dfdd] px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[#201f1e]">Observed infrastructure</h2>
            <p className="mt-0.5 text-[12px] text-[#605e5c]">{filteredAssets.length} matching record{filteredAssets.length === 1 ? '' : 's'}</p>
          </div>
          <span className="text-[11px] text-[#605e5c]">Read-only view</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-4 py-2 font-medium">Endpoint</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Tenant</th>
                <th className="px-4 py-2 font-medium">Environment</th>
                <th className="px-4 py-2 font-medium">Host OS</th>
                <th className="px-4 py-2 font-medium">Passport</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => (
                <tr key={asset.id} className="border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02]">
                  <td className="px-4 py-2.5"><div className="flex items-center gap-2 font-mono font-medium text-[#201f1e]"><Server className="h-3.5 w-3.5 text-[#605e5c]" />{asset.hostName || asset.name || 'Not observed'}</div></td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{asset.type || 'Not observed'}</td>
                  <td className="px-4 py-2.5 font-medium text-[#323130]">{asset.clientName || 'Not observed'}</td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{asset.environment || 'Not observed'}</td>
                  <td className="px-4 py-2.5 text-[#8a8886]">{asset.OS || 'Not observed'}</td>
                  <td className="px-4 py-2.5 font-medium text-[#323130]">{asset.activePassport || asset.name || 'Not observed'}</td>
                  <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#0e700e]"><span className="h-1.5 w-1.5 rounded-full bg-[#0e700e]" />Observed data</span></td>
                </tr>
              ))}
              {filteredAssets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center">
                    <Server className="mx-auto h-6 w-6 text-[#c8c6c4]" />
                    <p className="mt-2 text-[13px] font-medium text-[#323130]">No observed assets match this view.</p>
                    <p className="mt-1 text-[12px] text-[#8a8886]">Register or connect software evidence to expand the asset map.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function MetricItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[11px] text-[#605e5c]">{label}</div>
      <div className="text-lg font-semibold text-[#201f1e]">{value}</div>
    </div>
  );
}
