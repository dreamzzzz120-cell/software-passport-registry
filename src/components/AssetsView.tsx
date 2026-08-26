import { useMemo, useState, type ReactNode } from 'react';
import { Filter, Layers3, Server, ShieldCheck } from 'lucide-react';
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
    <section className="space-y-6" id="msp-assets-view">
      <header className="rounded-[28px] border border-white/10 bg-white/[.035] p-6 backdrop-blur-2xl md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200"><Server className="h-4 w-4" /> Software reality</div><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Asset map</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Infrastructure records derived from the current passport dataset. Unobserved fields remain visible as unknown instead of being filled with assumptions.</p></div>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-slate-400"><Filter className="h-4 w-4 text-slate-600" /><span className="sr-only">Tenant context</span><select value={tenantFilter} onChange={(event) => setTenantFilter(event.target.value)} aria-label="Tenant context" className="bg-transparent font-semibold text-slate-200 outline-none"><option value="all">All tenants</option>{clients.map((client) => <option key={client.id} value={client.name}>{client.name}</option>)}</select></label>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3"><Metric label="Observed assets" value={systemAssets.length} icon={<Server />} /><Metric label="Asset types" value={observedTypes} icon={<Layers3 />} /><Metric label="Evidence posture" value={systemAssets.length ? 'Observed' : 'Not observed'} icon={<ShieldCheck />} /></div>
      </header>

      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[.025] backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4 md:px-6"><div><h2 className="text-sm font-semibold text-white">Observed infrastructure</h2><p className="mt-1 text-xs text-slate-500">{filteredAssets.length} matching record{filteredAssets.length === 1 ? '' : 's'}</p></div><span className="rounded-full border border-cyan-300/15 bg-cyan-300/[.05] px-2.5 py-1 text-[10px] text-cyan-200">Read-only view</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[840px] border-collapse text-left text-xs"><thead><tr className="border-b border-white/[.07] bg-black/15 text-[10px] font-bold uppercase tracking-[.14em] text-slate-600"><th className="px-5 py-3">Endpoint</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Tenant</th><th className="px-5 py-3">Environment</th><th className="px-5 py-3">Host OS</th><th className="px-5 py-3">Passport</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-white/[.06]">{filteredAssets.map((asset) => <tr key={asset.id} className="transition-colors hover:bg-white/[.035]"><td className="px-5 py-4"><div className="flex items-center gap-2 font-mono font-semibold text-slate-200"><Server className="h-4 w-4 text-cyan-200" />{asset.hostName || asset.name || 'Not observed'}</div></td><td className="px-5 py-4 text-slate-400">{asset.type || 'Not observed'}</td><td className="px-5 py-4 font-semibold text-slate-300">{asset.clientName || 'Not observed'}</td><td className="px-5 py-4 text-slate-400">{asset.environment || 'Not observed'}</td><td className="px-5 py-4 text-slate-500">{asset.OS || 'Not observed'}</td><td className="px-5 py-4 font-semibold text-slate-300">{asset.activePassport || asset.name || 'Not observed'}</td><td className="px-5 py-4"><span className="rounded-full border border-emerald-300/20 bg-emerald-300/[.06] px-2.5 py-1 text-[10px] font-semibold text-emerald-200">Observed data</span></td></tr>)}{filteredAssets.length === 0 && <tr><td colSpan={7} className="px-5 py-14 text-center"><Server className="mx-auto h-8 w-8 text-slate-700" /><p className="mt-3 text-sm font-semibold text-slate-300">No observed assets match this view.</p><p className="mt-1 text-xs text-slate-600">Register or connect software evidence to expand the asset map.</p></td></tr>}</tbody></table></div>
      </section>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-500"><span className="h-4 w-4 text-cyan-200">{icon}</span>{label}</div><div className="mt-3 text-2xl font-semibold text-white">{value}</div></div>;
}
