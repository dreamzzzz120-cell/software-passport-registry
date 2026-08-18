/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Settings, Shield, Sliders, KeyRound, Bell, HelpCircle, CheckCircle,
  Sun, Moon, RefreshCw, Trash2, Fingerprint, Lock, FileText, Globe, FileCode,
  BookOpen, Search, Sparkles, PlusCircle, AlertTriangle, Play, ChevronRight, Check,
  ExternalLink, Layers, Info, Filter, ShieldAlert, BadgeAlert, CheckCircle2, AlertCircle
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { apiFetch } from '../utils/apiClient';

interface SettingsViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function SettingsView({ theme, onToggleTheme }: SettingsViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'configurations' | 'bible' | 'organization'>('configurations');
  const [mfaEnabled, setMfaEnabled] = useState(true);
  const [slaTarget, setSlaTarget] = useState(85);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [offboarding, setOffboarding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<any[]>([]);

  // Profile & Org/Team States
  const [profile, setProfile] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Technician');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileJobTitle, setProfileJobTitle] = useState('');
  const [profileCompany, setProfileCompany] = useState('');
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamSuccess, setTeamSuccess] = useState<string | null>(null);

  const fetchProfileAndTeam = async () => {
    setLoadingTeam(true);
    try {
      // 1. Fetch user profile
      const profRes = await apiFetch('/api/user/me');
      if (profRes.ok) {
        const profData = await profRes.json();
        setProfile(profData);
        setProfileName(profData.displayName || '');
        setProfileJobTitle(profData.roleTitle || '');
        setProfileCompany(profData.companyName || '');
      }

      // 2. Fetch team members
      const teamRes = await apiFetch('/api/organization/team');
      if (teamRes.ok) {
        const teamData = await teamRes.json();
        setTeamMembers(teamData);
      }
    } catch (err) {
      console.error('Error fetching profile or organization team:', err);
    } finally {
      setLoadingTeam(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setTeamError(null);
    setTeamSuccess(null);
    try {
      const res = await apiFetch('/api/organization/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole })
      });
      if (res.ok) {
        setTeamSuccess(`Successfully sent security invitation to ${inviteEmail}`);
        setInviteEmail('');
        fetchProfileAndTeam();
      } else {
        const errData = await res.json();
        setTeamError(errData.message || 'Failed to send workspace invitation.');
      }
    } catch (err) {
      setTeamError('Network error while dispatching invitation.');
    }
  };

  const handleUpdateMemberRole = async (userId: string, newRole: string) => {
    setTeamError(null);
    setTeamSuccess(null);
    try {
      const res = await apiFetch(`/api/organization/team/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      if (res.ok) {
        setTeamSuccess('Workspace member role updated successfully.');
        fetchProfileAndTeam();
      } else {
        const errData = await res.json();
        setTeamError(errData.message || 'Permission denied.');
      }
    } catch (err) {
      setTeamError('Failed to synchronize updated permission rules.');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    const confirmed = window.confirm('Are you sure you want to revoke this user\'s workspace security credentials?');
    if (!confirmed) return;
    setTeamError(null);
    setTeamSuccess(null);
    try {
      const res = await apiFetch(`/api/organization/team/${userId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setTeamSuccess('Revoked workspace access and terminated session keys.');
        fetchProfileAndTeam();
      } else {
        const errData = await res.json();
        setTeamError(errData.message || 'Rejection from database.');
      }
    } catch (err) {
      setTeamError('Failed to remove member.');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeamError(null);
    setTeamSuccess(null);
    try {
      const res = await apiFetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profileName,
          roleTitle: profileJobTitle,
          companyName: profileCompany
        })
      });
      if (res.ok) {
        setTeamSuccess('User profile details updated successfully.');
        setEditingProfile(false);
        fetchProfileAndTeam();
      } else {
        const errData = await res.json();
        setTeamError(errData.message || 'Failed to save details.');
      }
    } catch (err) {
      setTeamError('Failed to save profile changes.');
    }
  };

  // Product Bible list
  const [bibleProducts, setBibleProducts] = useState<any[]>([
    {
      id: 'pb-nginx',
      name: 'Nginx Web Server',
      type: 'Web Infrastructure / Proxy',
      baselineSecureVersion: '1.24.0',
      allowedLicenses: ['BSD-2-Clause', 'MIT', 'Apache-2.0'],
      disallowedLicenses: ['GPL-3.0-only', 'AGPL-3.0-only'],
      riskTier: 'Low',
      complianceTarget: 'SOC 2 CC6.1 / NIST SP 800-53',
      safeguardPolicy: 'Enforce TLS 1.3 only, disable cleartext HTTP ports, and prune default Server header metadata.'
    },
    {
      id: 'pb-postgres',
      name: 'PostgreSQL Relational Engine',
      type: 'Database Systems',
      baselineSecureVersion: '15.4',
      allowedLicenses: ['PostgreSQL', 'MIT', 'Apache-2.0'],
      disallowedLicenses: ['AGPL-3.0-only', 'GPL-3.0-only'],
      riskTier: 'Low',
      complianceTarget: 'NIST SP 800-171 / HIPAA Sec. 164',
      safeguardPolicy: 'Enable row-level security (RLS), mandate pgcrypto encryption for columns, and bind exclusively to localized subnets.'
    },
    {
      id: 'pb-redis',
      name: 'Redis In-Memory Key-Value Cache',
      type: 'Cache Systems',
      baselineSecureVersion: '7.0.12',
      allowedLicenses: ['BSD-3-Clause', 'MIT'],
      disallowedLicenses: ['SSPL-1.0', 'AGPL-3.0-only'],
      riskTier: 'Medium',
      complianceTarget: 'PCI-DSS v4.0 Req 2 & 3',
      safeguardPolicy: 'Disable custom dangerous admin commands (CONFIG, FLUSHALL), set authentication passwords, and restrict container loopbacks.'
    },
    {
      id: 'pb-log4j',
      name: 'Apache Log4j Core Logging',
      type: 'Open Source Logging Framework',
      baselineSecureVersion: '2.17.1',
      allowedLicenses: ['Apache-2.0'],
      disallowedLicenses: ['GPL-3.0-only', 'AGPL-3.0-only'],
      riskTier: 'High',
      complianceTarget: 'CISA KEV Mitigation Directive',
      safeguardPolicy: 'Ensure strict lookup disabling (formatMsgNoLookups=true) and remove JMSAppender class files from all builds to neutralize JNDI execution risks.'
    },
    {
      id: 'pb-docker',
      name: 'Docker Container base environment',
      type: 'Container Foundations',
      baselineSecureVersion: '24.0.5',
      allowedLicenses: ['Apache-2.0', 'MIT'],
      disallowedLicenses: ['GPL-3.0-only', 'AGPL-3.0-only'],
      riskTier: 'Low',
      complianceTarget: 'CIS Docker Benchmarks v1.6',
      safeguardPolicy: 'Run containers with non-root privileges, specify readonly root filesystems, and strip all unneeded kernel capabilities (SYS_ADMIN).'
    }
  ]);

  // Search/Filter state for Product Bible
  const [bibleSearchQuery, setBibleSearchQuery] = useState('');
  const [bibleFilterRisk, setBibleFilterRisk] = useState('all');
  const [selectedBibleProductId, setSelectedBibleProductId] = useState<string>('pb-nginx');

  // New Bible Product form fields
  const [showAddBibleProduct, setShowAddBibleProduct] = useState(false);
  const [newBpName, setNewBpName] = useState('');
  const [newBpType, setNewBpType] = useState('Web Infrastructure / Proxy');
  const [newBpVersion, setNewBpVersion] = useState('');
  const [newBpAllowedLics, setNewBpAllowedLics] = useState('MIT, Apache-2.0, BSD-3-Clause');
  const [newBpDisallowedLics, setNewBpDisallowedLics] = useState('GPL-3.0-only, AGPL-3.0-only');
  const [newBpRisk, setNewBpRisk] = useState<'Low' | 'Medium' | 'High'>('Low');
  const [newBpCompliance, setNewBpCompliance] = useState('');
  const [newBpSafeguard, setNewBpSafeguard] = useState('');

  // Sandbox Auditor states
  const [sandboxProduct, setSandboxProduct] = useState('Nginx Web Server');
  const [sandboxCustomName, setSandboxCustomName] = useState('');
  const [sandboxVersion, setSandboxVersion] = useState('1.25.1');
  const [sandboxLicense, setSandboxLicense] = useState('MIT');
  const [sandboxEnv, setSandboxEnv] = useState('Production');
  const [sandboxReport, setSandboxReport] = useState<any | null>(null);

  // Multi-tenant Active Sessions, SSO and Cryptographic audit state
  const [sessions, setSessions] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [auditChain, setAuditChain] = useState<any[]>([]);
  const [loadingLedgers, setLoadingLedgers] = useState(false);
  const [verifyingLedger, setVerifyingLedger] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any | null>(null);

  // SAML SSO Form settings
  const [ssoEnabled, setSsoEnabled] = useState(true);
  const [ssoProvider, setSsoProvider] = useState('Okta Enterprise IdP');
  const [ssoMetadataUrl, setSsoMetadataUrl] = useState('https://idp.okta.com/app/exk810/sso/saml/metadata');
  const [ssoClientId, setSsoClientId] = useState('spr_msp_okta_prod_01');

  const handleVerifyLedger = async () => {
    setVerifyingLedger(true);
    setVerificationResult(null);
    try {
      const res = await apiFetch('/api/auth/audit-chain/verify');
      if (res.ok) {
        const data = await res.json();
        setVerificationResult(data);
      } else {
        setVerificationResult({
          isValid: false,
          error: 'Verification request returned a server exception.'
        });
      }
    } catch (err: any) {
      setVerificationResult({
        isValid: false,
        error: err?.message || 'Network connection timeout.'
      });
    } finally {
      setVerifyingLedger(false);
    }
  };

  const fetchAuthDataLedgers = async () => {
    setLoadingLedgers(true);
    try {
      const sessRes = await apiFetch('/api/auth/sessions');
      if (sessRes.ok) {
        const data = await sessRes.json();
        setSessions(data);
      }
      
      const histRes = await apiFetch('/api/auth/login-history');
      if (histRes.ok) {
        const data = await histRes.json();
        setHistory(data);
      }

      const chainRes = await apiFetch('/api/auth/audit-chain');
      if (chainRes.ok) {
        const data = await chainRes.json();
        setAuditChain(data);
      }
    } catch (err) {
      console.error('Error fetching identity and compliance data ledgers:', err);
    } finally {
      setLoadingLedgers(false);
    }
  };

  useEffect(() => {
    fetchAuthDataLedgers();
    fetchProfileAndTeam();
  }, []);

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await apiFetch('/api/auth/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      if (res.ok) {
        fetchAuthDataLedgers();
      } else {
        alert('Could not complete session revocation.');
      }
    } catch (err) {
      console.error('Error during session revocation:', err);
    }
  };

  const runDiagnosticSuite = async () => {
    setTesting(true);
    try {
      const res = await apiFetch('/api/tests/run');
      if (res.ok) {
        const data = await res.json();
        setTestResults(data.results || []);
      } else {
        alert('Could not run diagnostics.');
      }
    } catch (err) {
      console.error('Error running integration tests:', err);
    } finally {
      setTesting(false);
    }
  };

  const handleOffboardTenant = async () => {
    const confirmed = window.confirm(
      "CRITICAL SECURITY ALERT: Are you absolutely certain you want to offboard this tenant? This will cascade-delete all databases, software passports, compliance statuses, and credentials instantly from our PostgreSQL storage nodes. This action cannot be undone."
    );
    if (!confirmed) return;

    setOffboarding(true);
    try {
      const res = await apiFetch('/api/tenant/offboard', {
        method: 'POST',
      });
      if (res.ok) {
        alert("Offboarding complete. Your tenant profile and isolated workspaces have been purged from storage nodes.");
        localStorage.removeItem('msp_user');
        await auth.signOut().catch(() => {});
        window.location.reload();
      } else {
        const errorData = await res.json();
        alert(`Offboarding failed: ${errorData.error || 'Server error'}`);
      }
    } catch (err) {
      console.error('Failed to trigger tenant data offboarding:', err);
      alert('Network error while completing data purge.');
    } finally {
      setOffboarding(false);
    }
  };

  const handleSaveSettings = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const activeBibleProduct = useMemo(() => {
    return bibleProducts.find(p => p.id === selectedBibleProductId) || bibleProducts[0];
  }, [bibleProducts, selectedBibleProductId]);

  const filteredBibleProducts = useMemo(() => {
    return bibleProducts.filter(bp => {
      const matchSearch = bp.name.toLowerCase().includes(bibleSearchQuery.toLowerCase()) || 
                          bp.type.toLowerCase().includes(bibleSearchQuery.toLowerCase()) ||
                          bp.complianceTarget.toLowerCase().includes(bibleSearchQuery.toLowerCase());
      const matchRisk = bibleFilterRisk === 'all' || bp.riskTier.toLowerCase() === bibleFilterRisk.toLowerCase();
      return matchSearch && matchRisk;
    });
  }, [bibleProducts, bibleSearchQuery, bibleFilterRisk]);

  const handleAddBibleProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBpName || !newBpVersion) {
      alert('Please enter a product name and baseline secure version.');
      return;
    }

    const newProduct = {
      id: `pb-custom-${Date.now()}`,
      name: newBpName,
      type: newBpType,
      baselineSecureVersion: newBpVersion,
      allowedLicenses: newBpAllowedLics.split(',').map(s => s.trim()).filter(Boolean),
      disallowedLicenses: newBpDisallowedLics.split(',').map(s => s.trim()).filter(Boolean),
      riskTier: newBpRisk,
      complianceTarget: newBpCompliance || 'Standard Compliance Profile',
      safeguardPolicy: newBpSafeguard || 'Verify cryptographic signature and restrict host execution capabilities on staging.'
    };

    setBibleProducts(prev => [newProduct, ...prev]);
    setSelectedBibleProductId(newProduct.id);
    setShowAddBibleProduct(false);

    // Reset inputs
    setNewBpName('');
    setNewBpVersion('');
    setNewBpCompliance('');
    setNewBpSafeguard('');
  };

  const handleRunSandboxAudit = () => {
    let targetName = sandboxProduct;
    if (sandboxProduct === 'custom' && sandboxCustomName) {
      targetName = sandboxCustomName;
    }

    const matchedBp = bibleProducts.find(bp =>
      bp.name.toLowerCase() === targetName.toLowerCase() ||
      targetName.toLowerCase().includes(bp.name.toLowerCase())
    );

    let versionStatus: 'Compliant' | 'Warning' | 'Fail' = 'Compliant';
    let versionDetails = '';

    const inputVer = sandboxVersion.trim();
    if (!inputVer) {
      versionStatus = 'Warning';
      versionDetails = 'No version specified. Auditing engine cannot verify baseline standards.';
    } else if (matchedBp) {
      const baseline = matchedBp.baselineSecureVersion;
      const baselineNum = parseFloat(baseline.replace(/[^0-9.]/g, ''));
      const inputNum = parseFloat(inputVer.replace(/[^0-9.]/g, ''));

      if (!isNaN(baselineNum) && !isNaN(inputNum)) {
        if (inputNum < baselineNum) {
          versionStatus = 'Fail';
          versionDetails = `Ingested version v${inputVer} is older than the recommended secure baseline v${baseline}. Potential known CVE exposures exist!`;
        } else {
          versionStatus = 'Compliant';
          versionDetails = `Version v${inputVer} matches or exceeds secure baseline standards (v${baseline}).`;
        }
      } else {
        versionDetails = `Assumed compatible with baseline standards (Recommended baseline: v${baseline}).`;
      }
    } else {
      versionDetails = 'Unregistered custom software. Compliance baseline has not been defined in the Master Bible.';
    }

    let licenseStatus: 'Compliant' | 'Warning' | 'Fail' = 'Compliant';
    let licenseDetails = '';

    if (matchedBp) {
      const allowed = matchedBp.allowedLicenses.map((l: string) => l.toLowerCase());
      const disallowed = matchedBp.disallowedLicenses.map((l: string) => l.toLowerCase());
      const queryLic = sandboxLicense.trim().toLowerCase();

      if (disallowed.includes(queryLic)) {
        licenseStatus = 'Fail';
        licenseDetails = `License "${sandboxLicense}" is strictly prohibited for the enterprise by corporate policy. Refuse deployments.`;
      } else if (allowed.length > 0 && !allowed.includes(queryLic)) {
        licenseStatus = 'Warning';
        licenseDetails = `License "${sandboxLicense}" is not explicitly greenlisted in the Master Bible for ${matchedBp.name}. Legal review recommended.`;
      } else {
        licenseStatus = 'Compliant';
        licenseDetails = `License "${sandboxLicense}" matches greenlisted standards for this software class.`;
      }
    } else {
      const queryLic = sandboxLicense.trim().toLowerCase();
      if (['gpl-3.0', 'agpl-3.0', 'gpl-3.0-only', 'agpl-3.0-only', 'sspl-1.0'].includes(queryLic)) {
        licenseStatus = 'Fail';
        licenseDetails = `Copyleft license "${sandboxLicense}" detected. Deploying to commercial client clouds presents critical proprietary exposure risks.`;
      } else {
        licenseStatus = 'Compliant';
        licenseDetails = `License "${sandboxLicense}" is typical of standard permissible open-source software libraries.`;
      }
    }

    const complianceTarget = matchedBp ? matchedBp.complianceTarget : 'General NIST SP 800-53 Rev 5 / CIS Safeguards';
    const safeguardPolicy = matchedBp ? matchedBp.safeguardPolicy : 'Verify cryptographic signature (SLSA/Cosign), restrict container capabilities, and verify dependency CVE maps prior to operational staging.';

    let overallStatus: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    if (versionStatus === 'Fail' || licenseStatus === 'Fail') {
      overallStatus = 'FAIL';
    } else if (versionStatus === 'Warning' || licenseStatus === 'Warning') {
      overallStatus = 'WARN';
    }

    setSandboxReport({
      productName: targetName,
      version: inputVer || 'unknown',
      license: sandboxLicense,
      environment: sandboxEnv,
      overallStatus,
      versionStatus,
      versionDetails,
      licenseStatus,
      licenseDetails,
      complianceTarget,
      safeguardPolicy,
      timestamp: new Date().toISOString()
    });
  };

  return (
    <div className="space-y-6" id="msp-settings-view">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-slate-100 dark:border-zinc-800 pb-4">
        <div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span>Platform Settings & Compliance Bible</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
            Configure thresholds, SAML authentication gateways, operator sessions, and access the master product security Bible.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-Tab Selector */}
          <div className="flex bg-slate-100 dark:bg-zinc-800 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setActiveSubTab('configurations')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'configurations'
                  ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Configurations</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('organization')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'organization'
                  ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Team & Profile</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('bible')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'bible'
                  ? 'bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Master Bible</span>
            </button>
          </div>

          <button
            onClick={fetchAuthDataLedgers}
            disabled={loadingLedgers}
            className="p-2 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 rounded-xl hover:bg-slate-50 dark:hover:bg-zinc-700/80 transition flex items-center gap-1.5 text-xs font-mono cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingLedgers ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Sync Audits</span>
          </button>
        </div>
      </div>

      {activeSubTab === 'configurations' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
          {/* Left Column: Core Preferences */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* General platform settings card */}
            <div className="studio-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <Sliders className="w-4.5 h-4.5 text-indigo-500" />
                <span>General Platform Parameters</span>
              </h3>

              <div className="space-y-3.5 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700 dark:text-zinc-300">Audit Trust SLA Target Threshold (Score)</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="range"
                      min="60"
                      max="98"
                      value={slaTarget}
                      onChange={(e) => setSlaTarget(Number(e.target.value))}
                      className="flex-1 bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full cursor-pointer accent-indigo-600"
                    />
                    <span className="font-mono font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/60 px-2 py-1 rounded">
                      {slaTarget}/100
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">Alerts are compiled if a software passport overall rating drops below this value.</p>
                </div>

                <div className="flex justify-between items-center border-t border-slate-100 dark:border-zinc-800/80 pt-3">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-zinc-300 block">Enable Automated Daily Recalculation Scans</span>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 leading-snug">Automatically scan active client software inventory on CVE database updates.</p>
                  </div>
                  <input
                    type="checkbox"
                    defaultChecked
                    className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-500 border-slate-300 dark:border-zinc-700 rounded focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Theme & Interface Customization Card */}
            <div className="studio-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <Sun className="w-4.5 h-4.5 text-indigo-500" />
                <span>Theme & Interface Customization</span>
              </h3>

              <div className="space-y-4 text-xs">
                <div className="flex flex-col gap-1.5">
                  <span className="font-semibold text-slate-700 dark:text-zinc-300">Active Theme Preference</span>
                  <p className="text-[10px] text-slate-400 dark:text-zinc-500">Choose between high-contrast light mode or a dark interface designed for operating centers.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => theme === 'dark' && onToggleTheme()}
                    className={`flex items-center justify-center gap-2.5 p-3 rounded-xl border transition-all cursor-pointer ${
                      theme === 'light'
                        ? 'bg-indigo-50/55 border-indigo-200 text-indigo-700 font-semibold shadow-sm'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-450 hover:text-zinc-200 hover:bg-zinc-800/60'
                    }`}
                  >
                    <Sun className="w-4 h-4 text-amber-500" />
                    <span>Light Mode</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => theme === 'light' && onToggleTheme()}
                    className={`flex items-center justify-center gap-2.5 p-3 rounded-xl border transition-all cursor-pointer ${
                      theme === 'dark'
                        ? 'bg-indigo-950/20 border-indigo-800/50 text-indigo-200 font-semibold shadow-inner'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-800'
                    }`}
                  >
                    <Moon className="w-4 h-4 text-indigo-400" />
                    <span>Dark Mode</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SAML SSO Configuration Card */}
            <div className="studio-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <Globe className="w-4.5 h-4.5 text-indigo-500" />
                <span>Enterprise SAML / SSO Integration Configuration</span>
              </h3>

              <div className="space-y-4 text-xs">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-zinc-300 block">SAML SSO Access Gate</span>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 leading-snug">Redirect unauthenticated corporate domains to the unified Identity Provider (IdP).</p>
                  </div>
                  <button
                    onClick={() => setSsoEnabled(!ssoEnabled)}
                    className={`px-3 py-1 text-xs font-bold rounded-md border cursor-pointer transition-colors ${
                      ssoEnabled ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400' : 'bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-400'
                    }`}
                  >
                    {ssoEnabled ? 'SSO Active' : 'SSO Inactive'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase mb-1">Corporate Identity Provider</label>
                    <input
                      type="text"
                      value={ssoProvider}
                      onChange={(e) => setSsoProvider(e.target.value)}
                      className="w-full studio-input p-2.5 bg-slate-50 dark:bg-zinc-800/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase mb-1">Client ID / Issuer URL</label>
                    <input
                      type="text"
                      value={ssoClientId}
                      onChange={(e) => setSsoClientId(e.target.value)}
                      className="w-full studio-input p-2.5 bg-slate-50 dark:bg-zinc-800/50 font-mono"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase mb-1">SAML 2.0 Metadata XML Endpoint URL</label>
                    <input
                      type="text"
                      value={ssoMetadataUrl}
                      onChange={(e) => setSsoMetadataUrl(e.target.value)}
                      className="w-full studio-input p-2.5 bg-slate-50 dark:bg-zinc-800/50 font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Active Sessions Monitoring Ledger */}
            <div className="studio-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-4.5 h-4.5 text-indigo-500" />
                  <span>Active Operator Sessions Ledger</span>
                </span>
                <span className="font-mono text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-200/50">
                  {sessions.length} Active Node{sessions.length !== 1 ? 's' : ''}
                </span>
              </h3>

              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-zinc-800 text-slate-400 dark:text-zinc-500 font-mono text-[10px] uppercase">
                      <th className="py-2">User / Identity</th>
                      <th className="py-2">IP Address</th>
                      <th className="py-2">Device & Location</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/40 font-sans">
                    {sessions.map((sess) => (
                      <tr key={sess.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/20">
                        <td className="py-3 pr-2 font-semibold text-slate-800 dark:text-zinc-200">
                          {sess.email}
                          {sess.current && (
                            <span className="ml-2 font-mono text-[8px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 rounded font-bold uppercase">
                              Current Node
                            </span>
                          )}
                        </td>
                        <td className="py-3 font-mono text-slate-500">{sess.ip}</td>
                        <td className="py-3 text-slate-600 dark:text-zinc-400 leading-normal">
                          <span className="block">{sess.device}</span>
                          <span className="text-[10px] text-slate-400">{sess.location}</span>
                        </td>
                        <td className="py-3 text-right">
                          {!sess.current && (
                            <button
                              onClick={() => handleRevokeSession(sess.id)}
                              className="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg cursor-pointer transition"
                              title="Revoke session and force termination"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {sessions.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-slate-400 font-mono">
                          No active sessions identified in memory.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cryptographically Chained Audit Ledger visualization */}
            <div className="studio-card p-5 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-1.5">
                  <FileCode className="w-4.5 h-4.5 text-indigo-500" />
                  <span>Cryptographic Blockchain Audit Ledger</span>
                </h3>
                <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200/50 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Tamper-Proof SLA verified
                </span>
              </div>
              
              <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans leading-relaxed">
                Every critical login event and administrative action is recorded into a secure hash chain. Each block references the SHA-256 hash of its predecessor, creating a mathematically unalterable audit trail.
              </p>

              {/* Integrity Scanner Trigger */}
              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleVerifyLedger}
                  disabled={verifyingLedger}
                  className="flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 dark:disabled:bg-zinc-800 rounded-lg shadow-sm cursor-pointer transition-all shrink-0"
                >
                  {verifyingLedger ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-1.5 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Verifying Cryptographic Ledger...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Verify Cryptographic Chain Integrity</span>
                    </>
                  )}
                </button>
                {verificationResult && (
                  <button
                    type="button"
                    onClick={() => setVerificationResult(null)}
                    className="text-[10px] font-sans font-semibold text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-300 px-3 py-2 bg-slate-100 hover:bg-slate-200/80 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors"
                  >
                    Clear Audit Report
                  </button>
                )}
              </div>

              {/* Dynamic Verification Report */}
              {verificationResult && (
                <div className={`p-4 rounded-xl border font-sans text-xs ${
                  verificationResult.isValid 
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-200/60 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-400' 
                    : 'bg-rose-50/50 dark:bg-rose-950/10 border-rose-200/60 dark:border-rose-900/40 text-rose-800 dark:text-rose-400'
                } space-y-2.5 transition-all duration-300`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                      {verificationResult.isValid ? (
                        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4.5 h-4.5 text-rose-600 dark:text-rose-400 shrink-0" />
                      )}
                      <span>LEDGER ATTESTATION REPORT</span>
                    </span>
                    <span className="font-mono text-[9px] text-slate-400 dark:text-zinc-500">
                      Verified At: {new Date(verificationResult.verifiedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {verificationResult.isValid 
                      ? `SUCCESS: Checked sequential block hash connections across all ${verificationResult.totalBlocksVerified} audit ledger records. Zero database tampering, row injection, or signature modifications were identified.`
                      : `CRITICAL EXCEPTION: Ledger validation check failed! Cryptographic hash mismatch or missing blocks. ${verificationResult.error || 'Please contact the system security administrator immediately.'}`}
                  </p>
                  
                  {/* Verified Blocks Scrollable List */}
                  {verificationResult.details && verificationResult.details.length > 0 && (
                    <div className="bg-white/40 dark:bg-black/20 p-2.5 rounded-lg max-h-40 overflow-y-auto font-mono text-[9px] space-y-1.5 border border-slate-200/40 dark:border-zinc-800/40">
                      <div className="font-sans font-bold text-[8px] text-slate-400 dark:text-zinc-500 border-b border-slate-200/30 dark:border-zinc-800/30 pb-1 mb-1.5 uppercase">
                        Cryptographic Signatures Checked
                      </div>
                      {verificationResult.details.map((vBlock: any, vIdx: number) => (
                        <div key={vIdx} className="flex justify-between items-center gap-2">
                          <div className="truncate text-slate-600 dark:text-zinc-400">
                            Block #{vBlock.id} ({vBlock.action}): 
                            <span className="ml-1 text-slate-400 select-all">{vBlock.storedHash.substring(0, 16)}...</span>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] uppercase font-bold shrink-0 ${
                            vBlock.valid 
                              ? 'bg-emerald-100 dark:bg-emerald-950/55 text-emerald-700 dark:text-emerald-400' 
                              : 'bg-rose-100 dark:bg-rose-950/55 text-rose-700 dark:text-rose-400'
                          }`}>
                            {vBlock.valid ? 'Verified' : 'Corrupt'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3 font-mono text-[10px]">
                {auditChain.slice(0, 3).map((blockObj, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 dark:bg-zinc-800/30 rounded-xl border border-slate-200/60 dark:border-zinc-800 space-y-1 text-slate-600 dark:text-zinc-400 relative overflow-hidden">
                    <div className="absolute right-2 top-2 text-[8px] bg-slate-200 dark:bg-zinc-800 text-slate-500 dark:text-zinc-500 px-1.5 py-0.5 rounded uppercase font-bold">
                      Block #{auditChain.length - 1 - idx}
                    </div>
                    <div className="flex gap-2">
                      <span className="text-indigo-600 dark:text-indigo-400 font-bold uppercase">EVENT:</span>
                      <span className="text-slate-800 dark:text-zinc-200 font-bold">
                        {blockObj.block?.actionType || blockObj.block?.action || 'Genesis Node Initiated'}
                      </span>
                    </div>
                    {blockObj.block?.userEmail && (
                      <div className="flex gap-2">
                        <span className="text-slate-400">IDENTITY:</span>
                        <span className="text-slate-700 dark:text-zinc-300 font-semibold">{blockObj.block?.userEmail}</span>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      <div className="flex gap-2 text-[9px] truncate">
                        <span className="text-slate-400 uppercase font-bold shrink-0">BLOCK HASH:</span>
                        <span className="text-indigo-500 dark:text-indigo-400 select-all font-mono truncate">{blockObj.hash}</span>
                      </div>
                      <div className="flex gap-2 text-[9px] truncate">
                        <span className="text-slate-400 uppercase shrink-0">PREV HASH:</span>
                        <span className="text-slate-500 select-all font-mono truncate">{blockObj.previousHash}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Security Credentials settings */}
            <div className="studio-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <KeyRound className="w-4.5 h-4.5 text-indigo-500" />
                <span>Operator Authentication & Security Keys</span>
              </h3>

              <div className="space-y-3.5 text-xs">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-zinc-300 block">Enforce Multi-Factor Authentication (MFA)</span>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 leading-snug">All MSP users must provide TOTP codes on logon.</p>
                  </div>
                  <button
                    onClick={() => setMfaEnabled(!mfaEnabled)}
                    className={`px-3 py-1 text-xs font-bold rounded-md border cursor-pointer transition-colors ${
                      mfaEnabled ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400' : 'bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-400'
                    }`}
                  >
                    {mfaEnabled ? 'MFA Enabled' : 'MFA Disabled'}
                  </button>
                </div>

                <div className="flex justify-between items-center border-t border-slate-100 dark:border-zinc-800/80 pt-3">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-zinc-300 block">Cryptographic PGP Auditing Key (Private)</span>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500">Used for signing generated software passports and audit attestations.</p>
                  </div>
                  <button className="bg-slate-900 hover:bg-slate-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-sans font-semibold text-xs px-3.5 py-1.8 rounded-lg cursor-pointer transition-colors">
                    Regenerate Sign Key
                  </button>
                </div>

                <div className="flex justify-between items-center border-t border-rose-100 dark:border-rose-950/40 pt-4 mt-2 bg-rose-50/20 dark:bg-rose-950/5 p-3.5 rounded-lg border border-dashed border-rose-200 dark:border-rose-900/40">
                  <div>
                    <span className="font-bold text-rose-700 dark:text-rose-400 block flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-rose-500" /> Tenant Offboarding & Data Deletion (DPA Compliance)
                    </span>
                    <p className="text-[10px] text-slate-500 dark:text-zinc-400 leading-snug mt-1">
                      Cascading-delete all client lists, passports, vulnerability logs, and active integrations. This action is immediate and completely irreversible under GDPR/DPA compliance standards.
                    </p>
                  </div>
                  <button
                    onClick={handleOffboardTenant}
                    disabled={offboarding}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-sans font-bold text-xs px-4 py-2.5 rounded-lg cursor-pointer transition-colors shadow-sm disabled:opacity-50 shrink-0"
                  >
                    {offboarding ? 'Purging Context...' : 'Offboard Workspace'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {saveSuccess && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" />
                  <span>Portal configuration updated!</span>
                </span>
              )}
              <button
                onClick={handleSaveSettings}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-semibold text-xs rounded-lg shadow-sm cursor-pointer transition-all"
              >
                Save Platform Settings
              </button>
            </div>
          </div>

          {/* Right Column: Information panel & Live CI/CD Diagnostics */}
          <div className="space-y-6">
            
            {/* Active Login Audit Trail Panel */}
            <div className="studio-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <Fingerprint className="w-4.5 h-4.5 text-indigo-500" />
                <span>Real-time Login Audit Trail</span>
              </h3>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {history.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-xl border border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-850/30 text-[10px] space-y-1 text-left">
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-slate-700 dark:text-zinc-300 truncate max-w-36">{log.email}</span>
                      <span className={`font-mono text-[8px] font-bold px-1.5 py-0.2 rounded ${
                        log.status === 'Verified' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="text-slate-500 dark:text-zinc-400">
                      <span className="block font-medium">{log.action}</span>
                      <span className="block text-[9px] font-mono mt-0.5">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between font-mono text-[9px] text-slate-400 border-t border-slate-100 dark:border-zinc-800/40 pt-1 mt-1">
                      <span>IP: {log.ip}</span>
                      <span>Loc: {log.location}</span>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <p className="text-center font-mono text-slate-400 py-4">No audit logs identified.</p>
                )}
              </div>
            </div>

            <div className="studio-card p-5 space-y-4 h-fit">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <Shield className="w-4.5 h-4.5 text-slate-400 dark:text-zinc-500" />
                <span>Platform Pedigree Coordinates</span>
              </h3>

              <div className="text-xs space-y-2.5 font-mono text-slate-400 dark:text-zinc-500">
                <div className="flex justify-between border-b border-slate-100 dark:border-zinc-800/40 pb-1.5">
                  <span>PORTAL SERVICE:</span>
                  <span className="font-bold text-slate-700 dark:text-zinc-300">SPR-CORE-VM</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-zinc-800/40 pb-1.5">
                  <span>COMPILATION:</span>
                  <span className="font-bold text-slate-700 dark:text-zinc-300">DOCKER PROD v2.4</span>
                </div>
                <div className="flex justify-between border-b border-slate-100 dark:border-zinc-800/40 pb-1.5">
                  <span>SLA COMPLIANCE:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">99.98%</span>
                </div>
              </div>
            </div>

            <div className="studio-card p-5 space-y-4 h-fit">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <CheckCircle className="w-4.5 h-4.5 text-emerald-500" />
                <span>CI/CD Integration Diagnostics</span>
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans leading-relaxed">
                Verify database connectivity, multi-tenant row-level isolation rules, OAuth handshakes, and API quota safety layers in real-time.
              </p>

              <button
                onClick={runDiagnosticSuite}
                disabled={testing}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-sans font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                {testing ? 'Running Diagnostics...' : 'Run Integration Tests'}
              </button>

              {testResults.length > 0 && (
                <div className="space-y-2.5 pt-2.5 border-t border-slate-100 dark:border-zinc-800/40">
                  {testResults.map((t: any, idx: number) => (
                    <div key={idx} className="text-[10px] space-y-0.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700 dark:text-zinc-300">{t.name}</span>
                        <span className={`font-mono font-bold px-1.5 py-0.2 rounded text-[8px] ${
                          t.status === 'PASS' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {t.status}
                        </span>
                      </div>
                      <p className="text-slate-400 dark:text-zinc-500 font-sans leading-snug">{t.details}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : activeSubTab === 'organization' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn text-xs">
          {/* Profile Management Section */}
          <div className="lg:col-span-1 space-y-6">
            <div className="studio-card p-5 space-y-4 text-left">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <Sliders className="w-4.5 h-4.5 text-indigo-500" />
                <span>User Profile Credentials</span>
              </h3>

              {teamError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-150 rounded-xl flex gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <p>{teamError}</p>
                </div>
              )}

              {teamSuccess && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-150 rounded-xl flex gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <p>{teamSuccess}</p>
                </div>
              )}

              {editingProfile ? (
                <form onSubmit={handleSaveProfile} className="space-y-3.5">
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-slate-500">Display Name</label>
                    <input
                      type="text"
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="studio-input p-2.5 bg-slate-50 dark:bg-zinc-800/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-slate-500">Corporate Job Title</label>
                    <input
                      type="text"
                      required
                      value={profileJobTitle}
                      onChange={(e) => setProfileJobTitle(e.target.value)}
                      className="studio-input p-2.5 bg-slate-50 dark:bg-zinc-800/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-slate-500">Organization Name</label>
                    <input
                      type="text"
                      required
                      value={profileCompany}
                      onChange={(e) => setProfileCompany(e.target.value)}
                      className="studio-input p-2.5 bg-slate-50 dark:bg-zinc-800/50"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingProfile(false)}
                      className="px-3 py-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 cursor-pointer"
                    >
                      Save Profile
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-bold flex items-center justify-center text-lg border border-indigo-200 dark:border-indigo-900/40">
                      {profileName ? profileName.substring(0, 2).toUpperCase() : 'U'}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-800 dark:text-zinc-100">
                        {profileName || 'Active Operator'}
                      </h4>
                      <p className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">
                        {profileJobTitle || 'Workspace Administrator'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-slate-100 dark:border-zinc-850 pt-3 text-[11px] leading-normal text-slate-600 dark:text-zinc-400">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email Identifier:</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-zinc-200 select-all">{profile?.email || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Active Tenant ID:</span>
                      <span className="font-mono text-slate-500 select-all">{profile?.tenantId || 'global'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">MSP Workspace:</span>
                      <span className="font-bold text-slate-800 dark:text-zinc-200">{profile?.companyName || 'Not Defined'}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setProfileName(profile?.displayName || '');
                      setProfileJobTitle(profile?.roleTitle || '');
                      setProfileCompany(profile?.companyName || '');
                      setEditingProfile(true);
                    }}
                    className="w-full py-2 border border-indigo-200 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-400 font-semibold rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/20 cursor-pointer transition text-center"
                  >
                    Edit Profile Details
                  </button>
                </div>
              )}
            </div>

            <div className="studio-card p-5 space-y-3.5 text-left text-slate-400">
              <h4 className="text-[10px] font-mono font-bold uppercase text-slate-500 tracking-wider">
                Authorized Role Hierarchy
              </h4>
              <p className="text-[10px] leading-relaxed">
                RBAC enforces strict isolation gates. Permissions cascade in order: <strong>Owner &gt; Admin &gt; Technician &gt; Viewer &gt; Client</strong>. Modifying team permissions automatically triggers a cryptographic token invalidation audit block.
              </p>
            </div>
          </div>

          {/* Organization & Team Access List Section */}
          <div className="lg:col-span-2 space-y-6 text-left">
            {/* Invite form card */}
            <div className="studio-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <PlusCircle className="w-4.5 h-4.5 text-indigo-500" />
                <span>Invite New MSP Team Member</span>
              </h3>

              <form onSubmit={handleInviteMember} className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. associate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="studio-input p-2.5 bg-slate-50 dark:bg-zinc-800/50"
                  />
                </div>

                <div className="w-full md:w-44 flex flex-col gap-1">
                  <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase">
                    Security Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="studio-input p-2.5 bg-slate-50 dark:bg-zinc-800/50 cursor-pointer font-semibold text-slate-700 dark:text-zinc-300"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Technician">Technician</option>
                    <option value="Viewer">Viewer</option>
                    <option value="Client">Client</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="mt-5 md:mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 py-2.5 rounded-xl shrink-0 transition shadow-sm cursor-pointer"
                >
                  Send Invitation
                </button>
              </form>
            </div>

            {/* Team Members List Card */}
            <div className="studio-card p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-800/80">
                <span className="flex items-center gap-2">
                  <Lock className="w-4.5 h-4.5 text-indigo-500" />
                  <span>Workspace Associates Matrix</span>
                </span>
                <span className="font-mono text-[9px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-200/50">
                  {teamMembers.length} Registered Nodes
                </span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-zinc-850 text-slate-400 dark:text-zinc-500 font-mono text-[10px] uppercase">
                      <th className="py-2.5">User Details</th>
                      <th className="py-2.5">Authority Role</th>
                      <th className="py-2.5 text-right">Administrative Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 dark:divide-zinc-850/40">
                    {teamMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-850/20">
                        <td className="py-3.5 pr-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 font-bold flex items-center justify-center text-xs shrink-0 border border-slate-200 dark:border-zinc-700">
                              {member.displayName ? member.displayName.substring(0, 2).toUpperCase() : member.email.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-bold text-slate-800 dark:text-zinc-200 block">
                                {member.displayName || 'Pending Associate Registration'}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400 select-all block">
                                {member.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5">
                          {member.role === 'Owner' ? (
                            <span className="font-mono text-[9px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded uppercase">
                              Owner (Root)
                            </span>
                          ) : (
                            <select
                              value={member.role}
                              onChange={(e) => handleUpdateMemberRole(member.id, e.target.value)}
                              className="bg-transparent border border-slate-200 dark:border-zinc-700 rounded p-1 font-mono text-[10px] font-bold cursor-pointer text-slate-800 dark:text-zinc-300 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="Admin">Admin</option>
                              <option value="Technician">Technician</option>
                              <option value="Viewer">Viewer</option>
                              <option value="Client">Client</option>
                            </select>
                          )}
                        </td>
                        <td className="py-3.5 text-right">
                          {member.role !== 'Owner' && member.id !== profile?.id && (
                            <button
                              onClick={() => handleRemoveMember(member.id)}
                              className="px-2.5 py-1.5 text-[10px] font-bold text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-950 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg cursor-pointer transition-colors"
                            >
                              Revoke Access
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {teamMembers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-slate-400 font-mono">
                          {loadingTeam ? 'Securing team data...' : 'No other associates mapped to this workspace.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-fadeIn" id="product-master-bible-container">
          {/* Welcome Alert / Info Bar */}
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/20 dark:to-purple-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-5 shadow-xs">
            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-indigo-600 rounded-xl text-white">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-indigo-900 dark:text-indigo-300 font-display">Enterprise Platform Master Product Bible</h3>
                <p className="text-xs text-indigo-700 dark:text-indigo-400 font-sans leading-relaxed">
                  This Bible defines standard secure baseline versions, permitted/copyleft licenses, risk classifications, and operational NIST/ISO security safeguard guidelines. Ingested Software Passports must be checked against these standards to prevent compliance violations.
                </p>
                <div className="flex gap-4 pt-2 text-[10px] font-semibold text-indigo-800 dark:text-indigo-300">
                  <span>• Policy Reference: NIST SP 800-53 r5</span>
                  <span>• Legal Stand: SSPL/AGPL Copyleft Blocked</span>
                  <span>• Baseline updates: Automated daily RSS synchronizations</span>
                </div>
              </div>
            </div>
          </div>

          {/* Grid Layout: Left Column = Product Bible Directory, Right Column = Selected Specifications & Sandbox Compliance Auditor */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column: List of Products with Search & Add option */}
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 p-5 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200 font-display">Product Bible Index</h4>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-sans">Index of certified system components</p>
                  </div>
                  <button
                    onClick={() => setShowAddBibleProduct(!showAddBibleProduct)}
                    className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-zinc-800 rounded-lg cursor-pointer transition flex items-center gap-1 text-[11px] font-bold"
                    title="Register a new software specification"
                  >
                    <PlusCircle className="w-4.5 h-4.5" />
                    <span>Register</span>
                  </button>
                </div>

                {/* Quick Search & Filter */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700">
                    <Search className="w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search specifications..."
                      value={bibleSearchQuery}
                      onChange={(e) => setBibleSearchQuery(e.target.value)}
                      className="w-full bg-transparent focus:outline-none text-slate-700 dark:text-zinc-350"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-zinc-500 pt-1">
                    <span>Risk Filter:</span>
                    <div className="flex gap-1.5 font-semibold">
                      {['all', 'low', 'medium', 'high'].map(r => (
                        <button
                          key={r}
                          onClick={() => setBibleFilterRisk(r)}
                          className={`px-1.5 py-0.5 rounded capitalize cursor-pointer transition ${
                            bibleFilterRisk === r
                              ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold'
                              : 'hover:text-slate-800 dark:hover:text-zinc-300'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Add New Specification Form Block */}
                {showAddBibleProduct && (
                  <form onSubmit={handleAddBibleProduct} className="p-4 bg-slate-50 dark:bg-zinc-850/45 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs space-y-3">
                    <h5 className="font-bold text-slate-800 dark:text-zinc-200 font-display">New Standard Specifications Registration</h5>
                    
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase font-bold font-mono mb-1">Product / Package Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Apache Kafka"
                        required
                        value={newBpName}
                        onChange={(e) => setNewBpName(e.target.value)}
                        className="w-full studio-input p-2 bg-white dark:bg-zinc-800"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold font-mono mb-1">Class Type</label>
                        <select
                          value={newBpType}
                          onChange={(e) => setNewBpType(e.target.value)}
                          className="w-full studio-input p-1.5 bg-white dark:bg-zinc-800"
                        >
                          <option value="Web Infrastructure / Proxy">Web / Proxy</option>
                          <option value="Database Systems">Database</option>
                          <option value="Cache Systems">Cache</option>
                          <option value="Open Source Logging Framework">Logging</option>
                          <option value="Container Foundations">Container</option>
                          <option value="Framework Library">Framework</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold font-mono mb-1">Secure Baseline</label>
                        <input
                          type="text"
                          placeholder="e.g. 3.4.0"
                          required
                          value={newBpVersion}
                          onChange={(e) => setNewBpVersion(e.target.value)}
                          className="w-full studio-input p-1.5 bg-white dark:bg-zinc-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase font-bold font-mono mb-1">Permitted Licenses</label>
                      <input
                        type="text"
                        value={newBpAllowedLics}
                        onChange={(e) => setNewBpAllowedLics(e.target.value)}
                        className="w-full studio-input p-2 font-mono text-[10px] bg-white dark:bg-zinc-800"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase font-bold font-mono mb-1">Prohibited Copylefts</label>
                      <input
                        type="text"
                        value={newBpDisallowedLics}
                        onChange={(e) => setNewBpDisallowedLics(e.target.value)}
                        className="w-full studio-input p-2 font-mono text-[10px] bg-white dark:bg-zinc-800"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold font-mono mb-1">Risk Tier</label>
                        <select
                          value={newBpRisk}
                          onChange={(e) => setNewBpRisk(e.target.value as any)}
                          className="w-full studio-input p-1.5 bg-white dark:bg-zinc-800"
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold font-mono mb-1">Target Compliance</label>
                        <input
                          type="text"
                          placeholder="e.g. HIPAA CC4 / ISO"
                          value={newBpCompliance}
                          onChange={(e) => setNewBpCompliance(e.target.value)}
                          className="w-full studio-input p-1.5 bg-white dark:bg-zinc-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase font-bold font-mono mb-1">Operational Safeguard Policy</label>
                      <textarea
                        rows={2}
                        placeholder="Safeguards required..."
                        value={newBpSafeguard}
                        onChange={(e) => setNewBpSafeguard(e.target.value)}
                        className="w-full studio-input p-2 bg-white dark:bg-zinc-800"
                      />
                    </div>

                    <div className="flex gap-2 justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddBibleProduct(false)}
                        className="px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-750 text-slate-600 dark:text-zinc-300 rounded font-bold transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold transition flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Register Spec</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* List of Specs */}
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                  {filteredBibleProducts.length === 0 ? (
                    <p className="text-center text-[10px] text-slate-400 py-6">No matching standard specifications found.</p>
                  ) : (
                    filteredBibleProducts.map(bp => {
                      const isSelected = bp.id === selectedBibleProductId;
                      return (
                        <button
                          key={bp.id}
                          onClick={() => setSelectedBibleProductId(bp.id)}
                          className={`w-full text-left p-3 rounded-lg border text-xs flex justify-between items-center transition cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-900 text-indigo-900 dark:text-indigo-300 font-bold shadow-xs'
                              : 'bg-slate-50 dark:bg-zinc-850/30 border-slate-150 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-800/40 text-slate-750 dark:text-zinc-300'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-sans leading-snug">{bp.name}</p>
                            <span className="text-[8px] font-mono text-slate-400 block mt-0.5">{bp.type}</span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <span className={`px-1.5 py-0.2 rounded-[4px] text-[8px] font-mono font-bold ${
                              bp.riskTier === 'High' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                              bp.riskTier === 'Medium' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                              'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            }`}>
                              {bp.riskTier}
                            </span>
                            <ChevronRight className={`w-3.5 h-3.5 ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right 2 Columns: Specification Details & Interactive Sandbox compliance auditor */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Card 1: Active Specification detail */}
              {activeBibleProduct && (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-start border-b border-slate-150 dark:border-zinc-800 pb-3">
                    <div>
                      <span className="text-[8px] font-mono uppercase tracking-widest font-bold text-indigo-600 dark:text-indigo-400">Approved Platform Standard Spec</span>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100 mt-1 font-display flex items-center gap-1.5">
                        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" />
                        {activeBibleProduct.name}
                      </h3>
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5">{activeBibleProduct.type}</p>
                    </div>

                    <span className="bg-indigo-900 text-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase border border-indigo-850">
                      Baseline: v{activeBibleProduct.baselineSecureVersion}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                    <div className="space-y-3">
                      <div>
                        <span className="text-[9px] text-slate-400 dark:text-zinc-500 block font-mono font-bold uppercase">Permitted Security greenlist licenses</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {activeBibleProduct.allowedLicenses.map((lic: string) => (
                            <span key={lic} className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-150 dark:border-emerald-900/60 font-semibold">
                              {lic}
                            </span>
                          ))}
                          {activeBibleProduct.allowedLicenses.length === 0 && <span className="text-slate-500 italic text-[11px]">None specified</span>}
                        </div>
                      </div>

                      <div>
                        <span className="text-[9px] text-slate-400 dark:text-zinc-500 block font-mono font-bold uppercase">Prohibited copyleft blacklisted licenses</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {activeBibleProduct.disallowedLicenses.map((lic: string) => (
                            <span key={lic} className="bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 text-[10px] font-mono px-2 py-0.5 rounded border border-rose-150 dark:border-rose-900/60 font-semibold">
                              {lic}
                            </span>
                          ))}
                          {activeBibleProduct.disallowedLicenses.length === 0 && <span className="text-slate-500 italic text-[11px]">None prohibited</span>}
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-50 dark:bg-zinc-850/30 rounded-xl border border-slate-200 dark:border-zinc-800 space-y-2">
                      <span className="text-[9px] text-slate-400 dark:text-zinc-500 block font-mono font-bold uppercase">Target Regulatory Framework Compliance</span>
                      <p className="font-bold text-slate-700 dark:text-zinc-300">{activeBibleProduct.complianceTarget}</p>
                      <p className="text-[10px] text-slate-450 dark:text-zinc-400 leading-normal">
                        Ingested components of this product category must be validated in accordance with audit guidelines mapped to this baseline.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-indigo-50/30 dark:bg-indigo-950/10 rounded-xl border border-indigo-100/70 dark:border-indigo-900/40 space-y-1.5 text-xs">
                    <span className="font-bold text-indigo-950 dark:text-indigo-400 font-mono text-[9px] uppercase tracking-wider block">Standard Core Safeguards Policy</span>
                    <p className="text-slate-750 dark:text-zinc-300 leading-normal font-sans text-[11px]">{activeBibleProduct.safeguardPolicy}</p>
                  </div>
                </div>
              )}

              {/* Card 2: Interactive Sandbox Compliance Auditor */}
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800 p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-100 font-display flex items-center gap-1.5">
                    <Sparkles className="w-4.5 h-4.5 text-amber-500 animate-bounce" />
                    <span>Interactive Product Compliance Sandbox Auditor</span>
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-zinc-550 font-sans mt-0.5">
                    Simulate software ingest requests and instantly query compliance safety standards against the Master Product Bible.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-[10px] text-slate-400 dark:text-zinc-500 font-mono uppercase font-bold mb-1">Select Target Product Class</label>
                      <select
                        value={sandboxProduct}
                        onChange={(e) => {
                          setSandboxProduct(e.target.value);
                          const found = bibleProducts.find(bp => bp.name === e.target.value);
                          if (found) {
                            setSandboxVersion(found.baselineSecureVersion);
                            setSandboxLicense(found.allowedLicenses[0] || 'MIT');
                          }
                        }}
                        className="w-full studio-input p-2.5 bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300"
                      >
                        {bibleProducts.map(bp => (
                          <option key={bp.id} value={bp.name}>{bp.name}</option>
                        ))}
                        <option value="custom">-- Custom/Unregistered Product --</option>
                      </select>
                    </div>

                    {sandboxProduct === 'custom' && (
                      <div className="animate-fadeIn">
                        <label className="block text-[10px] text-slate-400 dark:text-zinc-500 font-mono uppercase font-bold mb-1">Custom Product Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Apache Kafka"
                          value={sandboxCustomName}
                          onChange={(e) => setSandboxCustomName(e.target.value)}
                          className="w-full studio-input p-2.5 bg-white dark:bg-zinc-800"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 dark:text-zinc-500 font-mono uppercase font-bold mb-1">Ingested Version</label>
                        <input
                          type="text"
                          value={sandboxVersion}
                          onChange={(e) => setSandboxVersion(e.target.value)}
                          className="w-full studio-input p-2 font-mono bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-350"
                          placeholder="e.g. 1.25.0"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-slate-400 dark:text-zinc-500 font-mono uppercase font-bold mb-1">License SPDX</label>
                        <input
                          type="text"
                          value={sandboxLicense}
                          onChange={(e) => setSandboxLicense(e.target.value)}
                          className="w-full studio-input p-2 font-mono bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-350"
                          placeholder="e.g. GPL-3.0-only"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 dark:text-zinc-500 font-mono uppercase font-bold mb-1">Target Deploy Environment</label>
                      <div className="grid grid-cols-3 gap-2">
                        {['Production', 'Staging', 'Development'].map(env => (
                          <button
                            key={env}
                            type="button"
                            onClick={() => setSandboxEnv(env)}
                            className={`p-2 rounded-lg border text-center font-semibold cursor-pointer transition ${
                              sandboxEnv === env
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-800/80'
                                : 'bg-slate-50 dark:bg-zinc-850/40 border-slate-150 dark:border-zinc-800 hover:bg-slate-100 text-slate-600 dark:text-zinc-400 dark:hover:text-zinc-300'
                            }`}
                          >
                            {env}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRunSandboxAudit}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-850 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 text-xs shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5 fill-current text-emerald-400" />
                      <span>Run Sandbox Compliance Attestation</span>
                    </button>
                  </div>

                  {/* Attestation Sandbox Report panel */}
                  <div className="border border-slate-200 dark:border-zinc-850 rounded-xl p-4.5 bg-slate-50/50 dark:bg-zinc-950/10 flex flex-col justify-between min-h-[240px]">
                    {sandboxReport ? (
                      <div className="space-y-3 font-sans animate-fadeIn">
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-zinc-800 pb-2">
                          <div>
                            <span className="text-[8px] font-mono text-slate-400 dark:text-zinc-500 font-bold block">ATTESTATION REPORT</span>
                            <h4 className="font-bold text-slate-800 dark:text-zinc-150 text-[11px] font-mono uppercase truncate max-w-[130px]">{sandboxReport.productName}</h4>
                          </div>

                          <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase flex items-center gap-1 ${
                            sandboxReport.overallStatus === 'PASS' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200/50' :
                            sandboxReport.overallStatus === 'WARN' ? 'bg-amber-100 text-amber-850 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200/50' :
                            'bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-200/50'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              sandboxReport.overallStatus === 'PASS' ? 'bg-emerald-500' :
                              sandboxReport.overallStatus === 'WARN' ? 'bg-amber-500 animate-pulse' :
                              'bg-rose-500 animate-pulse'
                            }`} />
                            {sandboxReport.overallStatus}
                          </span>
                        </div>

                        <div className="space-y-2 text-[10px] leading-normal font-sans">
                          <div className="flex items-start gap-1.5">
                            {sandboxReport.versionStatus === 'Compliant' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            ) : sandboxReport.versionStatus === 'Warning' ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            ) : (
                              <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <span className="font-bold text-slate-700 dark:text-zinc-300">Version Standard: </span>
                              <span className="text-slate-500 dark:text-zinc-400">{sandboxReport.versionDetails}</span>
                            </div>
                          </div>

                          <div className="flex items-start gap-1.5">
                            {sandboxReport.licenseStatus === 'Compliant' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            ) : sandboxReport.licenseStatus === 'Warning' ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            ) : (
                              <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <span className="font-bold text-slate-700 dark:text-zinc-300">License Standard: </span>
                              <span className="text-slate-500 dark:text-zinc-400">{sandboxReport.licenseDetails}</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-2.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded text-[9px] text-slate-500 dark:text-zinc-400 leading-normal space-y-1 shadow-inner">
                          <p className="font-bold text-slate-700 dark:text-zinc-300 font-mono text-[8px] uppercase">Compliance Checklist ({sandboxReport.complianceTarget}):</p>
                          <p className="font-sans italic">{sandboxReport.safeguardPolicy}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-10 text-slate-400 dark:text-zinc-500 space-y-2 font-sans flex flex-col justify-center items-center h-full">
                        <Sliders className="w-8 h-8 text-slate-300 dark:text-zinc-700" />
                        <p className="text-[11px] font-bold text-slate-600 dark:text-zinc-400 mt-2">Attestation Pending</p>
                        <p className="text-[9px] text-slate-400 dark:text-zinc-500 leading-snug max-w-[180px]">
                          Configure simulation parameters and run Sandbox Compliance Attestation to test build parameters against standards.
                        </p>
                      </div>
                    )}

                    <div className="text-[8px] font-mono text-slate-400 dark:text-zinc-650 border-t border-slate-200 dark:border-zinc-850 pt-2 mt-2 flex justify-between items-center">
                      <span>AUDIT KERNEL: SEC_ENGINE_v1.0</span>
                      {sandboxReport && (
                        <span>Attested: {new Date(sandboxReport.timestamp).toLocaleTimeString()}</span>
                      )}
                    </div>
                  </div>
                </div>

              </div>

            </div>

          </div>
        </div>
      )}
    </div>
  );
}
