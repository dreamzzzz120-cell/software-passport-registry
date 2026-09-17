import type { ReactNode } from 'react';
import { ArrowRight, CircleCheck, Database, FileCheck2, Radar, ScanSearch } from 'lucide-react';

type WorkspaceStage = 'software' | 'passports' | 'evidence' | 'monitoring' | 'reports';

const STAGES: Array<{ id: WorkspaceStage; label: string; path: string; icon: typeof Database }> = [
  { id: 'software', label: 'Software', path: '/assets', icon: Database },
  { id: 'passports', label: 'Passports', path: '/passports', icon: FileCheck2 },
  { id: 'evidence', label: 'Evidence', path: '/evidence-explorer', icon: ScanSearch },
  { id: 'monitoring', label: 'Monitoring', path: '/monitoring', icon: Radar },
  { id: 'reports', label: 'Reports', path: '/reports', icon: CircleCheck },
];

const COPY: Record<WorkspaceStage, { eyebrow: string; title: string; description: string }> = {
  software: {
    eyebrow: 'Software inventory',
    title: 'Software → identity → evidence',
    description: 'Start with what SPR can actually observe. Inventory records are inputs to trust evaluation, not proof of verification.',
  },
  passports: {
    eyebrow: 'Software passport',
    title: 'Passport → authoritative decision',
    description: 'A passport is the canonical software identity and trust record. Verification state comes from the authoritative evaluator.',
  },
  evidence: {
    eyebrow: 'Evidence explorer',
    title: 'Evidence → coverage → gaps',
    description: 'Inspect the raw and normalized evidence behind a passport. Coverage is shown separately from verification.',
  },
  monitoring: {
    eyebrow: 'Continuous monitoring',
    title: 'Change → impact → action',
    description: 'Monitor material changes, freshness, findings, and verification state so the next action is explicit.',
  },
  reports: {
    eyebrow: 'Reports & outputs',
    title: 'Evidence → findings → report',
    description: 'Reports present the same evidence-backed record without upgrading unknown or incomplete evidence into a claim.',
  },
};

export default function WorkspaceOperatingShell({
  stage,
  onNavigate,
  children,
}: {
  stage: WorkspaceStage;
  onNavigate: (path: string) => void;
  children: ReactNode;
}) {
  const copy = COPY[stage];
  return (
    <div className="space-y-5">
      <section className="spr-panel overflow-hidden">
        <div className="h-px bg-[var(--spr-highlight)] opacity-70" />
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 max-w-3xl">
              <div className="text-[10px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">{copy.eyebrow}</div>
              <h1 className="mt-1.5 text-xl font-display font-extrabold tracking-tight text-[var(--spr-text)]">{copy.title}</h1>
              <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{copy.description}</p>
            </div>
            <div className="rounded-md border border-[var(--spr-accent)]/30 bg-[var(--spr-accent-soft)] px-3 py-2 text-[11px] text-[var(--spr-text-muted)]">
              <span className="font-semibold text-[var(--spr-highlight)]">Evidence coverage</span>
              <span className="mx-1.5">≠</span>
              <span>verification</span>
            </div>
          </div>

          <nav aria-label="Evidence-to-action workspace" className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-5">
            {STAGES.map((item, index) => {
              const Icon = item.icon;
              const active = item.id === stage;
              return (
                <div key={item.id} className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate(item.path)}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2.5 text-left transition-colors ${active
                      ? 'border-[var(--spr-accent)]/60 bg-[var(--spr-accent-soft)] text-[var(--spr-text)]'
                      : 'border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] text-[var(--spr-text-muted)] hover:border-[var(--spr-accent)]/40 hover:text-[var(--spr-text)]'}`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate text-xs font-semibold">{item.label}</span>
                  </button>
                  {index < STAGES.length - 1 && <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-[var(--spr-text-faint)] xl:block" aria-hidden="true" />}
                </div>
              );
            })}
          </nav>
        </div>
      </section>
      {children}
    </div>
  );
}
