/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Search, Shield, Sparkles, Info } from 'lucide-react';
import { EXTENSIONS, type ExtensionDefinition } from '../workflows/extensionRegistry';

interface ExtensionMarketplaceProps {
  installedExtensions: string[];
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onNavigateTab: (tabId: string) => void;
}

const categoryFor = (extension: ExtensionDefinition) => {
  if (extension.id === 'agent-trust') return 'AI';
  if (extension.id === 'vendor-risk') return 'Vendor';
  if (extension.id === 'msp-compliance') return 'Compliance';
  if (extension.id === 'integrations') return 'Operations';
  return 'Security';
};

const iconFor = (extension: ExtensionDefinition) => {
  if (extension.id === 'agent-trust') return Sparkles;
  if (extension.id === 'integrations') return Shield;
  return Shield;
};

export default function ExtensionMarketplace({
  installedExtensions,
  onInstall,
  onUninstall,
  onNavigateTab,
}: ExtensionMarketplaceProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [selected, setSelected] = useState<ExtensionDefinition | null>(null);

  const categories = ['All', ...Array.from(new Set(EXTENSIONS.map(categoryFor)))];
  const filtered = useMemo(() => EXTENSIONS.filter((extension) => {
    const matchesCategory = category === 'All' || categoryFor(extension) === category;
    const haystack = `${extension.name} ${extension.shortName} ${extension.description} ${extension.steps.join(' ')}`.toLowerCase();
    return matchesCategory && haystack.includes(query.toLowerCase());
  }), [category, query]);

  const openSourceRoute = (path: string) => onNavigateTab(path);

  return (
    <section className="space-y-6" id="extension-marketplace-view">
      <header className="rounded-3xl border border-white/[.07] bg-white/[.035] p-6 backdrop-blur-2xl">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Shield size={18} /></div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200">Extension system</div>
            <h1 className="mt-1 text-2xl font-semibold">Capability Marketplace</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">This catalog describes software capabilities and workflow definitions. It does not claim tenant activity, live telemetry, popularity, deployment, certification, or provider health.</p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[.025] px-3 py-2">
          <Search size={16} className="text-slate-500" />
          <input aria-label="Search extensions" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search extensions" className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
        </div>
        <select aria-label="Filter extension category" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((extension) => {
          const Icon = iconFor(extension);
          const installed = installedExtensions.includes(extension.id);
          return <article key={extension.id} className="rounded-3xl border border-white/[.07] bg-white/[.025] p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[.03]"><Icon size={17} /></div><div><div className="text-[10px] uppercase tracking-[.16em] text-slate-600">{categoryFor(extension)}</div><h2 className="mt-1 font-semibold">{extension.name}</h2></div></div>
              {installed && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold text-emerald-200"><CheckCircle2 size={12} /> Installed</span>}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">{extension.description}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">{extension.steps.map((step) => <span key={step} className="rounded-full border border-white/[.07] px-2.5 py-1 text-[10px] text-slate-500">{step}</span>)}</div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setSelected(extension)} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200">Details</button>
              <button onClick={() => installed ? onUninstall(extension.id) : onInstall(extension.id)} className="rounded-xl bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950">{installed ? 'Remove' : 'Install'}</button>
            </div>
          </article>;
        })}
      </div>

      {selected && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" role="dialog" aria-modal="true" aria-label={`${selected.name} details`}>
        <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200">Capability definition</div><h2 className="mt-2 text-2xl font-semibold">{selected.name}</h2></div><button onClick={() => setSelected(null)} aria-label="Close extension details" className="rounded-lg border border-white/10 p-2 text-slate-400">×</button></div>
          <p className="mt-4 text-sm leading-6 text-slate-400">{selected.description}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2"><div><div className="text-[10px] uppercase tracking-[.16em] text-slate-600">Workflow steps</div><div className="mt-2 space-y-2">{selected.steps.map((step, index) => <div key={step} className="flex items-center gap-2 rounded-xl border border-white/[.07] p-3 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-white/[.04] text-xs">{index + 1}</span>{step}</div>)}</div></div><div><div className="text-[10px] uppercase tracking-[.16em] text-slate-600">Owning routes</div><div className="mt-2 space-y-2">{selected.sourceRoutes.map((route) => <button key={route} onClick={() => openSourceRoute(route)} className="flex w-full items-center justify-between rounded-xl border border-white/[.07] p-3 text-left text-sm hover:bg-white/[.03]">{route}<ChevronRight size={14} /></button>)}</div></div></div>
          <div className="mt-5 rounded-2xl border border-amber-300/10 bg-amber-300/[.04] p-4 text-xs text-amber-100/70"><Info size={14} className="mr-1 inline" /> Tenant-specific activity appears only from observed backend data; this catalog contains no synthetic activity feed.</div>
        </div>
      </div>}
    </section>
  );
}
