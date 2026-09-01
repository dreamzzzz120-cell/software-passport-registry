/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpDown, ChevronRight, ExternalLink, FileText, HelpCircle, Lock, Plus, Search, X } from 'lucide-react';
import { Vendor } from '../types';
import { apiFetch } from '../utils/apiClient';

interface VendorsViewProps {
  vendors: Vendor[];
  searchQuery: string;
  role?: string;
}

export default function VendorsView({ vendors: initialVendors, searchQuery: globalSearchQuery, role = 'Viewer' }: VendorsViewProps) {
  const [vendors, setVendors] = useState<Vendor[]>(initialVendors);
  const [effectiveRole, setEffectiveRole] = useState(role);
  const [localSearch, setLocalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [reputationFilter, setReputationFilter] = useState('all');
  const [auditStatusFilter, setAuditStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'score' | 'passports'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(initialVendors[0]?.id || null);
  const [isAddingAudit, setIsAddingAudit] = useState(false);
  const [newAuditType, setNewAuditType] = useState('SOC 2 Type II Compliance');
  const [newAuditor, setNewAuditor] = useState('');
  const [newAuditStatus, setNewAuditStatus] = useState<'Passed' | 'Failed' | 'Under Review'>('Passed');
  const [newAuditDetails, setNewAuditDetails] = useState('');
  const [newAuditHash, setNewAuditHash] = useState('');
  const [auditBusy, setAuditBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManageVendors = role === 'Owner' || role === 'Admin';
  const canLodgeAudit = role === 'Owner' || role === 'Admin' || role === 'Technician';
  const canManage = canManageVendors || effectiveRole === 'Owner' || effectiveRole === 'Admin';
  const canLodge = canLodgeAudit || effectiveRole === 'Owner' || effectiveRole === 'Admin' || effectiveRole === 'Technician';

  useEffect(() => {
    setVendors(initialVendors);
    setSelectedVendorId((current) => current && initialVendors.some((vendor) => vendor.id === current) ? current : initialVendors[0]?.id || null);
  }, [initialVendors]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch('/api/user/me').then(async (response) => {
      if (!response.ok || cancelled) return;
      const data = await response.json().catch(() => null);
      if (!cancelled && data?.role) setEffectiveRole(String(data.role));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch('/api/vendors').then(async (response) => {
      if (!response.ok || cancelled) return;
      const data = await response.json().catch(() => []);
      const rows = Array.isArray(data) ? data : data?.vendors;
      if (!cancelled && Array.isArray(rows)) {
        setVendors(rows as Vendor[]);
        setSelectedVendorId((current) => current && rows.some((vendor: Vendor) => String(vendor.id) === current) ? current : rows[0]?.id ? String(rows[0].id) : null);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const selectedVendor = useMemo(() => vendors.find((vendor) => vendor.id === selectedVendorId) ?? vendors[0] ?? null, [vendors, selectedVendorId]);
  const activeSearchQuery = localSearch || globalSearchQuery;

  const filteredVendors = useMemo(() => {
    const query = activeSearchQuery.trim().toLowerCase();
    const result = vendors.filter((vendor) => {
      const auditText = (vendor.auditHistory ?? []).map((audit) => `${audit.auditType} ${audit.auditor} ${audit.details}`).join(' ');
      const text = `${vendor.name} ${vendor.category} ${vendor.locations} ${vendor.website} ${auditText}`.toLowerCase();
      if (query && !text.includes(query)) return false;
      if (statusFilter !== 'all' && vendor.reviewStatus !== statusFilter) return false;
      if (riskFilter !== 'all' && vendor.riskTier !== riskFilter) return false;
      const score = vendor.reputationScore ?? vendor.overallTrustScore;
      if (reputationFilter === 'excellent' && score < 90) return false;
      if (reputationFilter === 'good' && (score < 80 || score >= 90)) return false;
      if (reputationFilter === 'fair' && (score < 70 || score >= 80)) return false;
      if (reputationFilter === 'critical' && score >= 70) return false;
      if (auditStatusFilter !== 'all' && !(vendor.auditHistory ?? []).some((audit) => audit.status === auditStatusFilter)) return false;
      return true;
    });
    result.sort((a, b) => {
      const aValue = sortBy === 'name' ? a.name.toLowerCase() : sortBy === 'score' ? (a.reputationScore ?? a.overallTrustScore) : a.activePassportsCount;
      const bValue = sortBy === 'name' ? b.name.toLowerCase() : sortBy === 'score' ? (b.reputationScore ?? b.overallTrustScore) : b.activePassportsCount;
      const direction = sortOrder === 'asc' ? 1 : -1;
      return aValue < bValue ? -direction : aValue > bValue ? direction : 0;
    });
    return result;
  }, [vendors, activeSearchQuery, statusFilter, riskFilter, reputationFilter, auditStatusFilter, sortBy, sortOrder]);

  const toggleSort = (field: 'name' | 'score' | 'passports') => {
    if (sortBy === field) setSortOrder((value) => value === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortOrder(field === 'name' ? 'asc' : 'desc'); }
  };

  const handleAddAuditAttestation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendor || !canLodge || auditBusy) return;
    setAuditBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/vendors/${encodeURIComponent(selectedVendor.id)}/audits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditType: newAuditType, status: newAuditStatus, details: newAuditDetails, auditor: newAuditor, referenceHash: newAuditHash }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Unable to lodge vendor audit.');
      setVendors((current) => current.map((vendor) => vendor.id === selectedVendor.id ? { ...vendor, ...(body.vendor ?? {}), auditHistory: [body.audit, ...(vendor.auditHistory ?? [])] } : vendor));
      setIsAddingAudit(false);
      setNewAuditor('');
      setNewAuditDetails('');
      setNewAuditHash('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to lodge vendor audit.');
    } finally { setAuditBusy(false); }
  };

  const createVendor = async (payload: { name: string; category: string; website: string; locations: string }) => {
    if (!canManage) return;
    setError(null);
    const response = await apiFetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Unable to create vendor.');
    const vendor = body?.vendor ?? body;
    setVendors((current) => [vendor, ...current]);
    setSelectedVendorId(vendor.id);
    return vendor;
  };

  return (
    <section id="msp-vendors-view-dashboard" className="space-y-4">
      <div><h1 className="text-[22px] font-semibold text-[#201f1e]">Vendor Trust Registry</h1><p className="mt-1 text-[13px] text-[#605e5c]">Trace supply-chain vulnerability vectors, publisher reputation, and server-backed compliance audit records.</p></div>
      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]"><summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary><div className="px-3 pb-3 text-[#605e5c]">Vendor records are tenant-scoped. Audit attestations are persisted in the server-side append-only ledger.</div></details>
      {error && <div role="alert" className="rounded-md border border-[#f5d7ac] bg-[#fff4ce] p-3 text-[13px] text-[#8a5700]">{error}</div>}
      <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3"><div><div className="text-[11px] text-[#605e5c]">Approved Publishers</div><div className="text-lg font-semibold">{vendors.filter((vendor) => vendor.reviewStatus === 'Approved').length} / {vendors.length}</div></div><div><div className="text-[11px] text-[#605e5c]">Avg Reputation Score</div><div className="text-lg font-semibold">{vendors.length ? Math.round(vendors.reduce((sum, vendor) => sum + (vendor.reputationScore ?? vendor.overallTrustScore), 0) / vendors.length) : '—'}</div></div><div><div className="text-[11px] text-[#605e5c]">Under Review</div><div className="text-lg font-semibold text-[#8a5700]">{vendors.filter((vendor) => vendor.reviewStatus === 'Under Review').length}</div></div></div>
      <div className="space-y-3 rounded-md border border-[#e1dfdd] bg-white p-3"><div className="flex flex-col gap-3 md:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8886]" /><input value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} placeholder="Search by vendor name, category, location, or audit type..." className="h-9 w-full rounded border border-[#c8c6c4] pl-9 pr-3 text-[13px]" /></label><button type="button" disabled={!canManage} onClick={() => { if (canManage) void createVendor({ name: `Software Publisher ${Date.now()}`, category: 'Software Publisher', website: '', locations: '' }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to create vendor.')); }} className="h-9 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white disabled:opacity-50">{canManage ? 'Add vendor' : 'Add vendor (Owner/Admin)'}</button></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded border border-[#c8c6c4] px-2 text-[13px]"><option value="all">All statuses</option><option value="Approved">Approved</option><option value="Under Review">Under Review</option><option value="Blocked">Blocked</option></select><select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} className="h-9 rounded border border-[#c8c6c4] px-2 text-[13px]"><option value="all">All risk tiers</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select><select value={reputationFilter} onChange={(event) => setReputationFilter(event.target.value)} className="h-9 rounded border border-[#c8c6c4] px-2 text-[13px]"><option value="all">All scores</option><option value="excellent">Excellent (90+)</option><option value="good">Good (80-89)</option><option value="fair">Fair (70-79)</option><option value="critical">Critical (&lt;70)</option></select><select value={auditStatusFilter} onChange={(event) => setAuditStatusFilter(event.target.value)} className="h-9 rounded border border-[#c8c6c4] px-2 text-[13px]"><option value="all">All audit outcomes</option><option value="Passed">Passed</option><option value="Under Review">Under Review</option><option value="Failed">Failed</option></select></div></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5"><div className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white lg:col-span-3">{filteredVendors.length ? <table className="w-full text-left"><thead><tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]"><th className="px-3 py-2.5 cursor-pointer" onClick={() => toggleSort('name')}>Publisher <ArrowUpDown className="inline h-3 w-3" /></th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 cursor-pointer" onClick={() => toggleSort('passports')}>Passports <ArrowUpDown className="inline h-3 w-3" /></th><th className="px-3 py-2.5 cursor-pointer" onClick={() => toggleSort('score')}>Trust <ArrowUpDown className="inline h-3 w-3" /></th></tr></thead><tbody>{filteredVendors.map((vendor) => <tr key={vendor.id} onClick={() => setSelectedVendorId(vendor.id)} className={`cursor-pointer border-b border-[#f3f2f1] text-[13px] ${selectedVendor?.id === vendor.id ? 'bg-[#eff6fc]' : ''}`}><td className="px-3 py-2.5"><div className="font-medium">{vendor.name}</div><div className="text-[11px] text-[#8a8886]">{vendor.category} · {vendor.locations}</div></td><td className="px-3 py-2.5">{vendor.reviewStatus}</td><td className="px-3 py-2.5">{vendor.activePassportsCount}</td><td className="px-3 py-2.5">{vendor.reputationScore ?? vendor.overallTrustScore}</td></tr>)}</tbody></table> : <div className="p-8 text-center text-[13px] text-[#8a8886]"><AlertCircle className="mx-auto h-7 w-7" /><p className="mt-2">No vendor records loaded for this tenant.</p></div>}</div>
        <div className="space-y-4 lg:col-span-2">{selectedVendor ? <><div className="rounded-md border border-[#e1dfdd] bg-white p-4"><div className="flex items-start justify-between"><div><span className="text-[11px] font-medium text-[#0f6cbd]">Publisher Profile</span><h2 className="mt-1 text-[16px] font-semibold">{selectedVendor.name}</h2><p className="text-[11px] text-[#8a8886]">{selectedVendor.category}</p></div><a href={selectedVendor.website} target="_blank" rel="noopener noreferrer" aria-label="Open vendor website" className="rounded border border-[#c8c6c4] p-1.5"><ExternalLink className="h-3.5 w-3.5" /></a></div></div><div className="rounded-md border border-[#e1dfdd] bg-white p-4"><div className="flex items-center justify-between border-b border-[#f3f2f1] pb-3"><div className="flex items-center gap-1.5"><FileText className="h-4 w-4" /><h3 className="text-[13px] font-semibold">Compliance Audit Ledger</h3></div><button type="button" disabled={!canLodge} onClick={() => setIsAddingAudit((value) => !value)} className="inline-flex h-8 items-center gap-1 rounded bg-[#0f6cbd] px-2.5 text-[13px] font-medium text-white disabled:opacity-50">{isAddingAudit ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {canLodge ? (isAddingAudit ? 'Cancel' : 'Lodge Proof') : 'Lodge Proof (Technician+)'}</button></div>{isAddingAudit && <form onSubmit={handleAddAuditAttestation} className="mt-3 space-y-2 rounded border border-[#e1dfdd] bg-[#faf9f8] p-3"><label className="block text-[11px]">Audit type<select value={newAuditType} onChange={(event) => setNewAuditType(event.target.value)} className="mt-1 h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px]"><option>SOC 2 Type II Compliance</option><option>ISO 27001 Blueprint Verification</option><option>FIPS 140-2 Cryptographic Audit</option><option>Supply Chain Level 4 (SLSA) Verification</option><option>CII Best Practices Badge Assessment</option><option>Static Application Security Scan (SAST)</option></select></label><label className="block text-[11px]">Auditor<input required value={newAuditor} onChange={(event) => setNewAuditor(event.target.value)} className="mt-1 h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px]" /></label><label className="block text-[11px]">Outcome<select value={newAuditStatus} onChange={(event) => setNewAuditStatus(event.target.value as typeof newAuditStatus)} className="mt-1 h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px]"><option value="Passed">Passed</option><option value="Under Review">Under Review</option><option value="Failed">Failed</option></select></label><label className="block text-[11px]">Details<textarea value={newAuditDetails} onChange={(event) => setNewAuditDetails(event.target.value)} rows={2} className="mt-1 w-full rounded border border-[#c8c6c4] px-2 py-1 text-[13px]" /></label><label className="block text-[11px]">Reference hash<input value={newAuditHash} onChange={(event) => setNewAuditHash(event.target.value)} className="mt-1 h-9 w-full rounded border border-[#c8c6c4] px-2 font-mono text-[11px]" /></label><button type="submit" disabled={auditBusy} className="flex h-9 w-full items-center justify-center gap-1 rounded bg-[#0f6cbd] text-[13px] font-medium text-white disabled:opacity-50"><Lock className="h-3.5 w-3.5" /> {auditBusy ? 'Saving…' : 'Lock into Ledger'}</button></form>}<div className="mt-3 space-y-2">{(selectedVendor.auditHistory ?? []).map((audit) => <div key={audit.id} className="rounded border border-[#e1dfdd] p-3"><div className="flex items-center justify-between"><strong className="text-[13px]">{audit.auditType}</strong><span className="text-[11px]">{audit.status}</span></div><p className="mt-1 text-[12px] text-[#605e5c]">{audit.details}</p><p className="mt-1 text-[11px] text-[#8a8886]">{audit.auditor} · {audit.date}</p></div>)}{!(selectedVendor.auditHistory ?? []).length && <div className="p-5 text-center text-[12px] text-[#8a8886]"><HelpCircle className="mx-auto h-6 w-6" />No audit logs listed.</div>}</div></div></> : <div className="rounded-md border border-[#e1dfdd] bg-white p-8 text-center text-[13px] text-[#8a8886]">Select a software vendor.</div>}</div>
      </div>
      <span className="sr-only"><ChevronRight /></span>
    </section>
  );
}
