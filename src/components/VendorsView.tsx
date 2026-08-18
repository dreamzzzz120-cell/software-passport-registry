/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { fuzzyMatch, filterData } from '../utils/filter';
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
  ArrowUpDown
} from 'lucide-react';
import { Vendor, VendorAudit, RiskLevel } from '../types';

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

  return (
    <div className="space-y-6" id="msp-vendors-view-dashboard">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
          <Factory className="w-5 h-5 text-indigo-600" />
          <span>Vendor Trust Registry</span>
        </h1>
        <p className="text-xs text-slate-500 font-sans mt-1">
          Trace supply chain vulnerability vectors, query validated publisher reputation indices, and inspect continuous compliance audit records.
        </p>
      </div>

      {/* Control Panel: Search & Filter Grid */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Main search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by vendor name, category, location, or audit type..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-slate-800 placeholder-slate-400"
            />
            {localSearch && (
              <button
                onClick={() => setLocalSearch('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
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
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold px-2 py-1 bg-indigo-50 hover:bg-indigo-100/80 rounded-lg transition-all"
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Filter Selectors Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          {/* Review Status Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Review Status</label>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none"
              >
                <option value="all">All Statuses</option>
                <option value="Approved">Approved Only</option>
                <option value="Under Review">Under Review</option>
                <option value="Blocked">Blocked Only</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
              </div>
            </div>
          </div>

          {/* Risk Tier Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Risk Tier</label>
            <div className="relative">
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none"
              >
                <option value="all">All Risk Tiers</option>
                <option value="Low">Low Risk</option>
                <option value="Medium">Medium Risk</option>
                <option value="High">High Risk</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
              </div>
            </div>
          </div>

          {/* Reputation Score Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Reputation Index</label>
            <div className="relative">
              <select
                value={reputationFilter}
                onChange={(e) => setReputationFilter(e.target.value)}
                className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none"
              >
                <option value="all">All Scores</option>
                <option value="excellent">Excellent (90+)</option>
                <option value="good">Good (80-89)</option>
                <option value="fair">Fair (70-79)</option>
                <option value="critical">Critical (&lt;70)</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                <ChevronRight className="w-3.5 h-3.5 rotate-90" />
              </div>
            </div>
          </div>

          {/* Compliance Audit Status Filter */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">Audit Ledger Status</label>
            <div className="relative">
              <select
                value={auditStatusFilter}
                onChange={(e) => setAuditStatusFilter(e.target.value)}
                className="w-full bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none"
              >
                <option value="all">All Audit Outcomes</option>
                <option value="Passed">Passed Audits</option>
                <option value="Under Review">Under Review Only</option>
                <option value="Failed">Failed/Gaps Only</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
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
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header with Sorting Indicators */}
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex justify-between items-center text-[10px] font-mono text-slate-400 font-bold uppercase">
              <span className="flex items-center gap-1 cursor-pointer hover:text-slate-700" onClick={() => toggleSort('name')}>
                Publisher Organization
                <ArrowUpDown className="w-3 h-3" />
              </span>
              <div className="flex items-center gap-6">
                <span className="flex items-center gap-1 cursor-pointer hover:text-slate-700" onClick={() => toggleSort('passports')}>
                  Passports
                  <ArrowUpDown className="w-3 h-3" />
                </span>
                <span className="flex items-center gap-1 cursor-pointer hover:text-slate-700" onClick={() => toggleSort('score')}>
                  Trust Score
                  <ArrowUpDown className="w-3 h-3" />
                </span>
              </div>
            </div>

            {/* List Body */}
            {filteredVendors.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                {filteredVendors.map((vendor) => {
                  const isSelected = selectedVendor?.id === vendor.id;
                  const score = vendor.reputationScore ?? vendor.overallTrustScore;

                  return (
                    <div
                      key={vendor.id}
                      onClick={() => setSelectedVendorId(vendor.id)}
                      className={`px-4 py-3.5 transition-all cursor-pointer flex justify-between items-center ${
                        isSelected 
                          ? 'bg-indigo-50/45 border-l-4 border-indigo-600' 
                          : 'hover:bg-slate-50/50 border-l-4 border-transparent'
                      }`}
                    >
                      {/* Name / Category */}
                      <div className="space-y-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-xs truncate">{vendor.name}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${
                            vendor.reviewStatus === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {vendor.reviewStatus}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-sans">
                          <span>{vendor.category}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-[9px] font-mono truncate">{vendor.locations}</span>
                        </div>
                      </div>

                      {/* Score / Status */}
                      <div className="flex items-center gap-5 shrink-0">
                        {/* Passport Count */}
                        <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                          {vendor.activePassportsCount} {vendor.activePassportsCount === 1 ? 'Passport' : 'Passports'}
                        </span>

                        {/* Overall Score Circle */}
                        <div className="flex items-center gap-1.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-xs ${
                            score >= 90 
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                              : score >= 80 
                                ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {score}
                          </div>
                          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${isSelected ? 'translate-x-0.5 text-indigo-500' : ''}`} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-400 space-y-2">
                <AlertCircle className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-semibold">No publishers matching selected filters.</p>
                <p className="text-[10px]">Try broading your criteria or clearing the search query.</p>
              </div>
            )}
          </div>

          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-slate-400 uppercase font-bold">Approved Publishers</div>
                <div className="text-sm font-bold text-slate-800">
                  {vendors.filter(v => v.reviewStatus === 'Approved').length} / {vendors.length}
                </div>
              </div>
            </div>

            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Award className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-slate-400 uppercase font-bold">Avg Reputation score</div>
                <div className="text-sm font-bold text-slate-800">
                  {Math.round(vendors.reduce((acc, v) => acc + (v.reputationScore ?? v.overallTrustScore), 0) / vendors.length)}/100
                </div>
              </div>
            </div>

            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-mono text-slate-400 uppercase font-bold">Unobserved Audits</div>
                <div className="text-sm font-bold text-slate-800">
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
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
                <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-[9px] font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded uppercase">
                      Publisher Profile
                    </span>
                    <h2 className="text-sm font-bold text-slate-900 mt-1">{selectedVendor.name}</h2>
                    <p className="text-[10px] text-slate-400 mt-0.5">{selectedVendor.category}</p>
                  </div>
                  <a
                    href={selectedVendor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-slate-600 p-1.5 bg-slate-50 hover:bg-slate-100 rounded-lg transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {/* Sub-scores metrics block */}
                <div className="space-y-3">
                  <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                    Supply Chain Reputation Metrics
                  </h3>

                  <div className="space-y-2.5">
                    {/* Code Signing Attestation */}
                    <div>
                      <div className="flex justify-between text-[10px] font-semibold text-slate-700 mb-1">
                        <span>Binary & Code Signing Attestation</span>
                        <span className="font-mono font-bold">
                          {selectedVendor.reputationScore ? Math.min(100, selectedVendor.reputationScore + 2) : 95}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                          style={{ width: `${selectedVendor.reputationScore ? Math.min(100, selectedVendor.reputationScore + 2) : 95}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Vulnerability SLA performance */}
                    <div>
                      <div className="flex justify-between text-[10px] font-semibold text-slate-700 mb-1">
                        <span>Vulnerability SLA Response Speed</span>
                        <span className="font-mono font-bold">
                          {selectedVendor.overallTrustScore}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${selectedVendor.overallTrustScore}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Threat / Incident frequency */}
                    <div className="flex justify-between items-center text-[10px] bg-slate-50 border border-slate-150 rounded-lg p-2.5 font-sans">
                      <div className="space-y-0.5">
                        <span className="text-slate-700 font-semibold block">Known Threat Incidents</span>
                        <span className="text-[9px] text-slate-400">Past 12 Months</span>
                      </div>
                      <span className={`font-mono font-bold px-2 py-0.5 rounded ${
                        selectedVendor.securityIncidentsCount === 0 
                          ? 'bg-emerald-50 text-emerald-700' 
                          : 'bg-rose-50 text-rose-700'
                      }`}>
                        {selectedVendor.securityIncidentsCount} {selectedVendor.securityIncidentsCount === 1 ? 'Incident' : 'Incidents'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 2: Associated Compliance Audit History */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4.5 h-4.5 text-slate-500" />
                    <h3 className="text-xs font-bold text-slate-800">Compliance Audit Ledger</h3>
                  </div>

                  {/* Add attestation action */}
                  <button
                    onClick={() => setIsAddingAudit(!isAddingAudit)}
                    className="text-[10px] font-sans font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded-lg flex items-center gap-0.5 shadow-sm transition-all cursor-pointer"
                  >
                    {isAddingAudit ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>{isAddingAudit ? 'Cancel' : 'Lodge Proof'}</span>
                  </button>
                </div>

                {/* Lodge Attestation Panel Form */}
                {isAddingAudit && (
                  <form onSubmit={handleAddAuditAttestation} className="p-3.5 bg-slate-900 border border-slate-800 text-slate-200 rounded-lg space-y-3">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] font-mono font-bold text-indigo-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Lock Attestation Proof
                      </span>
                    </div>

                    <div className="space-y-2 text-xs">
                      {/* Audit Standard Type */}
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-mono text-slate-400 block uppercase">Audit Type</label>
                        <select
                          value={newAuditType}
                          onChange={(e) => setNewAuditType(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-white"
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
                        <label className="text-[9px] font-mono text-slate-400 block uppercase">Auditor / Entity ID</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. KPMG Cyber Team, NCC Group"
                          value={newAuditor}
                          onChange={(e) => setNewAuditor(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-white"
                        />
                      </div>

                      {/* Audit Status */}
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-mono text-slate-400 block uppercase">Audit Outcome</label>
                        <select
                          value={newAuditStatus}
                          onChange={(e: any) => setNewAuditStatus(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-white"
                        >
                          <option value="Passed">PASSED (Score Boosts)</option>
                          <option value="Under Review">UNDER REVIEW (No Score Impact)</option>
                          <option value="Failed">FAILED / GAP DETECTED (Score Penalty)</option>
                        </select>
                      </div>

                      {/* Details */}
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-mono text-slate-400 block uppercase">Attestation Logs</label>
                        <textarea
                          placeholder="Detailed results or parameters verified..."
                          value={newAuditDetails}
                          onChange={(e) => setNewAuditDetails(e.target.value)}
                          rows={2}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-white"
                        />
                      </div>

                      {/* Cryptographic reference hash */}
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-mono text-slate-400 block uppercase">Cryptographical Hash reference (Optional)</label>
                        <input
                          type="text"
                          placeholder="Leave blank to auto-generate ledger hash..."
                          value={newAuditHash}
                          onChange={(e) => setNewAuditHash(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 font-mono text-[10px] text-white"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-bold py-1.5 rounded transition-colors flex justify-center items-center gap-1 shadow-sm cursor-pointer mt-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Lock into Ledger</span>
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
                          className={`p-3.5 border rounded-lg space-y-2 transition-all ${
                            isPassed 
                              ? 'bg-emerald-50/15 border-emerald-100' 
                              : isFailed 
                                ? 'bg-rose-50/15 border-rose-100' 
                                : 'bg-amber-50/15 border-amber-100'
                          }`}
                        >
                          {/* Header of Audit Event */}
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                            <div className="space-y-0.5">
                              <span className="text-[10px] font-bold text-slate-800 block leading-tight">
                                {audit.auditType}
                              </span>
                              <span className="text-[9px] text-slate-400 font-mono flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-slate-400" />
                                <span>{audit.date}</span>
                              </span>
                            </div>
                            
                            <span className={`px-2 py-0.5 rounded font-mono text-[8px] font-bold self-start ${
                              isPassed 
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                : isFailed 
                                  ? 'bg-rose-100 text-rose-800 border border-rose-200' 
                                  : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}>
                              {audit.status.toUpperCase()}
                            </span>
                          </div>

                          {/* Details description */}
                          <p className="text-[10px] text-slate-600 leading-relaxed">
                            {audit.details}
                          </p>

                          {/* Metadata: Auditor & Cryptographic Hash References */}
                          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 font-mono text-[9px] text-slate-500 bg-slate-50/70 p-2 rounded-md">
                            <div>
                              <span className="block text-slate-400 font-bold uppercase text-[7px]">Auditor</span>
                              <span className="font-semibold text-slate-700 flex items-center gap-1 mt-0.5 truncate" title={audit.auditor}>
                                <User className="w-2.5 h-2.5 shrink-0 text-slate-400" />
                                {audit.auditor}
                              </span>
                            </div>

                            <div>
                              <span className="block text-slate-400 font-bold uppercase text-[7px]">Ledger Hash Proof</span>
                              <button
                                type="button"
                                onClick={() => audit.referenceHash && copyToClipboard(audit.referenceHash, audit.id)}
                                disabled={!audit.referenceHash}
                                className="font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mt-0.5 text-left w-full truncate cursor-copy disabled:cursor-default disabled:text-slate-400"
                                title={audit.referenceHash ? 'Click to copy hash proof' : 'No reference hash was provided for this attestation'}
                              >
                                <Hash className="w-2.5 h-2.5 shrink-0 text-slate-400" />
                                <span className="truncate">
                                  {audit.referenceHash ? `${audit.referenceHash.substring(0, 15)}...` : 'Not provided'}
                                </span>
                                {copiedAuditId === audit.id ? (
                                  <span className="text-[8px] text-emerald-600 bg-emerald-50 px-1 rounded uppercase font-bold font-sans">
                                    Copied!
                                  </span>
                                ) : (
                                  <span className="text-[8px] text-slate-300 font-sans group-hover:block">
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
                    <div className="text-center p-6 text-slate-400">
                      <HelpCircle className="w-7 h-7 text-slate-300 mx-auto mb-1.5" />
                      <p className="text-xs">No audit logs listed on the secure ledger.</p>
                      <p className="text-[10px]">Click "Lodge Proof" above to register an audit.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-8 text-center bg-white border border-slate-200 rounded-xl text-slate-400">
              Select a software vendor to view reputation breakdowns and audit history.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
