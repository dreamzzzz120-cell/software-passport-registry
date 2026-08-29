/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import { ArrowRight, ClipboardList, DollarSign, Eye, Radio, ScanSearch, Scale, ShieldCheck, Users } from 'lucide-react';

interface Props {
  onEnter: () => void;
  onViewPricing: () => void;
}

// Describes only real, currently-shipped SPR capabilities -- nothing here is
// aspirational. If a feature is added or removed from the product, this list
// must be updated to match, not the other way around.
const CAPABILITIES: { icon: ReactNode; title: string; description: string }[] = [
  { icon: <Users className="h-5 w-5" />, title: 'One workspace per client', description: 'A dedicated Client record for each organization you serve, with a cross-client MSP Command Center for portfolio-wide oversight.' },
  { icon: <ScanSearch className="h-5 w-5" />, title: 'Software inventory & SBOM', description: 'Register the software each client runs as a Software Passport, with SBOM and OSV vulnerability scanning behind it.' },
  { icon: <ShieldCheck className="h-5 w-5" />, title: 'Evidence-first trust scoring', description: 'Trust scores are computed only from recorded evidence -- an asset with no evidence stays UNKNOWN, never a fabricated pass.' },
  { icon: <Eye className="h-5 w-5" />, title: 'Governance, risk & privacy', description: 'A real policy registry, control library, framework/requirement tracking, risk register, and privacy impact assessments -- not a static checklist.' },
  { icon: <Radio className="h-5 w-5" />, title: 'Continuous monitoring', description: 'Reverify software and infrastructure over time instead of treating a scan as a one-time snapshot, with real alerting on change.' },
  { icon: <ClipboardList className="h-5 w-5" />, title: 'Trust Response & reporting', description: 'Draft security-questionnaire answers from matched evidence, and hand clients plain-English, evidence-backed trust reports.' },
  { icon: <DollarSign className="h-5 w-5" />, title: 'Time & tool savings tracking', description: 'Measure the time SPR actually saves against a baseline you provide -- estimates are always labeled as estimates, never invented.' },
  { icon: <Scale className="h-5 w-5" />, title: 'Audit trail & tenant isolation', description: 'Every material action is recorded in a tamper-evident audit log, with strict tenant and Client isolation enforced server-side.' },
];

export default function MspLandingView({ onEnter, onViewPricing }: Props) {
  return (
    <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4]">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#3794ff]">Software Passport Registry for MSPs</div>
        <h1 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">
          Give every client a living, evidence-backed software trust report.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[#9d9d9d]">
          Run your client portfolio from one command center: inventory their software, collect real evidence, score trust
          from what's actually verified, track governance and risk, and hand each client a report they can trust — not a
          checklist that says "compliant" because a box got checked.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button onClick={onEnter} className="inline-flex items-center gap-2 rounded-[3px] bg-[#0e639c] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1177bb]">
            Enter SPR <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={onViewPricing} className="rounded-[3px] border border-[#3c3c3c] px-6 py-3 text-sm font-semibold text-[#d4d4d4] transition-colors hover:bg-[#2d2d2d]">
            View plans & pricing
          </button>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((item) => (
            <div key={item.title} className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
              <div className="mb-3 text-[#3794ff]">{item.icon}</div>
              <h3 className="text-sm font-semibold text-[#d4d4d4]">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[#9d9d9d]">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 max-w-2xl rounded-md border border-[#3c3c3c] bg-[#181818] p-4 text-xs leading-5 text-[#9d9d9d]">
          Software repository scanning is implemented today (GitHub, GitLab, Bitbucket, Azure DevOps), along with real
          ConnectWise, Autotask, NinjaOne, and Hudu integrations. This page reflects what's actually shipped, not a roadmap.
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3 rounded-md border border-[#3794ff]/40 bg-[#094771]/15 p-5">
          <ShieldCheck className="h-5 w-5 shrink-0 text-[#3794ff]" />
          <p className="flex-1 text-sm text-[#d4d4d4]">Not sure where to start? The Pilot plan lets you evaluate SPR on a small, bounded set of clients before committing.</p>
          <button onClick={onViewPricing} className="shrink-0 rounded-[3px] border border-[#3794ff]/40 px-4 py-2 text-xs font-semibold text-[#3794ff] hover:bg-[#3794ff]/10">See Pilot details</button>
        </div>
      </div>
    </div>
  );
}
