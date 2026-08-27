/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Info, Search, Shield, Trash2, Download } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { EXTENSIONS, type ExtensionDefinition } from '../workflows/extensionRegistry';

interface ExtensionMarketplaceProps {
  installedExtensions?: string[];
  onInstall?: (id: string) => void;
  onUninstall?: (id: string) => void;
  onNavigateTab?: (tabId: string) => void;
  role?: string;
}

const categoryFor = (extension: ExtensionDefinition) => {
  if (extension.id === 'agent-trust') return 'AI';
  if (extension.id === 'vendor-risk') return 'Vendor';
  if (extension.id === 'msp-compliance') return 'Compliance';
  if (extension.id === 'integrations') return 'Operations';
  return 'Security';
};

export default function ExtensionMarketplace({ onNavigateTab, role = 'Viewer' }: ExtensionMarketplaceProps) {
  // Matches backend gating exactly: POST/DELETE /api/user/extensions/:id
  // require Owner/Admin/Operator (auth.ts).
  const canManage = ['Owner', 'Admin', 'Operator'].includes(role);
  const [installed, setInstalled] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [selected, setSelected] = useState<ExtensionDefinition | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch('/api/user/extensions').then(async (response) => {
      if (!response.ok) throw new Error('Unable to load installation state');
      const rows = await response.json().catch(() => []);
      const ids = Array.isArray(rows) ? rows.map((row: any) => String(row.extensionId ?? row.extension_id ?? '')).filter(Boolean) : [];
      if (!cancelled) setInstalled(ids);
    }).catch(() => {
      if (!cancelled) setError('Installed-extension state is unavailable.');
    });
    return () => { cancelled = true; };
  }, []);

  const categories = ['All', ...Array.from(new Set(EXTENSIONS.map(categoryFor)))];
  const filtered = useMemo(() => EXTENSIONS.filter((extension) => {
    const matchesCategory = category === 'All' || categoryFor(extension) === category;
    const haystack = `${extension.name} ${extension.shortName} ${extension.description} ${extension.steps.join(' ')}`.toLowerCase();
    return matchesCategory && haystack.includes(query.toLowerCase());
  }), [category, query]);

  const toggleInstallation = async (extension: ExtensionDefinition) => {
    if (!canManage) { setError(`Your ${role} role cannot install or remove extensions.`); return; }
    setBusyId(extension.id);
    setError(null);
    const isInstalled = installed.includes(extension.id);
    try {
      const response = await apiFetch(`/api/user/extensions/${encodeURIComponent(extension.id)}`, { method: isInstalled ? 'DELETE' : 'POST' });
      if (response.status === 403) throw new Error(`Your ${role} role cannot ${isInstalled ? 'remove' : 'install'} extensions.`);
      if (!response.ok) throw new Error('installation request failed');
      setInstalled((current) => isInstalled ? current.filter((id) => id !== extension.id) : [...current, extension.id]);
    } catch (err) {
      setError(err instanceof Error && err.message.includes('role') ? err.message : `Could not ${isInstalled ? 'remove' : 'install'} ${extension.name}.`);
    } finally {
      setBusyId(null);
    }
  };

  return <section className="space-y-6" id="extension-marketplace-view">
    <header className="rounded-md border border-[#3c3c3c] bg-[#252526] p-6 ">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-[#c586c0]/40 bg-[#094771] text-[#c586c0]"><Shield size={18} /></div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#c586c0]">Extension system</div>
          <h1 className="mt-1 text-2xl font-semibold">Capability Marketplace</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#9d9d9d]">The catalog describes capabilities and workflow definitions. Installation state is tenant-scoped and persisted through the authenticated backend. It does not present synthetic popularity, activity, deployment, certification, or provider-health claims.</p>
        </div>
      </div>
      {(error) && <div role="alert" className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[.05] px-3 py-2 text-xs text-amber-100">{error}</div>}
    </header>

    <div className="flex flex-wrap gap-3">
      <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#252526] px-3 py-2">
        <Search size={16} className="text-[#9d9d9d]" />
        <input aria-label="Search extensions" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search extensions" className="w-full bg-transparent text-sm text-[#d4d4d4] outline-none placeholder:text-[#6f6f6f]" />
      </label>
      <select aria-label="Filter extension category" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-[#3c3c3c] bg-[#1e1e1e] px-3 py-2 text-sm text-[#d4d4d4]">{categories.map((item) => <option key={item}>{item}</option>)}</select>
    </div>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {filtered.map((extension) => {
        const installedNow = installed.includes(extension.id);
        return <article key={extension.id} className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
          <div className="flex items-start justify-between gap-4">
            <div><div className="text-[10px] uppercase tracking-[.16em] text-[#6f6f6f]">{categoryFor(extension)}</div><h2 className="mt-1 font-semibold">{extension.name}</h2></div>
            {installedNow && <span className="inline-flex items-center gap-1 rounded-full border border-[#89d185]/40 bg-[#89d185]/15 px-2 py-1 text-[10px] font-semibold text-[#89d185]"><CheckCircle2 size={12} /> Installed</span>}
          </div>
          <p className="mt-3 text-sm leading-6 text-[#9d9d9d]">{extension.description}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">{extension.steps.map((step) => <span key={step} className="rounded-full border border-[#3c3c3c] px-2.5 py-1 text-[10px] text-[#9d9d9d]">{step}</span>)}</div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setSelected(extension)} className="rounded-xl border border-[#3c3c3c] px-3 py-2 text-xs font-semibold text-[#d4d4d4]">Details</button>
            <button disabled={!canManage || busyId === extension.id} title={!canManage ? `Your ${role} role cannot install or remove extensions.` : undefined} onClick={() => void toggleInstallation(extension)} className="inline-flex items-center gap-2 rounded-xl bg-[#0e639c] px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{installedNow ? <Trash2 size={13}/> : <Download size={13}/>} {busyId === extension.id ? 'Saving…' : installedNow ? 'Remove' : 'Install'}</button>
          </div>
        </article>;
      })}
    </div>

    {selected && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" role="dialog" aria-modal="true" aria-label={`${selected.name} details`}>
      <div className="w-full max-w-2xl rounded-md border border-[#3c3c3c] bg-[#1e1e1e] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#3794ff]">Capability definition</div><h2 className="mt-2 text-2xl font-semibold">{selected.name}</h2></div><button onClick={() => setSelected(null)} aria-label="Close extension details" className="rounded-lg border border-[#3c3c3c] p-2 text-[#9d9d9d]">×</button></div>
        <p className="mt-4 text-sm leading-6 text-[#9d9d9d]">{selected.description}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2"><div><div className="text-[10px] uppercase tracking-[.16em] text-[#6f6f6f]">Workflow steps</div><div className="mt-2 space-y-2">{selected.steps.map((step, index) => <div key={step} className="flex items-center gap-2 rounded-xl border border-[#3c3c3c] p-3 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#252526] text-xs">{index + 1}</span>{step}</div>)}</div></div><div><div className="text-[10px] uppercase tracking-[.16em] text-[#6f6f6f]">Owning routes</div><div className="mt-2 space-y-2">{selected.sourceRoutes.map((route) => <button key={route} onClick={() => onNavigateTab?.(route)} className="flex w-full items-center justify-between rounded-xl border border-[#3c3c3c] p-3 text-left text-sm hover:bg-[#252526]">{route}<ChevronRight size={14} /></button>)}</div></div></div>
        <div className="mt-5 rounded-md border border-amber-300/10 bg-amber-300/[.04] p-4 text-xs text-amber-100/70"><Info size={14} className="mr-1 inline" /> Tenant-specific activity is shown only from observed backend state.</div>
      </div>
    </div>}
  </section>;
}
