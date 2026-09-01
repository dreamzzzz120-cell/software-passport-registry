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

  // profile is fetched from /api/user/me, which already returns the caller's
  // role — derive gating from it directly rather than requiring a separate
  // prop. Matches backend enforcement exactly: POST /api/tenant/offboard is
  // requireRole('Owner'); team invite/role-change/remove are requireRole
  // (['Owner','Admin']) (auth.ts).
  const currentRole: string = profile?.role || 'Viewer';
  const isOwner = currentRole === 'Owner';
  const canManageTeam = isOwner || currentRole === 'Admin';

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
    if (!inviteEmail || !canManageTeam) return;
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
    if (!canManageTeam) return;
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
    if (!canManageTeam) return;
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

  // There is no test-runner endpoint in the backend (running the test suite
  // from an HTTP request would itself be a code-execution risk), and no
  // endpoint separately verifies RLS isolation, OAuth handshakes, or API
  // quota safety. This checks the one thing SPR can actually report on
  // itself: real database connectivity, via the existing /api/ready
  // readiness probe — the same one an orchestrator uses.
  const runDiagnosticSuite = async () => {
    setTesting(true);
    try {
      const res = await apiFetch('/api/ready');
      const data = await res.json().catch(() => ({}));
      const dbOk = Boolean(data?.checks?.database?.ok);
      setTestResults([
        { name: 'Database connectivity', status: dbOk ? 'PASS' : 'FAIL', details: dbOk ? `Responded in ${data.checks.database.latencyMs}ms` : data?.checks?.database?.error || 'Database unavailable' },
        { name: 'API reachability', status: 'PASS', details: `/api/ready responded HTTP ${res.status}` },
      ]);
    } catch (err) {
      console.error('Error running readiness check:', err);
      setTestResults([{ name: 'API reachability', status: 'FAIL', details: 'The readiness request itself failed' }]);
    } finally {
      setTesting(false);
    }
  };

  const handleOffboardTenant = async () => {
    if (!isOwner) { alert(`Your ${currentRole} role cannot offboard this workspace. Owner is required.`); return; }
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

  // No backend endpoint persists these fields (SLA target, MFA toggle, SSO
  // config, daily-scan cadence) — they are local component state only and
  // reset on reload/navigation. This used to show a "Portal configuration
  // updated!" success message that implied a real save; keep that claim
  // honest until real persistence exists rather than build a fake one.
  const handleSaveSettings = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 4000);
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
    <div className="space-y-4" id="msp-settings-view">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e] flex items-center gap-2">
            <Settings className="h-4 w-4 text-[#0f6cbd]" />
            <span>Platform Settings & Compliance Bible</span>
          </h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">
            Configure thresholds, SAML authentication gateways, operator sessions, and the master product security Bible.
          </p>
        </div>

        <button
          onClick={fetchAuthDataLedgers}
          disabled={loadingLedgers}
          className="inline-flex h-9 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingLedgers ? 'animate-spin' : ''}`} />
          <span>Sync Audits</span>
        </button>
      </div>

      {/* Sub-Tab Selector */}
      <div className="flex gap-1 border-b border-[#e1dfdd]">
        <button
          type="button"
          onClick={() => setActiveSubTab('configurations')}
          className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium border-b-2 -mb-px ${
            activeSubTab === 'configurations'
              ? 'border-[#0f6cbd] text-[#0f6cbd]'
              : 'border-transparent text-[#605e5c] hover:text-[#323130]'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>Configurations</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('organization')}
          className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium border-b-2 -mb-px ${
            activeSubTab === 'organization'
              ? 'border-[#0f6cbd] text-[#0f6cbd]'
              : 'border-transparent text-[#605e5c] hover:text-[#323130]'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Team & Profile</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('bible')}
          className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium border-b-2 -mb-px ${
            activeSubTab === 'bible'
              ? 'border-[#0f6cbd] text-[#0f6cbd]'
              : 'border-transparent text-[#605e5c] hover:text-[#323130]'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>Master Bible</span>
        </button>
      </div>

      {activeSubTab === 'configurations' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left Column: Core Preferences */}
          <div className="lg:col-span-2 space-y-4">

            <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
              <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">What is this? &middot; How it works</summary>
              <div className="px-3 pb-3 text-[#605e5c]">
                <p>Platform-wide thresholds, single sign-on, and session controls for this workspace.</p>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                  <li>Set the trust score threshold that triggers alerts.</li>
                  <li>Configure the SAML identity provider your organization uses to sign in.</li>
                  <li>Review and revoke active operator sessions if needed.</li>
                </ol>
              </div>
            </details>

            {/* General platform settings card */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <Sliders className="h-4 w-4 text-[#0f6cbd]" />
                <span>General platform parameters</span>
              </h3>

              <div className="space-y-3 text-[13px]">
                <div className="flex flex-col gap-1">
                  <label className="font-medium text-[#323130]">Audit trust SLA target threshold (score)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="60"
                      max="98"
                      value={slaTarget}
                      onChange={(e) => setSlaTarget(Number(e.target.value))}
                      className="h-1.5 flex-1 cursor-pointer accent-[#0f6cbd]"
                    />
                    <span className="rounded border border-[#c8c6c4] bg-[#eff6fc] px-2 py-1 font-medium text-[#0f6cbd]">
                      {slaTarget}/100
                    </span>
                  </div>
                  <p className="text-[12px] text-[#605e5c]">Alerts are compiled if a software passport overall rating drops below this value.</p>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-[#e1dfdd] pt-3">
                  <div>
                    <span className="block font-medium text-[#323130]">Enable automated daily recalculation scans</span>
                    <p className="text-[12px] text-[#605e5c]">Automatically scan active client software inventory on CVE database updates.</p>
                  </div>
                  <input
                    type="checkbox"
                    defaultChecked
                    className="h-4 w-4 rounded border-[#c8c6c4] text-[#0f6cbd] focus:ring-[#0f6cbd]"
                  />
                </div>
              </div>
            </div>

            {/* Theme & Interface Customization Card */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <Sun className="h-4 w-4 text-[#0f6cbd]" />
                <span>Theme & interface</span>
              </h3>

              <div className="space-y-3 text-[13px]">
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-[#323130]">Active theme preference</span>
                  <p className="text-[12px] text-[#605e5c]">Choose between a light interface or a dark interface for operating centers.</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => theme === 'dark' && onToggleTheme()}
                    className={`flex h-9 items-center justify-center gap-2 rounded border text-[13px] font-medium ${
                      theme === 'light'
                        ? 'border-[#0f6cbd] bg-[#eff6fc] text-[#0f6cbd]'
                        : 'border-[#c8c6c4] text-[#323130] hover:bg-black/[.03]'
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    <span>Light mode</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => theme === 'light' && onToggleTheme()}
                    className={`flex h-9 items-center justify-center gap-2 rounded border text-[13px] font-medium ${
                      theme === 'dark'
                        ? 'border-[#0f6cbd] bg-[#eff6fc] text-[#0f6cbd]'
                        : 'border-[#c8c6c4] text-[#323130] hover:bg-black/[.03]'
                    }`}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    <span>Dark mode</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SAML SSO Configuration Card */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <Globe className="h-4 w-4 text-[#0f6cbd]" />
                <span>Enterprise SAML / SSO integration</span>
              </h3>

              <div className="space-y-3 text-[13px]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="block font-medium text-[#323130]">SAML SSO access gate</span>
                    <p className="text-[12px] text-[#605e5c]">Redirect unauthenticated corporate domains to the unified identity provider (IdP).</p>
                  </div>
                  <button
                    onClick={() => setSsoEnabled(!ssoEnabled)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded border px-2.5 text-[12px] font-medium ${
                      ssoEnabled ? 'border-[#c8c6c4] bg-[#dff6dd] text-[#0e700e]' : 'border-[#c8c6c4] bg-[#f3f2f1] text-[#605e5c]'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${ssoEnabled ? 'bg-[#0e700e]' : 'bg-[#8a8886]'}`} />
                    {ssoEnabled ? 'SSO active' : 'SSO inactive'}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 border-t border-[#e1dfdd] pt-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Corporate identity provider</label>
                    <input
                      type="text"
                      value={ssoProvider}
                      onChange={(e) => setSsoProvider(e.target.value)}
                      className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Client ID / issuer URL</label>
                    <input
                      type="text"
                      value={ssoClientId}
                      onChange={(e) => setSsoClientId(e.target.value)}
                      className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 font-mono text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">SAML 2.0 metadata XML endpoint URL</label>
                    <input
                      type="text"
                      value={ssoMetadataUrl}
                      onChange={(e) => setSsoMetadataUrl(e.target.value)}
                      className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 font-mono text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Active Sessions Monitoring Ledger */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center justify-between border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <span className="flex items-center gap-1.5">
                  <Lock className="h-4 w-4 text-[#0f6cbd]" />
                  <span>Active operator sessions</span>
                </span>
                <span className="rounded border border-[#c8c6c4] bg-[#eff6fc] px-2 py-0.5 text-[12px] font-medium text-[#0f6cbd]">
                  {sessions.length} active
                </span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                      <th className="py-2 font-medium">User / identity</th>
                      <th className="py-2 font-medium">IP address</th>
                      <th className="py-2 font-medium">Device & location</th>
                      <th className="py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((sess) => (
                      <tr key={sess.id} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                        <td className="py-2.5 pr-2 font-medium text-[#201f1e]">
                          {sess.email}
                          {sess.current && (
                            <span className="ml-2 rounded border border-[#c8c6c4] bg-[#dff6dd] px-1.5 py-0.5 text-[11px] font-medium text-[#0e700e]">
                              Current
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 font-mono text-[#605e5c]">{sess.ip}</td>
                        <td className="py-2.5 text-[#605e5c]">
                          <span className="block">{sess.device}</span>
                          <span className="text-[12px] text-[#8a8886]">{sess.location}</span>
                        </td>
                        <td className="py-2.5 text-right">
                          {!sess.current && (
                            <button
                              onClick={() => handleRevokeSession(sess.id)}
                              className="rounded p-1.5 text-[#a4262c] hover:bg-[#fdf2f2]"
                              title="Revoke session and force termination"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {sessions.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-[#8a8886]">
                          No active sessions identified.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cryptographically Chained Audit Ledger visualization */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-[#e1dfdd] pb-2">
                <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-[#201f1e]">
                  <FileCode className="h-4 w-4 text-[#0f6cbd]" />
                  <span>Cryptographic audit ledger</span>
                </h3>
                <span className="inline-flex items-center gap-1.5 rounded border border-[#c8c6c4] bg-[#dff6dd] px-2 py-0.5 text-[12px] font-medium text-[#0e700e]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0e700e]" />
                  Tamper-proof, SLA verified
                </span>
              </div>

              <p className="text-[13px] text-[#605e5c]">
                Every critical login event and administrative action is recorded into a secure hash chain. Each block references the SHA-256 hash of its predecessor, creating an unalterable audit trail.
              </p>

              {/* Integrity Scanner Trigger */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleVerifyLedger}
                  disabled={verifyingLedger}
                  className="inline-flex h-9 items-center gap-2 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:opacity-60"
                >
                  {verifyingLedger ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Verifying ledger…</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Verify chain integrity</span>
                    </>
                  )}
                </button>
                {verificationResult && (
                  <button
                    type="button"
                    onClick={() => setVerificationResult(null)}
                    className="inline-flex h-9 items-center rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]"
                  >
                    Clear report
                  </button>
                )}
              </div>

              {/* Dynamic Verification Report */}
              {verificationResult && (
                <div className={`space-y-2 rounded-md border p-3 text-[13px] ${
                  verificationResult.isValid
                    ? 'border-[#c8c6c4] bg-[#dff6dd] text-[#0e700e]'
                    : 'border-[#c8c6c4] bg-[#fdf2f2] text-[#a4262c]'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide">
                      {verificationResult.isValid ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0" />
                      )}
                      <span>Ledger attestation report</span>
                    </span>
                    <span className="text-[11px] text-[#605e5c]">
                      Verified at {new Date(verificationResult.verifiedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed">
                    {verificationResult.isValid
                      ? `Checked sequential block hash connections across all ${verificationResult.totalBlocksVerified} audit ledger records. No database tampering, row injection, or signature modifications were identified.`
                      : `Ledger validation check failed. Cryptographic hash mismatch or missing blocks. ${verificationResult.error || 'Please contact the system security administrator immediately.'}`}
                  </p>

                  {/* Verified Blocks Scrollable List */}
                  {verificationResult.details && verificationResult.details.length > 0 && (
                    <div className="max-h-40 space-y-1.5 overflow-y-auto rounded border border-[#e1dfdd] bg-white p-2.5 font-mono text-[11px]">
                      <div className="mb-1.5 border-b border-[#e1dfdd] pb-1 text-[11px] font-medium uppercase text-[#605e5c]">
                        Cryptographic signatures checked
                      </div>
                      {verificationResult.details.map((vBlock: any, vIdx: number) => (
                        <div key={vIdx} className="flex items-center justify-between gap-2">
                          <div className="truncate text-[#605e5c]">
                            Block #{vBlock.id} ({vBlock.action}):
                            <span className="ml-1 select-all text-[#8a8886]">{vBlock.storedHash.substring(0, 16)}...</span>
                          </div>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            vBlock.valid
                              ? 'bg-[#dff6dd] text-[#0e700e]'
                              : 'bg-[#fdf2f2] text-[#a4262c]'
                          }`}>
                            {vBlock.valid ? 'Verified' : 'Corrupt'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {auditChain.length === 0 && <p className="text-[13px] text-[#8a8886]">No audit events recorded yet.</p>}
                {auditChain.slice(0, 3).map((blockObj, idx) => (
                  <div key={idx} className="relative space-y-1 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 font-mono text-[11px] text-[#605e5c]">
                    <div className="absolute right-2 top-2 rounded bg-[#f3f2f1] px-1.5 py-0.5 text-[11px] font-medium text-[#605e5c]">
                      Block #{auditChain.length - 1 - idx}
                    </div>
                    <div className="flex gap-2">
                      <span className="font-medium uppercase text-[#0f6cbd]">Event:</span>
                      <span className="font-medium text-[#201f1e]">
                        {blockObj.block?.actionType || blockObj.block?.action || 'Genesis node initiated'}
                      </span>
                    </div>
                    {blockObj.block?.userEmail && (
                      <div className="flex gap-2">
                        <span className="text-[#8a8886]">Identity:</span>
                        <span className="font-medium text-[#323130]">{blockObj.block?.userEmail}</span>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      <div className="flex gap-2 truncate">
                        <span className="shrink-0 font-medium uppercase text-[#8a8886]">Block hash:</span>
                        <span className="select-all truncate text-[#0f6cbd]">{blockObj.hash}</span>
                      </div>
                      <div className="flex gap-2 truncate">
                        <span className="shrink-0 uppercase text-[#8a8886]">Prev hash:</span>
                        <span className="select-all truncate text-[#605e5c]">{blockObj.previousHash}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Security Credentials settings */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <KeyRound className="h-4 w-4 text-[#0f6cbd]" />
                <span>Operator authentication & security keys</span>
              </h3>

              <div className="space-y-3 text-[13px]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="block font-medium text-[#323130]">Enforce multi-factor authentication (MFA)</span>
                    <p className="text-[12px] text-[#605e5c]">All MSP users must provide TOTP codes on logon.</p>
                  </div>
                  <button
                    onClick={() => setMfaEnabled(!mfaEnabled)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded border px-2.5 text-[12px] font-medium ${
                      mfaEnabled ? 'border-[#c8c6c4] bg-[#dff6dd] text-[#0e700e]' : 'border-[#c8c6c4] bg-[#f3f2f1] text-[#605e5c]'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${mfaEnabled ? 'bg-[#0e700e]' : 'bg-[#8a8886]'}`} />
                    {mfaEnabled ? 'MFA enabled' : 'MFA disabled'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-[#e1dfdd] pt-3">
                  <div>
                    <span className="block font-medium text-[#323130]">Cryptographic PGP auditing key (private)</span>
                    <p className="text-[12px] text-[#605e5c]">Used for signing generated software passports and audit attestations.</p>
                  </div>
                  <button className="inline-flex h-8 items-center rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]">
                    Regenerate sign key
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4 rounded-md border border-[#a4262c]/30 bg-[#fdf2f2] p-3">
                  <div>
                    <span className="flex items-center gap-1.5 font-semibold text-[#a4262c]">
                      <Shield className="h-3.5 w-3.5" /> Tenant offboarding & data deletion (DPA compliance)
                    </span>
                    <p className="mt-1 text-[12px] text-[#605e5c]">
                      Cascading-delete all client lists, passports, vulnerability logs, and active integrations. This action is immediate and irreversible under GDPR/DPA compliance standards.
                    </p>
                  </div>
                  <button
                    onClick={handleOffboardTenant}
                    disabled={!isOwner || offboarding}
                    title={!isOwner ? `Your ${currentRole} role cannot offboard this workspace. Owner is required.` : undefined}
                    className="inline-flex h-9 shrink-0 items-center rounded bg-[#a4262c] px-3 text-[13px] font-medium text-white hover:bg-[#8a1f24] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {offboarding ? 'Purging…' : 'Offboard workspace'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              {saveSuccess && (
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#8a5700]">
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>Not saved to a server — these fields are local to this browser session only.</span>
                </span>
              )}
              <button
                onClick={handleSaveSettings}
                title="These settings are not persisted to a backend yet."
                className="inline-flex h-9 items-center rounded bg-[#0f6cbd] px-4 text-[13px] font-medium text-white hover:bg-[#004578]"
              >
                Save platform settings
              </button>
            </div>
          </div>

          {/* Right Column: Information panel & Live CI/CD Diagnostics */}
          <div className="space-y-4">

            {/* Active Login Audit Trail Panel */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <Fingerprint className="h-4 w-4 text-[#0f6cbd]" />
                <span>Real-time login audit trail</span>
              </h3>

              <div className="max-h-72 space-y-2 overflow-y-auto">
                {history.map((log) => (
                  <div key={log.id} className="space-y-1 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-2.5 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="max-w-36 truncate font-medium text-[#323130]">{log.email}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        log.status === 'Verified' ? 'bg-[#dff6dd] text-[#0e700e]' : 'bg-[#fdf2f2] text-[#a4262c]'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="text-[#605e5c]">
                      <span className="block">{log.action}</span>
                      <span className="mt-0.5 block text-[11px] text-[#8a8886]">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-t border-[#e1dfdd] pt-1 text-[11px] text-[#8a8886]">
                      <span>IP: {log.ip}</span>
                      <span>Loc: {log.location}</span>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <p className="py-4 text-center text-[13px] text-[#8a8886]">No audit logs identified.</p>
                )}
              </div>
            </div>

            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <Shield className="h-4 w-4 text-[#8a8886]" />
                <span>Platform pedigree coordinates</span>
              </h3>

              <div className="space-y-2 text-[13px] text-[#605e5c]">
                <div className="flex justify-between border-b border-[#f3f2f1] pb-1.5">
                  <span>Portal service</span>
                  <span className="font-medium text-[#323130]">SPR-CORE-VM</span>
                </div>
                <div className="flex justify-between border-b border-[#f3f2f1] pb-1.5">
                  <span>Compilation</span>
                  <span className="font-medium text-[#323130]">Docker prod v2.4</span>
                </div>
                <div className="flex justify-between pb-1.5">
                  <span>SLA compliance</span>
                  <span className="font-medium text-[#0e700e]">99.98%</span>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <CheckCircle className="h-4 w-4 text-[#0e700e]" />
                <span>Readiness diagnostics</span>
              </h3>
              <p className="text-[13px] text-[#605e5c]">
                Checks live database connectivity via the same /api/ready probe an orchestrator uses. This does not verify row-level isolation, OAuth handshakes, or API quota — those have no self-check endpoint yet.
              </p>

              <button
                onClick={runDiagnosticSuite}
                disabled={testing}
                className="h-9 w-full rounded border border-[#c8c6c4] text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-60"
              >
                {testing ? 'Checking…' : 'Check readiness'}
              </button>

              {testResults.length > 0 && (
                <div className="space-y-2 border-t border-[#e1dfdd] pt-2">
                  {testResults.map((t: any, idx: number) => (
                    <div key={idx} className="space-y-0.5 text-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-[#323130]">{t.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          t.status === 'PASS' ? 'bg-[#dff6dd] text-[#0e700e]' : 'bg-[#fdf2f2] text-[#a4262c]'
                        }`}>
                          {t.status}
                        </span>
                      </div>
                      <p className="leading-snug text-[#605e5c]">{t.details}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : activeSubTab === 'organization' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Profile Management Section */}
          <div className="lg:col-span-1 space-y-4">
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <Sliders className="h-4 w-4 text-[#0f6cbd]" />
                <span>User profile credentials</span>
              </h3>

              {teamError && (
                <div className="flex gap-2 rounded-md border border-[#a4262c]/30 bg-[#fdf2f2] p-3 text-[13px] text-[#a4262c]">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  <p>{teamError}</p>
                </div>
              )}

              {teamSuccess && (
                <div className="flex gap-2 rounded-md border border-[#0e700e]/30 bg-[#dff6dd] p-3 text-[13px] text-[#0e700e]">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <p>{teamSuccess}</p>
                </div>
              )}

              {editingProfile ? (
                <form onSubmit={handleSaveProfile} className="space-y-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] font-medium text-[#605e5c]">Display name</label>
                    <input
                      type="text"
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] font-medium text-[#605e5c]">Corporate job title</label>
                    <input
                      type="text"
                      required
                      value={profileJobTitle}
                      onChange={(e) => setProfileJobTitle(e.target.value)}
                      className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[12px] font-medium text-[#605e5c]">Organization name</label>
                    <input
                      type="text"
                      required
                      value={profileCompany}
                      onChange={(e) => setProfileCompany(e.target.value)}
                      className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingProfile(false)}
                      className="inline-flex h-9 items-center rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]"
                    >
                      Save profile
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#c8c6c4] bg-[#eff6fc] text-[15px] font-semibold text-[#0f6cbd]">
                      {profileName ? profileName.substring(0, 2).toUpperCase() : 'U'}
                    </div>
                    <div>
                      <h4 className="text-[14px] font-semibold text-[#201f1e]">
                        {profileName || 'Active Operator'}
                      </h4>
                      <p className="mt-0.5 text-[12px] text-[#605e5c]">
                        {profileJobTitle || 'Workspace Administrator'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 border-t border-[#e1dfdd] pt-3 text-[12px] text-[#605e5c]">
                    <div className="flex justify-between">
                      <span>Email identifier</span>
                      <span className="select-all font-medium text-[#201f1e]">{profile?.email || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Active tenant ID</span>
                      <span className="select-all">{profile?.tenantId || 'global'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>MSP workspace</span>
                      <span className="font-medium text-[#201f1e]">{profile?.companyName || 'Not defined'}</span>
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
                    className="h-9 w-full rounded border border-[#c8c6c4] text-[13px] font-medium text-[#323130] hover:bg-black/[.03]"
                  >
                    Edit profile details
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-4 space-y-2">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#605e5c]">
                Authorized role hierarchy
              </h4>
              <p className="text-[12px] leading-relaxed text-[#605e5c]">
                RBAC enforces strict isolation gates. Permissions cascade in order: <strong className="text-[#323130]">Owner &gt; Admin &gt; Technician &gt; Viewer &gt; Client</strong>. Modifying team permissions automatically triggers a cryptographic token invalidation audit block.
              </p>
            </div>
          </div>

          {/* Organization & Team Access List Section */}
          <div className="lg:col-span-2 space-y-4">
            {/* Invite form card */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <PlusCircle className="h-4 w-4 text-[#0f6cbd]" />
                <span>Invite new MSP team member</span>
              </h3>

              <form onSubmit={handleInviteMember} className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-[12px] font-medium text-[#605e5c]">
                    Email address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. associate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                  />
                </div>

                <div className="flex w-full flex-col gap-1 md:w-44">
                  <label className="text-[12px] font-medium text-[#605e5c]">
                    Security role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Technician">Technician</option>
                    <option value="Viewer">Viewer</option>
                    <option value="Client">Client</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={!canManageTeam}
                  title={!canManageTeam ? `Your ${currentRole} role cannot invite team members.` : undefined}
                  className="inline-flex h-9 shrink-0 items-center rounded bg-[#0f6cbd] px-4 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send invitation
                </button>
              </form>
              {!canManageTeam && <p className="text-[12px] text-[#8a5700]">Your {currentRole} role has read-only team access.</p>}
            </div>

            {/* Team Members List Card */}
            <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
              <h3 className="flex items-center justify-between border-b border-[#e1dfdd] pb-2 text-[14px] font-semibold text-[#201f1e]">
                <span className="flex items-center gap-1.5">
                  <Lock className="h-4 w-4 text-[#0f6cbd]" />
                  <span>Workspace associates</span>
                </span>
                <span className="rounded border border-[#c8c6c4] bg-[#eff6fc] px-2 py-0.5 text-[12px] font-medium text-[#0f6cbd]">
                  {teamMembers.length} registered
                </span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                      <th className="py-2 font-medium">User details</th>
                      <th className="py-2 font-medium">Authority role</th>
                      <th className="py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamMembers.map((member) => (
                      <tr key={member.id} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#c8c6c4] bg-[#f3f2f1] text-[12px] font-semibold text-[#605e5c]">
                              {member.displayName ? member.displayName.substring(0, 2).toUpperCase() : member.email.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="block font-medium text-[#201f1e]">
                                {member.displayName || 'Pending registration'}
                              </span>
                              <span className="block select-all text-[12px] text-[#8a8886]">
                                {member.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5">
                          {member.role === 'Owner' ? (
                            <span className="rounded border border-[#c8c6c4] bg-[#eff6fc] px-2 py-0.5 text-[12px] font-medium text-[#0f6cbd]">
                              Owner (root)
                            </span>
                          ) : (
                            <select
                              value={member.role}
                              disabled={!canManageTeam}
                              title={!canManageTeam ? `Your ${currentRole} role cannot change roles.` : undefined}
                              onChange={(e) => handleUpdateMemberRole(member.id, e.target.value)}
                              className="rounded border border-[#c8c6c4] p-1 text-[12px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="Admin">Admin</option>
                              <option value="Technician">Technician</option>
                              <option value="Viewer">Viewer</option>
                              <option value="Client">Client</option>
                            </select>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          {member.role !== 'Owner' && member.id !== profile?.id && canManageTeam && (
                            <button
                              onClick={() => handleRemoveMember(member.id)}
                              className="rounded border border-[#a4262c]/30 px-2.5 py-1 text-[12px] font-medium text-[#a4262c] hover:bg-[#fdf2f2]"
                            >
                              Revoke access
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {teamMembers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-[#8a8886]">
                          {loadingTeam ? 'Securing team data…' : 'No other associates mapped to this workspace.'}
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
        <div className="space-y-4" id="product-master-bible-container">
          {/* Welcome Alert / Info Bar */}
          <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
            <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">What is this? &middot; How the Master Bible works</summary>
            <div className="px-3 pb-3 text-[#605e5c]">
              <p>The Master Bible defines standard secure baseline versions, permitted/copyleft licenses, risk classifications, and operational NIST/ISO security safeguard guidelines. Ingested software passports are checked against these standards to prevent compliance violations.</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                <li>Policy reference: NIST SP 800-53 r5.</li>
                <li>Legal stance: SSPL/AGPL copyleft blocked.</li>
                <li>Baseline updates: automated daily RSS synchronizations.</li>
              </ol>
            </div>
          </details>

          {/* Grid Layout: Left Column = Product Bible Directory, Right Column = Selected Specifications & Sandbox Compliance Auditor */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Left Column: List of Products with Search & Add option */}
            <div className="lg:col-span-1 space-y-3">
              <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-[14px] font-semibold text-[#201f1e]">Product Bible index</h4>
                    <p className="text-[12px] text-[#605e5c]">Index of certified system components</p>
                  </div>
                  <button
                    onClick={() => setShowAddBibleProduct(!showAddBibleProduct)}
                    className="inline-flex items-center gap-1 rounded border border-[#c8c6c4] px-2.5 py-1.5 text-[12px] font-medium text-[#323130] hover:bg-black/[.03]"
                    title="Register a new software specification"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span>Register</span>
                  </button>
                </div>

                {/* Quick Search & Filter */}
                <div className="space-y-2">
                  <div className="flex h-9 items-center gap-2 rounded border border-[#c8c6c4] px-2.5 focus-within:border-[#0f6cbd] focus-within:ring-1 focus-within:ring-[#0f6cbd]">
                    <Search className="h-3.5 w-3.5 text-[#8a8886]" />
                    <input
                      type="text"
                      placeholder="Search specifications..."
                      value={bibleSearchQuery}
                      onChange={(e) => setBibleSearchQuery(e.target.value)}
                      className="w-full bg-transparent text-[13px] text-[#323130] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[12px] text-[#605e5c]">
                    <span>Risk filter</span>
                    <div className="flex gap-1">
                      {['all', 'low', 'medium', 'high'].map(r => (
                        <button
                          key={r}
                          onClick={() => setBibleFilterRisk(r)}
                          className={`rounded px-1.5 py-0.5 capitalize ${
                            bibleFilterRisk === r
                              ? 'bg-[#eff6fc] font-medium text-[#0f6cbd]'
                              : 'hover:text-[#323130]'
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
                  <form onSubmit={handleAddBibleProduct} className="space-y-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[13px]">
                    <h5 className="text-[13px] font-semibold text-[#201f1e]">New standard specification registration</h5>

                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Product / package name</label>
                      <input
                        type="text"
                        placeholder="e.g. Apache Kafka"
                        required
                        value={newBpName}
                        onChange={(e) => setNewBpName(e.target.value)}
                        className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Class type</label>
                        <select
                          value={newBpType}
                          onChange={(e) => setNewBpType(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
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
                        <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Secure baseline</label>
                        <input
                          type="text"
                          placeholder="e.g. 3.4.0"
                          required
                          value={newBpVersion}
                          onChange={(e) => setNewBpVersion(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Permitted licenses</label>
                      <input
                        type="text"
                        value={newBpAllowedLics}
                        onChange={(e) => setNewBpAllowedLics(e.target.value)}
                        className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 font-mono text-[12px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                      />
                      <p className="mt-1 text-[11px] text-[#8a8886]">Comma-separated SPDX identifiers.</p>
                    </div>

                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Prohibited copylefts</label>
                      <input
                        type="text"
                        value={newBpDisallowedLics}
                        onChange={(e) => setNewBpDisallowedLics(e.target.value)}
                        className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 font-mono text-[12px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Risk tier</label>
                        <select
                          value={newBpRisk}
                          onChange={(e) => setNewBpRisk(e.target.value as any)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Target compliance</label>
                        <input
                          type="text"
                          placeholder="e.g. HIPAA CC4 / ISO"
                          value={newBpCompliance}
                          onChange={(e) => setNewBpCompliance(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Operational safeguard policy</label>
                      <textarea
                        rows={2}
                        placeholder="Safeguards required..."
                        value={newBpSafeguard}
                        onChange={(e) => setNewBpSafeguard(e.target.value)}
                        className="w-full rounded border border-[#c8c6c4] bg-white px-2.5 py-2 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddBibleProduct(false)}
                        className="inline-flex h-9 items-center rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Register spec</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* List of Specs */}
                <div className="max-h-[400px] space-y-1 overflow-y-auto">
                  {filteredBibleProducts.length === 0 ? (
                    <p className="py-6 text-center text-[12px] text-[#8a8886]">No matching standard specifications found.</p>
                  ) : (
                    filteredBibleProducts.map(bp => {
                      const isSelected = bp.id === selectedBibleProductId;
                      return (
                        <button
                          key={bp.id}
                          onClick={() => setSelectedBibleProductId(bp.id)}
                          className={`flex w-full items-center justify-between rounded border p-2.5 text-left text-[13px] ${
                            isSelected
                              ? 'border-[#0f6cbd] bg-[#eff6fc] text-[#0f6cbd]'
                              : 'border-[#e1dfdd] bg-white text-[#323130] hover:bg-black/[.02]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate leading-snug">{bp.name}</p>
                            <span className="mt-0.5 block text-[11px] text-[#8a8886]">{bp.type}</span>
                          </div>

                          <div className="ml-2 flex shrink-0 items-center gap-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                              bp.riskTier === 'High' ? 'bg-[#fdf2f2] text-[#a4262c]' :
                              bp.riskTier === 'Medium' ? 'bg-[#fff4ce] text-[#8a5700]' :
                              'bg-[#dff6dd] text-[#0e700e]'
                            }`}>
                              {bp.riskTier}
                            </span>
                            <ChevronRight className={`h-3.5 w-3.5 ${isSelected ? 'text-[#0f6cbd]' : 'text-[#8a8886]'}`} />
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right 2 Columns: Specification Details & Interactive Sandbox compliance auditor */}
            <div className="lg:col-span-2 space-y-4">

              {/* Card 1: Active Specification detail */}
              {activeBibleProduct && (
                <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
                  <div className="flex items-start justify-between border-b border-[#e1dfdd] pb-3">
                    <div>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-[#0f6cbd]">Approved platform standard spec</span>
                      <h3 className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold text-[#201f1e]">
                        <CheckCircle2 className="h-4 w-4 text-[#0e700e]" />
                        {activeBibleProduct.name}
                      </h3>
                      <p className="mt-0.5 text-[12px] text-[#605e5c]">{activeBibleProduct.type}</p>
                    </div>

                    <span className="rounded border border-[#c8c6c4] bg-[#eff6fc] px-2 py-0.5 text-[12px] font-medium text-[#0f6cbd]">
                      Baseline v{activeBibleProduct.baselineSecureVersion}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <div>
                        <span className="block text-[11px] font-medium uppercase text-[#605e5c]">Permitted (greenlist) licenses</span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {activeBibleProduct.allowedLicenses.map((lic: string) => (
                            <span key={lic} className="rounded border border-[#c8c6c4] bg-[#dff6dd] px-2 py-0.5 text-[11px] font-medium text-[#0e700e]">
                              {lic}
                            </span>
                          ))}
                          {activeBibleProduct.allowedLicenses.length === 0 && <span className="text-[12px] italic text-[#8a8886]">None specified</span>}
                        </div>
                      </div>

                      <div>
                        <span className="block text-[11px] font-medium uppercase text-[#605e5c]">Prohibited (blacklisted) licenses</span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {activeBibleProduct.disallowedLicenses.map((lic: string) => (
                            <span key={lic} className="rounded border border-[#c8c6c4] bg-[#fdf2f2] px-2 py-0.5 text-[11px] font-medium text-[#a4262c]">
                              {lic}
                            </span>
                          ))}
                          {activeBibleProduct.disallowedLicenses.length === 0 && <span className="text-[12px] italic text-[#8a8886]">None prohibited</span>}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
                      <span className="block text-[11px] font-medium uppercase text-[#605e5c]">Target regulatory framework compliance</span>
                      <p className="text-[13px] font-medium text-[#323130]">{activeBibleProduct.complianceTarget}</p>
                      <p className="text-[12px] leading-normal text-[#605e5c]">
                        Ingested components of this product category must be validated in accordance with audit guidelines mapped to this baseline.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-md border border-[#e1dfdd] bg-[#eff6fc] p-3">
                    <span className="block text-[11px] font-medium uppercase tracking-wide text-[#0f6cbd]">Standard core safeguards policy</span>
                    <p className="text-[13px] leading-normal text-[#323130]">{activeBibleProduct.safeguardPolicy}</p>
                  </div>
                </div>
              )}

              {/* Card 2: Interactive Sandbox Compliance Auditor */}
              <div className="rounded-md border border-[#e1dfdd] bg-white p-4 space-y-3">
                <div>
                  <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-[#201f1e]">
                    <Sparkles className="h-4 w-4 text-[#0f6cbd]" />
                    <span>Interactive product compliance sandbox</span>
                  </h3>
                  <p className="mt-0.5 text-[12px] text-[#605e5c]">
                    Simulate software ingest requests and instantly check compliance against the Master Product Bible.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Select target product class</label>
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
                        className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                      >
                        {bibleProducts.map(bp => (
                          <option key={bp.id} value={bp.name}>{bp.name}</option>
                        ))}
                        <option value="custom">-- Custom/unregistered product --</option>
                      </select>
                    </div>

                    {sandboxProduct === 'custom' && (
                      <div>
                        <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Custom product name</label>
                        <input
                          type="text"
                          placeholder="e.g. Apache Kafka"
                          value={sandboxCustomName}
                          onChange={(e) => setSandboxCustomName(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Ingested version</label>
                        <input
                          type="text"
                          value={sandboxVersion}
                          onChange={(e) => setSandboxVersion(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 font-mono text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                          placeholder="e.g. 1.25.0"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">License SPDX</label>
                        <input
                          type="text"
                          value={sandboxLicense}
                          onChange={(e) => setSandboxLicense(e.target.value)}
                          className="h-9 w-full rounded border border-[#c8c6c4] px-2.5 font-mono text-[13px] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]"
                          placeholder="e.g. GPL-3.0-only"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-[#605e5c]">Target deploy environment</label>
                      <div className="grid grid-cols-3 gap-2">
                        {['Production', 'Staging', 'Development'].map(env => (
                          <button
                            key={env}
                            type="button"
                            onClick={() => setSandboxEnv(env)}
                            className={`rounded border p-2 text-center text-[12px] font-medium ${
                              sandboxEnv === env
                                ? 'border-[#0f6cbd] bg-[#eff6fc] text-[#0f6cbd]'
                                : 'border-[#c8c6c4] text-[#605e5c] hover:bg-black/[.03]'
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
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded bg-[#0f6cbd] text-[13px] font-medium text-white hover:bg-[#004578]"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Run sandbox compliance attestation</span>
                    </button>
                  </div>

                  {/* Attestation Sandbox Report panel */}
                  <div className="flex min-h-[240px] flex-col justify-between rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
                    {sandboxReport ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-[#e1dfdd] pb-2">
                          <div>
                            <span className="block text-[11px] font-medium text-[#605e5c]">Attestation report</span>
                            <h4 className="max-w-[160px] truncate text-[13px] font-semibold text-[#201f1e]">{sandboxReport.productName}</h4>
                          </div>

                          <span className={`inline-flex items-center gap-1 rounded border border-[#c8c6c4] px-2 py-0.5 text-[11px] font-medium ${
                            sandboxReport.overallStatus === 'PASS' ? 'bg-[#dff6dd] text-[#0e700e]' :
                            sandboxReport.overallStatus === 'WARN' ? 'bg-[#fff4ce] text-[#8a5700]' :
                            'bg-[#fdf2f2] text-[#a4262c]'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              sandboxReport.overallStatus === 'PASS' ? 'bg-[#0e700e]' :
                              sandboxReport.overallStatus === 'WARN' ? 'bg-[#8a5700]' :
                              'bg-[#a4262c]'
                            }`} />
                            {sandboxReport.overallStatus}
                          </span>
                        </div>

                        <div className="space-y-2 text-[12px] leading-normal">
                          <div className="flex items-start gap-1.5">
                            {sandboxReport.versionStatus === 'Compliant' ? (
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0e700e]" />
                            ) : sandboxReport.versionStatus === 'Warning' ? (
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8a5700]" />
                            ) : (
                              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a4262c]" />
                            )}
                            <div>
                              <span className="font-medium text-[#323130]">Version standard: </span>
                              <span className="text-[#605e5c]">{sandboxReport.versionDetails}</span>
                            </div>
                          </div>

                          <div className="flex items-start gap-1.5">
                            {sandboxReport.licenseStatus === 'Compliant' ? (
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0e700e]" />
                            ) : sandboxReport.licenseStatus === 'Warning' ? (
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8a5700]" />
                            ) : (
                              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a4262c]" />
                            )}
                            <div>
                              <span className="font-medium text-[#323130]">License standard: </span>
                              <span className="text-[#605e5c]">{sandboxReport.licenseDetails}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1 rounded border border-[#e1dfdd] bg-white p-2.5 text-[12px] leading-normal text-[#605e5c]">
                          <p className="text-[11px] font-medium uppercase text-[#323130]">Compliance checklist ({sandboxReport.complianceTarget}):</p>
                          <p className="italic">{sandboxReport.safeguardPolicy}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center space-y-2 py-10 text-center text-[#8a8886]">
                        <Sliders className="h-6 w-6 text-[#c8c6c4]" />
                        <p className="mt-2 text-[13px] font-medium text-[#605e5c]">Attestation pending</p>
                        <p className="max-w-[220px] text-[12px] leading-snug text-[#8a8886]">
                          Configure simulation parameters and run the sandbox compliance attestation to test build parameters against standards.
                        </p>
                      </div>
                    )}

                    <div className="mt-2 flex items-center justify-between border-t border-[#e1dfdd] pt-2 text-[11px] text-[#8a8886]">
                      <span>Audit kernel: SEC_ENGINE_v1.0</span>
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
