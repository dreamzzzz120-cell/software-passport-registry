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

  // Persistent white-label branding (migration 0030) -- set once, applied to
  // every future white-label report export instead of retyping it each time.
  const [brandingCompanyName, setBrandingCompanyName] = useState('');
  const [brandingColor, setBrandingColor] = useState('#3794ff');
  const [brandingLogoDataUrl, setBrandingLogoDataUrl] = useState<string | null>(null);
  const [brandingUpdatedAt, setBrandingUpdatedAt] = useState<string | null>(null);
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSuccess, setBrandingSuccess] = useState<string | null>(null);

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

  const fetchBranding = async () => {
    try {
      const res = await apiFetch('/api/organization/branding');
      if (res.ok) {
        const data = await res.json();
        setBrandingCompanyName(data.companyName || '');
        setBrandingColor(data.brandColor || '#3794ff');
        setBrandingLogoDataUrl(data.logoDataUrl || null);
        setBrandingUpdatedAt(data.updatedAt || null);
      }
    } catch (err) {
      console.error('Error fetching branding:', err);
    }
  };

  const handleBrandingLogoFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 220_000) { setBrandingError('Logo file is too large. Use an image under ~200KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') setBrandingLogoDataUrl(reader.result); };
    reader.readAsDataURL(file);
  };

  const handleSaveBranding = async () => {
    if (!canManageTeam) return;
    setSavingBranding(true);
    setBrandingError(null);
    setBrandingSuccess(null);
    try {
      const res = await apiFetch('/api/organization/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: brandingCompanyName.trim() || null,
          brandColor: brandingColor || null,
          logoDataUrl: brandingLogoDataUrl || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to save branding.');
      setBrandingUpdatedAt(data.updatedAt || null);
      setBrandingSuccess('Branding saved. Future white-label reports will use it automatically.');
    } catch (err) {
      setBrandingError(err instanceof Error ? err.message : 'Failed to save branding.');
    } finally {
      setSavingBranding(false);
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
    fetchBranding();
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
    <div className="space-y-6" id="msp-settings-view">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-[#3c3c3c] pb-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#9cdcfe]"><Sliders className="h-4 w-4" /> Platform configuration</div>
          <h1 className="mt-2 text-xl font-bold text-[#d4d4d4] flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#9cdcfe]" />
            <span>Platform Settings & Compliance Bible</span>
          </h1>
          <p className="text-xs text-[#9d9d9d] font-sans mt-1">
            Configure thresholds, SAML authentication gateways, operator sessions, and access the master product security Bible.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-Tab Selector */}
          <div className="flex bg-[#2d2d2d] p-1 rounded-md text-xs">
            <button
              type="button"
              onClick={() => setActiveSubTab('configurations')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'configurations'
                  ? 'bg-[#094771] text-white font-bold'
                  : 'text-[#9d9d9d] hover:text-[#d4d4d4] '
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
                  ? 'bg-[#094771] text-white font-bold'
                  : 'text-[#9d9d9d] hover:text-[#d4d4d4] '
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
                  ? 'bg-[#094771] text-white font-bold'
                  : 'text-[#9d9d9d] hover:text-[#d4d4d4] '
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Master Bible</span>
            </button>
          </div>

          <button
            onClick={fetchAuthDataLedgers}
            disabled={loadingLedgers}
            className="p-2 bg-[#2d2d2d] border border-[#3c3c3c] text-[#d4d4d4] rounded-md hover:bg-[#383838] transition flex items-center gap-1.5 text-xs font-mono cursor-pointer"
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
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5 pb-2 border-b border-[#3c3c3c]">
                <Sliders className="w-4.5 h-4.5 text-[#3794ff]" />
                <span>General Platform Parameters</span>
              </h3>

              <div className="space-y-3.5 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-[#d4d4d4]">Audit Trust SLA Target Threshold (Score)</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="range"
                      min="60"
                      max="98"
                      value={slaTarget}
                      onChange={(e) => setSlaTarget(Number(e.target.value))}
                      className="flex-1 bg-[#2d2d2d] h-1.5 rounded-full cursor-pointer accent-[#3794ff]"
                    />
                    <span className="font-mono font-bold text-[#3794ff] bg-[#094771] border border-[#3c3c3c] px-2 py-1 rounded">
                      {slaTarget}/100
                    </span>
                  </div>
                  <p className="text-[10px] text-[#6f6f6f] mt-0.5">Alerts are compiled if a software passport overall rating drops below this value.</p>
                </div>

                <div className="flex justify-between items-center border-t border-[#3c3c3c] pt-3">
                  <div>
                    <span className="font-semibold text-[#d4d4d4] block">Enable Automated Daily Recalculation Scans</span>
                    <p className="text-[10px] text-[#6f6f6f] leading-snug">Automatically scan active client software inventory on CVE database updates.</p>
                  </div>
                  <input
                    type="checkbox"
                    defaultChecked
                    className="w-4.5 h-4.5 text-[#3794ff] border-[#3c3c3c] rounded focus:ring-[#3794ff]"
                  />
                </div>
              </div>
            </div>

            {/* Theme & Interface Customization Card */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5 pb-2 border-b border-[#3c3c3c]">
                <Sun className="w-4.5 h-4.5 text-[#3794ff]" />
                <span>Theme & Interface Customization</span>
              </h3>

              <div className="space-y-4 text-xs">
                <div className="flex flex-col gap-1.5">
                  <span className="font-semibold text-[#d4d4d4]">Active Theme Preference</span>
                  <p className="text-[10px] text-[#6f6f6f] ">Choose between high-contrast light mode or a dark interface designed for operating centers.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => theme === 'dark' && onToggleTheme()}
                    className={`flex items-center justify-center gap-2.5 p-3 rounded-md border transition-all cursor-pointer ${
                      theme === 'light'
                        ? 'bg-[#094771] border-[#3c3c3c] text-[#3794ff] font-semibold shadow-sm'
                        : 'bg-[#2d2d2d] border-[#3c3c3c] text-[#9d9d9d] hover:text-[#d4d4d4] hover:bg-[#383838]'
                    }`}
                  >
                    <Sun className="w-4 h-4 text-[#cca700]" />
                    <span>Light Mode</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => theme === 'light' && onToggleTheme()}
                    className={`flex items-center justify-center gap-2.5 p-3 rounded-md border transition-all cursor-pointer ${
                      theme === 'dark'
                        ? 'bg-[#094771] border-[#3c3c3c] text-[#3794ff] font-semibold shadow-inner'
                        : 'bg-[#2d2d2d] hover:bg-[#383838] border-[#3c3c3c] text-[#9d9d9d] hover:text-[#d4d4d4]'
                    }`}
                  >
                    <Moon className="w-4 h-4 text-[#3794ff]" />
                    <span>Dark Mode</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SAML SSO Configuration Card */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5 pb-2 border-b border-[#3c3c3c]">
                <Globe className="w-4.5 h-4.5 text-[#3794ff]" />
                <span>Enterprise SAML / SSO Integration Configuration</span>
              </h3>

              <div className="space-y-4 text-xs">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-[#d4d4d4] block">SAML SSO Access Gate</span>
                    <p className="text-[10px] text-[#6f6f6f] leading-snug">Redirect unauthenticated corporate domains to the unified Identity Provider (IdP).</p>
                  </div>
                  <button
                    onClick={() => setSsoEnabled(!ssoEnabled)}
                    className={`px-3 py-1 text-xs font-bold rounded-md border cursor-pointer transition-colors ${
                      ssoEnabled ? 'bg-[#2d2d2d] border-[#3c3c3c] text-[#89d185]' : 'bg-[#2d2d2d] border-[#3c3c3c] text-[#9d9d9d]'
                    }`}
                  >
                    {ssoEnabled ? 'SSO Active' : 'SSO Inactive'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-[10px] font-mono font-bold text-[#6f6f6f] uppercase mb-1">Corporate Identity Provider</label>
                    <input
                      type="text"
                      value={ssoProvider}
                      onChange={(e) => setSsoProvider(e.target.value)}
                      className="w-full rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono font-bold text-[#6f6f6f] uppercase mb-1">Client ID / Issuer URL</label>
                    <input
                      type="text"
                      value={ssoClientId}
                      onChange={(e) => setSsoClientId(e.target.value)}
                      className="w-full rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d] font-mono"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-mono font-bold text-[#6f6f6f] uppercase mb-1">SAML 2.0 Metadata XML Endpoint URL</label>
                    <input
                      type="text"
                      value={ssoMetadataUrl}
                      onChange={(e) => setSsoMetadataUrl(e.target.value)}
                      className="w-full rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d] font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Active Sessions Monitoring Ledger */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center justify-between pb-2 border-b border-[#3c3c3c]">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-4.5 h-4.5 text-[#3794ff]" />
                  <span>Active Operator Sessions Ledger</span>
                </span>
                <span className="font-mono text-[10px] text-[#3794ff] bg-[#094771] px-2 py-0.5 rounded border border-[#3c3c3c]">
                  {sessions.length} Active Node{sessions.length !== 1 ? 's' : ''}
                </span>
              </h3>

              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#3c3c3c] text-[#6f6f6f] font-mono text-[10px] uppercase">
                      <th className="py-2">User / Identity</th>
                      <th className="py-2">IP Address</th>
                      <th className="py-2">Device & Location</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#3c3c3c] font-sans">
                    {sessions.map((sess) => (
                      <tr key={sess.id} className="hover:bg-[#383838]">
                        <td className="py-3 pr-2 font-semibold text-[#d4d4d4]">
                          {sess.email}
                          {sess.current && (
                            <span className="ml-2 font-mono text-[8px] bg-[#2d2d2d] text-[#89d185] border border-[#3c3c3c] px-1.5 py-0.2 rounded font-bold uppercase">
                              Current Node
                            </span>
                          )}
                        </td>
                        <td className="py-3 font-mono text-[#9d9d9d]">{sess.ip}</td>
                        <td className="py-3 text-[#9d9d9d] leading-normal">
                          <span className="block">{sess.device}</span>
                          <span className="text-[10px] text-[#6f6f6f]">{sess.location}</span>
                        </td>
                        <td className="py-3 text-right">
                          {!sess.current && (
                            <button
                              onClick={() => handleRevokeSession(sess.id)}
                              className="p-1.5 text-[#f14c4c] hover:bg-[#383838] rounded-lg cursor-pointer transition"
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
                        <td colSpan={4} className="py-4 text-center text-[#6f6f6f] font-mono">
                          No active sessions identified in memory.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cryptographically Chained Audit Ledger visualization */}
            <div className="spr-panel p-5 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[#3c3c3c]">
                <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5">
                  <FileCode className="w-4.5 h-4.5 text-[#3794ff]" />
                  <span>Cryptographic Blockchain Audit Ledger</span>
                </h3>
                <span className="font-mono text-[10px] text-[#89d185] bg-[#2d2d2d] px-2 py-0.5 rounded border border-[#3c3c3c] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#89d185] animate-pulse" />
                  Tamper-Proof SLA verified
                </span>
              </div>
              
              <p className="text-[10px] text-[#6f6f6f] font-sans leading-relaxed">
                Every critical login event and administrative action is recorded into a secure hash chain. Each block references the SHA-256 hash of its predecessor, creating a mathematically unalterable audit trail.
              </p>

              {/* Integrity Scanner Trigger */}
              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleVerifyLedger}
                  disabled={verifyingLedger}
                  className="flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-[#0e639c] hover:bg-[#1177bb] disabled:bg-[#2d2d2d] rounded-lg shadow-sm cursor-pointer transition-all shrink-0"
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
                    className="text-[10px] font-sans font-semibold text-[#9d9d9d] hover:text-[#d4d4d4] px-3 py-2 bg-[#2d2d2d] hover:bg-[#383838] rounded-lg cursor-pointer transition-colors"
                  >
                    Clear Audit Report
                  </button>
                )}
              </div>

              {/* Dynamic Verification Report */}
              {verificationResult && (
                <div className={`p-4 rounded-md border font-sans text-xs ${
                  verificationResult.isValid 
                    ? 'bg-[#2d2d2d] border-[#3c3c3c] text-[#89d185]'
                    : 'bg-[#2d2d2d] border-[#3c3c3c] text-[#f14c4c]'
                } space-y-2.5 transition-all duration-300`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                      {verificationResult.isValid ? (
                        <CheckCircle2 className="w-4.5 h-4.5 text-[#89d185] shrink-0" />
                      ) : (
                        <AlertCircle className="w-4.5 h-4.5 text-[#f14c4c] shrink-0" />
                      )}
                      <span>LEDGER ATTESTATION REPORT</span>
                    </span>
                    <span className="font-mono text-[9px] text-[#6f6f6f] ">
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
                    <div className="bg-[#2d2d2d] p-2.5 rounded-lg max-h-40 overflow-y-auto font-mono text-[9px] space-y-1.5 border border-[#3c3c3c]">
                      <div className="font-sans font-bold text-[8px] text-[#6f6f6f] border-b border-[#3c3c3c] pb-1 mb-1.5 uppercase">
                        Cryptographic Signatures Checked
                      </div>
                      {verificationResult.details.map((vBlock: any, vIdx: number) => (
                        <div key={vIdx} className="flex justify-between items-center gap-2">
                          <div className="truncate text-[#9d9d9d]">
                            Block #{vBlock.id} ({vBlock.action}): 
                            <span className="ml-1 text-[#6f6f6f] select-all">{vBlock.storedHash.substring(0, 16)}...</span>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] uppercase font-bold shrink-0 ${
                            vBlock.valid 
                              ? 'bg-[#2d2d2d] text-[#89d185]'
                              : 'bg-[#2d2d2d] text-[#f14c4c]'
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
                {auditChain.length === 0 && <p className="text-[#6f6f6f] font-sans">No audit events recorded yet.</p>}
                {auditChain.slice(0, 3).map((blockObj, idx) => (
                  <div key={idx} className="p-3 bg-[#2d2d2d] rounded-md border border-[#3c3c3c] space-y-1 text-[#9d9d9d] relative overflow-hidden">
                    <div className="absolute right-2 top-2 text-[8px] bg-[#2d2d2d] text-[#9d9d9d] px-1.5 py-0.5 rounded uppercase font-bold">
                      Block #{auditChain.length - 1 - idx}
                    </div>
                    <div className="flex gap-2">
                      <span className="text-[#3794ff] font-bold uppercase">EVENT:</span>
                      <span className="text-[#d4d4d4] font-bold">
                        {blockObj.block?.actionType || blockObj.block?.action || 'Genesis Node Initiated'}
                      </span>
                    </div>
                    {blockObj.block?.userEmail && (
                      <div className="flex gap-2">
                        <span className="text-[#6f6f6f]">IDENTITY:</span>
                        <span className="text-[#d4d4d4] font-semibold">{blockObj.block?.userEmail}</span>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      <div className="flex gap-2 text-[9px] truncate">
                        <span className="text-[#6f6f6f] uppercase font-bold shrink-0">BLOCK HASH:</span>
                        <span className="text-[#3794ff] select-all font-mono truncate">{blockObj.hash}</span>
                      </div>
                      <div className="flex gap-2 text-[9px] truncate">
                        <span className="text-[#6f6f6f] uppercase shrink-0">PREV HASH:</span>
                        <span className="text-[#9d9d9d] select-all font-mono truncate">{blockObj.previousHash}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Security Credentials settings */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5 pb-2 border-b border-[#3c3c3c]">
                <KeyRound className="w-4.5 h-4.5 text-[#3794ff]" />
                <span>Operator Authentication & Security Keys</span>
              </h3>

              <div className="space-y-3.5 text-xs">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-[#d4d4d4] block">Enforce Multi-Factor Authentication (MFA)</span>
                    <p className="text-[10px] text-[#6f6f6f] leading-snug">All MSP users must provide TOTP codes on logon.</p>
                  </div>
                  <button
                    onClick={() => setMfaEnabled(!mfaEnabled)}
                    className={`px-3 py-1 text-xs font-bold rounded-md border cursor-pointer transition-colors ${
                      mfaEnabled ? 'bg-[#2d2d2d] border-[#3c3c3c] text-[#89d185]' : 'bg-[#2d2d2d] border-[#3c3c3c] text-[#9d9d9d]'
                    }`}
                  >
                    {mfaEnabled ? 'MFA Enabled' : 'MFA Disabled'}
                  </button>
                </div>

                <div className="flex justify-between items-center border-t border-[#3c3c3c] pt-3">
                  <div>
                    <span className="font-semibold text-[#d4d4d4] block">Cryptographic PGP Auditing Key (Private)</span>
                    <p className="text-[10px] text-[#6f6f6f] ">Used for signing generated software passports and audit attestations.</p>
                  </div>
                  <button className="bg-[#2d2d2d] hover:bg-[#383838] text-white font-sans font-semibold text-xs px-3.5 py-1.8 rounded-lg cursor-pointer transition-colors">
                    Regenerate Sign Key
                  </button>
                </div>

                <div className="flex justify-between items-center border-t border-[#3c3c3c] pt-4 mt-2 bg-[#2d2d2d] p-3.5 rounded-lg border border-dashed border-[#3c3c3c]">
                  <div>
                    <span className="font-bold text-[#f14c4c] block flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-[#f14c4c]" /> Tenant Offboarding & Data Deletion (DPA Compliance)
                    </span>
                    <p className="text-[10px] text-[#9d9d9d] leading-snug mt-1">
                      Cascading-delete all client lists, passports, vulnerability logs, and active integrations. This action is immediate and completely irreversible under GDPR/DPA compliance standards.
                    </p>
                  </div>
                  <button
                    onClick={handleOffboardTenant}
                    disabled={!isOwner || offboarding}
                    title={!isOwner ? `Your ${currentRole} role cannot offboard this workspace. Owner is required.` : undefined}
                    className="bg-[#f14c4c] hover:bg-[#e04343] text-white font-sans font-bold text-xs px-4 py-2.5 rounded-lg cursor-pointer transition-colors shadow-sm disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
                  >
                    {offboarding ? 'Purging Context...' : 'Offboard Workspace'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {saveSuccess && (
                <span className="text-xs text-[#cca700] font-semibold flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" />
                  <span>Not saved to a server — these fields are local to this browser session only.</span>
                </span>
              )}
              <button
                onClick={handleSaveSettings}
                title="These settings are not persisted to a backend yet."
                className="px-4 py-2 bg-[#0e639c] hover:bg-[#1177bb] text-white font-sans font-semibold text-xs rounded-lg shadow-sm cursor-pointer transition-all"
              >
                Save Platform Settings
              </button>
            </div>
          </div>

          {/* Right Column: Information panel & Live CI/CD Diagnostics */}
          <div className="space-y-6">
            
            {/* Active Login Audit Trail Panel */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5 pb-2 border-b border-[#3c3c3c]">
                <Fingerprint className="w-4.5 h-4.5 text-[#3794ff]" />
                <span>Real-time Login Audit Trail</span>
              </h3>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {history.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[10px] space-y-1 text-left">
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-[#d4d4d4] truncate max-w-36">{log.email}</span>
                      <span className={`font-mono text-[8px] font-bold px-1.5 py-0.2 rounded ${
                        log.status === 'Verified' ? 'bg-[#2d2d2d] text-[#89d185] ' : 'bg-[#2d2d2d] text-[#f14c4c]'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="text-[#9d9d9d]">
                      <span className="block font-medium">{log.action}</span>
                      <span className="block text-[9px] font-mono mt-0.5">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between font-mono text-[9px] text-[#6f6f6f] border-t border-[#3c3c3c] pt-1 mt-1">
                      <span>IP: {log.ip}</span>
                      <span>Loc: {log.location}</span>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <p className="text-center font-mono text-[#6f6f6f] py-4">No audit logs identified.</p>
                )}
              </div>
            </div>

            <div className="spr-panel p-5 space-y-4 h-fit">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5 pb-2 border-b border-[#3c3c3c]">
                <Shield className="w-4.5 h-4.5 text-[#6f6f6f] " />
                <span>Platform Pedigree Coordinates</span>
              </h3>

              <div className="text-xs space-y-2.5 font-mono text-[#6f6f6f] ">
                <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                  <span>PORTAL SERVICE:</span>
                  <span className="font-bold text-[#d4d4d4]">SPR-CORE-VM</span>
                </div>
                <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                  <span>COMPILATION:</span>
                  <span className="font-bold text-[#d4d4d4]">DOCKER PROD v2.4</span>
                </div>
                <div className="flex justify-between border-b border-[#3c3c3c] pb-1.5">
                  <span>SLA COMPLIANCE:</span>
                  <span className="font-bold text-[#89d185]">99.98%</span>
                </div>
              </div>
            </div>

            <div className="spr-panel p-5 space-y-4 h-fit">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5 pb-2 border-b border-[#3c3c3c]">
                <CheckCircle className="w-4.5 h-4.5 text-[#89d185]" />
                <span>Readiness Diagnostics</span>
              </h3>
              <p className="text-[10px] text-[#6f6f6f] font-sans leading-relaxed">
                Checks live database connectivity via the same /api/ready probe an orchestrator uses. This does not verify row-level isolation, OAuth handshakes, or API quota — those have no self-check endpoint yet.
              </p>

              <button
                onClick={runDiagnosticSuite}
                disabled={testing}
                className="w-full py-2 bg-[#2d2d2d] hover:bg-[#383838] text-white font-sans font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                {testing ? 'Checking…' : 'Check Readiness'}
              </button>

              {testResults.length > 0 && (
                <div className="space-y-2.5 pt-2.5 border-t border-[#3c3c3c]">
                  {testResults.map((t: any, idx: number) => (
                    <div key={idx} className="text-[10px] space-y-0.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-[#d4d4d4]">{t.name}</span>
                        <span className={`font-mono font-bold px-1.5 py-0.2 rounded text-[8px] ${
                          t.status === 'PASS' ? 'bg-[#2d2d2d] text-[#89d185] ' : 'bg-[#2d2d2d] text-[#f14c4c]'
                        }`}>
                          {t.status}
                        </span>
                      </div>
                      <p className="text-[#6f6f6f] font-sans leading-snug">{t.details}</p>
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
            <div className="spr-panel p-5 space-y-4 text-left">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-2 pb-2 border-b border-[#3c3c3c]">
                <Sliders className="w-4.5 h-4.5 text-[#3794ff]" />
                <span>User Profile Credentials</span>
              </h3>

              {teamError && (
                <div className="p-3 bg-[#2d2d2d] text-[#f14c4c] border border-[#3c3c3c] rounded-md flex gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <p>{teamError}</p>
                </div>
              )}

              {teamSuccess && (
                <div className="p-3 bg-[#2d2d2d] text-[#89d185] border border-[#3c3c3c] rounded-md flex gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <p>{teamSuccess}</p>
                </div>
              )}

              {editingProfile ? (
                <form onSubmit={handleSaveProfile} className="space-y-3.5">
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[#9d9d9d]">Display Name</label>
                    <input
                      type="text"
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[#9d9d9d]">Corporate Job Title</label>
                    <input
                      type="text"
                      required
                      value={profileJobTitle}
                      onChange={(e) => setProfileJobTitle(e.target.value)}
                      className="rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[#9d9d9d]">Organization Name</label>
                    <input
                      type="text"
                      required
                      value={profileCompany}
                      onChange={(e) => setProfileCompany(e.target.value)}
                      className="rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d]"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingProfile(false)}
                      className="px-3 py-1.5 border border-[#3c3c3c] rounded-lg text-[#9d9d9d] hover:bg-[#383838] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-[#0e639c] text-white font-bold rounded-lg hover:bg-[#1177bb] cursor-pointer"
                    >
                      Save Profile
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-md bg-[#094771] text-[#3794ff] font-bold flex items-center justify-center text-lg border border-[#3c3c3c]">
                      {profileName ? profileName.substring(0, 2).toUpperCase() : 'U'}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[#d4d4d4]">
                        {profileName || 'Active Operator'}
                      </h4>
                      <p className="text-[10px] font-semibold text-[#3794ff] font-mono mt-0.5">
                        {profileJobTitle || 'Workspace Administrator'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-[#3c3c3c] pt-3 text-[11px] leading-normal text-[#9d9d9d]">
                    <div className="flex justify-between">
                      <span className="text-[#6f6f6f]">Email Identifier:</span>
                      <span className="font-mono font-bold text-[#d4d4d4] select-all">{profile?.email || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6f6f6f]">Active Tenant ID:</span>
                      <span className="font-mono text-[#9d9d9d] select-all">{profile?.tenantId || 'global'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6f6f6f]">MSP Workspace:</span>
                      <span className="font-bold text-[#d4d4d4]">{profile?.companyName || 'Not Defined'}</span>
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
                    className="w-full py-2 border border-[#3c3c3c] text-[#3794ff] font-semibold rounded-lg hover:bg-[#383838] cursor-pointer transition text-center"
                  >
                    Edit Profile Details
                  </button>
                </div>
              )}
            </div>

            <div className="spr-panel p-5 space-y-3.5 text-left text-[#6f6f6f]">
              <h4 className="text-[10px] font-mono font-bold uppercase text-[#9d9d9d] tracking-wider">
                Authorized Role Hierarchy
              </h4>
              <p className="text-[10px] leading-relaxed">
                RBAC enforces strict isolation gates. Permissions cascade in order: <strong>Owner &gt; Admin &gt; Technician &gt; Viewer &gt; Client</strong>. Modifying team permissions automatically triggers a cryptographic token invalidation audit block.
              </p>
            </div>

            {/* Persistent white-label branding */}
            <div className="spr-panel p-5 space-y-4 text-left">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-2 pb-2 border-b border-[#3c3c3c]">
                <FileText className="w-4.5 h-4.5 text-[#3794ff]" />
                <span>White-label Branding</span>
              </h3>
              <p className="text-[10px] leading-relaxed text-[#9d9d9d]">
                Set once here; the Reports page's white-label export uses this automatically instead of asking you to retype it every time. This only changes report packaging — it never changes any score or evidence.
              </p>

              {brandingError && (
                <div className="p-3 bg-[#2d2d2d] text-[#f14c4c] border border-[#3c3c3c] rounded-md flex gap-2 text-[11px]">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <p>{brandingError}</p>
                </div>
              )}
              {brandingSuccess && (
                <div className="p-3 bg-[#2d2d2d] text-[#89d185] border border-[#3c3c3c] rounded-md flex gap-2 text-[11px]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <p>{brandingSuccess}</p>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-[#9d9d9d] text-[11px]">Company / MSP name</label>
                <input
                  type="text"
                  value={brandingCompanyName}
                  onChange={(e) => setBrandingCompanyName(e.target.value)}
                  disabled={!canManageTeam}
                  placeholder="Your MSP name"
                  className="rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d] text-xs disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-[#9d9d9d] text-[11px]">Brand color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandingColor}
                    onChange={(e) => setBrandingColor(e.target.value)}
                    disabled={!canManageTeam}
                    className="h-9 w-14 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] disabled:opacity-50"
                  />
                  <span className="font-mono text-[11px] text-[#9d9d9d]">{brandingColor}</span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-[#9d9d9d] text-[11px]">Logo (under ~200KB)</label>
                {brandingLogoDataUrl && (
                  <div className="mb-1 flex items-center gap-2">
                    <img src={brandingLogoDataUrl} alt="Logo preview" className="h-10 w-auto rounded border border-[#3c3c3c] bg-white p-1" />
                    {canManageTeam && (
                      <button type="button" onClick={() => setBrandingLogoDataUrl(null)} className="text-[10px] text-[#f14c4c] hover:underline">Remove</button>
                    )}
                  </div>
                )}
                {canManageTeam && (
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={(e) => handleBrandingLogoFile(e.target.files?.[0] || null)}
                    className="text-[10px] text-[#9d9d9d] file:mr-2 file:rounded-md file:border file:border-[#3c3c3c] file:bg-[#2d2d2d] file:px-2.5 file:py-1.5 file:text-[10px] file:text-[#d4d4d4]"
                  />
                )}
              </div>

              {canManageTeam ? (
                <button
                  type="button"
                  onClick={handleSaveBranding}
                  disabled={savingBranding}
                  className="w-full py-2 bg-[#0e639c] hover:bg-[#1177bb] text-white font-sans font-bold text-xs rounded-lg cursor-pointer transition-colors disabled:opacity-50"
                >
                  {savingBranding ? 'Saving…' : 'Save branding'}
                </button>
              ) : (
                <p className="text-[10px] text-[#6f6f6f]">Only Owner/Admin can change branding.</p>
              )}
              {brandingUpdatedAt && <p className="text-[9px] text-[#6f6f6f]">Last updated {new Date(brandingUpdatedAt).toLocaleString()}</p>}
            </div>
          </div>

          {/* Organization & Team Access List Section */}
          <div className="lg:col-span-2 space-y-6 text-left">
            {/* Invite form card */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-2 pb-2 border-b border-[#3c3c3c]">
                <PlusCircle className="w-4.5 h-4.5 text-[#3794ff]" />
                <span>Invite New MSP Team Member</span>
              </h3>

              <form onSubmit={handleInviteMember} className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="block text-[10px] font-mono font-bold text-[#6f6f6f] uppercase">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. associate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d]"
                  />
                </div>

                <div className="w-full md:w-44 flex flex-col gap-1">
                  <label className="block text-[10px] font-mono font-bold text-[#6f6f6f] uppercase">
                    Security Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d] cursor-pointer font-semibold text-[#d4d4d4]"
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
                  className="mt-5 md:mt-4 bg-[#0e639c] hover:bg-[#1177bb] text-white font-bold px-5 py-2.5 rounded-md shrink-0 transition shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send Invitation
                </button>
              </form>
              {!canManageTeam && <p className="text-[10px] text-[#cca700]">Your {currentRole} role has read-only team access.</p>}
            </div>

            {/* Team Members List Card */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center justify-between pb-2 border-b border-[#3c3c3c]">
                <span className="flex items-center gap-2">
                  <Lock className="w-4.5 h-4.5 text-[#3794ff]" />
                  <span>Workspace Associates Matrix</span>
                </span>
                <span className="font-mono text-[9px] text-[#3794ff] bg-[#094771] px-2 py-0.5 rounded border border-[#3c3c3c]">
                  {teamMembers.length} Registered Nodes
                </span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#3c3c3c] text-[#6f6f6f] font-mono text-[10px] uppercase">
                      <th className="py-2.5">User Details</th>
                      <th className="py-2.5">Authority Role</th>
                      <th className="py-2.5 text-right">Administrative Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#3c3c3c]">
                    {teamMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-[#383838]">
                        <td className="py-3.5 pr-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-md bg-[#2d2d2d] text-[#9d9d9d] font-bold flex items-center justify-center text-xs shrink-0 border border-[#3c3c3c]">
                              {member.displayName ? member.displayName.substring(0, 2).toUpperCase() : member.email.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-bold text-[#d4d4d4] block">
                                {member.displayName || 'Pending Associate Registration'}
                              </span>
                              <span className="text-[10px] font-mono text-[#6f6f6f] select-all block">
                                {member.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5">
                          {member.role === 'Owner' ? (
                            <span className="font-mono text-[9px] font-bold bg-[#0e639c] text-[#3794ff] border border-[#3794ff] px-2 py-0.5 rounded uppercase">
                              Owner (Root)
                            </span>
                          ) : (
                            <select
                              value={member.role}
                              disabled={!canManageTeam}
                              title={!canManageTeam ? `Your ${currentRole} role cannot change roles.` : undefined}
                              onChange={(e) => handleUpdateMemberRole(member.id, e.target.value)}
                              className="bg-transparent border border-[#3c3c3c] rounded p-1 font-mono text-[10px] font-bold cursor-pointer text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="Admin">Admin</option>
                              <option value="Technician">Technician</option>
                              <option value="Viewer">Viewer</option>
                              <option value="Client">Client</option>
                            </select>
                          )}
                        </td>
                        <td className="py-3.5 text-right">
                          {member.role !== 'Owner' && member.id !== profile?.id && canManageTeam && (
                            <button
                              onClick={() => handleRemoveMember(member.id)}
                              className="px-2.5 py-1.5 text-[10px] font-bold text-[#f14c4c] border border-[#3c3c3c] hover:bg-[#383838] rounded-lg cursor-pointer transition-colors"
                            >
                              Revoke Access
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {teamMembers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-[#6f6f6f] font-mono">
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
          <div className="spr-panel p-5">
            <div className="flex items-start gap-4">
              <div className="p-2.5 bg-[#0e639c] rounded-md text-white">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-[#3794ff]">Enterprise Platform Master Product Bible</h3>
                <p className="text-xs text-[#3794ff] font-sans leading-relaxed">
                  This Bible defines standard secure baseline versions, permitted/copyleft licenses, risk classifications, and operational NIST/ISO security safeguard guidelines. Ingested Software Passports must be checked against these standards to prevent compliance violations.
                </p>
                <div className="flex gap-4 pt-2 text-[10px] font-semibold text-[#3794ff]">
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
              <div className="spr-panel p-5 space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-bold text-[#d4d4d4]">Product Bible Index</h4>
                    <p className="text-[10px] text-[#6f6f6f] font-sans">Index of certified system components</p>
                  </div>
                  <button
                    onClick={() => setShowAddBibleProduct(!showAddBibleProduct)}
                    className="p-1.5 text-[#3794ff] hover:bg-[#383838] rounded-lg cursor-pointer transition flex items-center gap-1 text-[11px] font-bold"
                    title="Register a new software specification"
                  >
                    <PlusCircle className="w-4.5 h-4.5" />
                    <span>Register</span>
                  </button>
                </div>

                {/* Quick Search & Filter */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 bg-[#2d2d2d] px-3 py-2 rounded-lg border border-[#3c3c3c]">
                    <Search className="w-4 h-4 text-[#6f6f6f]" />
                    <input
                      type="text"
                      placeholder="Search specifications..."
                      value={bibleSearchQuery}
                      onChange={(e) => setBibleSearchQuery(e.target.value)}
                      className="w-full bg-transparent focus:outline-none text-[#d4d4d4] "
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#9d9d9d] pt-1">
                    <span>Risk Filter:</span>
                    <div className="flex gap-1.5 font-semibold">
                      {['all', 'low', 'medium', 'high'].map(r => (
                        <button
                          key={r}
                          onClick={() => setBibleFilterRisk(r)}
                          className={`px-1.5 py-0.5 rounded capitalize cursor-pointer transition ${
                            bibleFilterRisk === r
                              ? 'bg-[#094771] text-[#3794ff] font-bold'
                              : 'hover:text-[#d4d4d4]'
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
                  <form onSubmit={handleAddBibleProduct} className="p-4 bg-[#2d2d2d] rounded-md border border-[#3c3c3c] text-xs space-y-3">
                    <h5 className="font-bold text-[#d4d4d4]">New Standard Specifications Registration</h5>
                    
                    <div>
                      <label className="block text-[10px] text-[#6f6f6f] uppercase font-bold font-mono mb-1">Product / Package Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Apache Kafka"
                        required
                        value={newBpName}
                        onChange={(e) => setNewBpName(e.target.value)}
                        className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-[#6f6f6f] uppercase font-bold font-mono mb-1">Class Type</label>
                        <select
                          value={newBpType}
                          onChange={(e) => setNewBpType(e.target.value)}
                          className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-1.5"
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
                        <label className="block text-[10px] text-[#6f6f6f] uppercase font-bold font-mono mb-1">Secure Baseline</label>
                        <input
                          type="text"
                          placeholder="e.g. 3.4.0"
                          required
                          value={newBpVersion}
                          onChange={(e) => setNewBpVersion(e.target.value)}
                          className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-1.5"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-[#6f6f6f] uppercase font-bold font-mono mb-1">Permitted Licenses</label>
                      <input
                        type="text"
                        value={newBpAllowedLics}
                        onChange={(e) => setNewBpAllowedLics(e.target.value)}
                        className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2 font-mono text-[10px]"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-[#6f6f6f] uppercase font-bold font-mono mb-1">Prohibited Copylefts</label>
                      <input
                        type="text"
                        value={newBpDisallowedLics}
                        onChange={(e) => setNewBpDisallowedLics(e.target.value)}
                        className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2 font-mono text-[10px]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-[#6f6f6f] uppercase font-bold font-mono mb-1">Risk Tier</label>
                        <select
                          value={newBpRisk}
                          onChange={(e) => setNewBpRisk(e.target.value as any)}
                          className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-1.5"
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-[#6f6f6f] uppercase font-bold font-mono mb-1">Target Compliance</label>
                        <input
                          type="text"
                          placeholder="e.g. HIPAA CC4 / ISO"
                          value={newBpCompliance}
                          onChange={(e) => setNewBpCompliance(e.target.value)}
                          className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-1.5"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-[#6f6f6f] uppercase font-bold font-mono mb-1">Operational Safeguard Policy</label>
                      <textarea
                        rows={2}
                        placeholder="Safeguards required..."
                        value={newBpSafeguard}
                        onChange={(e) => setNewBpSafeguard(e.target.value)}
                        className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2"
                      />
                    </div>

                    <div className="flex gap-2 justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddBibleProduct(false)}
                        className="px-2.5 py-1.5 bg-[#2d2d2d] border border-[#3c3c3c] hover:bg-[#383838] text-[#9d9d9d] rounded font-bold transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded font-bold transition flex items-center gap-1 cursor-pointer"
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
                    <p className="text-center text-[10px] text-[#6f6f6f] py-6">No matching standard specifications found.</p>
                  ) : (
                    filteredBibleProducts.map(bp => {
                      const isSelected = bp.id === selectedBibleProductId;
                      return (
                        <button
                          key={bp.id}
                          onClick={() => setSelectedBibleProductId(bp.id)}
                          className={`w-full text-left p-3 rounded-lg border text-xs flex justify-between items-center transition cursor-pointer ${
                            isSelected
                              ? 'bg-[#094771] border-[#3c3c3c] text-[#3794ff] font-bold shadow-xs'
                              : 'bg-[#2d2d2d] border-[#3c3c3c] hover:bg-[#383838] text-[#d4d4d4]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-sans leading-snug">{bp.name}</p>
                            <span className="text-[8px] font-mono text-[#6f6f6f] block mt-0.5">{bp.type}</span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <span className={`px-1.5 py-0.2 rounded-[4px] text-[8px] font-mono font-bold ${
                              bp.riskTier === 'High' ? 'bg-[#2d2d2d] text-[#f14c4c] border border-[#3c3c3c]' :
                              bp.riskTier === 'Medium' ? 'bg-[#2d2d2d] text-[#cca700] border border-[#3c3c3c]' :
                              'bg-[#2d2d2d] text-[#89d185] border border-[#3c3c3c]'
                            }`}>
                              {bp.riskTier}
                            </span>
                            <ChevronRight className={`w-3.5 h-3.5 ${isSelected ? 'text-[#3794ff]' : 'text-[#6f6f6f]'}`} />
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
                <div className="spr-panel p-5 space-y-4">
                  <div className="flex justify-between items-start border-b border-[#3c3c3c] pb-3">
                    <div>
                      <span className="text-[8px] font-mono uppercase tracking-widest font-bold text-[#3794ff]">Approved Platform Standard Spec</span>
                      <h3 className="text-sm font-bold text-[#d4d4d4] mt-1 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4.5 h-4.5 text-[#89d185]" />
                        {activeBibleProduct.name}
                      </h3>
                      <p className="text-[10px] text-[#6f6f6f] font-sans mt-0.5">{activeBibleProduct.type}</p>
                    </div>

                    <span className="bg-[#094771] text-[#3794ff] text-[9px] font-mono font-bold px-2 py-0.5 rounded uppercase border border-[#3c3c3c]">
                      Baseline: v{activeBibleProduct.baselineSecureVersion}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                    <div className="space-y-3">
                      <div>
                        <span className="text-[9px] text-[#6f6f6f] block font-mono font-bold uppercase">Permitted Security greenlist licenses</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {activeBibleProduct.allowedLicenses.map((lic: string) => (
                            <span key={lic} className="bg-[#2d2d2d] text-[#89d185] text-[10px] font-mono px-2 py-0.5 rounded border border-[#3c3c3c] font-semibold">
                              {lic}
                            </span>
                          ))}
                          {activeBibleProduct.allowedLicenses.length === 0 && <span className="text-[#9d9d9d] italic text-[11px]">None specified</span>}
                        </div>
                      </div>

                      <div>
                        <span className="text-[9px] text-[#6f6f6f] block font-mono font-bold uppercase">Prohibited copyleft blacklisted licenses</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {activeBibleProduct.disallowedLicenses.map((lic: string) => (
                            <span key={lic} className="bg-[#2d2d2d] text-[#f14c4c] text-[10px] font-mono px-2 py-0.5 rounded border border-[#3c3c3c] font-semibold">
                              {lic}
                            </span>
                          ))}
                          {activeBibleProduct.disallowedLicenses.length === 0 && <span className="text-[#9d9d9d] italic text-[11px]">None prohibited</span>}
                        </div>
                      </div>
                    </div>

                    <div className="p-3.5 bg-[#2d2d2d] rounded-md border border-[#3c3c3c] space-y-2">
                      <span className="text-[9px] text-[#6f6f6f] block font-mono font-bold uppercase">Target Regulatory Framework Compliance</span>
                      <p className="font-bold text-[#d4d4d4]">{activeBibleProduct.complianceTarget}</p>
                      <p className="text-[10px] text-[#9d9d9d] leading-normal">
                        Ingested components of this product category must be validated in accordance with audit guidelines mapped to this baseline.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-[#094771] rounded-md border border-[#3c3c3c] space-y-1.5 text-xs">
                    <span className="font-bold text-[#3794ff] font-mono text-[9px] uppercase tracking-wider block">Standard Core Safeguards Policy</span>
                    <p className="text-[#d4d4d4] leading-normal font-sans text-[11px]">{activeBibleProduct.safeguardPolicy}</p>
                  </div>
                </div>
              )}

              {/* Card 2: Interactive Sandbox Compliance Auditor */}
              <div className="spr-panel p-5 space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-[#d4d4d4] flex items-center gap-1.5">
                    <Sparkles className="w-4.5 h-4.5 text-[#cca700] animate-bounce" />
                    <span>Interactive Product Compliance Sandbox Auditor</span>
                  </h3>
                  <p className="text-[10px] text-[#9d9d9d] font-sans mt-0.5">
                    Simulate software ingest requests and instantly query compliance safety standards against the Master Product Bible.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-[10px] text-[#6f6f6f] font-mono uppercase font-bold mb-1">Select Target Product Class</label>
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
                        className="w-full rounded-md border border-[#3c3c3c] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5 bg-[#2d2d2d] text-[#d4d4d4]"
                      >
                        {bibleProducts.map(bp => (
                          <option key={bp.id} value={bp.name}>{bp.name}</option>
                        ))}
                        <option value="custom">-- Custom/Unregistered Product --</option>
                      </select>
                    </div>

                    {sandboxProduct === 'custom' && (
                      <div className="animate-fadeIn">
                        <label className="block text-[10px] text-[#6f6f6f] font-mono uppercase font-bold mb-1">Custom Product Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Apache Kafka"
                          value={sandboxCustomName}
                          onChange={(e) => setSandboxCustomName(e.target.value)}
                          className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2.5"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-[#6f6f6f] font-mono uppercase font-bold mb-1">Ingested Version</label>
                        <input
                          type="text"
                          value={sandboxVersion}
                          onChange={(e) => setSandboxVersion(e.target.value)}
                          className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2 font-mono"
                          placeholder="e.g. 1.25.0"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-[#6f6f6f] font-mono uppercase font-bold mb-1">License SPDX</label>
                        <input
                          type="text"
                          value={sandboxLicense}
                          onChange={(e) => setSandboxLicense(e.target.value)}
                          className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] text-[#d4d4d4] focus:outline-none focus:border-[#3794ff] p-2 font-mono"
                          placeholder="e.g. GPL-3.0-only"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-[#6f6f6f] font-mono uppercase font-bold mb-1">Target Deploy Environment</label>
                      <div className="grid grid-cols-3 gap-2">
                        {['Production', 'Staging', 'Development'].map(env => (
                          <button
                            key={env}
                            type="button"
                            onClick={() => setSandboxEnv(env)}
                            className={`p-2 rounded-lg border text-center font-semibold cursor-pointer transition ${
                              sandboxEnv === env
                                ? 'bg-[#094771] border-[#3c3c3c] text-[#3794ff] font-bold '
                                : 'bg-[#2d2d2d] border-[#3c3c3c] hover:bg-[#383838] text-[#9d9d9d] '
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
                      className="w-full py-2.5 bg-[#2d2d2d] hover:bg-[#383838] text-white font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 text-xs shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5 fill-current text-[#89d185]" />
                      <span>Run Sandbox Compliance Attestation</span>
                    </button>
                  </div>

                  {/* Attestation Sandbox Report panel */}
                  <div className="border border-[#3c3c3c] rounded-md p-4.5 bg-[#2d2d2d] flex flex-col justify-between min-h-[240px]">
                    {sandboxReport ? (
                      <div className="space-y-3 font-sans animate-fadeIn">
                        <div className="flex justify-between items-center border-b border-[#3c3c3c] pb-2">
                          <div>
                            <span className="text-[8px] font-mono text-[#6f6f6f] font-bold block">ATTESTATION REPORT</span>
                            <h4 className="font-bold text-[#d4d4d4] text-[11px] font-mono uppercase truncate max-w-[130px]">{sandboxReport.productName}</h4>
                          </div>

                          <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase flex items-center gap-1 ${
                            sandboxReport.overallStatus === 'PASS' ? 'bg-[#2d2d2d] text-[#89d185] border border-[#3c3c3c]' :
                            sandboxReport.overallStatus === 'WARN' ? 'bg-[#2d2d2d] text-[#cca700] border border-[#3c3c3c]' :
                            'bg-[#2d2d2d] text-[#f14c4c] border border-[#3c3c3c]'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              sandboxReport.overallStatus === 'PASS' ? 'bg-[#89d185]' :
                              sandboxReport.overallStatus === 'WARN' ? 'bg-[#cca700] animate-pulse' :
                              'bg-[#f14c4c] animate-pulse'
                            }`} />
                            {sandboxReport.overallStatus}
                          </span>
                        </div>

                        <div className="space-y-2 text-[10px] leading-normal font-sans">
                          <div className="flex items-start gap-1.5">
                            {sandboxReport.versionStatus === 'Compliant' ? (
                              <Check className="w-3.5 h-3.5 text-[#89d185] shrink-0 mt-0.5" />
                            ) : sandboxReport.versionStatus === 'Warning' ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-[#cca700] shrink-0 mt-0.5" />
                            ) : (
                              <ShieldAlert className="w-3.5 h-3.5 text-[#f14c4c] shrink-0 mt-0.5" />
                            )}
                            <div>
                              <span className="font-bold text-[#d4d4d4]">Version Standard: </span>
                              <span className="text-[#9d9d9d]">{sandboxReport.versionDetails}</span>
                            </div>
                          </div>

                          <div className="flex items-start gap-1.5">
                            {sandboxReport.licenseStatus === 'Compliant' ? (
                              <Check className="w-3.5 h-3.5 text-[#89d185] shrink-0 mt-0.5" />
                            ) : sandboxReport.licenseStatus === 'Warning' ? (
                              <AlertTriangle className="w-3.5 h-3.5 text-[#cca700] shrink-0 mt-0.5" />
                            ) : (
                              <ShieldAlert className="w-3.5 h-3.5 text-[#f14c4c] shrink-0 mt-0.5" />
                            )}
                            <div>
                              <span className="font-bold text-[#d4d4d4]">License Standard: </span>
                              <span className="text-[#9d9d9d]">{sandboxReport.licenseDetails}</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-2.5 bg-[#2d2d2d] border border-[#3c3c3c] rounded text-[9px] text-[#9d9d9d] leading-normal space-y-1">
                          <p className="font-bold text-[#d4d4d4] font-mono text-[8px] uppercase">Compliance Checklist ({sandboxReport.complianceTarget}):</p>
                          <p className="font-sans italic">{sandboxReport.safeguardPolicy}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-10 text-[#6f6f6f] space-y-2 font-sans flex flex-col justify-center items-center h-full">
                        <Sliders className="w-8 h-8 text-[#6f6f6f]" />
                        <p className="text-[11px] font-bold text-[#9d9d9d] mt-2">Attestation Pending</p>
                        <p className="text-[9px] text-[#6f6f6f] leading-snug max-w-[180px]">
                          Configure simulation parameters and run Sandbox Compliance Attestation to test build parameters against standards.
                        </p>
                      </div>
                    )}

                    <div className="text-[8px] font-mono text-[#6f6f6f] border-t border-[#3c3c3c] pt-2 mt-2 flex justify-between items-center">
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
