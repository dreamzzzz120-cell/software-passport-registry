import { useState } from 'react';
import { AlertOctagon, BookOpen, ClipboardList, FileText, Scale, ShieldCheck } from 'lucide-react';
import GovernancePoliciesTab from './governance/GovernancePoliciesTab';
import GovernanceControlsTab from './governance/GovernanceControlsTab';
import GovernanceFrameworksTab from './governance/GovernanceFrameworksTab';
import GovernanceRisksTab from './governance/GovernanceRisksTab';
import GovernanceFindingsTab from './governance/GovernanceFindingsTab';
import GovernanceAuditTab from './governance/GovernanceAuditTab';

type Tab = 'policies' | 'controls' | 'frameworks' | 'risks' | 'findings' | 'audit';

const TABS: Array<{ id: Tab; label: string; icon: typeof FileText }> = [
  { id: 'policies', label: 'Policies', icon: FileText },
  { id: 'controls', label: 'Controls', icon: ShieldCheck },
  { id: 'frameworks', label: 'Frameworks', icon: BookOpen },
  { id: 'risks', label: 'Risks', icon: AlertOctagon },
  { id: 'findings', label: 'Findings', icon: Scale },
  { id: 'audit', label: 'Audit trail', icon: ClipboardList },
];

export default function GovernanceView({ role = 'Viewer' }: { role?: string }) {
  const [tab, setTab] = useState<Tab>('policies');
  const [pendingControlId, setPendingControlId] = useState<string | null>(null);
  const [pendingPolicyId, setPendingPolicyId] = useState<string | null>(null);
  const canWrite = role === 'Owner' || role === 'Admin';
  const canTest = canWrite || role === 'Technician';

  // Cross-tab navigation (e.g. "Related controls" on a policy) switches to
  // the target tab AND selects the real underlying object once that tab's
  // own list finishes loading -- never just a tab switch pretending to be
  // navigation to a specific record.
  const navigateToControl = (id: string) => { setPendingControlId(id); setTab('controls'); };
  const navigateToPolicy = (id: string) => { setPendingPolicyId(id); setTab('policies'); };

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-[var(--spr-highlight)]"><ShieldCheck className="h-4 w-4" /> Governance & compliance</div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--spr-text)]">Governance</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Policies, controls, framework requirements, and risk decisions -- all backed by real records. A control existing does not prove it is effective; a policy existing does not prove it is followed. Evidence and test results remain the authority, not this registry.</p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-[var(--spr-border)]">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${tab === t.id ? 'border-[var(--spr-highlight)] text-[var(--spr-highlight)]' : 'border-transparent text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]'}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'policies' && <GovernancePoliciesTab canWrite={canWrite} onNavigateControl={navigateToControl} selectIdOnLoad={pendingPolicyId} />}
      {tab === 'controls' && <GovernanceControlsTab canWrite={canWrite} canTest={canTest} onNavigatePolicy={navigateToPolicy} selectIdOnLoad={pendingControlId} />}
      {tab === 'frameworks' && <GovernanceFrameworksTab canWrite={canWrite} canMap={canTest} />}
      {tab === 'risks' && <GovernanceRisksTab canWrite={canWrite} />}
      {tab === 'findings' && <GovernanceFindingsTab canDispose={canTest} />}
      {tab === 'audit' && <GovernanceAuditTab />}
    </div>
  );
}
