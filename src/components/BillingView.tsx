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

 return (
 <div className="space-y-6" id="msp-billing-view">
 {/* Page Header */}
 <div className="flex justify-between items-center">
 <div>
 <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#cca700]"><CreditCard className="h-4 w-4" /> Billing</div>
 <h1 className="text-xl font-display font-bold text-[#d4d4d4]">Tenant Billing & Subscriptions</h1>
 <p className="text-xs text-[#9d9d9d] font-sans mt-1">
 Monitor contract licenses, active software passport quotas, and billing invoices across your MSP account.
 </p>
 </div>
 <button
 onClick={loadBilling}
 className="studio-btn bg-[#2d2d2d] hover:bg-[#383838] text-[#d4d4d4] px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
 >
 Refresh Invoices
 </button>
 </div>

 {error && (
 <div role="alert" className="rounded-xl border border-[#cca700]/40 bg-[#cca700]/10 px-4 py-3 text-xs text-[#cca700]">
 {error}
 </div>
 )}

 {loading && billingList.length === 0 ? (
 <div className="flex flex-col items-center justify-center p-20 bg-[#1e1e1e] border border-[#3c3c3c] rounded-xl space-y-2">
 <Loader2 className="w-6 h-6 text-[#3794ff] animate-spin" />
 <p className="text-xs text-[#9d9d9d] font-mono uppercase">Retrieving Financial Records...</p>
 </div>
 ) : (
 <>
 {/* Aggregate Billing Cards */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div className="bg-[#1e1e1e] p-4.5 rounded-xl border border-[#3c3c3c] text-center">
 <p className="text-[9px] text-[#9d9d9d] font-mono font-bold uppercase">Active Deployed Passports</p>
 <h3 className="text-2xl font-bold font-mono text-[#d4d4d4] mt-1">
 {billingList.reduce((acc, b) => acc + b.activePassportsCount, 0)}
 </h3>
 <span className="text-[8px] text-[#9d9d9d] font-mono">Continuous Threat Monitoring</span>
 </div>
 <div className="bg-[#1e1e1e] p-4.5 rounded-xl border border-[#3c3c3c] text-center">
 <p className="text-[9px] text-[#9d9d9d] font-mono font-bold uppercase">Aggregated Pending Amount</p>
 <h3 className="text-2xl font-bold font-mono text-[#3794ff] mt-1">
 ${totalDueAmount}.00
 </h3>
 <span className="text-[8px] text-[#3794ff] font-mono font-bold">Invoicing Cycle: Monthly</span>
 </div>
 <div className="bg-[#1e1e1e] p-4.5 rounded-xl border border-[#3c3c3c] text-center">
 <p className="text-[9px] text-[#9d9d9d] font-mono font-bold uppercase">Mean Cost Per Deployed Passport</p>
 <h3 className="text-2xl font-bold font-mono text-[#89d185] mt-1">
 {(() => { const passports = billingList.reduce((acc, b) => acc + b.activePassportsCount, 0); return passports > 0 ? `$${(totalDueAmount / passports).toFixed(2)}` : '—'; })()}
 </h3>
 <span className="text-[8px] text-[#89d185] font-mono font-bold">Includes automated SBOM attestations</span>
 </div>
 </div>

 {/* Invoicing Log Table */}
 <div className="bg-[#1e1e1e] rounded-xl border border-[#3c3c3c] overflow-hidden">
 <div className="px-5 py-4 border-b border-[#3c3c3c]">
 <h3 className="text-sm font-bold text-[#d4d4d4] font-display">Multi-Tenant Licensing Invoices</h3>
 <p className="text-[10px] text-[#9d9d9d] font-mono mt-0.5">
 Automated invoice breakdowns. Click 'Pay Securely' to verify the Stripe Checkout pipeline.
 </p>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs border-collapse">
 <thead>
 <tr className="bg-[#252526] border-b border-[#3c3c3c] text-[10px] font-mono text-[#9d9d9d] font-bold uppercase">
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
 <tbody className="divide-y divide-[#3c3c3c] font-sans">
 {billingList.map((bill) => (
 <tr key={bill.id} className="hover:bg-[#252526]/50">
 <td className="px-5 py-3.5 font-bold text-[#d4d4d4]">{bill.clientName}</td>
 <td className="px-5 py-3.5 font-bold font-mono text-[#d4d4d4]">
 {bill.activePassportsCount} Passports
 </td>
 <td className="px-5 py-3.5 font-mono text-[#9d9d9d]">${bill.pricePerPassport} / pass</td>
 <td className="px-5 py-3.5 font-mono text-[#9d9d9d]">${bill.extraFees}</td>
 <td className="px-5 py-3.5 text-[#9d9d9d]">{bill.billingCycle}</td>
 <td className="px-5 py-3.5 font-bold font-mono text-[#d4d4d4]">${bill.totalAmount}.00</td>
 <td className="px-5 py-3.5">
 <span
 className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold ${
 bill.status === 'Paid'
 ? 'bg-[#89d185]/15 text-[#89d185]'
 : bill.status === 'Pending'
 ? 'bg-[#cca700]/15 text-[#cca700] animate-pulse'
 : 'bg-[#f14c4c]/15 text-[#f14c4c]'
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
 className={`inline-flex items-center gap-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white font-bold py-1.5 px-3 rounded-lg text-[10px] transition cursor-pointer ${
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
 <span className="text-[10px] text-[#9d9d9d] font-medium font-mono flex items-center justify-end gap-1 select-none">
 <ShieldCheck className="w-3.5 h-3.5 text-[#89d185]" /> Co-signed
 </span>
 )}
 </td>
 </tr>
 ))}
 {billingList.length === 0 && (
 <tr>
 <td colSpan={8} className="px-5 py-10 text-center text-[#9d9d9d]">
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
