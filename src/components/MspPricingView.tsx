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

// Public MSP pricing is intentionally framed around the recurring service an
// MSP can deliver to its clients: client coverage, software assets, evidence,
// monitoring, white-label delivery, and portfolio operations.
const TIERS: { name: string; tagline: string; priceLabel: string; features: string[]; highlight?: boolean }[] = [
  {
    name: 'Free',
    tagline: 'See SPR before you sell it',
    priceLabel: '$0',
    features: [
      '1 software review',
      'Basic software identity and risk assessment',
      'Limited evidence view',
      'BUY / INVESTIGATE / AVOID result',
      'Sample client-ready report',
    ],
  },
  {
    name: 'MSP Starter',
    tagline: 'Start offering software trust as an MSP service',
    priceLabel: '$149/month',
    features: [
      'Up to 5 managed clients',
      'Up to 50 software assets',
      'Software Passports and evidence',
      'SBOM + vulnerability evidence',
      'Trust scoring and BUY / INVESTIGATE / AVOID',
      'Evidence Explorer and evidence history',
      '5 client-ready reports/month',
      'Monthly monitoring and email alerts',
      '2 MSP users',
    ],
  },
  {
    name: 'MSP Professional',
    tagline: 'Turn SPR into a recurring client service',
    priceLabel: '$399/month',
    highlight: true,
    features: [
      'Up to 25 managed clients',
      'Up to 250 software assets',
      'Everything in Starter',
      'Weekly continuous verification',
      'Change and risk alerts',
      'White-label reports and MSP branding',
      'Client-specific workspaces and portal',
      '25 client-ready reports/month',
      'Scheduled executive + technical reports',
      'Compliance-oriented evidence mapping',
      '10 MSP users',
      'Full MSP Command Center',
    ],
  },
  {
    name: 'MSP Business',
    tagline: 'Run software trust across your full client portfolio',
    priceLabel: '$799/month',
    features: [
      'Up to 100 managed clients',
      'Up to 1,000 software assets',
      'Everything in Professional',
      'Continuous automated monitoring',
      'Advanced risk and evidence alerts',
      'Unlimited client-ready reports',
      'Portfolio-wide risk and client ranking',
      'Advanced MSP Command Center',
      'Scheduled client reporting and bulk operations',
      'API access and webhooks',
      'Unlimited MSP users',
      'Priority support and guided onboarding',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'For large MSPs, MSSPs and enterprise programs',
    priceLabel: 'Custom',
    features: [
      'Custom client and asset limits',
      'Everything in Business',
      'Advanced API and custom integrations',
      'SSO and advanced RBAC',
      'Custom evidence retention',
      'Custom compliance and reporting requirements',
      'Dedicated onboarding and support',
      'SLA options and custom contracts',
    ],
  },
];

export default function MspPricingView({ isAuthenticated, onPrimaryAction }: Props) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-16 text-[var(--spr-text)]">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Software Passport Registry for MSPs</div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Turn software trust into a recurring MSP service</h1>
        <p className="mx-auto mt-4 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">
          SPR gives MSPs the evidence, monitoring, reports, white-label delivery, and portfolio visibility needed to offer software trust and verification to their clients.
        </p>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {TIERS.map((tier) => (
          <div key={tier.name} className={`rounded-md border p-6 ${tier.highlight ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent)]/10' : 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)]'}`}>
            {tier.highlight && <div className="mb-3 inline-flex items-center gap-1 rounded-full border border-[var(--spr-highlight)]/40 bg-[var(--spr-highlight)]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--spr-highlight)]">Most popular</div>}
            <h2 className="text-xl font-bold text-[var(--spr-text)]">{tier.name}</h2>
            <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{tier.tagline}</p>
            <p className="mt-4 text-2xl font-bold text-[var(--spr-text)]">{tier.priceLabel}</p>
            <ul className="mt-5 space-y-2.5">
              {tier.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-[var(--spr-text)]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-green)]" /> {feature}
                </li>
              ))}
            </ul>
            <button onClick={onPrimaryAction} className="spr-btn spr-btn-primary mt-6 w-full">
              {isAuthenticated ? 'Open billing' : tier.name === 'Free' ? 'Try SPR free' : 'Get started'}
            </button>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 max-w-4xl rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-5">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h2 className="text-base font-semibold text-[var(--spr-text)]">Why MSPs buy SPR</h2>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-[var(--spr-text-muted)]">
              <li>• Build a new recurring software-trust service without building the platform.</li>
              <li>• Deliver evidence-backed reports clients can understand and act on.</li>
              <li>• Monitor software risk and changes across the client portfolio.</li>
              <li>• White-label the client-facing experience as part of your own offering.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--spr-text)]">Simple MSP economics</h2>
            <p className="mt-3 text-sm leading-5 text-[var(--spr-text-muted)]">
              An MSP can bundle SPR into its own managed service. For example, 10 clients at $150/month creates $1,500/month in client revenue against a $399/month SPR Professional subscription, before the MSP's own service and support costs.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-4xl items-start gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-4 text-xs leading-5 text-[var(--spr-text-muted)]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-highlight)]" />
        <p>
          Recurring plans are billed through Stripe inside SPR Billing. Enterprise pricing and limits are contractual. White-label and advanced capabilities are subject to the plan and configured account entitlements.
        </p>
      </div>

      <LegalFooterLinks className="mx-auto mt-8 max-w-2xl justify-center" />
    </div>
  );
}
