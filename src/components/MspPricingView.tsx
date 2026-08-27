/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Check, ShieldCheck } from 'lucide-react';

interface Props {
  isAuthenticated: boolean;
  onPrimaryAction: () => void;
}

// Displayed packaging only. This is NOT wired to Stripe or any automated billing —
// checkout still runs through the existing BillingView flow. Nothing here should be
// read as "this tier is live-metered" until that wiring exists.
const TIERS: { name: string; tagline: string; priceLabel: string; features: string[]; highlight?: boolean }[] = [
  {
    name: 'Starter',
    tagline: 'Small MSP, first few clients',
    priceLabel: 'Contact for pricing',
    features: [
      'Up to 5 clients',
      'Software passport registry per client',
      'SBOM + OSV vulnerability scanning',
      'Evidence-backed trust scoring',
      'Client-ready PDF reports',
    ],
  },
  {
    name: 'Growth',
    tagline: 'Growing MSP with a real client book',
    priceLabel: 'Contact for pricing',
    highlight: true,
    features: [
      'Up to 25 clients',
      'Everything in Starter',
      'Technician assignment & remediation workflow',
      'Cross-client risk rollup (Command Center)',
      'White-label branding on reports',
      'GitHub repository scanning',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'Larger MSP, multiple teams',
    priceLabel: 'Contact for pricing',
    features: [
      'Unlimited clients',
      'Everything in Growth',
      'Role-based team management',
      'Audit log & compliance evidence exports',
      'Priority support',
    ],
  },
];

export default function MspPricingView({ isAuthenticated, onPrimaryAction }: Props) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 text-[#d4d4d4]">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#3794ff]">Software Passport Registry for MSPs</div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Pricing built around clients and software, not seats</h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-[#9d9d9d]">
          Packaging shown below reflects how SPR is priced for MSPs. Checkout and invoicing run through your SPR workspace —
          this page does not itself charge a card.
        </p>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
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
              {isAuthenticated ? 'Manage billing' : 'Enter SPR'}
            </button>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 flex max-w-2xl items-start gap-3 rounded-md border border-[#3c3c3c] bg-[#181818] p-4 text-xs leading-5 text-[#9d9d9d]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#3794ff]" />
        <p>
          Displayed pricing is commercial packaging, not an automated billing plan. Actual checkout runs through Stripe inside
          your authenticated workspace (Billing), and no tier above is metered or enforced by the application yet.
        </p>
      </div>
    </div>
  );
}
