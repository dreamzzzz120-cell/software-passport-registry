/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CreditCard, ShieldCheck, Loader2 } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface BillingItem {
  id: string;
  clientName: string;
  activePassportsCount: number;
  pricePerPassport: number;
  extraFees: number;
  billingCycle: string;
  totalAmount: number;
  status: string;
  stripeSessionId?: string | null;
}

export default function BillingView() {
  const [billingList, setBillingList] = useState<BillingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBilling();
  }, []);

  // No /api/billing route exists anywhere in the backend — there is no
  // billing/Stripe integration built yet, not a config problem. Surface
  // that honestly instead of only logging to console.
  const loadBilling = () => {
    setLoading(true);
    setError(null);
    apiFetch('/api/billing')
      .then((res) => {
        if (!res.ok) throw new Error('Billing is not available on this deployment yet.');
        return res.json();
      })
      .then((data) => {
        setBillingList(data);
      })
      .catch((err) => { console.error('[Billing Loader Error]:', err); setError('Billing is not available on this deployment yet.'); setBillingList([]); })
      .finally(() => setLoading(false));
  };

  const handlePayInvoice = async (billingId: string) => {
    setPayingId(billingId);
    try {
      const res = await apiFetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingId }),
      });

      if (!res.ok) {
        throw new Error('Failed to initiate transaction');
      }

      const data = await res.json();
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('Checkout URL not provided');
      }
    } catch (err) {
      console.error('[Stripe Ingress Error]:', err);
      alert('Checkout is not available — there is no billing gateway built into this deployment yet.');
    } finally {
      setPayingId(null);
    }
  };

  const totalDueAmount = billingList.reduce(
    (acc, b) => (b.status !== 'Paid' ? acc + b.totalAmount : acc),
    0
  );
  const totalPassports = billingList.reduce((acc, b) => acc + b.activePassportsCount, 0);

  return (
    <div className="space-y-4" id="msp-billing-view">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e]">Billing &amp; Subscriptions</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">Contract licenses, active software passport quotas, and invoices for this account.</p>
        </div>
        <button
          onClick={loadBilling}
          className="h-8 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]"
        >
          Refresh Invoices
        </button>
      </div>

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">&#9432; What is this? &middot; How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Lists invoices generated for active software passports across your account and lets you settle any that are outstanding.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Review the invoice list below for each client organization.</li>
            <li>Select "Pay Securely" on an unpaid invoice to start Stripe Checkout.</li>
            <li>Paid invoices are marked co-signed once settlement is confirmed.</li>
          </ol>
        </div>
      </details>

      {error && (
        <div role="alert" className="rounded-md border border-[#e1dfdd] bg-[#fff4ce] px-3 py-2.5 text-[12px] text-[#8a5700]">
          {error}
        </div>
      )}

      {loading && billingList.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-[#e1dfdd] bg-white p-12">
          <Loader2 className="w-5 h-5 text-[#0f6cbd] animate-spin" />
          <p className="text-[12px] text-[#605e5c]">Retrieving financial records…</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
            <div>
              <div className="text-[11px] text-[#605e5c]">Active Deployed Passports</div>
              <div className="text-lg font-semibold text-[#201f1e]">{totalPassports}</div>
            </div>
            <div>
              <div className="text-[11px] text-[#605e5c]">Aggregated Pending Amount</div>
              <div className="text-lg font-semibold text-[#201f1e]">${totalDueAmount}.00</div>
            </div>
            <div>
              <div className="text-[11px] text-[#605e5c]">Mean Cost Per Deployed Passport</div>
              <div className="text-lg font-semibold text-[#201f1e]">{totalPassports > 0 ? `$${(totalDueAmount / totalPassports).toFixed(2)}` : '—'}</div>
            </div>
          </div>

          <div className="rounded-md border border-[#e1dfdd] bg-white">
            <div className="border-b border-[#e1dfdd] px-4 py-3">
              <h2 className="text-[14px] font-semibold text-[#201f1e]">Licensing Invoices</h2>
              <p className="mt-0.5 text-[12px] text-[#605e5c]">Automated invoice breakdowns per client organization.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                    <th className="px-4 py-2">Client Organization</th>
                    <th className="px-4 py-2">Active Passports</th>
                    <th className="px-4 py-2">Base Cost Rate</th>
                    <th className="px-4 py-2">Extra Fees</th>
                    <th className="px-4 py-2">Billing Cycle</th>
                    <th className="px-4 py-2">Total</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {billingList.map((bill) => (
                    <tr key={bill.id} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                      <td className="px-4 py-2.5 font-medium text-[#323130]">{bill.clientName}</td>
                      <td className="px-4 py-2.5 text-[#323130]">{bill.activePassportsCount} Passports</td>
                      <td className="px-4 py-2.5 text-[#605e5c]">${bill.pricePerPassport} / pass</td>
                      <td className="px-4 py-2.5 text-[#605e5c]">${bill.extraFees}</td>
                      <td className="px-4 py-2.5 text-[#605e5c]">{bill.billingCycle}</td>
                      <td className="px-4 py-2.5 font-medium text-[#201f1e]">${bill.totalAmount}.00</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[13px]">
                          <span className={`h-1.5 w-1.5 rounded-full ${bill.status === 'Paid' ? 'bg-[#0e700e]' : bill.status === 'Pending' ? 'bg-[#8a5700]' : 'bg-[#a4262c]'}`} />
                          {bill.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {bill.status !== 'Paid' ? (
                          <button
                            onClick={() => handlePayInvoice(bill.id)}
                            disabled={payingId !== null}
                            className={`inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[12px] font-medium text-white hover:bg-[#004578] disabled:opacity-60 ${
                              payingId === bill.id ? 'cursor-wait' : ''
                            }`}
                          >
                            {payingId === bill.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="w-3.5 h-3.5" />
                            )}
                            <span>Pay Securely</span>
                          </button>
                        ) : (
                          <span className="inline-flex items-center justify-end gap-1 text-[12px] text-[#605e5c]">
                            <ShieldCheck className="w-3.5 h-3.5 text-[#0e700e]" /> Co-signed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {billingList.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-[#8a8886]">
                        No active invoices detected for this tenant workspace context.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
