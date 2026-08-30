/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { ShieldCheck, Search, Info } from 'lucide-react';
import { Client } from '../types';

interface EnterpriseReadinessViewProps { clients: Client[]; }
type EvidenceStatus = 'Observed' | 'Calculated' | 'Not verified';
interface Capability { id: string; category: string; name: string; description: string; status: EvidenceStatus; evidence?: string; }

// Evidence-first catalog. Product capability is not treated as proof of deployment.
const capabilityCatalog: Capability[] = [
  { id: 'ent-1', category: 'Enterprise', name: 'Client workspaces', description: 'Workspace capability exposed by the application.', status: 'Observed', evidence: 'Client records are supplied to this view.' },
  { id: 'ent-2', category: 'Enterprise', name: 'Team management', description: 'Team-management capability.', status: 'Not verified' },
  { id: 'ent-3', category: 'Enterprise', name: 'Organization hierarchy', description: 'Organization hierarchy capability.', status: 'Not verified' },
  { id: 'ent-4', category: 'Enterprise', name: 'Vendor management', description: 'Vendor-management capability.', status: 'Not verified' },
  { id: 'sec-1', category: 'Security', name: 'Dependency monitoring', description: 'Dependency evidence can be surfaced when supplied by scans.', status: 'Not verified' },
  { id: 'sec-2', category: 'Security', name: 'SBOM generation', description: 'SBOM evidence capability.', status: 'Not verified' },
  { id: 'comp-1', category: 'Compliance', name: 'Compliance evidence mapping', description: 'Compliance status is shown only when backed by evidence.', status: 'Not verified' },
  { id: 'int-1', category: 'Integrations', name: 'Source-control integrations', description: 'Source-control integration capability.', status: 'Not verified' },
  { id: 'ai-1', category: 'AI', name: 'AI risk analysis', description: 'AI analysis capability.', status: 'Not verified' },
  { id: 'trust-1', category: 'Trust', name: 'Software Passport evidence', description: 'Passport evidence derived from supplied passport records.', status: 'Not verified' },
];

export default function EnterpriseReadinessView({ clients }: EnterpriseReadinessViewProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const categories = ['All', ...Array.from(new Set(capabilityCatalog.map(c => c.category)))];
  const filtered = useMemo(() => capabilityCatalog.filter(c =>
    (category === 'All' || c.category === category) && c.name.toLowerCase().includes(query.toLowerCase())
  ), [query, category]);
  const observedCount = filtered.filter(c => c.status === 'Observed').length;
  const calculatedCount = filtered.filter(c => c.status === 'Calculated').length;
  const unverifiedCount = filtered.filter(c => c.status === 'Not verified').length;

  return <div className="space-y-6">
    <header className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--spr-amber)]"><ShieldCheck size={18}/> Enterprise Readiness</div>
          <h1 className="mt-2 text-2xl font-bold">Evidence-backed readiness</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/60">Claims are not inferred from UI components. Deployment, certifications, infrastructure, pentests, integrations and telemetry remain unverified until supporting evidence is available.</p>
        </div>
        <div className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60"><Info size={14} className="inline mr-1"/> Evidence-first</div>
      </div>
    </header>

    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Metric label="Observed" value={observedCount}/>
      <Metric label="Calculated" value={calculatedCount}/>
      <Metric label="Not verified" value={unverifiedCount}/>
    </div>

    <div className="flex flex-wrap gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2"><Search size={16}/><input aria-label="Search capabilities" className="bg-transparent outline-none text-sm" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search capabilities"/></div>
      <select aria-label="Filter capability category" className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select>
    </div>

    <div className="space-y-3">{filtered.map(c => <article key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-4"><div><div className="text-xs text-white/40">{c.category}</div><h2 className="font-semibold">{c.name}</h2></div><Status status={c.status}/></div>
      <p className="mt-2 text-sm text-white/60">{c.description}</p>
      {c.evidence && <p className="mt-2 text-xs text-white/45">Evidence: {c.evidence}</p>}
    </article>)}</div>

    <footer className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-xs text-white/45">{clients.length} client record{clients.length === 1 ? '' : 's'} are available to this view. This count is observed application state, not a claim about production infrastructure.</footer>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"><div className="text-xs text-white/45">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></div>; }
function Status({ status }: { status: EvidenceStatus }) { return <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-medium">{status}</span>; }
