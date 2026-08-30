/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import LegalFooterLinks from './legal/LegalFooterLinks';

interface Props {
  isAuthenticated: boolean;
  onPrimaryAction: () => void;
}

// Public MSP pricing mirrors the server-side PLAN_CONFIG values. Checkout is
// still performed by Stripe inside the authenticated SPR Billing surface.
const TIERS: { name: string; tagline: string; priceLabel: string; features: string[]; highlight?: boolean }[] = [
  {
    name: 'Pilot',
    tagline: 'White-label MSP pilot',
    priceLabel: '$500/month',
    features: [
      'Up to 2 client environments',
      'White-label MSP workflow',
      'Software Passports and evidence',
      'Reports and monitoring',
      'Bounded pilot program',
    ],
  },
  {
    name: 'Starter',
    tagline: 'Small MSP, first client book',
    priceLabel: '$499/month',
    features: [
      'Up to 10 client environments',
      'Software Passport registry',
      'SBOM + vulnerability evidence',
      'Evidence-backed trust state',
      'Client-ready reports',
    ],
  },
  {
    name: 'Growth',
    tagline: 'MSP scaling its client operations',
    priceLabel: '$1,000/month',
    highlight: true,
    features: [
      'Up to 50 client environments',
      'Everything in Starter',
      'Remediation workflow',
      'Governance, risk, and privacy management',
      'Cross-client risk rollup',
    ],
  },
  {
    name: 'Scale',
    tagline: 'Larger MSP portfolio',
    priceLabel: '$2,500/month',
    features: [
      'Up to 150 client environments',
      'Everything in Growth',
      'White-label reporting',
      'GitHub repository scanning',
      'MSP time and ROI reporting',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'Custom contracts and larger teams',
    priceLabel: '$5,000+/month',
    features: [
      'Custom client limits',
      'Everything in Scale',
      'Custom contract terms',
      'Role-based team management',
      'Audit and compliance exports',
      'Priority support',
    ],
  },
];

export default function MspPricingView({ isAuthenticated, onPrimaryAction }: Props) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 text-[#d4d4d4]">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#3794ff]">Software Passport Registry for MSPs</div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Pay for the software trust work you use</h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-[#9d9d9d]">
          SPR charges for verification, evidence, reports, monitoring, API access, and MSP operations. No hidden free tier for paid work.
        </p>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {TIERS.map((tier) => (
          <div key={tier.name} className={`rounded-md border p-6 ${tier.highlight ? 'border-[#3794ff] bg-[#0e639c]/10' : 'border-[#3c3c3c] bg-[#252526]'}`}>
            {tier.highlight && <div className="mb-3 inline-flex items-center gap-1 rounded-full border border-[#3794ff]/40 bg-[#3794ff]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#3794ff]">Most common</div>}
            <h2 className="text-xl font-bold text-[#d4d4d4]">{tier.name}</h2>
            <p className="mt-1 text-sm text-[#9d9d9d]">{tier.tagline}</p>
            <p className="mt-4 text-2xl font-bold text-[#d4d4d4]">{tier.priceLabel}</p>
            <ul className="mt-5 space-y-2.5">
              {tier.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-[#d4d4d4]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#89d185]" /> {feature}
                </li>
              ))}
            </ul>
            <button onClick={onPrimaryAction} className="spr-btn spr-btn-primary mt-6 w-full">
              {isAuthenticated ? 'Open billing' : 'Enter SPR'}
            </button>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 flex max-w-2xl items-start gap-3 rounded-md border border-[#3c3c3c] bg-[#181818] p-4 text-xs leading-5 text-[#9d9d9d]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#3794ff]" />
        <p>
          Actual checkout runs through Stripe inside SPR Billing. One-time verification products and recurring add-ons are also available there. Enterprise pricing and limits are contractual rather than automated checkout.
        </p>
      </div>

      <LegalFooterLinks className="mx-auto mt-8 max-w-2xl justify-center" />
    </div>
  );
}
