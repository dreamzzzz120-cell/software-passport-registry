import LegalFooterLinks from './legal/LegalFooterLinks';

interface Props { onNavigate: (path: string) => void; }

const sections = [
  {
    title: '1. Run a review',
    body: 'Start with a public GitHub repository in Free Review, or sign in and use New Review for workspace-owned software. SPR records the repository commit it actually observed. A review is evidence collection, not a permanent safety guarantee.',
  },
  {
    title: '2. Read the Passport',
    body: 'The Passport is the software record. Check identity, observed version, evidence coverage, findings, verification state and timestamps. UNKNOWN means SPR does not have enough evidence to make that claim.',
  },
  {
    title: '3. Trace a claim',
    body: 'Open Evidence Explorer to follow Claim → Evidence → Source → Timestamp → Hash → History. If the Passport list or ledger cannot be loaded, the page reports the dependency failure instead of presenting an empty evidence estate as fact.',
  },
  {
    title: '4. Monitor change',
    body: 'Monitoring schedules collectors against supported sources. New observations can change findings or trust state without rewriting prior evidence. Review alert details before treating a change as resolved.',
  },
];

const states = [
  ['OBSERVED', 'SPR recorded evidence from the named source. This does not automatically mean the underlying claim is independently verified.'],
  ['VERIFIED', 'A verification control succeeded for the specific evidence or decision being displayed.'],
  ['UNVERIFIED', 'Evidence exists, but the required verification did not establish the claim.'],
  ['UNKNOWN', 'SPR cannot make the claim from available evidence. UNKNOWN is not a pass and is not converted into zero.'],
];

export default function PublicDocsView({ onNavigate }: Props) {
  return <div className="min-h-screen bg-[var(--spr-surface)] text-[var(--spr-text)]">
    <header className="border-b border-[var(--spr-border)] bg-[var(--spr-surface-deep)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-6 py-5">
        <button onClick={() => onNavigate('/')} className="flex items-center gap-3 text-left">
          <img src="/brand/spr-icon.png" alt="SPR" className="h-11 w-11 rounded-md border border-[var(--spr-border)] object-contain" />
          <div><div className="text-sm font-semibold">Software Passport Registry</div><div className="text-[12px] uppercase tracking-[.16em] text-[var(--spr-text-faint)]">Product documentation</div></div>
        </button>
        <div className="flex gap-2">
          <button onClick={() => onNavigate('/free-review')} className="spr-btn spr-btn-secondary">Run a Free Review</button>
          <button onClick={() => onNavigate('/login')} className="spr-btn spr-btn-primary">Sign in</button>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="max-w-3xl">
        <div className="text-[12px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">SPR Docs</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">From repository to evidence-backed decision.</h1>
        <p className="mt-5 text-sm leading-7 text-[var(--spr-text-muted)]">These docs describe the workflow a customer can actually use. They deliberately distinguish product behavior from claims SPR cannot prove.</p>
      </div>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        {sections.map((item) => <article key={item.title} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><h2 className="text-sm font-semibold">{item.title}</h2><p className="mt-2 text-xs leading-6 text-[var(--spr-text-muted)]">{item.body}</p></article>)}
      </section>

      <section className="mt-10 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <h2 className="text-xl font-semibold">Evidence states</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Do not treat different evidence states as interchangeable.</p>
        <div className="mt-5 divide-y divide-[var(--spr-border)]">
          {states.map(([state, meaning]) => <div key={state} className="grid gap-2 py-4 md:grid-cols-[160px_1fr]"><div className="text-xs font-bold tracking-wide text-[var(--spr-highlight)]">{state}</div><div className="text-xs leading-6 text-[var(--spr-text-muted)]">{meaning}</div></div>)}
        </div>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-3">
        <DocCard title="MSP workflow">
          Create or select a client, run a review, inspect the Passport and evidence, enroll monitoring, then export a client-facing report. White-label presentation changes branding, not the underlying evidence.
        </DocCard>
        <DocCard title="Billing">
          Plans, add-ons and one-time reports are shown from the billing catalog. Manage billing opens the Stripe customer portal for eligible workspace Owners/Admins. If production billing configuration cannot be verified, checkout fails closed.
        </DocCard>
        <DocCard title="Security & access">
          Workspace roles are enforced server-side. Tenant-scoped data uses PostgreSQL row-level security. Email verification is required; TOTP MFA can be enrolled under Settings. See the public Security page for current controls and limitations.
        </DocCard>
      </section>

      <section className="mt-10 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <h2 className="text-xl font-semibold">Troubleshooting</h2>
        <div className="mt-5 space-y-5 text-sm leading-7 text-[var(--spr-text-muted)]">
          <div><strong className="text-[var(--spr-text)]">Workspace session unavailable:</strong> use Retry. SPR intentionally does not assume a lower role or an empty workspace when it cannot confirm identity.</div>
          <div><strong className="text-[var(--spr-text)]">Passport or evidence list unavailable:</strong> retry the page. An unavailable source is different from a confirmed empty result.</div>
          <div><strong className="text-[var(--spr-text)]">Scan failed:</strong> open Scans and inspect the recorded failure reason. A failed collector or provider call must not be interpreted as a clean result.</div>
          <div><strong className="text-[var(--spr-text)]">Billing unavailable:</strong> do not retry repeated payments blindly. Check Billing for the returned configuration/error state or contact support.</div>
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-4 rounded-md border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent-soft)] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold">Need help with a real workspace?</h2><p className="mt-1 text-xs leading-6 text-[var(--spr-text-muted)]">Use the contact form for product support, an MSP pilot, privacy request, partnership question or security report.</p></div>
        <button onClick={() => onNavigate('/contact/')} className="spr-btn spr-btn-primary shrink-0">Contact SPR</button>
      </section>
    </main>

    <footer className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-9"><div className="mx-auto max-w-6xl"><LegalFooterLinks /></div></footer>
  </div>;
}

function DocCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-2 text-xs leading-6 text-[var(--spr-text-muted)]">{children}</p></article>;
}
