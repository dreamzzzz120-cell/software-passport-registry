/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Check, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import LegalFooterLinks from './legal/LegalFooterLinks';
import { apiFetch } from '../utils/apiClient';

interface Props {
  isAuthenticated: boolean;
  onPrimaryAction: () => void;
}

type PlanId = 'pilot' | 'starter' | 'professional' | 'growth' | 'enterprise';
type CatalogPlan = {
  id: PlanId;
  label: string;
  priceLabel: string | null;
  clientLimit: number | null;
  checkoutAvailable: boolean;
};

// Every figure on this page that costs money, or that SPR will actually
// enforce, comes from GET /api/billing/catalog -- the same catalogue the
// Subscribe button in Billing checks out against, with each amount read from
// the live Stripe Price. Only the positioning copy lives here. This page used
// to carry its own hardcoded monthly prices and client counts, which drifted
// away from what billing charged and enforced; a visitor could be quoted one
// price on this page and charged another at checkout.
const PLAN_COPY: Record<PlanId, { tagline: string; features: string[]; highlight?: boolean }> = {
  pilot: {
    tagline: 'Run a white-label pilot before committing',
    features: [
      'Software Passports and evidence',
      'SBOM + vulnerability evidence',
      'Trust scoring and BUY / INVESTIGATE / AVOID',
      'White-label reports and MSP branding',
      'Client-ready reporting',
    ],
  },
  starter: {
    tagline: 'Start offering software trust as an MSP service',
    features: [
      'Up to 50 software assets',
      'Software Passports and evidence',
      'SBOM + vulnerability evidence',
      'Trust scoring and BUY / INVESTIGATE / AVOID',
      'Evidence Explorer and evidence history',
      'Client-ready reports',
      'Monitoring and email alerts',
    ],
  },
  professional: {
    tagline: 'Turn SPR into a recurring client service',
    highlight: true,
    features: [
      'Up to 250 software assets',
      'Everything in MSP Starter',
      'Weekly continuous verification',
      'Change and risk alerts',
      'White-label reports and MSP branding',
      'Client-specific workspaces and portal',
      'Scheduled executive + technical reports',
      'Compliance-oriented evidence mapping',
      'Full MSP Command Center',
    ],
  },
  growth: {
    tagline: 'Run software trust across your full client portfolio',
    features: [
      'Up to 1,000 software assets',
      'Everything in MSP Professional',
      'Continuous automated monitoring',
      'Advanced risk and evidence alerts',
      'Portfolio-wide risk and client ranking',
      'Advanced MSP Command Center',
      'Scheduled client reporting and bulk operations',
      'API access and webhooks',
      'Priority support and guided onboarding',
    ],
  },
  enterprise: {
    tagline: 'For large MSPs, MSSPs and enterprise programs',
    features: [
      'Everything in MSP Business',
      'Advanced API and custom integrations',
      'SSO and advanced RBAC',
      'Custom evidence retention',
      'Custom compliance and reporting requirements',
      'Dedicated onboarding and support',
      'SLA options and custom contracts',
    ],
  },
};

// The free entry point is not a Stripe plan and never goes through checkout,
// so it is stated here rather than read from the billing catalogue.
const FREE_TIER = {
  name: 'Free',
  tagline: 'See SPR before you sell it',
  features: [
    '1 software review',
    'Basic software identity and risk assessment',
    'Limited evidence view',
    'BUY / INVESTIGATE / AVOID result',
    'Sample client-ready report',
  ],
};

const limitLabel = (limit: number | null) =>
  limit === null ? 'Client coverage agreed by contract' : `Up to ${limit} managed client${limit === 1 ? '' : 's'}`;

