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
  if (extension.id === 'agent-trust') return 'Specialized';
  if (extension.id === 'vendor-risk') return 'Specialized';
  return 'Core';
};

const scopeFor = (extension: ExtensionDefinition) => {
  if (extension.id === 'new-review') return 'INTAKE';
  if (extension.id === 'trust-evidence') return 'ANALYSIS';
  if (extension.id === 'msp-command-center') return 'MSP OPERATIONS';
  if (extension.id === 'integrations') return 'SYSTEM BOUNDARY';
  if (extension.id === 'agent-trust') return 'AI TRUST';
  if (extension.id === 'vendor-risk') return 'SUPPLIER RISK';
  return 'CAPABILITY';
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
    const haystack = `${extension.name} ${extension.shortName} ${extension.description} ${extension.steps.join(' ')} ${scopeFor(extension)}`.toLowerCase();
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

  return <section className="space-y-5" id="extension-marketplace-view">
    <header className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#c586c0]/40 bg-[var(--spr-accent-soft)] text-[#c586c0]"><Shield size={17} /></div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#c586c0]">SPR capability system</div>
          <h1 className="mt-1 text-xl font-semibold">Capabilities</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">One canonical workflow per responsibility. Core capabilities form the SPR operating model; specialized capabilities extend it without creating parallel evidence, findings, or MSP workflows.</p>
        </div>
      </div>
      {error && <div role="alert" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[.05] px-3 py-2 text-xs text-amber-100">{error}</div>}
    </header>

    <div className="flex flex-wrap gap-2.5">
      <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-2">
        <Search size={15} className="text-[var(--spr-text-muted)]" />
        <input aria-label="Search capabilities" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search capabilities" className="w-full bg-transparent text-sm text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-faint)]" />
      </label>
      <select aria-label="Filter capability category" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-sm text-[var(--spr-text)]">{categories.map((item) => <option key={item}>{item}</option>)}</select>
    </div>

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {filtered.map((extension) => {
        const installedNow = installed.includes(extension.id);
        return <article key={extension.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 transition-colors hover:border-[var(--spr-border-strong,var(--spr-border))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="text-[9px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">{categoryFor(extension)}</span><span className="rounded-full border border-[var(--spr-border)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--spr-text-faint)]">{scopeFor(extension)}</span></div><h2 className="mt-1 font-semibold">{extension.name}</h2></div>
            {installedNow && <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--spr-green)]/40 bg-[var(--spr-green)]/15 px-2 py-1 text-[10px] font-semibold text-[var(--spr-green)]"><CheckCircle2 size={12} /> Installed</span>}
          </div>
          <p className="mt-2.5 text-sm leading-5 text-[var(--spr-text-muted)]">{extension.description}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{extension.steps.map((step) => <span key={step} className="rounded-full border border-[var(--spr-border)] px-2 py-1 text-[9px] text-[var(--spr-text-muted)]">{step}</span>)}</div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setSelected(extension)} className="rounded-xl border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)]">Details</button>
            <button disabled={!canManage || busyId === extension.id} title={!canManage ? `Your ${role} role cannot install or remove extensions.` : undefined} onClick={() => void toggleInstallation(extension)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{installedNow ? <Trash2 size={13}/> : <Download size={13}/>} {busyId === extension.id ? 'Saving…' : installedNow ? 'Remove' : 'Install'}</button>
          </div>
        </article>;
      })}
    </div>

    {selected && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5" role="dialog" aria-modal="true" aria-label={`${selected.name} details`}>
      <div className="w-full max-w-2xl rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">{categoryFor(selected)} capability · {scopeFor(selected)}</div><h2 className="mt-2 text-xl font-semibold">{selected.name}</h2></div><button onClick={() => setSelected(null)} aria-label="Close capability details" className="rounded-lg border border-[var(--spr-border)] p-2 text-[var(--spr-text-muted)]">×</button></div>
        <p className="mt-3 text-sm leading-6 text-[var(--spr-text-muted)]">{selected.description}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2"><div><div className="text-[10px] uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Workflow</div><div className="mt-2 space-y-2">{selected.steps.map((step, index) => <div key={step} className="flex items-center gap-2 rounded-xl border border-[var(--spr-border)] p-2.5 text-sm"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--spr-surface-alt)] text-xs">{index + 1}</span>{step}</div>)}</div></div><div><div className="text-[10px] uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Owning surfaces</div><div className="mt-2 space-y-2">{selected.sourceRoutes.map((route) => <button key={route} onClick={() => onNavigateTab?.(route)} className="flex w-full items-center justify-between rounded-xl border border-[var(--spr-border)] p-2.5 text-left text-sm hover:bg-[var(--spr-surface-alt)]">{route}<ChevronRight size={14} /></button>)}</div></div></div>
        <div className="mt-4 rounded-md border border-amber-300/10 bg-amber-300/[.04] p-3 text-xs text-amber-100/70"><Info size={14} className="mr-1 inline" /> Tenant-specific activity is shown only from observed backend state.</div>
      </div>
    </div>}
  </section>;
}
