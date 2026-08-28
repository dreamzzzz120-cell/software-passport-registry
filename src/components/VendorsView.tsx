/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { fuzzyMatch, filterData } from '../utils/filter';
import { apiFetch } from '../utils/apiClient';
import {
  Factory,
  ShieldCheck,
  ShieldAlert,
  Shield,
  ExternalLink,
  Filter,
  Search,
  Award,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Calendar,
  User,
  Hash,
  X,
  ChevronRight,
  Plus,
  Activity,
  FileText,
  Check,
  Lock,
  ArrowUpDown,
  Loader2,
} from 'lucide-react';
import { Vendor, VendorAudit, RiskLevel } from '../types';

interface VendorsViewProps {
  vendors: Vendor[];
  searchQuery: string;
  role?: string;
  onVendorsChange?: (vendors: Vendor[]) => void;
}

export default function VendorsView({ vendors: initialVendors, searchQuery: globalSearchQuery, role = 'Viewer', onVendorsChange }: VendorsViewProps) {
  const canManageVendors = role === 'Owner' || role === 'Admin';
  const canLodgeAudit = role === 'Owner' || role === 'Admin' || role === 'Technician';
  // Mirrors the vendors prop (real data from GET /api/vendors, fetched in
  // App.tsx) so this view can optimistically update after a real API call
  // without waiting for a full parent refetch.
  const [vendors, setVendorsState] = useState<Vendor[]>(initialVendors);
  React.useEffect(() => { setVendorsState(initialVendors); }, [initialVendors]);
  const setVendors = (updater: Vendor[] | ((current: Vendor[]) => Vendor[])) => {
    setVendorsState((current) => {
      const next = typeof updater === 'function' ? (updater as (c: Vendor[]) => Vendor[])(current) : updater;
      onVendorsChange?.(next);
      return next;
    });
  };

  const [showAddVendor, setShowAddVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorCategory, setNewVendorCategory] = useState('Software Publisher');
  const [newVendorWebsite, setNewVendorWebsite] = useState('');
  const [newVendorLocations, setNewVendorLocations] = useState('');
  const [addingVendor, setAddingVendor] = useState(false);
  const [addVendorError, setAddVendorError] = useState('');

  const handleAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName.trim() || addingVendor) return;
    setAddingVendor(true); setAddVendorError('');
    try {
      const response = await apiFetch('/api/vendors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newVendorName.trim(), category: newVendorCategory.trim() || 'Software Publisher', website: newVendorWebsite.trim(), locations: newVendorLocations.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error === 'VENDOR_NAME_ALREADY_EXISTS' ? 'A vendor with this name already exists.' : (data?.error?.message || data?.error || 'Unable to add this vendor.'));
      setVendors((current) => [data as Vendor, ...current]);
      setSelectedVendorId(data.id);
      setShowAddVendor(false);
      setNewVendorName(''); setNewVendorCategory('Software Publisher'); setNewVendorWebsite(''); setNewVendorLocations('');
    } catch (error: any) {
      setAddVendorError(error?.message || 'Unable to add this vendor.');
    } finally {
      setAddingVendor(false);
    }
  };

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
  const [lodgingAudit, setLodgingAudit] = useState(false);
  const [lodgeAuditError, setLodgeAuditError] = useState('');

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

  // Lodges a real audit attestation via POST /api/vendors/:id/audits, which
  // persists it to the append-only vendor_audits ledger and recalculates
  // the vendor's reputation/trust/risk tier server-side (the authoritative
  // source now, matching the delta rule this form used to only apply
  // locally: Passed +3, Failed -10, clamped 0-100).
  const handleAddAuditAttestation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendor || lodgingAudit) return;
    setLodgingAudit(true); setLodgeAuditError('');
    try {
      const response = await apiFetch(`/api/vendors/${encodeURIComponent(selectedVendor.id)}/audits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auditType: newAuditType, status: newAuditStatus,
          details: newAuditDetails || 'Manual attestation lodged by system operator through secure MSP console.',
          auditor: newAuditor || 'Authorized MSP Assessor',
          // No fabricated hash: if the operator didn't paste a real reference
          // hash for this attestation, the field stays empty rather than
          // inventing one that would look like a real cryptographic proof.
          referenceHash: newAuditHash.trim(),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message || data?.error || 'Unable to lodge this attestation.');
      const { vendor: updatedVendor, audit } = data as { vendor: Vendor; audit: VendorAudit };
      setVendors((current) => current.map((v) => v.id === selectedVendor.id ? { ...updatedVendor, auditHistory: [audit, ...(v.auditHistory || [])] } : v));
      setIsAddingAudit(false);
      setNewAuditor(''); setNewAuditDetails(''); setNewAuditHash('');
    } catch (error: any) {
      setLodgeAuditError(error?.message || 'Unable to lodge this attestation.');
    } finally {
      setLodgingAudit(false);
    }
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

  return (
    <div className="space-y-6" id="msp-vendors-view-dashboard">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#c586c0]"><Factory className="h-4 w-4" /> Supply chain trust</div>
          <h1 className="mt-1 text-xl font-display font-bold text-[#d4d4d4] flex items-center gap-2">
            <Factory className="w-5 h-5 text-[#3794ff]" />
            <span>Vendor Trust Registry</span>
          </h1>
          <p className="text-xs text-[#9d9d9d] font-sans mt-1">
            Trace supply chain vulnerability vectors, query validated publisher reputation indices, and inspect continuous compliance audit records.
          </p>
        </div>
        {canManageVendors && (
          <button onClick={() => setShowAddVendor(true)} className="spr-btn spr-btn-primary inline-flex items-center justify-center gap-2 shrink-0">
            <Plus className="h-4 w-4" /> Add vendor
          </button>
        )}
      </div>

      {showAddVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="add-vendor-title">
          <div className="w-full max-w-md rounded-md border border-[#3c3c3c] bg-[#252526] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="add-vendor-title" className="text-lg font-bold text-[#d4d4d4]">Add vendor</h2>
              <button onClick={() => setShowAddVendor(false)} aria-label="Close" className="rounded-md p-1.5 text-[#9d9d9d] hover:bg-[#383838] hover:text-[#d4d4d4]"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleAddVendor} className="mt-5 space-y-3.5">
              {addVendorError && <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2.5 text-xs text-[#f14c4c] flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {addVendorError}</div>}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#9d9d9d]">Vendor name *</label>
                <input required value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="e.g. Acme Cloud Backup" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#9d9d9d]">Category</label>
                <input value={newVendorCategory} onChange={(e) => setNewVendorCategory(e.target.value)} placeholder="Software Publisher" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#9d9d9d]">Website</label>
                <input value={newVendorWebsite} onChange={(e) => setNewVendorWebsite(e.target.value)} placeholder="https://example.com" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#9d9d9d]">Location(s)</label>
                <input value={newVendorLocations} onChange={(e) => setNewVendorLocations(e.target.value)} placeholder="e.g. United States" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddVendor(false)} className="rounded-md border border-[#3c3c3c] px-3.5 py-2 text-xs font-semibold text-[#9d9d9d] hover:bg-[#383838]">Cancel</button>
                <button type="submit" disabled={addingVendor || !newVendorName.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[#0e639c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1177bb] disabled:opacity-40">
                  {addingVendor ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {addingVendor ? 'Adding…' : 'Add vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Control Panel: Search & Filter Grid */}
      <div className="spr-panel p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Main search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#9d9d9d]" />
            <input
              type="text"
              placeholder="Search by vendor name, category, location, or audit type..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="w-full bg-[#2d2d2d] hover:bg-[#252526] border border-[#3c3c3c] rounded-md pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-[#3794ff] focus:bg-white transition-all text-[#d4d4d4] placeholder-[#6f6f6f]"
            />
            {localSearch && (
              <button
                onClick={() => setLocalSearch('')}
                className="absolute right-3 top-2.5 text-[#9d9d9d] hover:text-[#6f6f6f] text-xs"
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
              className="text-xs text-[#3794ff] hover:text-[#5fa8ff] font-semibold px-2 py-1 bg-[#094771] hover:bg-[#0e639c]/30 rounded-md transition-all"
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Filter Selectors Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          {/* Review Status Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-[#9d9d9d] uppercase tracking-wider block">Review Status</label>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-white border border-[#3c3c3c] hover:border-[#525252] rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-[#6f6f6f] focus:outline-none focus:border-[#3794ff] cursor-pointer appearance-none"
              >
                <option value="all">All Statuses</option>
                <option value="Approved">Approved Only</option>
                <option value="Under Review">Under Review</option>
                <option value="Blocked">Blocked Only</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[#9d9d9d]">
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
              </div>
            </div>
          </div>

          {/* Risk Tier Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-[#9d9d9d] uppercase tracking-wider block">Risk Tier</label>
            <div className="relative">
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                className="w-full bg-white border border-[#3c3c3c] hover:border-[#525252] rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-[#6f6f6f] focus:outline-none focus:border-[#3794ff] cursor-pointer appearance-none"
              >
                <option value="all">All Risk Tiers</option>
                <option value="Low">Low Risk</option>
                <option value="Medium">Medium Risk</option>
                <option value="High">High Risk</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[#9d9d9d]">
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
              </div>
            </div>
          </div>

          {/* Reputation Score Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-[#9d9d9d] uppercase tracking-wider block">Reputation Index</label>
            <div className="relative">
              <select
                value={reputationFilter}
                onChange={(e) => setReputationFilter(e.target.value)}
                className="w-full bg-white border border-[#3c3c3c] hover:border-[#525252] rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-[#6f6f6f] focus:outline-none focus:border-[#3794ff] cursor-pointer appearance-none"
              >
                <option value="all">All Scores</option>
                <option value="excellent">Excellent (90+)</option>
                <option value="good">Good (80-89)</option>
                <option value="fair">Fair (70-79)</option>
                <option value="critical">Critical (&lt;70)</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[#9d9d9d]">
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
              </div>
            </div>
          </div>

          {/* Compliance Audit Status Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-[#9d9d9d] uppercase tracking-wider block">Audit Ledger Status</label>
            <div className="relative">
              <select
                value={auditStatusFilter}
                onChange={(e) => setAuditStatusFilter(e.target.value)}
                className="w-full bg-white border border-[#3c3c3c] hover:border-[#525252] rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-[#6f6f6f] focus:outline-none focus:border-[#3794ff] cursor-pointer appearance-none"
              >
                <option value="all">All Audit Outcomes</option>
                <option value="Passed">Passed Audits</option>
                <option value="Under Review">Under Review Only</option>
                <option value="Failed">Failed/Gaps Only</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[#9d9d9d]">
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Two-Column Exploration Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* LEFT COLUMN: Vendor Directory List */}
        <div className="lg:col-span-3 space-y-4">
          <div className="spr-panel overflow-hidden">
            {/* Header with Sorting Indicators */}
            <div className="bg-[#252526] border-b border-[#3c3c3c] px-4 py-2.5 flex justify-between items-center text-[10px] font-mono text-[#9d9d9d] font-bold uppercase">
              <span className="flex items-center gap-1 cursor-pointer hover:text-[#6f6f6f]" onClick={() => toggleSort('name')}>
                Publisher Organization
                <ArrowUpDown className="w-3 h-3" />
              </span>
              <div className="flex items-center gap-6">
                <span className="flex items-center gap-1 cursor-pointer hover:text-[#6f6f6f]" onClick={() => toggleSort('passports')}>
                  Passports
                  <ArrowUpDown className="w-3 h-3" />
                </span>
                <span className="flex items-center gap-1 cursor-pointer hover:text-[#6f6f6f]" onClick={() => toggleSort('score')}>
                  Trust Score
                  <ArrowUpDown className="w-3 h-3" />
                </span>
              </div>
            </div>

            {/* List Body */}
            {filteredVendors.length > 0 ? (
              <div className="divide-y divide-[#3c3c3c] max-h-[500px] overflow-y-auto">
                {filteredVendors.map((vendor) => {
                  const isSelected = selectedVendor?.id === vendor.id;
                  const score = vendor.reputationScore ?? vendor.overallTrustScore;

                  return (
                    <div
                      key={vendor.id}
                      onClick={() => setSelectedVendorId(vendor.id)}
                      className={`px-4 py-3.5 transition-all cursor-pointer flex justify-between items-center ${
                        isSelected 
                          ? 'bg-[#094771]/45 border-l-4 border-[#0e639c]'
                          : 'hover:bg-[#2d2d2d] border-l-4 border-transparent'
                      }`}
                    >
                      {/* Name / Category */}
                      <div className="space-y-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#d4d4d4] text-xs truncate">{vendor.name}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${
                            vendor.reviewStatus === 'Approved' ? 'bg-[#89d185]/15 text-[#89d185]' : 'bg-[#cca700]/15 text-[#cca700]'
                          }`}>
                            {vendor.reviewStatus}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-[#9d9d9d] font-sans">
                          <span>{vendor.category}</span>
                          <span className="text-[#6f6f6f]">•</span>
                          <span className="text-[9px] font-mono truncate">{vendor.locations}</span>
                        </div>
                      </div>

                      {/* Score / Status */}
                      <div className="flex items-center gap-5 shrink-0">
                        {/* Passport Count */}
                        <span className="text-xs font-mono font-bold text-[#6f6f6f] bg-[#2d2d2d] px-2 py-0.5 rounded-md border border-[#3c3c3c]">
                          {vendor.activePassportsCount} {vendor.activePassportsCount === 1 ? 'Passport' : 'Passports'}
                        </span>

                        {/* Overall Score Circle */}
                        <div className="flex items-center gap-1.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-xs ${
                            score >= 90 
                              ? 'bg-[#89d185]/10 text-[#89d185] border border-[#89d185]/30'
                              : score >= 80 
                                ? 'bg-[#cca700]/10 text-[#cca700] border border-[#cca700]/30'
                                : 'bg-[#f14c4c]/10 text-[#f14c4c] border border-[#f14c4c]/30'
                          }`}>
                            {score}
                          </div>
                          <ChevronRight className={`w-4 h-4 text-[#9d9d9d] transition-transform ${isSelected ? 'translate-x-0.5 text-[#3794ff]' : ''}`} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-[#9d9d9d] space-y-2">
                <AlertCircle className="w-8 h-8 text-[#6f6f6f] mx-auto" />
                {vendors.length === 0 ? (
                  <>
                    <p className="text-xs font-semibold">No vendors recorded for this tenant yet.</p>
                    <p className="text-[10px]">{canManageVendors ? 'Add your first supply-chain vendor to start tracking reputation and audit evidence.' : 'Ask an Owner or Admin to add a vendor.'}</p>
                    {canManageVendors && (
                      <button onClick={() => setShowAddVendor(true)} className="spr-btn spr-btn-primary mt-2 inline-flex items-center gap-2">
                        <Plus className="h-4 w-4" /> Add vendor
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold">No publishers matching selected filters.</p>
                    <p className="text-[10px]">Try broading your criteria or clearing the search query.</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="spr-panel p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-[#89d185]/10 text-[#89d185] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-[#9d9d9d] uppercase font-bold">Approved Publishers</div>
                <div className="text-sm font-bold text-[#d4d4d4]">
                  {vendors.filter(v => v.reviewStatus === 'Approved').length} / {vendors.length}
                </div>
              </div>
            </div>

            <div className="spr-panel p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-[#094771] text-[#3794ff] flex items-center justify-center">
                <Award className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-[#9d9d9d] uppercase font-bold">Avg Reputation score</div>
                <div className="text-sm font-bold text-[#d4d4d4]">
                  {vendors.length === 0 ? '—' : `${Math.round(vendors.reduce((acc, v) => acc + (v.reputationScore ?? v.overallTrustScore), 0) / vendors.length)}/100`}
                </div>
              </div>
            </div>

            <div className="spr-panel p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-[#cca700]/10 text-[#cca700] flex items-center justify-center">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-[#9d9d9d] uppercase font-bold">Unobserved Audits</div>
                <div className="text-sm font-bold text-[#d4d4d4]">
                  {vendors.filter(v => v.reviewStatus === 'Under Review').length} Under Review
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Selected Vendor Audit & Reputation Drilldown */}
        <div className="lg:col-span-2 space-y-4">
          {selectedVendor ? (
            <div className="space-y-4">
              
              {/* Card 1: Vendor Trust Profile */}
              <div className="spr-panel p-5 space-y-4">
                <div className="flex justify-between items-start border-b border-[#3c3c3c] pb-3">
                  <div>
                    <span className="text-[9px] font-mono font-bold bg-[#094771] text-[#3794ff] px-2 py-0.5 rounded uppercase">
                      Publisher Profile
                    </span>
                    <h2 className="text-sm font-bold text-[#d4d4d4] mt-1">{selectedVendor.name}</h2>
                    <p className="text-[10px] text-[#9d9d9d] mt-0.5">{selectedVendor.category}</p>
                  </div>
                  <a
                    href={selectedVendor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#9d9d9d] hover:text-[#6f6f6f] p-1.5 bg-[#252526] hover:bg-[#2d2d2d] rounded-md transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {/* Sub-scores metrics block */}
                <div className="space-y-3">
                  <h3 className="text-[10px] font-mono font-bold text-[#9d9d9d] uppercase tracking-wider">
                    Supply Chain Reputation Metrics
                  </h3>

                  <div className="space-y-2.5">
                    {/* Code Signing Attestation -- there is no code-signing evidence source
                        wired to vendors yet. This used to synthesize a percentage from
                        reputationScore (+2, or a hardcoded 95 fallback), which fabricated a
                        metric that was never actually observed. Show the true state instead. */}
                    <div>
                      <div className="flex justify-between text-[10px] font-semibold text-[#6f6f6f] mb-1">
                        <span>Binary & Code Signing Attestation</span>
                        <span className="font-mono font-bold text-[#9d9d9d]">Not available</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#2d2d2d] rounded-full overflow-hidden" title="No code-signing attestation evidence source is connected for this vendor." />
                    </div>

                    {/* Vulnerability SLA performance -- previously re-displayed
                        overallTrustScore under an unrelated label; there is no real
                        SLA-response-time data source for vendors. */}
                    <div>
                      <div className="flex justify-between text-[10px] font-semibold text-[#6f6f6f] mb-1">
                        <span>Vulnerability SLA Response Speed</span>
                        <span className="font-mono font-bold text-[#9d9d9d]">Not available</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#2d2d2d] rounded-full overflow-hidden" title="No SLA response-time evidence source is connected for this vendor." />
                    </div>

                    {/* Threat / Incident frequency */}
                    <div className="flex justify-between items-center text-[10px] bg-[#252526] border border-[#3c3c3c] rounded-md p-2.5 font-sans">
                      <div className="space-y-0.5">
                        <span className="text-[#6f6f6f] font-semibold block">Known Threat Incidents</span>
                        <span className="text-[9px] text-[#9d9d9d]">Past 12 Months</span>
                      </div>
                      <span className={`font-mono font-bold px-2 py-0.5 rounded ${
                        selectedVendor.securityIncidentsCount === 0 
                          ? 'bg-[#89d185]/10 text-[#89d185]'
                          : 'bg-[#f14c4c]/10 text-[#f14c4c]'
                      }`}>
                        {selectedVendor.securityIncidentsCount} {selectedVendor.securityIncidentsCount === 1 ? 'Incident' : 'Incidents'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Associated Compliance Audit History */}
              <div className="spr-panel p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-[#3c3c3c] pb-3">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4.5 h-4.5 text-[#9d9d9d]" />
                    <h3 className="text-xs font-bold text-[#d4d4d4]">Compliance Audit Ledger</h3>
                  </div>

                  {/* Add attestation action */}
                  {canLodgeAudit && (
                    <button
                      onClick={() => { setIsAddingAudit(!isAddingAudit); setLodgeAuditError(''); }}
                      className="text-[10px] font-sans font-bold bg-[#0e639c] hover:bg-[#1177bb] text-white px-2 py-1 rounded-md flex items-center gap-0.5 transition-all cursor-pointer"
                    >
                      {isAddingAudit ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      <span>{isAddingAudit ? 'Cancel' : 'Lodge Proof'}</span>
                    </button>
                  )}
                </div>

                {/* Lodge Attestation Panel Form */}
                {isAddingAudit && canLodgeAudit && (
                  <form onSubmit={handleAddAuditAttestation} className="p-3.5 spr-panel-alt text-[#d4d4d4] space-y-3">
                    {lodgeAuditError && <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2.5 text-xs text-[#f14c4c] flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {lodgeAuditError}</div>}
                    <div className="flex justify-between items-center border-b border-[#3c3c3c] pb-1.5">
                      <span className="text-[10px] font-mono font-bold text-[#3794ff] flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Lock Attestation Proof
                      </span>
                    </div>

                    <div className="space-y-2 text-xs">
                      {/* Audit Standard Type */}
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-mono text-[#9d9d9d] block uppercase">Audit Type</label>
                        <select
                          value={newAuditType}
                          onChange={(e) => setNewAuditType(e.target.value)}
                          className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2.5 py-1 text-xs text-white"
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
                        <label className="text-[9px] font-mono text-[#9d9d9d] block uppercase">Auditor / Entity ID</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. KPMG Cyber Team, NCC Group"
                          value={newAuditor}
                          onChange={(e) => setNewAuditor(e.target.value)}
                          className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2.5 py-1 text-xs text-white"
                        />
                      </div>

                      {/* Audit Status */}
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-mono text-[#9d9d9d] block uppercase">Audit Outcome</label>
                        <select
                          value={newAuditStatus}
                          onChange={(e: any) => setNewAuditStatus(e.target.value)}
                          className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2.5 py-1 text-xs text-white"
                        >
                          <option value="Passed">PASSED (Score Boosts)</option>
                          <option value="Under Review">UNDER REVIEW (No Score Impact)</option>
                          <option value="Failed">FAILED / GAP DETECTED (Score Penalty)</option>
                        </select>
                      </div>

                      {/* Details */}
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-mono text-[#9d9d9d] block uppercase">Attestation Logs</label>
                        <textarea
                          placeholder="Detailed results or parameters verified..."
                          value={newAuditDetails}
                          onChange={(e) => setNewAuditDetails(e.target.value)}
                          rows={2}
                          className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2.5 py-1 text-xs text-white"
                        />
                      </div>

                      {/* Cryptographic reference hash */}
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-mono text-[#9d9d9d] block uppercase">Cryptographical Hash reference (Optional)</label>
                        <input
                          type="text"
                          placeholder="Leave blank to auto-generate ledger hash..."
                          value={newAuditHash}
                          onChange={(e) => setNewAuditHash(e.target.value)}
                          className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2.5 py-1 font-mono text-[10px] text-white"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={lodgingAudit}
                        className="w-full bg-[#0e639c] hover:bg-[#1177bb] text-white font-sans font-bold py-1.5 rounded transition-colors flex justify-center items-center gap-1 cursor-pointer mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {lodgingAudit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        <span>{lodgingAudit ? 'Locking…' : 'Lock into Ledger'}</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Audit History Timeline Ledger */}
                <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
                  {selectedVendor.auditHistory && selectedVendor.auditHistory.length > 0 ? (
                    selectedVendor.auditHistory.map((audit) => {
                      const isPassed = audit.status === 'Passed';
                      const isFailed = audit.status === 'Failed';

                      return (
                        <div
                          key={audit.id}
                          className={`p-3.5 border rounded-md space-y-2 transition-all ${
                            isPassed 
                              ? 'bg-[#89d185]/10 border-[#89d185]/25'
                              : isFailed 
                                ? 'bg-[#f14c4c]/10 border-[#f14c4c]/25'
                                : 'bg-[#cca700]/10 border-[#cca700]/25'
                          }`}
                        >
                          {/* Header of Audit Event */}
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                            <div className="space-y-0.5">
                              <span className="text-[10px] font-bold text-[#d4d4d4] block leading-tight">
                                {audit.auditType}
                              </span>
                              <span className="text-[9px] text-[#9d9d9d] font-mono flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-[#9d9d9d]" />
                                <span>{audit.date}</span>
                              </span>
                            </div>
                            
                            <span className={`px-2 py-0.5 rounded font-mono text-[8px] font-bold self-start ${
                              isPassed 
                                ? 'bg-[#89d185]/15 text-[#89d185] border border-emerald-200'
                                : isFailed 
                                  ? 'bg-[#f14c4c]/15 text-[#f14c4c] border border-[#f14c4c]/30'
                                  : 'bg-[#cca700]/15 text-[#cca700] border border-amber-200'
                            }`}>
                              {audit.status.toUpperCase()}
                            </span>
                          </div>

                          {/* Details description */}
                          <p className="text-[10px] text-[#6f6f6f] leading-relaxed">
                            {audit.details}
                          </p>

                          {/* Metadata: Auditor & Cryptographic Hash References */}
                          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#3c3c3c] font-mono text-[9px] text-[#9d9d9d] bg-[#2d2d2d] p-2 rounded-md">
                            <div>
                              <span className="block text-[#9d9d9d] font-bold uppercase text-[7px]">Auditor</span>
                              <span className="font-semibold text-[#6f6f6f] flex items-center gap-1 mt-0.5 truncate" title={audit.auditor}>
                                <User className="w-2.5 h-2.5 shrink-0 text-[#9d9d9d]" />
                                {audit.auditor}
                              </span>
                            </div>

                            <div>
                              <span className="block text-[#9d9d9d] font-bold uppercase text-[7px]">Ledger Hash Proof</span>
                              <button
                                type="button"
                                onClick={() => audit.referenceHash && copyToClipboard(audit.referenceHash, audit.id)}
                                disabled={!audit.referenceHash}
                                className="font-semibold text-[#3794ff] hover:text-[#5fa8ff] flex items-center gap-1 mt-0.5 text-left w-full truncate cursor-copy disabled:cursor-default disabled:text-[#9d9d9d]"
                                title={audit.referenceHash ? 'Click to copy hash proof' : 'No reference hash was provided for this attestation'}
                              >
                                <Hash className="w-2.5 h-2.5 shrink-0 text-[#9d9d9d]" />
                                <span className="truncate">
                                  {audit.referenceHash ? `${audit.referenceHash.substring(0, 15)}...` : 'Not provided'}
                                </span>
                                {copiedAuditId === audit.id ? (
                                  <span className="text-[8px] text-[#89d185] bg-[#89d185]/10 px-1 rounded uppercase font-bold font-sans">
                                    Copied!
                                  </span>
                                ) : (
                                  <span className="text-[8px] text-[#6f6f6f] font-sans group-hover:block">
                                    Copy
                                  </span>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center p-6 text-[#9d9d9d]">
                      <HelpCircle className="w-7 h-7 text-[#6f6f6f] mx-auto mb-1.5" />
                      <p className="text-xs">No audit logs listed on the secure ledger.</p>
                      <p className="text-[10px]">Click "Lodge Proof" above to register an audit.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-8 text-center spr-panel text-[#9d9d9d]">
              Select a software vendor to view reputation breakdowns and audit history.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
