/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { ShieldCheck, Search } from 'lucide-react';
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

const STATUS_DOT: Record<EvidenceStatus, string> = {
  Observed: 'bg-[#0e700e]',
  Calculated: 'bg-[#0f6cbd]',
  'Not verified': 'bg-[#8a8886]',
};

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

  return (
    <section aria-labelledby="enterprise-readiness-title">
      <div className="mb-4">
        <h1 id="enterprise-readiness-title" className="flex items-center gap-1.5 text-[22px] font-semibold text-[#201f1e]"><ShieldCheck className="h-4 w-4 text-[#605e5c]" />Evidence-backed readiness</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-[#605e5c]">Claims are not inferred from UI components. Deployment, certifications, infrastructure, pentests, integrations and telemetry remain unverified until supporting evidence is available.</p>
      </div>

      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>A catalog of enterprise-readiness capabilities, each labeled by the strength of evidence actually behind it — not by whether the UI happens to expose a control for it.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Observed = backed by data this view was given directly.</li>
            <li>Calculated = derived from observed data.</li>
            <li>Not verified = no supporting evidence is currently connected.</li>
          </ol>
        </div>
      </details>

      <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <Metric label="Observed" value={observedCount} />
        <Metric label="Calculated" value={calculatedCount} />
        <Metric label="Not verified" value={unverifiedCount} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex h-9 items-center gap-2 rounded border border-[#c8c6c4] bg-white px-3"><Search className="h-3.5 w-3.5 text-[#8a8886]" /><input aria-label="Search capabilities" className="bg-transparent text-[13px] text-[#201f1e] outline-none placeholder:text-[#8a8886]" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search capabilities" /></div>
        <select aria-label="Filter capability category" className="h-9 rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select>
      </div>

      <div className="rounded-md border border-[#e1dfdd] bg-white">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]"><tr><th className="px-4 py-2">Capability</th><th className="px-4 py-2">Category</th><th className="px-4 py-2">Status</th></tr></thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b border-[#f3f2f1] align-top hover:bg-black/[.02]">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-[#201f1e]">{c.name}</div>
                  <p className="mt-0.5 text-[12px] text-[#605e5c]">{c.description}</p>
                  {c.evidence && <p className="mt-1 text-[11px] text-[#8a8886]">Evidence: {c.evidence}</p>}
                </td>
                <td className="px-4 py-2.5 text-[#605e5c]">{c.category}</td>
                <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5 text-[13px]"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[c.status]}`} />{c.status}</span></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-[13px] text-[#8a8886]">No capabilities match this search.</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[12px] text-[#8a8886]">{clients.length} client record{clients.length === 1 ? '' : 's'} are available to this view. This count is observed application state, not a claim about production infrastructure.</p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div><div className="text-[11px] text-[#605e5c]">{label}</div><div className="text-lg font-semibold text-[#201f1e]">{value}</div></div>; }
