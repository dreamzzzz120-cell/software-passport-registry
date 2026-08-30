import { useState } from 'react';
import { ClipboardCheck, Database, Inbox, ShieldCheck } from 'lucide-react';
import PrivacyInventoryTab from './privacy/PrivacyInventoryTab';
import PrivacyRequestsTab from './privacy/PrivacyRequestsTab';
import PrivacyPiaTab from './privacy/PrivacyPiaTab';

type Tab = 'inventory' | 'requests' | 'pias';

const TABS: Array<{ id: Tab; label: string; icon: typeof Database }> = [
  { id: 'inventory', label: 'PI Inventory', icon: Database },
  { id: 'requests', label: 'Privacy Requests', icon: Inbox },
  { id: 'pias', label: 'Impact Assessments', icon: ClipboardCheck },
];

export default function PrivacyView({ role = 'Viewer' }: { role?: string }) {
  const [tab, setTab] = useState<Tab>('inventory');
  const canWrite = role === 'Owner' || role === 'Admin';
  const canProcess = canWrite || role === 'Technician';

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <header>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-[var(--spr-highlight)]"><ShieldCheck className="h-4 w-4" /> Privacy management</div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--spr-text)]">Privacy</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">What personal information exists, why it's collected, and how privacy requests and impact assessments are tracked. This organizes real records for review -- it does not determine legal compliance on its own. Where legal interpretation is required, that determination is left to qualified counsel.</p>
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

      {tab === 'inventory' && <PrivacyInventoryTab canWrite={canWrite} />}
      {tab === 'requests' && <PrivacyRequestsTab canProcess={canProcess} />}
      {tab === 'pias' && <PrivacyPiaTab canWrite={canWrite} />}
    </div>
  );
}
