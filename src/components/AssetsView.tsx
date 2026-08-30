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
      <header className="spr-panel p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#9cdcfe]"><Server className="h-4 w-4" /> Software reality</div><h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--spr-text)]">Asset map</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Infrastructure records derived from the current passport dataset. Unobserved fields remain visible as unknown instead of being filled with assumptions.</p></div>
          <label className="flex items-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-xs text-[var(--spr-text-muted)]"><Filter className="h-4 w-4 text-[var(--spr-text-faint)]" /><span className="sr-only">Tenant context</span><select value={tenantFilter} onChange={(event) => setTenantFilter(event.target.value)} aria-label="Tenant context" className="bg-transparent font-semibold text-[var(--spr-text)] outline-none"><option value="all">All tenants</option>{clients.map((client) => <option key={client.id} value={client.name}>{client.name}</option>)}</select></label>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3"><Metric label="Observed assets" value={systemAssets.length} icon={<Server />} /><Metric label="Asset types" value={observedTypes} icon={<Layers3 />} /><Metric label="Evidence posture" value={systemAssets.length ? 'Observed' : 'Not observed'} icon={<ShieldCheck />} /></div>
      </header>

      <section className="spr-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--spr-border)] px-5 py-4 md:px-6"><div><h2 className="text-sm font-semibold text-[var(--spr-text)]">Observed infrastructure</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">{filteredAssets.length} matching record{filteredAssets.length === 1 ? '' : 's'}</p></div><span className="rounded-sm border border-[var(--spr-border)] px-2.5 py-1 text-[10px] text-[var(--spr-highlight)]">Read-only view</span></div>
        <div className="overflow-x-auto"><table className="spr-table w-full min-w-[840px]"><thead><tr><th>Endpoint</th><th>Type</th><th>Tenant</th><th>Environment</th><th>Host OS</th><th>Passport</th><th>Status</th></tr></thead><tbody>{filteredAssets.map((asset) => <tr key={asset.id}><td><div className="flex items-center gap-2 font-mono font-semibold text-[var(--spr-text)]"><Server className="h-4 w-4 text-[var(--spr-highlight)]" />{asset.hostName || asset.name || 'Not observed'}</div></td><td className="text-[var(--spr-text-muted)]">{asset.type || 'Not observed'}</td><td className="font-semibold text-[var(--spr-text)]">{asset.clientName || 'Not observed'}</td><td className="text-[var(--spr-text-muted)]">{asset.environment || 'Not observed'}</td><td className="text-[var(--spr-text-muted)]">{asset.OS || 'Not observed'}</td><td className="font-semibold text-[var(--spr-text)]">{asset.activePassport || asset.name || 'Not observed'}</td><td><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--spr-green)]"><span className="spr-status-dot spr-status-dot--green" />Observed data</span></td></tr>)}{filteredAssets.length === 0 && <tr><td colSpan={7} className="px-5 py-14 text-center"><Server className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]" /><p className="mt-3 text-sm font-semibold text-[var(--spr-text)]">No observed assets match this view.</p><p className="mt-1 text-xs text-[var(--spr-text-faint)]">Register or connect software evidence to expand the asset map.</p></td></tr>}</tbody></table></div>
      </section>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]"><span className="h-4 w-4 text-[var(--spr-highlight)]">{icon}</span>{label}</div><div className="mt-3 text-2xl font-semibold text-[var(--spr-text)]">{value}</div></div>;
}
