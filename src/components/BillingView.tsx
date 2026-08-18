/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CreditCard, ShieldCheck, DollarSign, ExternalLink, Calendar, HelpCircle, Loader2 } from 'lucide-react';
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

  useEffect(() => {
    loadBilling();
  }, []);

  const loadBilling = () => {
    setLoading(true);
    apiFetch('/api/billing')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to pull billing invoices');
        return res.json();
      })
      .then((data) => {
        setBillingList(data);
      })
      .catch((err) => console.error('[Billing Loader Error]:', err))
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
      alert('Checkout is unavailable. Configure the billing gateway first.');
    } finally {
      setPayingId(null);
    }
  };

  const totalDueAmount = billingList.reduce(
    (acc, b) => (b.status !== 'Paid' ? acc + b.totalAmount : acc),
    0
  );

  return (
    <div className="space-y-6" id="msp-billing-view">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-zinc-50">Tenant Billing & Subscriptions</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
            Monitor contract licenses, active software passport quotas, and billing invoices across your MSP account.
          </p>
        </div>
        <button
          onClick={loadBilling}
          className="studio-btn bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
        >
          Refresh Invoices
        </button>
      </div>

      {loading && billingList.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-20 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl space-y-2">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          <p className="text-xs text-slate-400 font-mono uppercase">Retrieving Financial Records...</p>
        </div>
      ) : (
        <>
          {/* Aggregate Billing Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-xl border border-slate-200 dark:border-zinc-800/80 shadow-sm text-center">
              <p className="text-[9px] text-slate-400 font-mono font-bold uppercase">Active Deployed Passports</p>
              <h3 className="text-2xl font-bold font-mono text-slate-800 dark:text-zinc-100 mt-1">
                {billingList.reduce((acc, b) => acc + b.activePassportsCount, 0)}
              </h3>
              <span className="text-[8px] text-slate-400 font-mono">Continuous Threat Monitoring</span>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-xl border border-slate-200 dark:border-zinc-800/80 shadow-sm text-center">
              <p className="text-[9px] text-slate-400 font-mono font-bold uppercase">Aggregated Pending Amount</p>
              <h3 className="text-2xl font-bold font-mono text-indigo-600 dark:text-indigo-400 mt-1">
                ${totalDueAmount}.00
              </h3>
              <span className="text-[8px] text-indigo-500 font-mono font-bold">Invoicing Cycle: Monthly</span>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-4.5 rounded-xl border border-slate-200 dark:border-zinc-800/80 shadow-sm text-center">
              <p className="text-[9px] text-slate-400 font-mono font-bold uppercase">Mean Cost Per Deployed Passport</p>
              <h3 className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">$45.00</h3>
              <span className="text-[8px] text-emerald-600 font-mono font-bold">Includes automated SBOM attestations</span>
            </div>
          </div>

          {/* Invoicing Log Table */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800/80 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800/80">
              <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 font-display">Multi-Tenant Licensing Invoices</h3>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                Automated invoice breakdowns. Click 'Pay Securely' to verify the Stripe Checkout pipeline.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-zinc-800/30 border-b border-slate-200 dark:border-zinc-800 text-[10px] font-mono text-slate-400 font-bold uppercase">
                    <th className="px-5 py-3">Client Organization</th>
                    <th className="px-5 py-3">Active Software Passports</th>
                    <th className="px-5 py-3">Base Cost Rate</th>
                    <th className="px-5 py-3">Extra Compliance Fees</th>
                    <th className="px-5 py-3">Billing Cycle</th>
                    <th className="px-5 py-3">Aggregate Total</th>
                    <th className="px-5 py-3">Invoice Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/60 font-sans">
                  {billingList.map((bill) => (
                    <tr key={bill.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/10">
                      <td className="px-5 py-3.5 font-bold text-slate-700 dark:text-zinc-200">{bill.clientName}</td>
                      <td className="px-5 py-3.5 font-bold font-mono text-slate-700 dark:text-zinc-300">
                        {bill.activePassportsCount} Passports
                      </td>
                      <td className="px-5 py-3.5 font-mono text-slate-500 dark:text-zinc-400">${bill.pricePerPassport} / pass</td>
                      <td className="px-5 py-3.5 font-mono text-slate-500 dark:text-zinc-400">${bill.extraFees}</td>
                      <td className="px-5 py-3.5 text-slate-500 dark:text-zinc-400">{bill.billingCycle}</td>
                      <td className="px-5 py-3.5 font-bold font-mono text-slate-800 dark:text-zinc-100">${bill.totalAmount}.00</td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold ${
                            bill.status === 'Paid'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                              : bill.status === 'Pending'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 animate-pulse'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400'
                          }`}
                        >
                          {bill.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {bill.status !== 'Paid' ? (
                          <button
                            onClick={() => handlePayInvoice(bill.id)}
                            disabled={payingId !== null}
                            className={`inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg text-[10px] transition cursor-pointer ${
                              payingId === bill.id ? 'opacity-80 cursor-wait' : ''
                            }`}
                          >
                            {payingId === bill.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CreditCard className="w-3 h-3" />
                            )}
                            <span>Pay Securely</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-medium font-mono flex items-center justify-end gap-1 select-none">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Co-signed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {billingList.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-slate-400">
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
