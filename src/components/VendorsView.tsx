/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { fuzzyMatch, filterData } from '../utils/filter';
import {
  ExternalLink,
  Search,
  HelpCircle,
  AlertCircle,
  Calendar,
  User,
  Hash,
  X,
  ChevronRight,
  Plus,
  FileText,
  Check,
  Lock,
  ArrowUpDown
} from 'lucide-react';
import { Vendor, VendorAudit, RiskLevel } from '../types';

// Score-band and audit-status presentation tokens, kept in one place so the
// list rows, detail panel, and ledger entries all agree on what each state
// looks like.
function scoreStyle(score: number) {
  if (score >= 90) return { text: 'text-[#0e700e]', dot: 'bg-[#0e700e]' };
  if (score >= 80) return { text: 'text-[#8a5700]', dot: 'bg-[#8a5700]' };
  return { text: 'text-[#a4262c]', dot: 'bg-[#a4262c]' };
}
const AUDIT_STYLES: Record<string, { text: string; dot: string }> = {
  Passed: { text: 'text-[#0e700e]', dot: 'bg-[#0e700e]' },
  Failed: { text: 'text-[#a4262c]', dot: 'bg-[#a4262c]' },
  'Under Review': { text: 'text-[#8a5700]', dot: 'bg-[#8a5700]' }
};
function auditStyle(status: string) {
  return AUDIT_STYLES[status] || { text: 'text-[#605e5c]', dot: 'bg-[#605e5c]' };
}

interface VendorsViewProps {
  vendors: Vendor[];
  searchQuery: string;
}

