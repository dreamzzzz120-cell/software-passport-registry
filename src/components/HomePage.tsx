/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowRight } from 'lucide-react';
import TrustField from './trust/TrustField';
import LegalFooterLinks from './legal/LegalFooterLinks';

interface Props {
  onCreatePassport: () => void;
  onExploreTrustNetwork: () => void;
  onViewSamplePassport: () => void;
}

// Concrete buyer questions replace the old generic asset taxonomy. These are
// the decisions SPR is actually meant to inform.
const BUYER_QUESTIONS = [
  'Can we verify what we are buying?',
  'Has this software changed since the last review?',
  'Which evidence supports this risk assessment?',
  'What do we actually know about this vendor?',
  'What remains UNKNOWN?',
];

// Who SPR is for, framed as the job to be done rather than an industry list.
const AUDIENCES = [
  { who: 'Security & IT teams', job: 'Decide whether software is safe to approve, with the evidence attached.' },
  { who: 'Procurement & vendor risk', job: 'Replace a questionnaire answer with an observation you can check.' },
  { who: 'MSPs', job: 'Assess software across many client environments from one place.' },
  { who: 'Software buyers', job: 'Understand what a supplier can and cannot demonstrate.' },
  { who: 'Developers & software owners', job: 'Show customers what your release actually proves.' },
];

// Outputs that exist in the product today. Nothing aspirational is listed.
const OUTPUTS = [
  { title: 'Software Passport', body: 'A durable identity and evidence record for one software asset at one exact version.' },
  { title: 'Evidence Explorer', body: 'Inspect the observations behind a result — source, timestamp and content hash.' },
  { title: 'Decision & trust state', body: 'What the evidence supports, what it does not, and the reason codes for both.' },
  { title: 'Continuous observation', body: 'Re-observe over time so an old review is not treated as permanent truth.' },
];

const INFRASTRUCTURE_STEPS: { n: string; title: string; description: string }[] = [
  { n: '01', title: 'Identity', description: 'Establish what a piece of software actually is -- its name, version, publisher, and release.' },
  { n: '02', title: 'Evidence', description: 'Collect observable information: SBOMs, scan results, attestations, and repository signals.' },
  { n: '03', title: 'Verification', description: 'Independently re-check what can be verified. Self-reported claims are confirmed, not assumed.' },
  { n: '04', title: 'Trust State', description: 'Turn available evidence into a current, explainable state -- never a fabricated conclusion.' },
  { n: '05', title: 'Continuous Observation', description: 'Track what changes over time, so the trust state stays current rather than static.' },
];