export default function MspPricingView({ isAuthenticated, onPrimaryAction }: Props) {
  const [plans, setPlans] = useState<CatalogPlan[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch('/api/billing/catalog')
      .then((res) => { if (!res.ok) throw new Error('catalog unavailable'); return res.json(); })
      .then((data: { plans: CatalogPlan[] }) => { if (active) setPlans(data.plans); })
      .catch(() => { if (active) { setCatalogError(true); setPlans([]); } });
    return () => { active = false; };
  }, []);

  // Used in the worked example below. Quoting a subscription cost in that
  // example is only honest while the real price of that plan is known.
  const featured = plans?.find((plan) => PLAN_COPY[plan.id]?.highlight) ?? null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-16 text-[var(--spr-text)]">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Software Passport Registry for MSPs</div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">Turn software trust into a recurring MSP service</h1>
        <p className="mx-auto mt-4 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">
          SPR gives MSPs the evidence, monitoring, reports, white-label delivery, and portfolio visibility needed to offer software trust and verification to their clients.
        </p>
      </div>

      {catalogError && (
        <div role="alert" className="mx-auto mt-8 flex max-w-2xl items-start gap-2 rounded-md border border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10 p-3 text-xs leading-5 text-[var(--spr-amber)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Current subscription prices could not be loaded from Stripe just now, so they are not shown below. Open Billing to see live pricing.
        </div>
      )}

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
          <h2 className="text-xl font-bold text-[var(--spr-text)]">{FREE_TIER.name}</h2>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{FREE_TIER.tagline}</p>
          <p className="mt-4 text-2xl font-bold text-[var(--spr-text)]">$0</p>
          <ul className="mt-5 space-y-2.5">
            {FREE_TIER.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-[var(--spr-text)]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-green)]" /> {feature}
              </li>
            ))}
          </ul>
          <button onClick={onPrimaryAction} className="spr-btn spr-btn-primary mt-6 w-full">
            {isAuthenticated ? 'Open billing' : 'Try SPR free'}
          </button>
        </div>

        {plans === null ? (
          <div className="flex items-center justify-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 text-xs text-[var(--spr-text-muted)] sm:col-span-1 lg:col-span-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading current plans and prices…
          </div>
        ) : plans.map((plan) => {
          const copy = PLAN_COPY[plan.id];
          if (!copy) return null;
          return (
            <div key={plan.id} className={`rounded-md border p-6 ${copy.highlight ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent)]/10' : 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)]'}`}>
              {copy.highlight && <div className="mb-3 inline-flex items-center gap-1 rounded-full border border-[var(--spr-highlight)]/40 bg-[var(--spr-highlight)]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--spr-highlight)]">Most popular</div>}
              <h2 className="text-xl font-bold text-[var(--spr-text)]">{plan.label}</h2>
              <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{copy.tagline}</p>
              <p className={`mt-4 text-2xl font-bold ${plan.priceLabel ? 'text-[var(--spr-text)]' : 'text-[var(--spr-text-muted)]'}`}>
                {plan.priceLabel ?? 'Contact us for pricing'}
              </p>
              <ul className="mt-5 space-y-2.5">
                <li className="flex items-start gap-2 text-sm text-[var(--spr-text)]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-green)]" /> {limitLabel(plan.clientLimit)}
                </li>
                {copy.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-[var(--spr-text)]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-green)]" /> {feature}
                  </li>
                ))}
              </ul>
              <button onClick={onPrimaryAction} className="spr-btn spr-btn-primary mt-6 w-full">
                {isAuthenticated ? 'Open billing' : plan.checkoutAvailable ? 'Get started' : 'Talk to us'}
              </button>
            </div>
          );
        })}
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
              An MSP can bundle SPR into its own managed service: what it bills its own clients each month, less its SPR subscription, before the MSP's own service and support costs.
              {featured?.priceLabel && ` ${featured.label} currently costs ${featured.priceLabel}.`}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-4xl items-start gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-4 text-xs leading-5 text-[var(--spr-text-muted)]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-highlight)]" />
        <p>
          Recurring plans are billed through Stripe inside SPR Billing, and every price above is read from the live Stripe price that checkout charges against. Enterprise pricing and limits are contractual. White-label and advanced capabilities are subject to the plan and configured account entitlements.
        </p>
      </div>

      <LegalFooterLinks className="mx-auto mt-8 max-w-2xl justify-center" />
    </div>
  );
}
