import React, { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, FileCheck2, Search, ShieldAlert, Users } from 'lucide-react';
import type { Client, SoftwarePassport } from '../types';
import type { VerificationDecisionState } from './trust/TrustStateBadge';
import type { VerificationDecisionDetail } from './design/CommandCenter';

interface Props {
  passports: SoftwarePassport[];
  clients?: Client[];
  selectedPassportId: string | null;
  setSelectedPassportId: (id: string | null) => void;
  verificationDecisions?: Record<string, VerificationDecisionState>;
  verificationDetails?: Record<string, VerificationDecisionDetail>;
  onNavigateTab?: (tab: string, itemId?: string) => void;
}

type State = 'Verified' | 'Partial' | 'Unverified' | 'Evidence gap';

function decisionState(passport: SoftwarePassport, decisions: Record<string, VerificationDecisionState>): State {
  const decision = decisions[passport.id];
  if (decision === 'verified') return 'Verified';
  if (decision === 'partial') return 'Partial';
  if ((passport.evidence?.length || 0) === 0) return 'Evidence gap';
  return 'Unverified';
}

function stateClass(state: State) {
  if (state === 'Verified') return 'text-[var(--spr-green)]';
  if (state === 'Partial') return 'text-[var(--spr-amber)]';
  if (state === 'Evidence gap') return 'text-[var(--spr-red)]';
  return 'text-[var(--spr-text-muted)]';
}

