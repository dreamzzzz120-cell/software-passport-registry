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
}

const FRAGMENTED_SOURCES = ['Repositories', 'SaaS', 'Dependencies', 'APIs', 'AI Systems', 'Vendors', 'Cloud', 'Security Systems', 'Compliance Systems'];

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
export default function HomePage({ onCreatePassport, onExploreTrustNetwork }: Props) {
  return (
    <div className="min-h-screen bg-[#1e1e1e] text-[#cccccc]">
      {/* Hero */}
      <section className="mx-auto flex max-w-7xl flex-col items-center gap-14 px-6 py-20 lg:flex-row lg:items-center lg:py-28">
        <div className="max-w-2xl">
          <img src="/brand/spr-logo.jpg" alt="Software Passport Registry" className="mb-6 h-10 w-auto" />
          <div className="mb-5 text-[11px] font-bold uppercase tracking-[.22em] text-[#3794ff]">Software Trust Infrastructure</div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-.02em] text-[#d4d4d4] md:text-5xl">The trust infrastructure layer for software.</h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#9d9d9d]">SPR gives software a persistent identity, verifies its evidence, and turns fragmented signals into a living trust state.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={onCreatePassport} className="inline-flex items-center gap-2 rounded-[3px] bg-[#0e639c] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1177bb]">Create a Software Passport <ArrowRight className="h-4 w-4" /></button>
            <button onClick={onExploreTrustNetwork} className="rounded-[3px] border border-[#3c3c3c] bg-[#2d2d2d] px-6 py-3 text-sm font-semibold text-[#cccccc] transition-colors hover:bg-[#383838]">Explore the Trust Network</button>
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

      {/* Fragmentation -> convergence */}
      <section className="border-t border-[#3c3c3c] bg-[#181818] px-6 py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-2xl font-semibold text-[#d4d4d4] md:text-3xl">Software is everywhere. Trust is fragmented.</h2>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            {FRAGMENTED_SOURCES.map((source) => (
              <span key={source} className="rounded-full border border-[#3c3c3c] bg-[#252526] px-3.5 py-1.5 text-xs text-[#9d9d9d]">{source}</span>
            ))}
          </div>
          <div className="mx-auto mt-8 h-10 w-px bg-gradient-to-b from-[#3c3c3c] to-[#3794ff]" />
          <h2 className="text-2xl font-bold text-[#3794ff] md:text-3xl">SPR creates the trust layer.</h2>
        </div>
      </section>

      {/* Infrastructure explainer */}
      <section className="border-t border-[#3c3c3c] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-6 md:grid-cols-5">
            {INFRASTRUCTURE_STEPS.map((step) => (
              <div key={step.n} className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
                <div className="font-mono text-xs font-bold text-[#3794ff]">{step.n}</div>
                <h3 className="mt-2 text-sm font-semibold text-[#d4d4d4]">{step.title}</h3>
                <p className="mt-2 text-xs leading-5 text-[#9d9d9d]">{step.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <div className="inline-block rounded-md border border-[#3794ff]/40 bg-[#094771]/15 px-6 py-3 text-sm font-bold uppercase tracking-[.15em] text-[#3794ff]">Software Passport</div>
          </div>
        </div>
      </section>

      {/* Category statement */}
      <section className="border-t border-[#3c3c3c] bg-[#181818] px-6 py-16 text-center">
        <div className="mx-auto max-w-2xl">
          <div className="text-[11px] font-bold uppercase tracking-[.22em] text-[#3794ff]">Software Trust Infrastructure</div>
          <p className="mt-3 text-lg font-semibold text-[#d4d4d4]">The trust layer for the software ecosystem.</p>
          <p className="mt-2 text-sm leading-6 text-[#9d9d9d]">Persistent software identity. Verifiable evidence. Explainable trust. Continuous observation.</p>
        </div>
      </section>
    </div>
  );
}
