import { ArrowRight, CheckCircle2 } from 'lucide-react';
import LegalFooterLinks from './legal/LegalFooterLinks';

interface Props {
  onCreatePassport: () => void;
  onExploreTrustNetwork: () => void;
  onViewSamplePassport: () => void;
}

// One audience (MSPs), one offer (a free report on one repository), one
// primary action (Run a Free Review). Everything else on the page exists to
// get a visitor to that button.

// What an MSP's clients are starting to ask, and what the report answers.
const BUYER_QUESTIONS = [
  'What open-source components are inside the software we run?',
  'Do any of them have known vulnerabilities right now?',
  'Can you show us an SBOM for this application?',
  'Has anything changed since the last review?',
  'What remains UNKNOWN?',
];

const STEPS = [
  { n: '1', title: 'Paste a GitHub repository', body: 'Any public repo one of your clients depends on. No account, no install.' },
  { n: '2', title: 'SPR builds the evidence record', body: 'Resolves exact package versions where evidence permits, preserves declared dependency ranges when it does not, and checks only resolved components against OSV.' },
  { n: '3', title: 'Download the PDF', body: 'A report you can put in front of a client: components, known vulnerabilities, and what could not be verified.' },
];

const REPORT_CONTENTS = [
  'Resolved SBOM components plus declared-but-unresolved dependencies, clearly separated',
  'Known vulnerabilities matched from OSV, with severity',
  'Evidence status for each finding: verified, observed or UNKNOWN',
  'Timestamp and source for everything in the report',
];

const PAID_ADDS = [
  'Your logo and colours on every report (white-label)',
  'Organise reports by client and re-scan on a schedule',
  'Alerts when a new vulnerability hits a client’s software',
  'ConnectWise PSA tickets filed automatically',
];

function PrimaryCta({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-[3px] bg-[var(--spr-accent)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--spr-accent-hover)] ${className}`}>
      Run a Free Review <ArrowRight className="h-4 w-4" />
    </button>
  );
}

export default function HomePage({ onCreatePassport, onExploreTrustNetwork }: Props) {
  return (
    <div className="min-h-screen bg-[var(--spr-surface)] text-[var(--spr-text)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <img src="/brand/spr-logo.jpg" alt="Software Passport Registry" className="h-10 w-auto" />
        <nav className="flex items-center gap-5 text-sm">
          <a href="/pricing" className="text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Pricing</a>
          <button onClick={onCreatePassport} className="text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Sign in</button>
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-6 pb-16 pt-10 text-center md:pt-16">
        <div className="mb-5 flex flex-wrap items-center justify-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">For Managed Service Providers</span>
          <span className="rounded-full border border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10 px-2.5 py-1 text-[12px] font-bold uppercase tracking-[.14em] text-[var(--spr-amber)]">Limited early access</span>
        </div>
        <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-.02em] md:text-5xl">Show your clients what’s inside their software.</h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-[var(--spr-text-muted)]">
          SPR is the evidence and accountability layer around software scanners: a client-ready record of what was observed, what was resolved, what remains UNKNOWN, and what evidence supports every claim.
          Use the free review to inspect a repository, then turn that evidence into a repeatable MSP service with monitoring, history, reporting, and white-label delivery.
        </p>
        <div className="mt-9 flex flex-col items-center gap-3">
          <PrimaryCta onClick={onExploreTrustNetwork} className="px-8 py-3.5 text-base" />
          <p className="text-xs text-[var(--spr-text-muted)]">Free. Paste a GitHub repo, get a PDF report. No account needed.</p>
        </div>
      </section>

      <section className="border-y border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold md:text-3xl">How the free review works</h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
                <div className="font-mono text-xs font-bold text-[var(--spr-highlight)]">STEP {step.n}</div>
                <h3 className="mt-2 text-sm font-semibold">{step.title}</h3>
                <p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">What’s in the report</h2>
            <ul className="mt-6 space-y-3">
              {REPORT_CONTENTS.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-highlight)]" />{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-semibold">The questions it answers</h2>
            <ul className="mt-6 space-y-2">
              {BUYER_QUESTIONS.map((q) => (
                <li key={q} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-4 py-3 text-sm">{q}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--spr-border)] px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="text-[12px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]">Why not just use a free scanner?</div>
          <h2 className="mt-2 text-2xl font-semibold">Scanners find issues. SPR preserves the evidence around the decision.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
              <h3 className="text-sm font-semibold">Dependabot / Trivy / Grype / Socket</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Excellent inputs for dependency and vulnerability findings. They are not the client evidence record, the historical Launch Ticket, the MSP portfolio workflow, or the white-label managed service.</p>
            </div>
            <div className="rounded-md border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)]/15 p-5">
              <h3 className="text-sm font-semibold">Software Passport Registry</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Combines observed evidence, preserves UNKNOWN and unresolved states, tracks provenance and change over time, and turns the result into something an MSP can monitor, explain, deliver, and sell.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-16">
        <div className="mx-auto max-w-3xl">
          <div className="text-[12px] font-bold uppercase tracking-[.18em] text-[var(--spr-amber)]">Honest by design</div>
          <h2 className="mt-2 text-2xl font-semibold">UNKNOWN is a real answer.</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--spr-text-muted)]">
            UNKNOWN does not mean safe, and it does not mean unsafe. It means available evidence is insufficient to make that determination.
            SPR does not invent scores, badges or certainty it has not observed — so nothing in a report will embarrass you in front of a client.
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--spr-border)] px-6 py-16">
        <div className="mx-auto max-w-5xl rounded-md border-2 border-[var(--spr-highlight)]/50 bg-[var(--spr-surface-deep)] p-7 md:flex md:items-center md:justify-between md:gap-10">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">When you’re ready to offer it as a service</div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {PAID_ADDS.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-6"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[var(--spr-highlight)]" />{item}</li>
              ))}
            </ul>
          </div>
          <a href="/pricing" className="spr-btn spr-btn-primary mt-6 inline-block shrink-0 !px-5 !py-2.5 text-sm md:mt-0">View MSP pricing →</a>
        </div>
      </section>

      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold">Try it on one of your clients’ apps.</h2>
        <p className="mt-2 text-sm text-[var(--spr-text-muted)]">Takes a couple of minutes. You keep the PDF either way.</p>
        <PrimaryCta onClick={onExploreTrustNetwork} className="mt-6" />
        <div className="mx-auto max-w-5xl">
          <LegalFooterLinks className="mt-8" />
        </div>
      </section>
    </div>
  );
}
