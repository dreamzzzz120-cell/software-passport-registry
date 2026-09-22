import { ArrowRight, ExternalLink } from 'lucide-react';
import LegalFooterLinks from './legal/LegalFooterLinks';
import UniversalIntakeView from './UniversalIntakeView';

interface Props {
  onCreatePassport: () => void;
  onExploreTrustNetwork: () => void;
  onViewSamplePassport: () => void;
}

const BUYER_QUESTIONS = [
  'Can we verify what we are buying?',
  'Has this software changed since the last review?',
  'Which evidence supports this risk assessment?',
  'What do we actually know about this vendor?',
  'What remains UNKNOWN?',
];

const AUDIENCES = [
  { who: 'Security & IT teams', job: 'Decide whether software is safe to approve, with the evidence attached.' },
  { who: 'Procurement & vendor risk', job: 'Replace a questionnaire answer with an observation you can check.' },
  { who: 'MSPs', job: 'Assess software across many client environments from one place.' },
  { who: 'Software buyers', job: 'Understand what a supplier can and cannot demonstrate.' },
  { who: 'Developers & software owners', job: 'Show customers what your release actually proves.' },
];

const OUTPUTS = [
  { title: 'Software Passport', body: 'A durable identity and evidence record for one software asset at one exact version.' },
  { title: 'Evidence Explorer', body: 'Inspect the observations behind a result — source, timestamp and content hash.' },
  { title: 'Decision & trust state', body: 'What the evidence supports, what it does not, and the reason codes for both.' },
  { title: 'Continuous observation', body: 'Re-observe over time so an old review is not treated as permanent truth.' },
];

const INFRASTRUCTURE_STEPS: { n: string; title: string; description: string }[] = [
  { n: '01', title: 'Identity', description: 'Establish what a piece of software actually is — its name, version, publisher, and release.' },
  { n: '02', title: 'Evidence', description: 'Collect observable information: SBOMs, scan results, attestations, repository signals, policies and documents.' },
  { n: '03', title: 'Verification', description: 'Independently re-check what can be verified. Self-reported claims are confirmed, not assumed.' },
  { n: '04', title: 'Trust State', description: 'Turn available evidence into a current, explainable state — never a fabricated conclusion.' },
  { n: '05', title: 'Continuous Observation', description: 'Track what changes over time, so the trust state stays current rather than static.' },
];