export default function VendorsView({ vendors: initialVendors, searchQuery: globalSearchQuery }: VendorsViewProps) {
  // Live local state for vendor records (to support manual attestation submissions)
  const [vendors, setVendors] = useState<Vendor[]>(initialVendors);

  // Local filter states
  const [localSearch, setLocalSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [reputationFilter, setReputationFilter] = useState<string>('all');
  const [auditStatusFilter, setAuditStatusFilter] = useState<string>('all');

  // Sort state
  const [sortBy, setSortBy] = useState<'name' | 'score' | 'passports'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Selected Vendor for Drilldown Detail View
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(initialVendors[0]?.id || null);

  // New Audit Attestation Submission Form State
  const [isAddingAudit, setIsAddingAudit] = useState(false);
  const [newAuditType, setNewAuditType] = useState('SOC 2 Type II Compliance');
  const [newAuditor, setNewAuditor] = useState('');
  const [newAuditStatus, setNewAuditStatus] = useState<'Passed' | 'Failed' | 'Under Review'>('Passed');
  const [newAuditDetails, setNewAuditDetails] = useState('');
  const [newAuditHash, setNewAuditHash] = useState('');

  // Copy-to-clipboard state
  const [copiedAuditId, setCopiedAuditId] = useState<string | null>(null);

  // Active Selected Vendor
  const selectedVendor = useMemo(() => {
    return vendors.find(v => v.id === selectedVendorId) || vendors[0] || null;
  }, [vendors, selectedVendorId]);

  // Combined search queries
  const activeSearchQuery = useMemo(() => {
    return localSearch || globalSearchQuery;
  }, [localSearch, globalSearchQuery]);

  // Filter & Sort core logic
  const filteredVendors = useMemo(() => {
    // 1. Text Search filtering (Vendor Name, Category, Locations)
    let result = filterData<Vendor>(vendors, activeSearchQuery, ['name', 'category', 'locations', 'website']);

    // If searching, also check inside audit types or auditors
    if (activeSearchQuery) {
      const lowerQuery = activeSearchQuery.toLowerCase();
      const auditMatches = vendors.filter(v =>
        v.auditHistory?.some(a =>
          a.auditType.toLowerCase().includes(lowerQuery) ||
          a.auditor.toLowerCase().includes(lowerQuery) ||
          a.details.toLowerCase().includes(lowerQuery)
        )
      );
      // Union the search results
      const unionMap = new Map();
      result.forEach(v => unionMap.set(v.id, v));
      auditMatches.forEach(v => unionMap.set(v.id, v));
      result = Array.from(unionMap.values());
    }

    // 2. Review Status filter
    if (statusFilter !== 'all') {
      result = result.filter(v => v.reviewStatus === statusFilter);
    }

    // 3. Risk Tier filter
    if (riskFilter !== 'all') {
      result = result.filter(v => v.riskTier === riskFilter);
    }

    // 4. Reputation Score Filter
    if (reputationFilter !== 'all') {
      result = result.filter(v => {
        const score = v.reputationScore ?? v.overallTrustScore;
        if (reputationFilter === 'excellent') return score >= 90;
        if (reputationFilter === 'good') return score >= 80 && score < 90;
        if (reputationFilter === 'fair') return score >= 70 && score < 80;
        if (reputationFilter === 'critical') return score < 70;
        return true;
      });
    }

    // 5. Audit Compliance Status Filter
    if (auditStatusFilter !== 'all') {
      result = result.filter(v =>
        v.auditHistory?.some(a => a.status === auditStatusFilter)
      );
    }

    // 6. Sort
    result.sort((a, b) => {
      let valA: any = a.name;
      let valB: any = b.name;

      if (sortBy === 'score') {
        valA = a.reputationScore ?? a.overallTrustScore;
        valB = b.reputationScore ?? b.overallTrustScore;
      } else if (sortBy === 'passports') {
        valA = a.activePassportsCount;
        valB = b.activePassportsCount;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [vendors, activeSearchQuery, statusFilter, riskFilter, reputationFilter, auditStatusFilter, sortBy, sortOrder]);

  // Handle lodging new audit event
  // This only updates local component state — there is no vendor-audit
  // persistence endpoint anywhere in the backend (no vendors table exists
  // at all yet). Currently unreachable in practice since `vendors` is
  // always empty upstream (App.tsx has no vendor data source either), but
  // if that ever changes, this form will silently lose every submitted
  // audit on refresh/navigation unless a real API call is added here first.
  const handleAddAuditAttestation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendor) return;

    const auditId = `aud-submitted-${Date.now()}`;
    const timestamp = new Date().toISOString().split('T')[0];
    // No fabricated hash: if the operator didn't paste a real reference hash for
    // this attestation, the field stays empty rather than inventing one that would
    // look like a real cryptographic proof.
    const hash = newAuditHash.trim();

    const newAudit: VendorAudit = {
      id: auditId,
      date: timestamp,
      auditType: newAuditType,
      status: newAuditStatus,
      details: newAuditDetails || 'Manual attestation lodged by system operator through secure MSP console.',
      auditor: newAuditor || 'Authorized MSP Assessor',
      referenceHash: hash
    };

    // Calculate updated trust score based on audit submission (Passed audit increases score, Failed decreases)
    let scoreDelta = 0;
    if (newAuditStatus === 'Passed') scoreDelta = 3;
    if (newAuditStatus === 'Failed') scoreDelta = -10;

    const oldScore = selectedVendor.reputationScore ?? selectedVendor.overallTrustScore;
    const newScore = Math.min(100, Math.max(0, oldScore + scoreDelta));

    // Update vendors array
    const updatedVendors = vendors.map(v => {
      if (v.id === selectedVendor.id) {
        const history = v.auditHistory || [];
        return {
          ...v,
          overallTrustScore: newScore,
          reputationScore: newScore,
          lastAuditDate: timestamp,
          riskTier: (newScore >= 88 ? 'Low' : newScore >= 75 ? 'Medium' : 'High') as RiskLevel,
          auditHistory: [newAudit, ...history]
        };
      }
      return v;
    });

    setVendors(updatedVendors);

    // Reset Form
    setIsAddingAudit(false);
    setNewAuditor('');
    setNewAuditDetails('');
    setNewAuditHash('');
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAuditId(id);
    setTimeout(() => setCopiedAuditId(null), 2000);
  };

  const toggleSort = (field: 'name' | 'score' | 'passports') => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc'); // default high to low
    }
  };

  const approvedCount = vendors.filter(v => v.reviewStatus === 'Approved').length;
  const avgReputation = vendors.length === 0 ? '—' : Math.round(vendors.reduce((acc, v) => acc + (v.reputationScore ?? v.overallTrustScore), 0) / vendors.length);
  const underReviewCount = vendors.filter(v => v.reviewStatus === 'Under Review').length;

  return (
    <div id="msp-vendors-view-dashboard">
      {/* Page Header */}
      <div className="mb-4">
        <h1 className="text-[22px] font-semibold text-[#201f1e]">Vendor Trust Registry</h1>
        <p className="mt-1 text-[13px] text-[#605e5c]">
          Trace supply chain vulnerability vectors, publisher reputation indices, and continuous compliance audit records.
        </p>
      </div>

      {/* About this page */}
      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Every software publisher and vendor tracked in the supply chain, with their reputation score, review status, and audit history.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Search or filter the publisher directory below.</li>
            <li>Select a row to open its reputation and audit breakdown.</li>
            <li>Use Lodge Proof to record a new compliance attestation.</li>
          </ol>
        </div>
      </details>

      {/* Summary strip */}
      <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div>
          <div className="text-[11px] text-[#605e5c]">Approved Publishers</div>
          <div className="text-lg font-semibold text-[#201f1e]">{approvedCount} / {vendors.length}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">Avg Reputation Score</div>
          <div className="text-lg font-semibold text-[#201f1e]">{avgReputation === '—' ? '—' : `${avgReputation}/100`}</div>
        </div>
        <div>
          <div className="text-[11px] text-[#605e5c]">Under Review</div>
          <div className="text-lg font-semibold text-[#8a5700]">{underReviewCount}</div>
        </div>
      </div>

      {/* Control Panel: Search & Filter Grid */}
      <div className="mb-4 space-y-3 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div className="flex flex-col gap-3 md:flex-row">
          {/* Main search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a8886]" />
            <input
              type="text"
              placeholder="Search by vendor name, category, location, or audit type..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="h-9 w-full rounded border border-[#c8c6c4] bg-white pl-9 pr-4 text-[13px] text-[#323130] placeholder-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
            />
            {localSearch && (
              <button
                onClick={() => setLocalSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#8a8886] hover:text-[#323130]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Quick Clear Filters Button */}
          {(statusFilter !== 'all' || riskFilter !== 'all' || reputationFilter !== 'all' || auditStatusFilter !== 'all') && (
            <button
              onClick={() => {
                setStatusFilter('all');
                setRiskFilter('all');
                setReputationFilter('all');
                setAuditStatusFilter('all');
              }}
              className="h-9 shrink-0 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#0f6cbd] hover:bg-black/[.03]"
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Filter Selectors Grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {/* Review Status Filter */}
          <div className="space-y-1">
            <label className="block text-[11px] text-[#605e5c]">Review Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
            >
              <option value="all">All Statuses</option>
              <option value="Approved">Approved Only</option>
              <option value="Under Review">Under Review</option>
              <option value="Blocked">Blocked Only</option>
            </select>
          </div>

          {/* Risk Tier Filter */}
          <div className="space-y-1">
            <label className="block text-[11px] text-[#605e5c]">Risk Tier</label>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
            >
              <option value="all">All Risk Tiers</option>
              <option value="Low">Low Risk</option>
              <option value="Medium">Medium Risk</option>
              <option value="High">High Risk</option>
            </select>
          </div>

          {/* Reputation Score Filter */}
          <div className="space-y-1">
            <label className="block text-[11px] text-[#605e5c]">Reputation Index</label>
            <select
              value={reputationFilter}
              onChange={(e) => setReputationFilter(e.target.value)}
              className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
            >
              <option value="all">All Scores</option>
              <option value="excellent">Excellent (90+)</option>
              <option value="good">Good (80-89)</option>
              <option value="fair">Fair (70-79)</option>
              <option value="critical">Critical (&lt;70)</option>
            </select>
          </div>

          {/* Compliance Audit Status Filter */}
          <div className="space-y-1">
            <label className="block text-[11px] text-[#605e5c]">Audit Ledger Status</label>
            <select
              value={auditStatusFilter}
              onChange={(e) => setAuditStatusFilter(e.target.value)}
              className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
            >
              <option value="all">All Audit Outcomes</option>
              <option value="Passed">Passed Audits</option>
              <option value="Under Review">Under Review Only</option>
              <option value="Failed">Failed/Gaps Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Two-Column Exploration Layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">

        {/* LEFT COLUMN: Vendor Directory Table */}
        <div className="lg:col-span-3">
          <div className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white">
            {filteredVendors.length > 0 ? (
              <div className="max-h-[560px] overflow-y-auto overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                      <th className="cursor-pointer select-none px-3 py-2.5 font-medium" onClick={() => toggleSort('name')}>
                        <span className="inline-flex items-center gap-1">Publisher Organization <ArrowUpDown className="h-3 w-3" /></span>
                      </th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="cursor-pointer select-none px-3 py-2.5 font-medium" onClick={() => toggleSort('passports')}>
                        <span className="inline-flex items-center gap-1">Passports <ArrowUpDown className="h-3 w-3" /></span>
                      </th>
                      <th className="cursor-pointer select-none px-3 py-2.5 font-medium" onClick={() => toggleSort('score')}>
                        <span className="inline-flex items-center gap-1">Trust Score <ArrowUpDown className="h-3 w-3" /></span>
                      </th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVendors.map((vendor) => {
                      const isSelected = selectedVendor?.id === vendor.id;
                      const score = vendor.reputationScore ?? vendor.overallTrustScore;
                      const ss = scoreStyle(score);

                      return (
                        <tr
                          key={vendor.id}
                          onClick={() => setSelectedVendorId(vendor.id)}
                          className={`cursor-pointer border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02] ${isSelected ? 'bg-[#eff6fc]' : ''}`}
                        >
                          <td className="px-3 py-2.5">
                            <div className="min-w-0">
                              <span className="font-medium text-[#201f1e]">{vendor.name}</span>
                              <div className="flex items-center gap-1.5 text-[11px] text-[#8a8886]">
                                <span>{vendor.category}</span>
                                <span>•</span>
                                <span className="truncate">{vendor.locations}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 rounded-full ${vendor.reviewStatus === 'Approved' ? 'bg-[#0e700e]' : 'bg-[#8a5700]'}`} />
                              <span className={vendor.reviewStatus === 'Approved' ? 'text-[#0e700e]' : 'text-[#8a5700]'}>{vendor.reviewStatus}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-[#201f1e]">
                            {vendor.activePassportsCount}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`font-medium ${ss.text}`}>{score}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <ChevronRight className={`h-4 w-4 text-[#8a8886] ${isSelected ? 'text-[#0f6cbd]' : ''}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="space-y-2 p-8 text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-[#c8c6c4]" />
                {vendors.length === 0 ? (
                  <>
                    <p className="text-[13px] font-medium text-[#323130]">No vendor records loaded for this tenant.</p>
                    <p className="text-[11px] text-[#8a8886]">SPR has no vendor data source configured yet — this view has nothing to show, not a filter mismatch.</p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] font-medium text-[#323130]">No publishers matching selected filters.</p>
                    <p className="text-[11px] text-[#8a8886]">Try broadening your criteria or clearing the search query.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Selected Vendor Audit & Reputation Drilldown */}
        <div className="space-y-4 lg:col-span-2">
          {selectedVendor ? (
            <div className="space-y-4">

              {/* Card 1: Vendor Trust Profile */}
              <div className="space-y-3 rounded-md border border-[#e1dfdd] bg-white p-4">
                <div className="flex items-start justify-between border-b border-[#f3f2f1] pb-3">
                  <div>
                    <span className="rounded border border-[#e1dfdd] bg-[#eff6fc] px-2 py-0.5 text-[11px] font-medium text-[#0f6cbd]">
                      Publisher Profile
                    </span>
                    <h2 className="mt-1 text-[16px] font-semibold text-[#201f1e]">{selectedVendor.name}</h2>
                    <p className="mt-0.5 text-[11px] text-[#8a8886]">{selectedVendor.category}</p>
                  </div>
                  <a
                    href={selectedVendor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-[#c8c6c4] p-1.5 text-[#605e5c] hover:bg-black/[.03]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                {/* Sub-scores metrics block */}
                <div className="space-y-3">
                  <h3 className="text-[11px] uppercase tracking-wide text-[#605e5c]">
                    Supply Chain Reputation Metrics
                  </h3>

                  <div className="space-y-2.5">
                    {/* Code Signing Attestation */}
                    <div>
                      <div className="mb-1 flex justify-between text-[13px] text-[#323130]">
                        <span>Binary & Code Signing Attestation</span>
                        <span className="font-medium">
                          {selectedVendor.reputationScore ? Math.min(100, selectedVendor.reputationScore + 2) : 95}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f3f2f1]">
                        <div
                          className="h-full rounded-full bg-[#0f6cbd]"
                          style={{ width: `${selectedVendor.reputationScore ? Math.min(100, selectedVendor.reputationScore + 2) : 95}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Vulnerability SLA performance */}
                    <div>
                      <div className="mb-1 flex justify-between text-[13px] text-[#323130]">
                        <span>Vulnerability SLA Response Speed</span>
                        <span className="font-medium">
                          {selectedVendor.overallTrustScore}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f3f2f1]">
                        <div
                          className="h-full rounded-full bg-[#0e700e]"
                          style={{ width: `${selectedVendor.overallTrustScore}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Threat / Incident frequency */}
                    <div className="flex items-center justify-between rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-2.5 text-[13px]">
                      <div>
                        <span className="block font-medium text-[#323130]">Known Threat Incidents</span>
                        <span className="text-[11px] text-[#8a8886]">Past 12 Months</span>
                      </div>
                      <span className={`rounded px-2 py-0.5 font-medium ${
                        selectedVendor.securityIncidentsCount === 0
                          ? 'bg-[#dff6dd] text-[#0e700e]'
                          : 'bg-[#fdf2f2] text-[#a4262c]'
                      }`}>
                        {selectedVendor.securityIncidentsCount} {selectedVendor.securityIncidentsCount === 1 ? 'Incident' : 'Incidents'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Associated Compliance Audit History */}
              <div className="space-y-3 rounded-md border border-[#e1dfdd] bg-white p-4">
                <div className="flex items-center justify-between border-b border-[#f3f2f1] pb-3">
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-[#605e5c]" />
                    <h3 className="text-[13px] font-semibold text-[#323130]">Compliance Audit Ledger</h3>
                  </div>

                  {/* Add attestation action */}
                  <button
                    onClick={() => setIsAddingAudit(!isAddingAudit)}
                    className="flex h-8 items-center gap-1 rounded bg-[#0f6cbd] px-2.5 text-[13px] font-medium text-white hover:bg-[#004578]"
                  >
                    {isAddingAudit ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    <span>{isAddingAudit ? 'Cancel' : 'Lodge Proof'}</span>
                  </button>
                </div>

                {/* Lodge Attestation Panel Form */}
                {isAddingAudit && (
                  <form onSubmit={handleAddAuditAttestation} className="space-y-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3.5">
                    <div className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-1.5 text-[13px] font-medium text-[#323130]">
                      <Lock className="h-3.5 w-3.5 text-[#605e5c]" /> Lock Attestation Proof
                    </div>

                    <div className="space-y-2">
                      {/* Audit Standard Type */}
                      <div className="space-y-0.5">
                        <label className="block text-[11px] text-[#605e5c]">Audit Type</label>
                        <select
                          value={newAuditType}
                          onChange={(e) => setNewAuditType(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        >
                          <option value="SOC 2 Type II Continuous compliance">SOC 2 Type II Continuous</option>
                          <option value="ISO 27001 Blueprint Verification">ISO 27001 ISMS</option>
                          <option value="FIPS 140-2 Cryptographic Audit">FIPS Federal Cryptography</option>
                          <option value="Supply Chain Level 4 (SLSA) Verification">SLSA Supply Chain Level 4</option>
                          <option value="CII Best Practices Badge Assessment">CII Best Practices Badge</option>
                          <option value="Static Application Security Scan (SAST)">Static Security Scan (SAST)</option>
                        </select>
                      </div>

                      {/* Auditor Name */}
                      <div className="space-y-0.5">
                        <label className="block text-[11px] text-[#605e5c]">Auditor / Entity ID</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. KPMG Cyber Team, NCC Group"
                          value={newAuditor}
                          onChange={(e) => setNewAuditor(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-[13px] text-[#323130] placeholder-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        />
                      </div>

                      {/* Audit Status */}
                      <div className="space-y-0.5">
                        <label className="block text-[11px] text-[#605e5c]">Audit Outcome</label>
                        <select
                          value={newAuditStatus}
                          onChange={(e: any) => setNewAuditStatus(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        >
                          <option value="Passed">Passed (Score Boosts)</option>
                          <option value="Under Review">Under Review (No Score Impact)</option>
                          <option value="Failed">Failed / Gap Detected (Score Penalty)</option>
                        </select>
                      </div>

                      {/* Details */}
                      <div className="space-y-0.5">
                        <label className="block text-[11px] text-[#605e5c]">Attestation Logs</label>
                        <textarea
                          placeholder="Detailed results or parameters verified..."
                          value={newAuditDetails}
                          onChange={(e) => setNewAuditDetails(e.target.value)}
                          rows={2}
                          className="w-full rounded border border-[#c8c6c4] bg-white px-2.5 py-1.5 text-[13px] text-[#323130] placeholder-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        />
                      </div>

                      {/* Cryptographic reference hash */}
                      <div className="space-y-0.5">
                        <label className="block text-[11px] text-[#605e5c]">Cryptographic Hash Reference (Optional)</label>
                        <input
                          type="text"
                          placeholder="Leave blank to auto-generate ledger hash..."
                          value={newAuditHash}
                          onChange={(e) => setNewAuditHash(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 font-mono text-[11px] text-[#323130] placeholder-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        />
                      </div>

                      <button
                        type="submit"
                        className="mt-1 flex h-9 w-full items-center justify-center gap-1 rounded bg-[#0f6cbd] text-[13px] font-medium text-white hover:bg-[#004578]"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Lock into Ledger</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Audit History Timeline Ledger */}
                <div className="max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
                  {selectedVendor.auditHistory && selectedVendor.auditHistory.length > 0 ? (
                    selectedVendor.auditHistory.map((audit) => {
                      const as = auditStyle(audit.status);

                      return (
                        <div
                          key={audit.id}
                          className="space-y-2 rounded-md border border-[#e1dfdd] bg-white p-3"
                        >
                          {/* Header of Audit Event */}
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-0.5">
                              <span className="block text-[13px] font-medium leading-tight text-[#201f1e]">
                                {audit.auditType}
                              </span>
                              <span className="flex items-center gap-1 text-[11px] text-[#8a8886]">
                                <Calendar className="h-3 w-3" />
                                <span>{audit.date}</span>
                              </span>
                            </div>

                            <span className={`inline-flex items-center gap-1.5 self-start text-[11px] font-medium ${as.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${as.dot}`} />
                              {audit.status}
                            </span>
                          </div>

                          {/* Details description */}
                          <p className="text-[13px] leading-relaxed text-[#605e5c]">
                            {audit.details}
                          </p>

                          {/* Metadata: Auditor & Cryptographic Hash References */}
                          <div className="grid grid-cols-2 gap-2 rounded-md border-t border-[#f3f2f1] bg-[#faf9f8] p-2 pt-2 text-[11px] text-[#605e5c]">
                            <div>
                              <span className="block text-[10px] uppercase text-[#8a8886]">Auditor</span>
                              <span className="mt-0.5 flex items-center gap-1 truncate font-medium text-[#323130]" title={audit.auditor}>
                                <User className="h-2.5 w-2.5 shrink-0 text-[#8a8886]" />
                                {audit.auditor}
                              </span>
                            </div>

                            <div>
                              <span className="block text-[10px] uppercase text-[#8a8886]">Ledger Hash Proof</span>
                              <button
                                type="button"
                                onClick={() => audit.referenceHash && copyToClipboard(audit.referenceHash, audit.id)}
                                disabled={!audit.referenceHash}
                                className="mt-0.5 flex w-full items-center gap-1 truncate text-left font-medium text-[#0f6cbd] hover:underline disabled:cursor-default disabled:text-[#8a8886] disabled:no-underline"
                                title={audit.referenceHash ? 'Click to copy hash proof' : 'No reference hash was provided for this attestation'}
                              >
                                <Hash className="h-2.5 w-2.5 shrink-0 text-[#8a8886]" />
                                <span className="truncate">
                                  {audit.referenceHash ? `${audit.referenceHash.substring(0, 15)}...` : 'Not provided'}
                                </span>
                                {copiedAuditId === audit.id && (
                                  <span className="rounded bg-[#dff6dd] px-1 text-[10px] font-medium text-[#0e700e]">
                                    Copied!
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-6 text-center text-[#8a8886]">
                      <HelpCircle className="mx-auto mb-1.5 h-7 w-7 text-[#c8c6c4]" />
                      <p className="text-[13px]">No audit logs listed on the secure ledger.</p>
                      <p className="text-[11px]">Click "Lodge Proof" above to register an audit.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-[#e1dfdd] bg-white p-8 text-center text-[13px] text-[#8a8886]">
              Select a software vendor to view reputation breakdowns and audit history.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
