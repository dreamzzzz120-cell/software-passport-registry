/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { CreditCard, ShieldCheck, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type PlanId = 'pilot' | 'starter' | 'professional' | 'growth' | 'enterprise';
type OneTimeProductId = 'softwarePassport' | 'evidenceReport' | 'securityAssessment' | 'verifiedSystemReport' | 'dueDiligenceReport' | 'vendorRiskAssessment' | 'sbomAnalysis' | 'portfolioAssessment' | 'auditEvidencePackage' | 'customAssessment';
type AddonId = 'continuousVerification' | 'trustBadge' | 'publicPassport' | 'api';
// priceLabel is nullable on purpose: it comes from the real Stripe Price and
// is null when that price could not be read, which the UI must show as an
// unavailable price rather than as a figure of its own.
type PlanMeta = { id: PlanId; label: string; priceLabel: string | null; clientLimit: number | null; description: string | null; checkoutAvailable: boolean };
type ProductMeta = { id: OneTimeProductId; label: string; priceLabel: string | null; description: string | null; checkoutAvailable: boolean };
type AddonMeta = { id: AddonId; label: string; priceLabel: string | null; description: string | null; checkoutAvailable: boolean };
type BillingStatus = {
  billingConfigured: boolean;
  plans: PlanMeta[];
  products: ProductMeta[];
  addons: AddonMeta[];
  availablePlans: PlanId[];
  availableProducts: OneTimeProductId[];
  availableAddons: AddonId[];
  subscription: { plan: PlanId | null; status: string; clientLimit: number | null; currentPeriodEnd: string | null } | null;
  clientCount: number;
};

const limitLabel = (limit: number | null) => limit === null ? 'Unlimited clients' : `Up to ${limit} client${limit === 1 ? '' : 's'}`;
// One primary action per section; everything else is the outlined secondary,
// so the page reads as a decision rather than nineteen identical blue buttons.
const BTN_BASE = 'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';
const BTN_PRIMARY = `${BTN_BASE} bg-[var(--spr-accent)] text-white hover:bg-[var(--spr-accent-hover)]`;
const BTN_OUTLINE = `${BTN_BASE} border border-[var(--spr-border)] bg-[var(--spr-surface)] text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]`;
const SALES_EMAIL = 'contact@softwarepassportregistry.com';

export default function BillingView() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
  const [busyProduct, setBusyProduct] = useState<OneTimeProductId | null>(null);
  const [busyAddon, setBusyAddon] = useState<AddonId | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  const loadStatus = () => {
    setLoading(true);
    setError(null);
    apiFetch('/api/billing')
      .then((res) => { if (!res.ok) throw new Error('Unable to load billing status.'); return res.json(); })
      .then((data: BillingStatus) => setStatus(data))
      .catch((err) => { setError(err instanceof Error ? err.message : 'Unable to load billing status.'); setStatus(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStatus(); }, []);

  const handleSubscribe = async (plan: PlanId) => {
    setBusyPlan(plan);
    setError(null);
    try {
      const res = await apiFetch('/api/billing/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || 'Unable to start checkout.');
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start checkout.');
    } finally {
      setBusyPlan(null);
    }
  };

  const handlePurchase = async (product: OneTimeProductId) => {
    setBusyProduct(product);
    setError(null);
    try {
      const res = await apiFetch('/api/billing/one-time-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || 'Unable to start checkout.');
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start checkout.');
    } finally {
      setBusyProduct(null);
    }
  };

  const handleAddon = async (addon: AddonId) => {
    setBusyAddon(addon);
    setError(null);
    try {
      const res = await apiFetch('/api/billing/addon-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addon }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || 'Unable to start checkout.');
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start checkout.');
    } finally {
      setBusyAddon(null);
    }
  };

  const handleManageBilling = async () => {
    setOpeningPortal(true);
    setError(null);
    try {
      const res = await apiFetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error === 'NO_SUBSCRIPTION' ? 'No active subscription to manage yet.' : (data?.error || 'Unable to open billing portal.'));
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open billing portal.');
    } finally {
      setOpeningPortal(false);
    }
  };


  const anyBusy = busyPlan !== null || busyProduct !== null || busyAddon !== null;
  const currentPlan = status?.subscription?.plan && status.subscription.status !== 'canceled' ? status.subscription.plan : null;
  const currentPlanLabel = currentPlan ? status?.plans.find((p) => p.id === currentPlan)?.label ?? currentPlan : null;

  return (
    <div className="space-y-10" id="msp-billing-view">
      <div className="border-b border-[var(--spr-border)] pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--spr-text)]">Billing</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--spr-text-muted)]">
          Plans, add-ons and one-time assessments. Checkout runs through Stripe, and every price shown is read live from the Stripe Price the button charges against.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-4 py-3 text-sm text-[var(--spr-red)]">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center space-y-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-20">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--spr-highlight)]" />
          <p className="text-sm text-[var(--spr-text-muted)]">Loading billing…</p>
        </div>
      ) : !status?.billingConfigured ? (
        <div className="space-y-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-8 text-center">
          <CreditCard className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]" />
          <p className="text-sm font-semibold text-[var(--spr-text)]">Billing is not yet configured for this deployment.</p>
          <p className="text-sm text-[var(--spr-text-muted)]">Stripe credentials are not available to this server.</p>
        </div>
      ) : (
        <>
          {currentPlan && (
            <div className="flex flex-col justify-between gap-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-5 py-4 md:flex-row md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-[var(--spr-text-muted)]">Current plan</span>
                  <span className="text-base font-semibold text-[var(--spr-text)]">{currentPlanLabel}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[12px] font-medium ${status.subscription!.status === 'active' ? 'border-[var(--spr-green)]/40 text-[var(--spr-green)]' : status.subscription!.status === 'past_due' ? 'border-[var(--spr-red)]/40 text-[var(--spr-red)]' : 'border-[var(--spr-amber)]/40 text-[var(--spr-amber)]'}`}>
                    {status.subscription!.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--spr-text-muted)]">
                  {status.clientCount} client{status.clientCount === 1 ? '' : 's'} used{status.subscription!.clientLimit != null ? ` of ${status.subscription!.clientLimit}` : ' (unlimited)'}
                  {status.subscription!.currentPeriodEnd && ` · renews ${new Date(status.subscription!.currentPeriodEnd).toLocaleDateString()}`}
                </p>
              </div>
              <button onClick={handleManageBilling} disabled={openingPortal} className={BTN_OUTLINE}>
                {openingPortal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                Manage billing
              </button>
            </div>
          )}

          <section aria-labelledby="billing-plans">
            <h2 id="billing-plans" className="text-base font-semibold text-[var(--spr-text)]">Plans</h2>
            <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Pick the tier that matches how many clients you manage. Change plans any time from Manage billing.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {status.plans.map((plan) => {
                const isCurrent = plan.id === currentPlan;
                const recommended = plan.id === 'professional';
                const salesLed = !plan.checkoutAvailable && (plan.id === 'enterprise' || plan.id === 'pilot');
                return (
                  <div
                    key={plan.id}
                    className={`relative flex flex-col rounded-md border p-5 ${isCurrent ? 'border-[var(--spr-green)]/60 bg-[var(--spr-surface)]' : recommended ? 'border-[var(--spr-highlight)] bg-[var(--spr-surface)]' : 'border-[var(--spr-border)] bg-[var(--spr-surface)]'}`}
                  >
                    {recommended && !isCurrent && (
                      <span className="absolute -top-2.5 left-4 rounded-full bg-[var(--spr-highlight)] px-2 py-0.5 text-[11px] font-semibold text-white">Recommended</span>
                    )}
                    <h3 className="text-sm font-semibold text-[var(--spr-text)]">{plan.label}</h3>
                    <div className="mt-3 flex items-baseline gap-1">
                      {plan.priceLabel ? (
                        <>
                          <span className="text-2xl font-semibold tabular-nums text-[var(--spr-text)]">{plan.priceLabel.split('/')[0]}</span>
                          {plan.priceLabel.includes('/') && <span className="text-sm text-[var(--spr-text-muted)]">/{plan.priceLabel.split('/')[1]}</span>}
                        </>
                      ) : (
                        <span className="text-2xl font-semibold text-[var(--spr-text)]">{salesLed ? 'Custom' : '—'}</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{limitLabel(plan.clientLimit)}</p>
                    {plan.description && <p className="mt-3 text-sm leading-5 text-[var(--spr-text-muted)]">{plan.description}</p>}
                    <div className="mt-auto pt-5">
                      {isCurrent ? (
                        <div className={`${BTN_OUTLINE} w-full cursor-default text-[var(--spr-green)]`} aria-disabled="true">
                          <ShieldCheck className="h-4 w-4" /> Current plan
                        </div>
                      ) : salesLed ? (
                        <a href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`SPR ${plan.label} plan`)}`} className={`${BTN_OUTLINE} w-full`}>
                          Contact sales
                        </a>
                      ) : (
                        <button
                          onClick={() => handleSubscribe(plan.id)}
                          disabled={!plan.checkoutAvailable || anyBusy}
                          className={`${recommended ? BTN_PRIMARY : BTN_OUTLINE} w-full`}
                        >
                          {busyPlan === plan.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          {plan.checkoutAvailable ? (currentPlan ? 'Switch plan' : 'Get started') : 'Unavailable'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="billing-addons">
            <h2 id="billing-addons" className="text-base font-semibold text-[var(--spr-text)]">Add-ons</h2>
            <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Recurring services that keep your passports verified and public.</p>
            <div className="mt-4 divide-y divide-[var(--spr-border)] rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)]">
              {status.addons.map((addon) => (
                <div key={addon.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--spr-text)]">{addon.label}</div>
                    {addon.description && <div className="mt-0.5 text-sm text-[var(--spr-text-muted)]">{addon.description}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="text-sm font-semibold tabular-nums text-[var(--spr-text)]">{addon.priceLabel ?? '—'}</span>
                    <button onClick={() => handleAddon(addon.id)} disabled={!addon.checkoutAvailable || anyBusy} className={BTN_OUTLINE}>
                      {busyAddon === addon.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {addon.checkoutAvailable ? 'Add' : 'Unavailable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="billing-onetime">
            <h2 id="billing-onetime" className="text-base font-semibold text-[var(--spr-text)]">One-time reports & assessments</h2>
            <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Pay once for a specific deliverable. No subscription required.</p>
            <div className="mt-4 divide-y divide-[var(--spr-border)] rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)]">
              {status.products.map((product) => (
                <div key={product.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--spr-text)]">{product.label}</div>
                    {product.description && <div className="mt-0.5 text-sm text-[var(--spr-text-muted)]">{product.description}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="text-sm font-semibold tabular-nums text-[var(--spr-text)]">{product.priceLabel ?? '—'}</span>
                    <button onClick={() => handlePurchase(product.id)} disabled={!product.checkoutAvailable || anyBusy} className={BTN_OUTLINE}>
                      {busyProduct === product.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {product.checkoutAvailable ? 'Buy' : 'Unavailable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