// The public homepage, rebuilt around SPR's category: a trust infrastructure
// layer, not a dashboard. The Trust Field visualization here is explicitly
// marked as example data (demo=true) -- there is no authenticated passport to
// draw real numbers from on a signed-out page. The four dimensions shown are
// the real ones the scoring engine actually computes today (security,
// compliance, vendor reputation, confidence); this component does not invent
// the other eight sometimes referenced elsewhere in mockups.
export default function HomePage({ onCreatePassport, onExploreTrustNetwork, onViewSamplePassport }: Props) {
  return (
    <div className="min-h-screen bg-[var(--spr-surface)] text-[#cccccc]">
      {/* Hero */}
      <section className="mx-auto flex max-w-7xl flex-col items-center gap-14 px-6 py-20 lg:flex-row lg:items-center lg:py-28">
        <div className="max-w-2xl">
          <img src="/brand/spr-logo.jpg" alt="Software Passport Registry" className="mb-6 h-10 w-auto" />
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">Software Trust Infrastructure</span>
            {/* Honest status: the release gate has not been cleared, so the page
                must not imply production readiness. */}
            <span className="rounded-full border border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-[var(--spr-amber)]">Limited early access</span>
          </div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-.02em] text-[var(--spr-text)] md:text-5xl">Verify software before you trust it.</h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[var(--spr-text-muted)]">SPR turns repositories, applications, dependencies and vendors into evidence-backed Software Passports — so buyers, security teams and operators can see what was observed, what was verified, and what remains unknown.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={onExploreTrustNetwork} className="inline-flex items-center gap-2 rounded-[3px] bg-[var(--spr-accent)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--spr-accent-hover)]">Run a Free Review <ArrowRight className="h-4 w-4" /></button>
            <button onClick={onViewSamplePassport} className="rounded-[3px] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-6 py-3 text-sm font-semibold text-[#cccccc] transition-colors hover:bg-[var(--spr-surface-hover)]">View Sample Passport</button>
            <button onClick={onCreatePassport} className="rounded-[3px] px-3 py-3 text-sm font-semibold text-[var(--spr-text-muted)] underline-offset-4 hover:text-[var(--spr-highlight)] hover:underline">Sign in</button>
          </div>
          <LegalFooterLinks className="mt-8" />
        </div>
        <div className="hidden w-full flex-1 justify-center lg:flex">
          <TrustField
            demo
            state="VERIFIED"
            centerLabel="PASSPORT"
            size={380}
            dimensions={[
              { key: 'security', label: 'Security', value: 91 },
              { key: 'compliance', label: 'Compliance', value: 84 },
              { key: 'vendor', label: 'Vendor Rep.', value: 78 },
              { key: 'confidence', label: 'Confidence', value: 88 },
            ]}
          />
        </div>
      </section>

      {/* Buyer questions replace the old generic asset taxonomy. */}
      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">The questions SPR is built to answer.</h2>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BUYER_QUESTIONS.map((question) => (
              <li key={question} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 text-sm leading-6 text-[var(--spr-text)]">{question}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Who it is for, framed as a job to be done. */}
      <section className="border-t border-[var(--spr-border)] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">Who SPR is for</h2>
          <dl className="mt-8 grid gap-5 md:grid-cols-2">
            {AUDIENCES.map((item) => (
              <div key={item.who} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
                <dt className="text-sm font-semibold text-[var(--spr-text)]">{item.who}</dt>
                <dd className="mt-1.5 text-xs leading-5 text-[var(--spr-text-muted)]">{item.job}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Evidence, and the UNKNOWN differentiator. */}
      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">See the evidence.</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">
            SPR keeps six things separate: observations, evidence, independent sources, verification,
            trust state and the decision. Repeated observations of one source are not independent
            corroboration, and SPR reports what its verification systems observed — it does not invent
            certainty where evidence is missing.
          </p>
          <div className="mt-9 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
            <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-amber)]">A state most products hide</div>
            <h3 className="mt-2 text-xl font-semibold text-[var(--spr-text)]">UNKNOWN is a real answer.</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--spr-text-muted)]">
              UNKNOWN does not mean safe, and it does not mean unsafe. It means the available evidence is
              insufficient to make that determination. SPR shows it with the same weight as any other
              state, because a trust product that cannot say &ldquo;I do not know&rdquo; is not
              trustworthy.
            </p>
            <button onClick={onViewSamplePassport} className="mt-6 inline-flex items-center gap-2 rounded-[3px] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-5 py-2.5 text-sm font-semibold text-[#cccccc] hover:bg-[var(--spr-surface-hover)]">
              See it on a sample Passport <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Tangible outputs that exist in the product today. */}
      <section className="border-t border-[var(--spr-border)] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-[var(--spr-text)] md:text-3xl">What you get</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {OUTPUTS.map((item) => (
              <div key={item.title} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
                <h3 className="text-sm font-semibold text-[var(--spr-text)]">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-5 text-[var(--spr-text-muted)]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Infrastructure explainer */}
      <section className="border-t border-[var(--spr-border)] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-6 md:grid-cols-5">
            {INFRASTRUCTURE_STEPS.map((step) => (
              <div key={step.n} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
                <div className="font-mono text-xs font-bold text-[var(--spr-highlight)]">{step.n}</div>
                <h3 className="mt-2 text-sm font-semibold text-[var(--spr-text)]">{step.title}</h3>
                <p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">{step.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <div className="inline-block rounded-md border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)]/15 px-6 py-3 text-sm font-bold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Software Passport</div>
          </div>
        </div>
      </section>

      {/* Category statement */}
      <section className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-6 py-16 text-center">
        <div className="mx-auto max-w-2xl">
          <div className="text-[11px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">Software Trust Infrastructure</div>
          <p className="mt-3 text-lg font-semibold text-[var(--spr-text)]">The trust layer for the software ecosystem.</p>
          <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Persistent software identity. Verifiable evidence. Explainable trust. Continuous observation.</p>
        </div>
      </section>
    </div>
  );
}
