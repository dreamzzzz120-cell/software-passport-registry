/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { CreditCard, ShieldCheck, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type PlanId = 'pilot' | 'starter' | 'professional' | 'growth' | 'enterprise';
type PlanMeta = { id: PlanId; label: string; priceLabel: string; clientLimit: number | null; checkoutAvailable: boolean };
type BillingStatus = {
  billingConfigured: boolean;
  plans: PlanMeta[];
  availablePlans: PlanId[];
  subscription: { plan: PlanId | null; status: string; clientLimit: number | null; currentPeriodEnd: string | null } | null;
  clientCount: number;
};

const limitLabel = (limit: number | null) => limit === null ? 'Unlimited clients' : `Up to ${limit} client${limit === 1 ? '' : 's'}`;

export default function BillingView() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
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
      if (!res.ok) throw new Error(data?.error || 'Unable to start checkout.');
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start checkout.');
    } finally {
      setBusyPlan(null);
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

  return (
    <div className="space-y-6" id="msp-billing-view">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[var(--spr-amber)]"><CreditCard className="h-4 w-4" /> Billing</div>
          <h1 className="text-xl font-display font-bold text-[var(--spr-text)]">Subscription & Billing</h1>
          <p className="text-xs text-[var(--spr-text-muted)] font-sans mt-1">Manage your SPR plan. Checkout and invoicing run through Stripe.</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-4 py-3 text-xs text-[var(--spr-red)] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-xl space-y-2">
          <Loader2 className="w-6 h-6 text-[var(--spr-highlight)] animate-spin" />
          <p className="text-xs text-[var(--spr-text-muted)] font-mono uppercase">Loading billing status…</p>
        </div>
      ) : !status?.billingConfigured ? (
        <div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-8 text-center space-y-2">
          <CreditCard className="w-8 h-8 text-[var(--spr-text-faint)] mx-auto" />
          <p className="text-sm font-semibold text-[var(--spr-text)]">Billing is not yet configured for this deployment.</p>
          <p className="text-xs text-[var(--spr-text-muted)]">No Stripe account is connected. This isn't a bug — it just hasn't been set up yet.</p>
        </div>
      ) : (
        <>
          {status.subscription?.plan && status.subscription.status !== 'canceled' && (
            <div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-mono uppercase text-[var(--spr-text-muted)]">Current plan</p>
                <p className="text-lg font-bold text-[var(--spr-text)] flex items-center gap-2">
                  {status.plans.find((p) => p.id === status.subscription!.plan)?.label ?? status.subscription.plan}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.subscription.status === 'active' ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)]' : status.subscription.status === 'past_due' ? 'bg-[var(--spr-red)]/15 text-[var(--spr-red)]' : 'bg-[var(--spr-amber)]/15 text-[var(--spr-amber)]'}`}>
                    {status.subscription.status}
                  </span>
                </p>
                <p className="text-xs text-[var(--spr-text-muted)] mt-1">
                  {status.clientCount} client{status.clientCount === 1 ? '' : 's'} used{status.subscription.clientLimit != null ? ` of ${status.subscription.clientLimit}` : ' (unlimited)'}
                  {status.subscription.currentPeriodEnd && ` · renews ${new Date(status.subscription.currentPeriodEnd).toLocaleDateString()}`}
                </p>
              </div>
              <button onClick={handleManageBilling} disabled={openingPortal} className="inline-flex items-center gap-1.5 bg-[var(--spr-surface-sunken)] hover:bg-[var(--spr-surface-hover)] text-[var(--spr-text)] font-bold py-2 px-3.5 rounded-lg text-xs transition cursor-pointer disabled:opacity-50">
                {openingPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                Manage billing
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {status.plans.map((planMeta) => {
              const isCurrent = status.subscription?.plan === planMeta.id && status.subscription.status !== 'canceled';
              return (
                <div key={planMeta.id} className={`rounded-xl border p-5 space-y-3 ${isCurrent ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent)]/10' : 'border-[var(--spr-border)] bg-[var(--spr-surface)]'}`}>
                  <h3 className="text-sm font-bold text-[var(--spr-text)]">{planMeta.label}</h3>
                  <p className="text-xs text-[var(--spr-highlight)] font-semibold">{planMeta.priceLabel}</p>
                  <p className="text-xs text-[var(--spr-text-muted)]">{limitLabel(planMeta.clientLimit)}</p>
                  {isCurrent ? (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--spr-green)]"><ShieldCheck className="w-4 h-4" /> Current plan</div>
                  ) : (
                    <button
                      onClick={() => handleSubscribe(planMeta.id)}
                      disabled={!planMeta.checkoutAvailable || busyPlan !== null}
                      title={!planMeta.checkoutAvailable ? 'This plan has no Stripe price configured yet -- contact us to subscribe.' : undefined}
                      className="w-full inline-flex items-center justify-center gap-1.5 bg-[var(--spr-accent)] hover:bg-[var(--spr-accent-hover)] disabled:opacity-40 text-white font-bold py-2 rounded-lg text-xs transition cursor-pointer"
                    >
                      {busyPlan === planMeta.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {planMeta.checkoutAvailable ? 'Subscribe' : 'Contact us'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
