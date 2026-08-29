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

// Prices and client limits shown here must always match PLAN_CONFIG in
// src/routes/billing.ts (the single source of truth the server actually
// enforces) -- this page is display copy, not a second definition of the
// plans. Checkout runs through the existing BillingView/Stripe flow.
const TIERS: { name: string; tagline: string; priceLabel: string; features: string[]; highlight?: boolean }[] = [
  {
    name: 'Pilot',
    tagline: 'Evaluate SPR before committing',
    priceLabel: 'Negotiated ($0–$500 one-time)',
    features: [
      'Up to 2 clients',
      'Limited Passport creation and reporting',
      'Full evidence-first trust scoring on what you onboard',
      'For a bounded evaluation window',
    ],
  },
  {
    name: 'Starter',
    tagline: 'Small MSP, first few clients',
    priceLabel: '$499/month',
    features: [
      'Up to 10 client environments',
      'Software passport registry per client',
      'SBOM + OSV vulnerability scanning',
      'Evidence-backed trust scoring',
      'Client-ready PDF reports',
    ],
  },
  {
    name: 'Professional',
    tagline: 'MSP with an established client book',
    priceLabel: '$1,499/month',
    highlight: true,
    features: [
      'Up to 50 client environments',
      'Everything in Starter',
      'Technician assignment & remediation workflow',
      'Governance, risk, and privacy management',
      'Cross-client risk rollup (Command Center)',
    ],
  },
  {
    name: 'Growth',
    tagline: 'Growing MSP scaling client operations',
    priceLabel: '$2,999/month',
    features: [
      'Up to 150 client environments',
      'Everything in Professional',
      'White-label branding on reports',
      'GitHub repository scanning',
      'MSP time & tool savings / ROI reporting',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'Larger MSP, multiple teams, custom terms',
    priceLabel: '$5,000+/month (custom)',
    features: [
      'Unlimited client environments',
      'Everything in Growth',
      'Custom limits and contract terms',
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
              {isAuthenticated ? 'Manage billing' : 'Enter SPR'}
            </button>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 flex max-w-2xl items-start gap-3 rounded-md border border-[#3c3c3c] bg-[#181818] p-4 text-xs leading-5 text-[#9d9d9d]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#3794ff]" />
        <p>
          Actual checkout runs through Stripe inside your authenticated workspace (Billing). Client-environment limits shown
          above are enforced by the application once a plan is active; other listed features reflect current SPR
          functionality, not a separate per-feature metering system. Enterprise pricing and limits are set by contract, not
          automated checkout.
        </p>
      </div>
    </div>
  );
}