function freshness(passport: SoftwarePassport): string {
  const raw = (passport as any).lastVerifiedAt || (passport as any).updatedAt || (passport as any).updated_at || (passport as any).createdAt || (passport as any).created_at;
  if (!raw) return 'Unknown';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export default function PassportsCommandWorkspace({
  passports,
  clients = [],
  selectedPassportId,
  setSelectedPassportId,
  verificationDecisions = {},
  verificationDetails = {},
  onNavigateTab,
}: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'verified' | 'gaps'>('all');
  const selected = useMemo(() => passports.find((p) => p.id === selectedPassportId) ?? null, [passports, selectedPassportId]);

  const rows = useMemo(() => passports.filter((passport) => {
    const state = decisionState(passport, verificationDecisions);
    const text = `${passport.name || ''} ${passport.publisher || ''} ${passport.version || ''} ${passport.category || ''}`.toLowerCase();
    const matchesQuery = !query.trim() || text.includes(query.trim().toLowerCase());
    const matchesFilter = filter === 'all' || (filter === 'attention' && state !== 'Verified') || (filter === 'verified' && state === 'Verified') || (filter === 'gaps' && state === 'Evidence gap');
    return matchesQuery && matchesFilter;
  }), [passports, query, filter, verificationDecisions]);

  const verified = passports.filter((p) => decisionState(p, verificationDecisions) === 'Verified').length;
  const attention = passports.filter((p) => decisionState(p, verificationDecisions) !== 'Verified').length;
  const evidenceGaps = passports.filter((p) => decisionState(p, verificationDecisions) === 'Evidence gap').length;
  const evidenceCoverage = passports.length ? Math.round((passports.filter((p) => (p.evidence?.length || 0) > 0).length / passports.length) * 100) : 0;
  const selectedClients = selected ? clients.filter((client) => String((client as any).id) === String((selected as any).clientId) || (client.softwareInventory || []).some((item: any) => String(item.passportId) === String(selected.id))) : [];
  const selectedDecision = selected ? verificationDetails[selected.id] : undefined;

  return (
    <section className="space-y-6">
      <header className="spr-panel p-6 md:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-amber)]"><FileCheck2 className="h-4 w-4" /> Passport operations</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--spr-text)]">Passport command center</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Manage software trust records by verification state, evidence posture, client relationships and freshness. Evidence gaps remain visible instead of being converted into a reassuring score.</p>
          </div>
          <button onClick={() => onNavigateTab?.('/scans')} className="spr-btn spr-btn-primary">Run or review scans <ArrowRight className="h-4 w-4" /></button>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric icon={<FileCheck2 />} label="Passports" value={passports.length} />
          <Metric icon={<CheckCircle2 />} label="Verified" value={verified} />
          <Metric icon={<ShieldAlert />} label="Needs attention" value={attention} />
          <Metric icon={<ShieldAlert />} label="Evidence gaps" value={evidenceGaps} />
          <Metric icon={<Clock3 />} label="Evidence coverage" value={`${evidenceCoverage}%`} />
        </div>
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {([['all', 'All'], ['attention', 'Needs attention'], ['verified', 'Verified'], ['gaps', 'Evidence gaps']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} className={`rounded-md border px-3 py-2 text-xs font-semibold ${filter === key ? 'border-[var(--spr-border)] bg-[var(--spr-accent-soft)] text-white' : 'border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] text-[var(--spr-text-muted)]'}`}>{label}</button>
          ))}
        </div>
        <label className="flex min-w-64 items-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2"><Search className="h-4 w-4 text-[var(--spr-text-faint)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search passports" aria-label="Search passports" className="min-w-0 flex-1 bg-transparent text-xs text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-faint)]" /></label>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-hidden rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)]">
          <div className="grid grid-cols-[minmax(180px,1.4fr)_120px_110px_110px_100px_110px] gap-3 border-b border-[var(--spr-border)] px-4 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--spr-text-faint)]">
            <span>Software</span><span>Clients</span><span>Passport</span><span>Evidence</span><span>Findings</span><span>Freshness</span>
          </div>
          {rows.map((passport) => {
            const state = decisionState(passport, verificationDecisions);
            const linkedClients = clients.filter((client) => String((client as any).id) === String((passport as any).clientId) || (client.softwareInventory || []).some((item: any) => String(item.passportId) === String(passport.id))).length;
            return <button key={passport.id} onClick={() => setSelectedPassportId(passport.id)} className={`grid w-full grid-cols-[minmax(180px,1.4fr)_120px_110px_110px_100px_110px] gap-3 border-b border-[var(--spr-border)] px-4 py-4 text-left last:border-b-0 hover:bg-[var(--spr-surface-sunken)] ${selectedPassportId === passport.id ? 'bg-[var(--spr-accent-soft)]' : ''}`}>
              <span className="min-w-0"><strong className="block truncate text-sm text-[var(--spr-text)]">{passport.name || 'Unnamed software'}</strong><span className="mt-1 block truncate text-[11px] text-[var(--spr-text-muted)]">{passport.publisher || 'Publisher not observed'} · {passport.version || 'Version not observed'}</span></span>
              <span className="text-xs text-[var(--spr-text-muted)]">{linkedClients}</span>
              <span className={`text-xs font-semibold ${stateClass(state)}`}>{state}</span>
              <span className="text-xs text-[var(--spr-text-muted)]">{passport.evidence?.length || 0}</span>
              <span className="text-xs text-[var(--spr-text-muted)]">{passport.vulnerabilities?.length || 0}</span>
              <span className="text-xs text-[var(--spr-text-muted)]">{freshness(passport)}</span>
            </button>;
          })}
          {rows.length === 0 && <div className="p-12 text-center"><FileCheck2 className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]" /><p className="mt-3 text-sm font-semibold text-[var(--spr-text)]">No passports match this view.</p></div>}
        </div>

        <aside className="spr-panel p-5">
          {!selected ? <div className="grid min-h-80 place-items-center text-center"><div><FileCheck2 className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]" /><p className="mt-3 text-sm font-semibold text-[var(--spr-text)]">Select a passport</p><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">The operating panel will show trust posture, evidence, clients and next actions.</p></div></div> : <>
            <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--spr-text-faint)]">Selected software</div><h2 className="mt-2 text-xl font-semibold text-[var(--spr-text)]">{selected.name || 'Unnamed software'}</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">{selected.publisher || 'Publisher not observed'} · {selected.version || 'Version not observed'}</p></div><span className={`text-xs font-semibold ${stateClass(decisionState(selected, verificationDecisions))}`}>{decisionState(selected, verificationDecisions)}</span></div>
            <div className="mt-5 grid grid-cols-2 gap-2 text-xs"><Detail label="Evidence" value={String(selected.evidence?.length || 0)} /><Detail label="Findings" value={String(selected.vulnerabilities?.length || 0)} /><Detail label="Freshness" value={freshness(selected)} /><Detail label="Policy" value={selectedDecision?.decision?.policyVersion || '—'} /></div>
            <div className="mt-5 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[var(--spr-text)]"><Users className="h-4 w-4" /> Linked clients</div>{selectedClients.length ? <ul className="mt-3 space-y-2">{selectedClients.map((client) => <li key={client.id} className="text-xs text-[var(--spr-text-muted)]">{client.name}</li>)}</ul> : <p className="mt-2 text-xs text-[var(--spr-text-faint)]">No client relationship is currently observed.</p>}</div>
            <div className="mt-5 space-y-2"><Action label="Open full Passport workflow" onClick={() => onNavigateTab?.('/registry', selected.id)} /><Action label="View evidence" onClick={() => onNavigateTab?.('/evidence-explorer', selected.id)} /><Action label="Open monitoring" onClick={() => onNavigateTab?.('/monitoring', selected.id)} /><Action label="View linked clients" onClick={() => onNavigateTab?.('/clients', selectedClients[0]?.id)} /></div>
            <p className="mt-4 text-[11px] leading-5 text-[var(--spr-text-faint)]">Observed evidence and authoritative verification are separate. A missing decision is not treated as verification.</p>
          </>}
        </aside>
      </div>
    </section>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) { return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4"><div className="flex items-center gap-2 text-[var(--spr-text-faint)]">{icon}<span className="text-[11px]">{label}</span></div><div className="mt-2 text-2xl font-semibold text-[var(--spr-text)]">{value}</div></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3"><div className="text-[10px] uppercase tracking-[.06em] text-[var(--spr-text-faint)]">{label}</div><div className="mt-1 text-sm font-semibold text-[var(--spr-text)]">{value}</div></div>; }
function Action({ label, onClick }: { label: string; onClick: () => void }) { return <button onClick={onClick} className="flex w-full items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-3 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-alt)]"><span>{label}</span><ArrowRight className="h-4 w-4 text-[var(--spr-text-faint)]" /></button>; }