export default function HomePage({ onCreatePassport, onExploreTrustNetwork, onViewSamplePassport }: Props) {
  return (
    <div className="min-h-screen bg-[var(--spr-surface)] text-[#cccccc]">
      <section className="mx-auto flex max-w-7xl flex-col items-center gap-14 px-6 py-20 lg:flex-row lg:items-center lg:py-28">
        <div className="max-w-2xl">
          <img src="/brand/spr-logo.jpg" alt="Software Passport Registry" className="mb-6 h-24 w-auto drop-shadow-[0_4px_20px_rgba(0,0,0,0.35)]" />
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">Software Trust Infrastructure</span>
            <span className="rounded-full border border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10 px-2.5 py-1 text-[12px] font-bold uppercase tracking-[.14em] text-[var(--spr-amber)]">Limited early access</span>
          </div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-.02em] text-[var(--spr-text)] md:text-5xl">Verify software before you trust it.</h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[var(--spr-text-muted)]">SPR turns repositories, applications, dependencies and vendors into evidence-backed Software Passports — so buyers, security teams and operators can see what was observed, what was verified, and what remains unknown.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={onExploreTrustNetwork} className="inline-flex items-center gap-2 rounded-[3px] bg-[var(--spr-accent)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--spr-accent-hover)]">Run a Free Review <ArrowRight className="h-4 w-4" /></button>
            <a href="/software" className="inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-highlight)]/50 bg-[var(--spr-surface-sunken)] px-6 py-3 text-sm font-semibold text-[var(--spr-text)] transition-colors hover:bg-[var(--spr-surface-hover)]" aria-label="Open the public Software Passport Registry">Explore the Software Registry <ExternalLink className="h-4 w-4" /></a>
            <button onClick={onCreatePassport} className="rounded-[3px] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-6 py-3 text-sm font-semibold text-[#cccccc] transition-colors hover:bg-[var(--spr-surface-hover)]">Sign in</button>
          </div>
          <p className="mt-3 text-xs text-[var(--spr-text-muted)]">Public registry: observed repositories only. No invented scores or placeholder records.</p>
          <LegalFooterLinks className="mt-8" />
        </div>
        <div className="hidden w-full flex-1 justify-center lg:flex">
          <div className="w-full max-w-md rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-7">
            <div className="text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]">Live evidence only</div>
            <h2 className="mt-3 text-2xl font-semibold text-[var(--spr-text)]">No software is being scored here.</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--spr-text-muted)]">This homepage does not invent a security, compliance, vendor, or confidence score. Run a Free Review and SPR will populate the result from the repository and evidence it actually observed.</p>
            <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
              {['Repository identity', 'SBOM evidence', 'Vulnerability findings', 'Verification state'].map((item) => (
                <div key={item} className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3 text-[var(--spr-text-muted)]">{item}<div className="mt-1 font-semibold text-[var(--spr-text)]">Not yet observed</div></div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={onExploreTrustNetwork} className="inline-flex items-center gap-2 rounded-[3px] bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white">Run a Free Review <ArrowRight className="h-4 w-4" /></button>
              <a href="/software" className="inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-border)] px-5 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Open Registry <ExternalLink className="h-4 w-4" /></a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl"><div className="text-[12px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">Universal intake</div><h2 className="mt-3 text-3xl font-semibold text-[var(--spr-text)] md:text-4xl">Give SPR everything you already have.</h2><p className="mt-3 text-sm leading-6 text-[var(--spr-text-muted)]">No SBOM preparation project. No guessing where a document belongs. Stage the software and the evidence together, then continue into the workspace.</p></div>
          <UniversalIntakeView onContinue={onCreatePassport} />
        </div>
      </section>

      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-20"><div className="mx-auto max-w-5xl"><h2 className="text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">The questions SPR is built to answer.</h2><ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{BUYER_QUESTIONS.map(q => <li key={q} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 text-sm leading-6 text-[var(--spr-text)]">{q}</li>)}</ul></div></section>
      <section className="border-t border-[var(--spr-border)] px-6 py-20"><div className="mx-auto max-w-5xl"><h2 className="text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">Who SPR is for</h2><dl className="mt-8 grid gap-5 md:grid-cols-2">{AUDIENCES.map(item => <div key={item.who} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><dt className="text-sm font-semibold text-[var(--spr-text)]">{item.who}</dt><dd className="mt-1.5 text-xs leading-5 text-[var(--spr-text-muted)]">{item.job}</dd></div>)}</dl></div></section>
      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-20"><div className="mx-auto max-w-5xl"><h2 className="text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">See the evidence.</h2><p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">SPR keeps observations, evidence, independent sources, verification, trust state and the decision separate. Repeated observations of one source are not independent corroboration, and missing evidence stays visible.</p><div className="mt-9 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="text-[12px] font-bold uppercase tracking-[.18em] text-[var(--spr-amber)]">A state most products hide</div><h3 className="mt-2 text-xl font-semibold text-[var(--spr-text)]">UNKNOWN is a real answer.</h3><p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">UNKNOWN does not mean safe, and it does not mean unsafe. It means available evidence is insufficient to make that determination. SPR does not invent certainty it has not observed.</p><button onClick={onExploreTrustNetwork} className="mt-6 inline-flex items-center gap-2 rounded-[3px] bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white">Run a Free Review <ArrowRight className="h-4 w-4" /></button></div></div></section>
      <section className="border-t border-[var(--spr-border)] px-6 py-20"><div className="mx-auto max-w-5xl"><h2 className="text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">What you get</h2><div className="mt-8 grid gap-5 md:grid-cols-2">{OUTPUTS.map(item => <div key={item.title} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><h3 className="text-sm font-semibold text-[var(--spr-text)]">{item.title}</h3><p className="mt-1.5 text-xs leading-5 text-[var(--spr-text-muted)]">{item.body}</p></div>)}</div></div></section>
      <section className="border-t border-[var(--spr-border)] px-6 py-20"><div className="mx-auto max-w-5xl"><div className="grid gap-6 md:grid-cols-5">{INFRASTRUCTURE_STEPS.map(step => <div key={step.n} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className="font-mono text-xs font-bold text-[var(--spr-highlight)]">{step.n}</div><h3 className="mt-2 text-sm font-semibold text-[var(--spr-text)]">{step.title}</h3><p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">{step.description}</p></div>)}</div><div className="mt-10 text-center"><div className="inline-block rounded-md border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)]/15 px-6 py-3 text-sm font-bold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Software Passport</div></div></div></section>
      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-[12px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">Built for the real software lifecycle</div>
          <h2 className="mt-3 text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">Connect evidence where software actually changes.</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">SPR is designed to sit between software sources, security signals and the people who need to make a trust decision. Connect repositories and CI/CD evidence, ingest SBOMs, correlate vulnerability observations, and keep the resulting Passport addressable over time.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {['GitHub / repositories','CI/CD & SBOM intake','Vulnerability evidence','Continuous observation'].map(item => <div key={item} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 text-sm font-semibold text-[var(--spr-text)]">{item}<div className="mt-2 text-xs font-normal leading-5 text-[var(--spr-text-muted)]">Evidence is shown with its source and observed state.</div></div>)}
          </div>
          <p className="mt-5 text-xs text-[var(--spr-text-muted)]">Integration availability varies by deployment and is never represented as configured unless SPR can observe it.</p>
        </div>
      </section>

      <section className="border-t border-[var(--spr-border)] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-8 md:grid-cols-2">
            <div><div className="text-[12px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">Share without an account</div><h2 className="mt-3 text-2xl font-semibold text-[var(--spr-text)]">Give a client or auditor a Passport they can inspect.</h2><p className="mt-4 text-sm leading-7 text-[var(--spr-text-muted)]">Public Passport links are designed for external review. A recipient can inspect the evidence-backed state without becoming a paid SPR workspace user.</p></div>
            <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="text-xs font-bold uppercase tracking-[.16em] text-[var(--spr-amber)]">What the recipient sees</div><ul className="mt-4 space-y-3 text-sm text-[var(--spr-text-muted)]">{['Software identity and version','Observed evidence and timestamps','Verification state and reason codes','Unknown or unavailable evidence','Freshness / observation history'].map(item => <li key={item} className="flex gap-3"><span className="text-[var(--spr-highlight)]">•</span><span>{item}</span></li>)}</ul><button onClick={onViewSamplePassport} className="mt-6 inline-flex items-center gap-2 rounded-[3px] bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white">View a sample Passport <ArrowRight className="h-4 w-4" /></button></div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-[12px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">Evidence methodology</div><h2 className="mt-3 text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">A Passport is not a certification.</h2><p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">SPR does not turn a badge into ISO, SOC 2, GDPR or other certification. It records what was observed, what can be verified, and what remains unknown. Claims supplied by a vendor stay distinct from independently observed evidence.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">{[['Observed','Evidence that SPR actually collected or received.'],['Verified','A documented verification decision supported by available evidence.'],['Unknown','A meaningful state when evidence is missing, stale, inaccessible or insufficient.']].map(([title, body]) => <div key={title} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><h3 className="text-sm font-semibold text-[var(--spr-text)]">{title}</h3><p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">{body}</p></div>)}</div>
          <div className="mt-7 flex flex-wrap gap-3"><a href="/methodology/" className="inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-border)] px-5 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Read the methodology <ExternalLink className="h-4 w-4" /></a><a href="/security/" className="inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-border)] px-5 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Security & privacy <ExternalLink className="h-4 w-4" /></a><a href="/whitepaper" className="inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-border)] px-5 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Read the whitepaper <ExternalLink className="h-4 w-4" /></a></div>
        </div>
      </section>

      <section className="border-t border-[var(--spr-border)] px-6 py-20">
        <div className="mx-auto max-w-5xl"><div className="text-[12px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">For MSPs</div><h2 className="mt-3 text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">Turn software assurance into a repeatable client service.</h2><p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">Use a shared operational layer for client software reviews, evidence collection, vendor risk, monitoring and externally shareable Passports. White-label capabilities are designed around tenant isolation rather than a cosmetic skin.</p><div className="mt-7 flex flex-wrap gap-3"><a href="/msp" className="inline-flex items-center gap-2 rounded-[3px] bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white">Explore MSP workflows <ArrowRight className="h-4 w-4" /></a><a href="/roi" className="inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-border)] px-5 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Open MSP ROI calculator <ExternalLink className="h-4 w-4" /></a><a href="/pricing" className="inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-border)] px-5 py-2.5 text-sm font-semibold text-[var(--spr-text)]">See pricing <ExternalLink className="h-4 w-4" /></a></div></div>
      </section>

      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-16 text-center"><div className="mx-auto max-w-2xl"><div className="text-[11px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">Software Trust Infrastructure</div><p className="mt-3 text-lg font-semibold text-[var(--spr-text)]">The trust layer for the software ecosystem.</p><p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Persistent software identity. Verifiable evidence. Explainable trust. Continuous observation.</p><a href="/software" className="mt-6 inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-border)] px-5 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Browse the public Software Registry <ExternalLink className="h-4 w-4" /></a></div></section>
    </div>
  );
}
