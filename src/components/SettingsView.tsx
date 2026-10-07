/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Settings, Shield, Sliders, KeyRound, HelpCircle, CheckCircle,
  Sun, Moon, RefreshCw, Trash2, Fingerprint, Lock, FileText, FileCode,
  PlusCircle, AlertTriangle, Check,
  Layers, ShieldAlert, CheckCircle2, AlertCircle, ArrowRight, Search, Circle, ExternalLink
} from 'lucide-react';
import { auth, supabase } from '../lib/supabase-auth';
import { apiFetch } from '../utils/apiClient';
import DataGovernancePanel from './DataGovernancePanel';

interface SettingsViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  /** Signed-in user's role and email; the workspace deletion panel is shown to Owners only. */
  role?: string;
  userEmail?: string;
  onWorkspaceDeleted?: () => void | Promise<void>;
}

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function DeleteWorkspacePanel({ userEmail, onWorkspaceDeleted }: { userEmail: string; onWorkspaceDeleted?: () => void | Promise<void> }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ rows: number; tables: number; logins: { deleted: string[]; retained: { email: string; reason: string }[] } } | null>(null);
  const matches = confirm.trim().toLowerCase() === userEmail.trim().toLowerCase();
  // DELETE /api/organization removes every row this workspace owns in one
  // transaction and then the logins of members who belong to no other
  // workspace. The response is shown as returned: which tables, how many
  // rows, which logins were removed and which were kept and why.
  const run = async () => {
    if (!matches || busy) return;
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/organization', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: confirm.trim() }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body?.message || body?.error || 'The workspace was not deleted.'); return; }
      const rows = Object.values(body.deleted || {}).reduce((a: number, b: any) => a + Number(b), 0) as number;
      setResult({ rows, tables: Object.keys(body.deleted || {}).length, logins: body.logins });
      await onWorkspaceDeleted?.();
    } catch { setError('The deletion request failed before the server answered; nothing is known to have been removed.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="spr-panel p-5 space-y-3 border-red-500/40" aria-labelledby="delete-workspace-title">
      <h3 id="delete-workspace-title" className="text-xs font-bold text-red-300 flex items-center gap-2"><Trash2 className="w-4 h-4" /> Delete this workspace</h3>
      <p className="text-xs text-[var(--spr-text-muted)] leading-relaxed">Permanently removes every client, passport, scan, finding, evidence record, integration credential, audit entry and team member of this workspace, then the sign-in of every member who belongs to no other workspace. This cannot be undone and there is no backup restore for it.</p>
      {result ? (
        <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-xs space-y-1">
          <div className="font-semibold text-[var(--spr-text)]">Workspace deleted.</div>
          <div>{result.rows} row(s) removed across {result.tables} table(s).</div>
          <div>Sign-ins removed: {result.logins?.deleted?.length ? result.logins.deleted.join(', ') : 'none'}.</div>
          {result.logins?.retained?.length > 0 && <div>Sign-ins kept: {result.logins.retained.map((r) => `${r.email} (${r.reason})`).join('; ')}.</div>}
        </div>
      ) : (
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`Type ${userEmail} to confirm`} aria-label="Type your email to confirm workspace deletion" className="min-w-0 flex-1 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)] outline-none focus:border-red-400" />
          <button type="button" onClick={() => void run()} disabled={!matches || busy} className="rounded-md border border-red-500/60 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-300 disabled:opacity-40">{busy ? 'Deleting…' : 'Delete workspace permanently'}</button>
        </div>
      )}
      {error && <div role="alert" className="text-xs text-red-300">{error}</div>}
    </div>
  );
}

export default function SettingsView({ theme, onToggleTheme, role, userEmail, onWorkspaceDeleted }: SettingsViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'configurations' | 'organization' | 'guide'>('configurations');
  const [offboarding, setOffboarding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<any[]>([]);

  // Profile & Org/Team States
  const [profile, setProfile] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Technician');
  const [inviteClientId, setInviteClientId] = useState('');
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
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

  const fetchClientsList = () => {
    apiFetch('/api/user/clients').then((r) => r.ok ? r.json() : []).then((data) => { if (Array.isArray(data)) setClientsList(data.map((c: any) => ({ id: c.id, name: c.name }))); }).catch(() => {});
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !canManageTeam) return;
    if (inviteRole === 'Client' && !inviteClientId) { setTeamError('Select which client this invitation is for.'); return; }
    setTeamError(null);
    setTeamSuccess(null);
    try {
      const res = await apiFetch('/api/organization/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, clientId: inviteRole === 'Client' ? inviteClientId : undefined })
      });
      if (res.ok) {
        const invited = await res.json().catch(() => ({} as { emailed?: boolean; inviteLink?: string | null; emailError?: string | null }));
        if (invited.emailed === true) setTeamSuccess(`Invitation emailed to ${inviteEmail}.`);
        else if (invited.inviteLink) setTeamSuccess(`${inviteEmail} was added, but the invitation email was not sent (${invited.emailError || 'no email provider'}). Share this link with them directly: ${invited.inviteLink}`);
        else setTeamSuccess(`${inviteEmail} was added. No invitation link could be generated; they can use “Forgot password” on the sign-in page with this address.`);
        setInviteEmail('');
        setInviteClientId('');
        fetchProfileAndTeam();
      } else {
        const errData = await res.json().catch(() => null);
        setTeamError(errData?.error || errData?.message || 'Failed to send workspace invitation.');
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

  // Multi-tenant Active Sessions, SSO and Cryptographic audit state
  const [sessions, setSessions] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [auditChain, setAuditChain] = useState<any[]>([]);
  const [loadingLedgers, setLoadingLedgers] = useState(false);
  const [verifyingLedger, setVerifyingLedger] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<{ service: string; uptimeSeconds: number } | null>(null);
  const [mfaFactors, setMfaFactors] = useState<any[]>([]);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSuccess, setMfaSuccess] = useState<string | null>(null);
  const [mfaEnrollment, setMfaEnrollment] = useState<{ factorId: string; qrCode: string; secret?: string | null } | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const refreshMfaFactors = async () => {
    setMfaLoading(true);
    setMfaError(null);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const factors = [...(data?.totp || []), ...(data?.phone || [])];
      setMfaFactors(factors);
    } catch (error) {
      setMfaFactors([]);
      setMfaError(error instanceof Error ? error.message : 'Could not read multi-factor authentication status.');
    } finally {
      setMfaLoading(false);
    }
  };

  const beginTotpEnrollment = async () => {
    setMfaLoading(true);
    setMfaError(null);
    setMfaSuccess(null);
    setMfaCode('');
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'SPR authenticator',
      });
      if (error) throw error;
      if (!data?.id || !data?.totp?.qr_code) throw new Error('Authenticator enrollment did not return a QR code.');
      setMfaEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret ?? null });
    } catch (error) {
      setMfaEnrollment(null);
      setMfaError(error instanceof Error ? error.message : 'Could not start authenticator enrollment.');
    } finally {
      setMfaLoading(false);
    }
  };

  const verifyTotpEnrollment = async () => {
    if (!mfaEnrollment || !/^\d{6}$/.test(mfaCode.trim())) {
      setMfaError('Enter the current 6-digit code from your authenticator app.');
      return;
    }
    setMfaLoading(true);
    setMfaError(null);
    setMfaSuccess(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: mfaEnrollment.factorId });
      if (challenge.error) throw challenge.error;
      if (!challenge.data?.id) throw new Error('Authenticator challenge could not be created.');
      const verification = await supabase.auth.mfa.verify({
        factorId: mfaEnrollment.factorId,
        challengeId: challenge.data.id,
        code: mfaCode.trim(),
      });
      if (verification.error) throw verification.error;
      setMfaEnrollment(null);
      setMfaCode('');
      setMfaSuccess('Authenticator MFA is enabled for this account.');
      await refreshMfaFactors();
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : 'Authenticator verification failed.');
    } finally {
      setMfaLoading(false);
    }
  };

  const removeTotpFactor = async (factorId: string) => {
    if (!window.confirm('Disable this authenticator factor? Your account will lose this MFA factor immediately.')) return;
    setMfaLoading(true);
    setMfaError(null);
    setMfaSuccess(null);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      setMfaSuccess('Authenticator factor removed.');
      await refreshMfaFactors();
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : 'Could not remove the authenticator factor.');
    } finally {
      setMfaLoading(false);
    }
  };


  useEffect(() => {
    let cancelled = false;
    fetch('/health').then((r) => r.json()).then((data) => {
      if (!cancelled && data?.service) setRuntimeStatus({ service: data.service, uptimeSeconds: Number(data.uptimeSeconds) || 0 });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
    fetchClientsList();
    void refreshMfaFactors();
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
        const result = await res.json().catch(() => ({} as { identityAccountsRemoved?: number; identityAccountsNotRemoved?: string[] }));
        const notRemoved: string[] = Array.isArray(result.identityAccountsNotRemoved) ? result.identityAccountsNotRemoved : [];
        alert(notRemoved.length
          ? `Workspace data purged. ${result.identityAccountsRemoved ?? 0} sign-in account(s) removed; these could not be removed and need manual deletion: ${notRemoved.join(', ')}.`
          : `Workspace data purged and ${result.identityAccountsRemoved ?? 0} sign-in account(s) removed from the identity provider.`);
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

  return (
    <div className="space-y-6" id="msp-settings-view">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-[var(--spr-border)] pb-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[.22em] text-[#9cdcfe]"><Sliders className="h-4 w-4" /> Platform configuration</div>
          <h1 className="mt-2 text-xl font-bold text-[var(--spr-text)] flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#9cdcfe]" />
            <span>Platform Settings</span>
          </h1>
          <p className="text-xs text-[var(--spr-text-muted)] font-sans mt-1">
            Configure thresholds, SAML authentication gateways, and operator sessions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-Tab Selector */}
          <div className="flex bg-[var(--spr-surface-sunken)] p-1 rounded-md text-xs">
            <button
              type="button"
              onClick={() => setActiveSubTab('configurations')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'configurations'
                  ? 'bg-[var(--spr-accent-soft)] text-white font-bold'
                  : 'text-[var(--spr-text-muted)] hover:text-[var(--spr-text)] '
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
                  ? 'bg-[var(--spr-accent-soft)] text-white font-bold'
                  : 'text-[var(--spr-text-muted)] hover:text-[var(--spr-text)] '
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Team & Profile</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('guide')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'guide'
                  ? 'bg-[var(--spr-accent-soft)] text-white font-bold'
                  : 'text-[var(--spr-text-muted)] hover:text-[var(--spr-text)] '
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Getting Started</span>
            </button>
          </div>

          <button
            onClick={fetchAuthDataLedgers}
            disabled={loadingLedgers}
            className="p-2 bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] text-[var(--spr-text)] rounded-md hover:bg-[var(--spr-surface-hover)] transition flex items-center gap-1.5 text-xs font-mono cursor-pointer"
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
            
            {/* Theme & Interface Customization Card */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-1.5 pb-2 border-b border-[var(--spr-border)]">
                <Sun className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                <span>Theme & Interface Customization</span>
              </h3>

              <div className="space-y-4 text-xs">
                <div className="flex flex-col gap-1.5">
                  <span className="font-semibold text-[var(--spr-text)]">Active Theme Preference</span>
                  <p className="text-[12px] text-[var(--spr-text-faint)] ">Choose between high-contrast light mode or a dark interface designed for operating centers.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => theme === 'dark' && onToggleTheme()}
                    className={`flex items-center justify-center gap-2.5 p-3 rounded-md border transition-all cursor-pointer ${
                      theme === 'light'
                        ? 'bg-[var(--spr-accent-soft)] border-[var(--spr-border)] text-[var(--spr-highlight)] font-semibold shadow-sm'
                        : 'bg-[var(--spr-surface-sunken)] border-[var(--spr-border)] text-[var(--spr-text-muted)] hover:text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]'
                    }`}
                  >
                    <Sun className="w-4 h-4 text-[var(--spr-amber)]" />
                    <span>Light Mode</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => theme === 'light' && onToggleTheme()}
                    className={`flex items-center justify-center gap-2.5 p-3 rounded-md border transition-all cursor-pointer ${
                      theme === 'dark'
                        ? 'bg-[var(--spr-accent-soft)] border-[var(--spr-border)] text-[var(--spr-highlight)] font-semibold shadow-inner'
                        : 'bg-[var(--spr-surface-sunken)] hover:bg-[var(--spr-surface-hover)] border-[var(--spr-border)] text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]'
                    }`}
                  >
                    <Moon className="w-4 h-4 text-[var(--spr-highlight)]" />
                    <span>Dark Mode</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Active Sessions Monitoring Ledger */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center justify-between pb-2 border-b border-[var(--spr-border)]">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                  <span>Active Operator Sessions Ledger</span>
                </span>
                <span className="font-mono text-[12px] text-[var(--spr-highlight)] bg-[var(--spr-accent-soft)] px-2 py-0.5 rounded border border-[var(--spr-border)]">
                  {sessions.length} Active Node{sessions.length !== 1 ? 's' : ''}
                </span>
              </h3>

              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--spr-border)] text-[var(--spr-text-faint)] font-mono text-[12px] uppercase">
                      <th className="py-2">User / Identity</th>
                      <th className="py-2">IP Address</th>
                      <th className="py-2">Device & Location</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--spr-border)] font-sans">
                    {sessions.map((sess) => (
                      <tr key={sess.id} className="hover:bg-[var(--spr-surface-hover)]">
                        <td className="py-3 pr-2 font-semibold text-[var(--spr-text)]">
                          {sess.email}
                          {sess.current && (
                            <span className="ml-2 font-mono text-[11px] bg-[var(--spr-surface-sunken)] text-[var(--spr-green)] border border-[var(--spr-border)] px-1.5 py-0.2 rounded font-bold uppercase">
                              Current Node
                            </span>
                          )}
                        </td>
                        <td className="py-3 font-mono text-[var(--spr-text-muted)]">{sess.ip}</td>
                        <td className="py-3 text-[var(--spr-text-muted)] leading-normal">
                          <span className="block">{sess.device}</span>
                          <span className="text-[12px] text-[var(--spr-text-faint)]">{sess.location}</span>
                        </td>
                        <td className="py-3 text-right">
                          {!sess.current && (
                            <button
                              onClick={() => handleRevokeSession(sess.id)}
                              className="p-1.5 text-[var(--spr-red)] hover:bg-[var(--spr-surface-hover)] rounded-lg cursor-pointer transition"
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
                        <td colSpan={4} className="py-4 text-center text-[var(--spr-text-faint)] font-mono">
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
              <div className="flex items-center justify-between pb-2 border-b border-[var(--spr-border)]">
                <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-1.5">
                  <FileCode className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                  <span>Cryptographic Blockchain Audit Ledger</span>
                </h3>
                <span className={`font-mono text-[12px] px-2 py-0.5 rounded border border-[var(--spr-border)] flex items-center gap-1 ${
                  verificationResult?.isValid === true ? 'text-[var(--spr-green)] bg-[var(--spr-surface-sunken)]' :
                  verificationResult?.isValid === false ? 'text-[var(--spr-red)] bg-[var(--spr-surface-sunken)]' :
                  'text-[var(--spr-text-muted)] bg-[var(--spr-surface-sunken)]'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    verificationResult?.isValid === true ? 'bg-[var(--spr-green)] animate-pulse' :
                    verificationResult?.isValid === false ? 'bg-[var(--spr-red)]' :
                    'bg-[var(--spr-text-faint)]'
                  }`} />
                  {verificationResult?.isValid === true ? 'Verified this session' : verificationResult?.isValid === false ? 'Verification failed' : 'Not yet verified this session'}
                </span>
              </div>
              
              <p className="text-[12px] text-[var(--spr-text-faint)] font-sans leading-relaxed">
                Every critical login event and administrative action is recorded into a secure hash chain. Each block references the SHA-256 hash of its predecessor, creating a mathematically unalterable audit trail.
              </p>

              {/* Integrity Scanner Trigger */}
              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleVerifyLedger}
                  disabled={verifyingLedger}
                  className="flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-[var(--spr-accent)] hover:bg-[var(--spr-accent-hover)] disabled:bg-[var(--spr-surface-sunken)] rounded-lg shadow-sm cursor-pointer transition-all shrink-0"
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
                    className="text-[12px] font-sans font-semibold text-[var(--spr-text-muted)] hover:text-[var(--spr-text)] px-3 py-2 bg-[var(--spr-surface-sunken)] hover:bg-[var(--spr-surface-hover)] rounded-lg cursor-pointer transition-colors"
                  >
                    Clear Audit Report
                  </button>
                )}
              </div>

              {/* Dynamic Verification Report */}
              {verificationResult && (
                <div className={`p-4 rounded-md border font-sans text-xs ${
                  verificationResult.isValid 
                    ? 'bg-[var(--spr-surface-sunken)] border-[var(--spr-border)] text-[var(--spr-green)]'
                    : 'bg-[var(--spr-surface-sunken)] border-[var(--spr-border)] text-[var(--spr-red)]'
                } space-y-2.5 transition-all duration-300`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold flex items-center gap-1.5 uppercase tracking-wide text-[12px]">
                      {verificationResult.isValid ? (
                        <CheckCircle2 className="w-4.5 h-4.5 text-[var(--spr-green)] shrink-0" />
                      ) : (
                        <AlertCircle className="w-4.5 h-4.5 text-[var(--spr-red)] shrink-0" />
                      )}
                      <span>LEDGER ATTESTATION REPORT</span>
                    </span>
                    <span className="font-mono text-[11px] text-[var(--spr-text-faint)] ">
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
                    <div className="bg-[var(--spr-surface-sunken)] p-2.5 rounded-lg max-h-40 overflow-y-auto font-mono text-[11px] space-y-1.5 border border-[var(--spr-border)]">
                      <div className="font-sans font-bold text-[11px] text-[var(--spr-text-faint)] border-b border-[var(--spr-border)] pb-1 mb-1.5 uppercase">
                        Cryptographic Signatures Checked
                      </div>
                      {verificationResult.details.map((vBlock: any, vIdx: number) => (
                        <div key={vIdx} className="flex justify-between items-center gap-2">
                          <div className="truncate text-[var(--spr-text-muted)]">
                            Block #{vBlock.id} ({vBlock.action}): 
                            <span className="ml-1 text-[var(--spr-text-faint)] select-all">{vBlock.storedHash.substring(0, 16)}...</span>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[11px] uppercase font-bold shrink-0 ${
                            vBlock.valid 
                              ? 'bg-[var(--spr-surface-sunken)] text-[var(--spr-green)]'
                              : 'bg-[var(--spr-surface-sunken)] text-[var(--spr-red)]'
                          }`}>
                            {vBlock.valid ? 'Verified' : 'Corrupt'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3 font-mono text-[12px]">
                {auditChain.length === 0 && <p className="text-[var(--spr-text-faint)] font-sans">No audit events recorded yet.</p>}
                {auditChain.slice(0, 3).map((blockObj, idx) => (
                  <div key={idx} className="p-3 bg-[var(--spr-surface-sunken)] rounded-md border border-[var(--spr-border)] space-y-1 text-[var(--spr-text-muted)] relative overflow-hidden">
                    <div className="absolute right-2 top-2 text-[11px] bg-[var(--spr-surface-sunken)] text-[var(--spr-text-muted)] px-1.5 py-0.5 rounded uppercase font-bold">
                      Block #{auditChain.length - 1 - idx}
                    </div>
                    <div className="flex gap-2">
                      <span className="text-[var(--spr-highlight)] font-bold uppercase">EVENT:</span>
                      <span className="text-[var(--spr-text)] font-bold">
                        {blockObj.block?.actionType || blockObj.block?.action || 'Genesis Node Initiated'}
                      </span>
                    </div>
                    {blockObj.block?.userEmail && (
                      <div className="flex gap-2">
                        <span className="text-[var(--spr-text-faint)]">IDENTITY:</span>
                        <span className="text-[var(--spr-text)] font-semibold">{blockObj.block?.userEmail}</span>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      <div className="flex gap-2 text-[11px] truncate">
                        <span className="text-[var(--spr-text-faint)] uppercase font-bold shrink-0">BLOCK HASH:</span>
                        <span className="text-[var(--spr-highlight)] select-all font-mono truncate">{blockObj.hash}</span>
                      </div>
                      <div className="flex gap-2 text-[11px] truncate">
                        <span className="text-[var(--spr-text-faint)] uppercase shrink-0">PREV HASH:</span>
                        <span className="text-[var(--spr-text-muted)] select-all font-mono truncate">{blockObj.previousHash}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DataGovernancePanel role={currentRole} />

            {/* Security Credentials settings */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-1.5 pb-2 border-b border-[var(--spr-border)]">
                <KeyRound className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                <span>Operator Authentication & Security Keys</span>
              </h3>

              <div className="space-y-3.5 text-xs">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className="font-semibold text-[var(--spr-text)] block">Multi-Factor Authentication</span>
                      <p className="text-[12px] text-[var(--spr-text-faint)]">Protect this account with a time-based one-time password (TOTP) authenticator. Enrollment is handled by the active Supabase identity session; SPR never stores your authenticator secret.</p>
                    </div>
                    <button type="button" disabled={mfaLoading || Boolean(mfaEnrollment)} onClick={() => void beginTotpEnrollment()} className="spr-btn spr-btn-secondary">
                      {mfaLoading ? 'Checking…' : 'Add authenticator'}
                    </button>
                  </div>

                  {mfaFactors.length > 0 && (
                    <div className="space-y-2">
                      {mfaFactors.map((factor: any) => (
                        <div key={String(factor.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3">
                          <div>
                            <div className="font-semibold text-[var(--spr-text)]">{factor.friendly_name || 'Authenticator factor'}</div>
                            <div className="mt-0.5 text-[11px] text-[var(--spr-text-faint)]">{String(factor.factor_type || 'totp').toUpperCase()} · {factor.status || 'unverified'}</div>
                          </div>
                          <button type="button" disabled={mfaLoading} onClick={() => void removeTotpFactor(String(factor.id))} className="spr-btn spr-btn-secondary">Remove</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {!mfaLoading && mfaFactors.length === 0 && !mfaEnrollment && (
                    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-[12px] text-[var(--spr-text-muted)]">No authenticator factor is enrolled for this account.</div>
                  )}

                  {mfaEnrollment && (
                    <div className="rounded-md border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent-soft)] p-4">
                      <div className="font-semibold text-[var(--spr-text)]">Scan this QR code with your authenticator app</div>
                      <p className="mt-1 text-[12px] text-[var(--spr-text-muted)]">Then enter the current 6-digit code to finish enrollment. Closing this panel without verification does not enable the factor.</p>
                      <img src={mfaEnrollment.qrCode} alt="TOTP authenticator QR code" className="mt-3 h-44 w-44 rounded-md bg-white p-2" />
                      {mfaEnrollment.secret && <details className="mt-3 text-[12px] text-[var(--spr-text-muted)]"><summary className="cursor-pointer">Can’t scan the QR code?</summary><div className="mt-2 break-all rounded bg-[var(--spr-surface-sunken)] p-2 font-mono select-all">{mfaEnrollment.secret}</div></details>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Authenticator verification code" placeholder="123456" className="w-36 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 font-mono text-sm text-[var(--spr-text)]" />
                        <button type="button" disabled={mfaLoading || mfaCode.length !== 6} onClick={() => void verifyTotpEnrollment()} className="spr-btn spr-btn-primary">Verify and enable</button>
                        <button type="button" disabled={mfaLoading} onClick={() => { setMfaEnrollment(null); setMfaCode(''); setMfaError(null); }} className="spr-btn spr-btn-secondary">Cancel</button>
                      </div>
                    </div>
                  )}

                  {mfaError && <div role="alert" className="text-[12px] text-[var(--spr-red)]">{mfaError}</div>}
                  {mfaSuccess && <div role="status" className="text-[12px] text-[var(--spr-green)]">{mfaSuccess}</div>}
                </div>

                <div className="flex justify-between items-center border-t border-[var(--spr-border)] pt-3">
                  <div>
                    <span className="font-semibold text-[var(--spr-text)] block">Cryptographic PGP Signing Key</span>
                    <p className="text-[12px] text-[var(--spr-text-faint)] ">Not yet implemented -- generated Software Passports and audit attestations are not cryptographically signed today. No key-management endpoint exists on the backend yet.</p>
                  </div>
                </div>

                <div className="flex justify-between items-center border-t border-[var(--spr-border)] pt-4 mt-2 bg-[var(--spr-surface-sunken)] p-3.5 rounded-lg border border-dashed border-[var(--spr-border)]">
                  <div>
                    <span className="font-bold text-[var(--spr-red)] block flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-[var(--spr-red)]" /> Tenant Offboarding & Data Deletion (DPA Compliance)
                    </span>
                    <p className="text-[12px] text-[var(--spr-text-muted)] leading-snug mt-1">
                      Cascading-delete all client lists, passports, vulnerability logs, and active integrations. This action is immediate and completely irreversible under GDPR/DPA compliance standards.
                    </p>
                  </div>
                  <button
                    onClick={handleOffboardTenant}
                    disabled={!isOwner || offboarding}
                    title={!isOwner ? `Your ${currentRole} role cannot offboard this workspace. Owner is required.` : undefined}
                    className="bg-[var(--spr-red)] hover:bg-[#e04343] text-white font-sans font-bold text-xs px-4 py-2.5 rounded-lg cursor-pointer transition-colors shadow-sm disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
                  >
                    {offboarding ? 'Purging Context...' : 'Offboard Workspace'}
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column: Information panel & Live CI/CD Diagnostics */}
          <div className="space-y-6">
            
            {/* Active Login Audit Trail Panel */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-1.5 pb-2 border-b border-[var(--spr-border)]">
                <Fingerprint className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                <span>Real-time Login Audit Trail</span>
              </h3>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {history.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] text-[12px] space-y-1 text-left">
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-[var(--spr-text)] truncate max-w-36">{log.email}</span>
                      <span className={`font-mono text-[11px] font-bold px-1.5 py-0.2 rounded ${
                        log.status === 'Verified' ? 'bg-[var(--spr-surface-sunken)] text-[var(--spr-green)] ' : 'bg-[var(--spr-surface-sunken)] text-[var(--spr-red)]'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="text-[var(--spr-text-muted)]">
                      <span className="block font-medium">{log.action}</span>
                      <span className="block text-[11px] font-mono mt-0.5">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between font-mono text-[11px] text-[var(--spr-text-faint)] border-t border-[var(--spr-border)] pt-1 mt-1">
                      <span>IP: {log.ip}</span>
                      <span>Loc: {log.location}</span>
                    </div>
                  </div>
                ))}
                {history.length === 0 && (
                  <p className="text-center font-mono text-[var(--spr-text-faint)] py-4">No audit logs identified.</p>
                )}
              </div>
            </div>

            <div className="spr-panel p-5 space-y-4 h-fit">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-1.5 pb-2 border-b border-[var(--spr-border)]">
                <Shield className="w-4.5 h-4.5 text-[var(--spr-text-faint)] " />
                <span>Platform Runtime Status</span>
              </h3>

              <div className="text-xs space-y-2.5 font-mono text-[var(--spr-text-faint)] ">
                <div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5">
                  <span>SERVICE:</span>
                  <span className="font-bold text-[var(--spr-text)]">{runtimeStatus ? runtimeStatus.service : 'Not fetched'}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5">
                  <span>PROCESS UPTIME:</span>
                  <span className="font-bold text-[var(--spr-text)]">{runtimeStatus ? formatUptime(runtimeStatus.uptimeSeconds) : 'Not fetched'}</span>
                </div>
                <div className="flex justify-between border-b border-[var(--spr-border)] pb-1.5">
                  <span>HISTORICAL SLA:</span>
                  <span className="font-bold text-[var(--spr-text-muted)]">Not tracked</span>
                </div>
              </div>
              <p className="text-[11px] text-[var(--spr-text-faint)] leading-relaxed">Process uptime resets on every deploy or restart -- it is not a measure of historical availability. No uptime-history or SLA-compliance tracking system exists yet.</p>
            </div>

            <div className="spr-panel p-5 space-y-4 h-fit">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-1.5 pb-2 border-b border-[var(--spr-border)]">
                <CheckCircle className="w-4.5 h-4.5 text-[var(--spr-green)]" />
                <span>Readiness Diagnostics</span>
              </h3>
              <p className="text-[12px] text-[var(--spr-text-faint)] font-sans leading-relaxed">
                Checks live database connectivity via the same /api/ready probe an orchestrator uses. This does not verify row-level isolation, OAuth handshakes, or API quota — those have no self-check endpoint yet.
              </p>

              <button
                onClick={runDiagnosticSuite}
                disabled={testing}
                className="w-full py-2 bg-[var(--spr-surface-sunken)] hover:bg-[var(--spr-surface-hover)] text-white font-sans font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                {testing ? 'Checking…' : 'Check Readiness'}
              </button>

              {testResults.length > 0 && (
                <div className="space-y-2.5 pt-2.5 border-t border-[var(--spr-border)]">
                  {testResults.map((t: any, idx: number) => (
                    <div key={idx} className="text-[12px] space-y-0.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-[var(--spr-text)]">{t.name}</span>
                        <span className={`font-mono font-bold px-1.5 py-0.2 rounded text-[11px] ${
                          t.status === 'PASS' ? 'bg-[var(--spr-surface-sunken)] text-[var(--spr-green)] ' : 'bg-[var(--spr-surface-sunken)] text-[var(--spr-red)]'
                        }`}>
                          {t.status}
                        </span>
                      </div>
                      <p className="text-[var(--spr-text-faint)] font-sans leading-snug">{t.details}</p>
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
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-2 pb-2 border-b border-[var(--spr-border)]">
                <Sliders className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                <span>User Profile Credentials</span>
              </h3>

              {teamError && (
                <div className="p-3 bg-[var(--spr-surface-sunken)] text-[var(--spr-red)] border border-[var(--spr-border)] rounded-md flex gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <p>{teamError}</p>
                </div>
              )}

              {teamSuccess && (
                <div className="p-3 bg-[var(--spr-surface-sunken)] text-[var(--spr-green)] border border-[var(--spr-border)] rounded-md flex gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <p>{teamSuccess}</p>
                </div>
              )}

              {editingProfile ? (
                <form onSubmit={handleSaveProfile} className="space-y-3.5">
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[var(--spr-text-muted)]">Display Name</label>
                    <input
                      type="text"
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="rounded-md border border-[var(--spr-border)] text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] p-2.5 bg-[var(--spr-surface-sunken)]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[var(--spr-text-muted)]">Corporate Job Title</label>
                    <input
                      type="text"
                      required
                      value={profileJobTitle}
                      onChange={(e) => setProfileJobTitle(e.target.value)}
                      className="rounded-md border border-[var(--spr-border)] text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] p-2.5 bg-[var(--spr-surface-sunken)]"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-[var(--spr-text-muted)]">Organization Name</label>
                    <input
                      type="text"
                      required
                      value={profileCompany}
                      onChange={(e) => setProfileCompany(e.target.value)}
                      className="rounded-md border border-[var(--spr-border)] text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] p-2.5 bg-[var(--spr-surface-sunken)]"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingProfile(false)}
                      className="px-3 py-1.5 border border-[var(--spr-border)] rounded-lg text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-[var(--spr-accent)] text-white font-bold rounded-lg hover:bg-[var(--spr-accent-hover)] cursor-pointer"
                    >
                      Save Profile
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-md bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)] font-bold flex items-center justify-center text-lg border border-[var(--spr-border)]">
                      {profileName ? profileName.substring(0, 2).toUpperCase() : 'U'}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[var(--spr-text)]">
                        {profileName || 'Active Operator'}
                      </h4>
                      <p className="text-[12px] font-semibold text-[var(--spr-highlight)] font-mono mt-0.5">
                        {profileJobTitle || 'Workspace Administrator'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-[var(--spr-border)] pt-3 text-[11px] leading-normal text-[var(--spr-text-muted)]">
                    <div className="flex justify-between">
                      <span className="text-[var(--spr-text-faint)]">Email Identifier:</span>
                      <span className="font-mono font-bold text-[var(--spr-text)] select-all">{profile?.email || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--spr-text-faint)]">Active Tenant ID:</span>
                      <span className="font-mono text-[var(--spr-text-muted)] select-all">{profile?.tenantId || 'global'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--spr-text-faint)]">MSP Workspace:</span>
                      <span className="font-bold text-[var(--spr-text)]">{profile?.companyName || 'Not Defined'}</span>
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
                    className="w-full py-2 border border-[var(--spr-border)] text-[var(--spr-highlight)] font-semibold rounded-lg hover:bg-[var(--spr-surface-hover)] cursor-pointer transition text-center"
                  >
                    Edit Profile Details
                  </button>
                </div>
              )}
            </div>

            <div className="spr-panel p-5 space-y-3.5 text-left text-[var(--spr-text-faint)]">
              <h4 className="text-[12px] font-mono font-bold uppercase text-[var(--spr-text-muted)] tracking-wider">
                Authorized Role Hierarchy
              </h4>
              <p className="text-[12px] leading-relaxed">
                RBAC enforces strict isolation gates. Permissions cascade in order: <strong>Owner &gt; Admin &gt; Technician &gt; Viewer &gt; Client</strong>. Modifying team permissions automatically triggers a cryptographic token invalidation audit block.
              </p>
            </div>

            {/* White-label branding moved to its own page */}
            <div className="spr-panel p-5 space-y-3 text-left">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-2 pb-2 border-b border-[var(--spr-border)]">
                <FileText className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                <span>White-label</span>
              </h3>
              <p className="text-[12px] leading-relaxed text-[var(--spr-text-muted)]">
                Logo, favicon, product name, every colour in light and dark mode, typography, corners, footer and support details now live on their own page with a live preview.
              </p>
              <button type="button" onClick={() => { window.history.pushState({}, '', '/white-label'); window.dispatchEvent(new PopStateEvent('popstate')); }} className="spr-btn spr-btn-secondary w-full">Open White-label</button>
            </div>
          </div>

          {/* Organization & Team Access List Section */}
          <div className="lg:col-span-2 space-y-6 text-left">
            {/* Invite form card */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-2 pb-2 border-b border-[var(--spr-border)]">
                <PlusCircle className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                <span>Invite New MSP Team Member</span>
              </h3>

              <form onSubmit={handleInviteMember} className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="block text-[12px] font-mono font-bold text-[var(--spr-text-faint)] uppercase">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. associate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="rounded-md border border-[var(--spr-border)] text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] p-2.5 bg-[var(--spr-surface-sunken)]"
                  />
                </div>

                <div className="w-full md:w-44 flex flex-col gap-1">
                  <label className="block text-[12px] font-mono font-bold text-[var(--spr-text-faint)] uppercase">
                    Security Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => { setInviteRole(e.target.value); setInviteClientId(''); }}
                    className="rounded-md border border-[var(--spr-border)] text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] p-2.5 bg-[var(--spr-surface-sunken)] cursor-pointer font-semibold text-[var(--spr-text)]"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Technician">Technician</option>
                    <option value="Viewer">Viewer</option>
                    <option value="Client">Client</option>
                  </select>
                </div>

                {inviteRole === 'Client' && (
                  <div className="w-full md:w-52 flex flex-col gap-1">
                    <label className="block text-[12px] font-mono font-bold text-[var(--spr-text-faint)] uppercase">
                      Client
                    </label>
                    <select
                      required
                      value={inviteClientId}
                      onChange={(e) => setInviteClientId(e.target.value)}
                      className="rounded-md border border-[var(--spr-border)] text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] p-2.5 bg-[var(--spr-surface-sunken)] cursor-pointer font-semibold text-[var(--spr-text)]"
                    >
                      <option value="">{clientsList.length ? 'Select client…' : 'No clients yet'}</option>
                      {clientsList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canManageTeam}
                  title={!canManageTeam ? `Your ${currentRole} role cannot invite team members.` : undefined}
                  className="mt-5 md:mt-4 bg-[var(--spr-accent)] hover:bg-[var(--spr-accent-hover)] text-white font-bold px-5 py-2.5 rounded-md shrink-0 transition shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send Invitation
                </button>
              </form>
              {!canManageTeam && <p className="text-[12px] text-[var(--spr-amber)]">Your {currentRole} role has read-only team access.</p>}
            </div>

            {/* Team Members List Card */}
            <div className="spr-panel p-5 space-y-4">
              <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center justify-between pb-2 border-b border-[var(--spr-border)]">
                <span className="flex items-center gap-2">
                  <Lock className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
                  <span>Workspace Associates Matrix</span>
                </span>
                <span className="font-mono text-[11px] text-[var(--spr-highlight)] bg-[var(--spr-accent-soft)] px-2 py-0.5 rounded border border-[var(--spr-border)]">
                  {teamMembers.length} Registered Nodes
                </span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--spr-border)] text-[var(--spr-text-faint)] font-mono text-[12px] uppercase">
                      <th className="py-2.5">User Details</th>
                      <th className="py-2.5">Authority Role</th>
                      <th className="py-2.5 text-right">Administrative Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--spr-border)]">
                    {teamMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-[var(--spr-surface-hover)]">
                        <td className="py-3.5 pr-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-md bg-[var(--spr-surface-sunken)] text-[var(--spr-text-muted)] font-bold flex items-center justify-center text-xs shrink-0 border border-[var(--spr-border)]">
                              {member.displayName ? member.displayName.substring(0, 2).toUpperCase() : member.email.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-bold text-[var(--spr-text)] block">
                                {member.displayName || 'Pending Associate Registration'}
                              </span>
                              <span className="text-[12px] font-mono text-[var(--spr-text-faint)] select-all block">
                                {member.email}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5">
                          {member.role === 'Owner' ? (
                            <span className="font-mono text-[11px] font-bold bg-[var(--spr-accent)] text-[var(--spr-highlight)] border border-[var(--spr-highlight)] px-2 py-0.5 rounded uppercase">
                              Owner (Root)
                            </span>
                          ) : (
                            <select
                              value={member.role}
                              disabled={!canManageTeam}
                              title={!canManageTeam ? `Your ${currentRole} role cannot change roles.` : undefined}
                              onChange={(e) => handleUpdateMemberRole(member.id, e.target.value)}
                              className="bg-transparent border border-[var(--spr-border)] rounded p-1 font-mono text-[12px] font-bold cursor-pointer text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] disabled:cursor-not-allowed disabled:opacity-50"
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
                              className="px-2.5 py-1.5 text-[12px] font-bold text-[var(--spr-red)] border border-[var(--spr-border)] hover:bg-[var(--spr-surface-hover)] rounded-lg cursor-pointer transition-colors"
                            >
                              Revoke Access
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {teamMembers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-[var(--spr-text-faint)] font-mono">
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
        <GettingStartedGuide role={currentRole} />
      )}
      {role === 'Owner' && userEmail && <DeleteWorkspacePanel userEmail={userEmail} onWorkspaceDeleted={onWorkspaceDeleted} />}
    </div>
  );
}

// Kept as real, current documentation of what's actually live -- update this
// alongside any feature that changes what it describes, the same way code
// comments describe the code next to them. Nothing here should claim a
// capability exists before it's actually built and deployed.
function GettingStartedGuide({ role }: { role: string }) {
  type GuideStatus = 'ready' | 'action' | 'info';
  type GuideItem = { id: string; title: string; summary: string; details: string[]; href?: string; action?: string; status: GuideStatus; ownerOnly?: boolean };
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>('first-scan');
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ api: 'PASS' | 'FAIL' | 'UNKNOWN'; database: 'PASS' | 'FAIL' | 'UNKNOWN'; detail: string } | null>(null);
  const isOwner = role === 'Owner';
  const canAdmin = isOwner || role === 'Admin';

  const items: GuideItem[] = [
    { id: 'first-scan', title: 'Run your first real software scan', summary: 'Create or select a Passport, connect a repository, then collect SBOM and vulnerability evidence.', details: ['Open Integrations and connect GitHub, or use a public repository that SPR can positively observe without a tenant token.', 'Select the software Passport that owns the evidence.', 'Discover a repository and run the software scan. SPR records observed evidence; unavailable evidence remains UNKNOWN.'], href: '/integrations', action: 'Open Integrations', status: 'action' },
    { id: 'monitoring', title: 'Turn on continuous monitoring', summary: 'Re-check software over time and surface changes instead of relying on a one-time scan.', details: ['Open Monitoring after a repository has been enrolled.', 'Public GitHub repositories may run credential-free only when public visibility is positively observed.', 'Private or unproven repositories require a tenant GitHub credential. Missing or invalid credentials remain visibly blocked rather than silently falling back to a global token.'], href: '/monitoring', action: 'Open Monitoring', status: 'action' },
    { id: 'evidence', title: 'Understand the evidence trail', summary: 'Trace Passport → observation → evidence → finding so you can explain where every conclusion came from.', details: ['Use Evidence Explorer for source records and provenance.', 'Use Trust Graph to inspect relationships across software, vendors, evidence and findings.', 'A missing observation is not converted into a PASS.'], href: '/evidence', action: 'Explore Evidence', status: 'ready' },
    { id: 'connectors', title: 'Connect business and cloud systems', summary: 'Bring in provider evidence and MSP customer context through tenant-scoped integrations.', details: ['GitHub, GitLab, Bitbucket, Azure DevOps, AWS, Azure, Google Cloud, Microsoft 365, Jira, Confluence and Slack use provider-specific credential fields and a real live test.', 'MSP connectors such as ConnectWise, Autotask, NinjaOne and Hudu can discover provider customers for mapping to SPR Clients.', 'Credentials are tenant-scoped; a failed connection is shown as failed rather than inferred healthy.'], href: '/integrations', action: 'Manage Connectors', status: 'action' },
    { id: 'team', title: 'Set up your team and client access', summary: 'Invite operators and clients with the minimum role they need.', details: ['Owner/Admin can invite members, change roles and revoke access.', 'Client invitations must be mapped to the client they are allowed to see.', 'Review active sessions in Settings and revoke sessions you do not recognize.'], action: canAdmin ? 'Use Team & Profile above' : 'Ask an Owner or Admin', status: canAdmin ? 'ready' : 'info' },
    { id: 'branding', title: 'Custom domains & white-label branding', summary: 'Apply your MSP identity to the workspace, reports, public evidence links and account email.', details: ['Open White-label and set identity, logo, typography, colours, support details and favicon.', 'Generate a white-label client PDF from real loaded inventory and scores. Tenant branding also applies to verification, password-reset and invitation emails.', 'Custom domains become Active only after the provider itself reports the domain verified.'], href: '/white-label', action: 'Open White-label', status: 'action' },
    { id: 'billing', title: 'Billing', summary: 'Use Real Stripe Checkout, the billing portal and server-enforced plan limits.', details: ['Checkout prices are read from Stripe; unreadable prices are shown unavailable rather than guessed.', 'Client limits are enforced server-side.', 'Use the billing portal for payment methods, invoices and cancellation.'], href: '/billing', action: 'Open Billing', status: 'action' },
    { id: 'governance', title: 'Finish governance and retention', summary: 'Execute the DPA and set an explicit retention policy for the workspace.', details: ['The public DPA is versioned and hashed.', 'The execution record is signed by the server and can be verified.', 'Until a retention policy is saved, SPR does not claim scheduled purging is active.'], action: isOwner ? 'Use Data Governance above' : 'Owner action required', status: isOwner ? 'ready' : 'info', ownerOnly: true },
    { id: 'public', title: 'Share evidence safely', summary: 'Generate a public Passport link without exposing the authoritative internal trust score.', details: ['Public views expose observed evidence and an evidence status such as AVOID, INVESTIGATE, VERIFIED or UNKNOWN.', 'Use Reports for client-facing PDF output.', 'Review the public view before sending it to a client.'], href: '/passports', action: 'Open Passports', status: 'ready' },
  ];

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.title, item.summary, ...item.details].join(' ').toLowerCase().includes(needle));
  }, [query, role]);

  const runLiveCheck = async () => {
    setDiagnosing(true);
    setDiagnostic(null);
    try {
      const res = await apiFetch('/api/ready');
      const data = await res.json().catch(() => ({}));
      const db = data?.checks?.database;
      setDiagnostic({
        api: res.ok ? 'PASS' : 'FAIL',
        database: db?.ok === true ? 'PASS' : db?.ok === false ? 'FAIL' : 'UNKNOWN',
        detail: db?.ok === true ? `Database responded in ${Number(db.latencyMs) || 0}ms.` : db?.error || `Readiness returned HTTP ${res.status}.`
      });
    } catch {
      setDiagnostic({ api: 'FAIL', database: 'UNKNOWN', detail: 'The readiness request did not return. No database conclusion was inferred.' });
    } finally { setDiagnosing(false); }
  };

  const statusLabel = (status: GuideStatus) => status === 'ready' ? 'Available' : status === 'action' ? 'Next action' : 'Role note';
  return (
    <div className="space-y-5 animate-fadeIn text-xs" id="settings-getting-started-guide">
      <section className="spr-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><HelpCircle className="h-4 w-4" /> Interactive setup center</div>
            <h3 className="mt-2 text-lg font-bold text-[var(--spr-text)]">Know what to do next — and why</h3>
            <p className="mt-2 leading-relaxed text-[var(--spr-text-muted)]">Use this page as the operating guide for SPR. It links directly to the real product surfaces, explains what each step proves, and keeps unavailable evidence UNKNOWN. Your current workspace role is <strong className="text-[var(--spr-text)]">{role}</strong>.</p>
          </div>
          <button type="button" onClick={() => void runLiveCheck()} disabled={diagnosing} className="spr-btn spr-btn-secondary inline-flex min-h-10 items-center justify-center gap-2 self-start">
            <RefreshCw className={`h-4 w-4 ${diagnosing ? 'animate-spin' : ''}`} />{diagnosing ? 'Checking…' : 'Run live readiness check'}
          </button>
        </div>
        {diagnostic && <div className="mt-4 grid gap-2 sm:grid-cols-3" role="status">
          {[['API', diagnostic.api], ['Database', diagnostic.database]].map(([name, value]) => <div key={name} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">{name}</div><div className={`mt-1 font-bold ${value === 'PASS' ? 'text-[var(--spr-green)]' : value === 'FAIL' ? 'text-[var(--spr-red)]' : 'text-[var(--spr-amber)]'}`}>{value}</div></div>)}
          <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 sm:col-span-1"><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Observed detail</div><div className="mt-1 leading-relaxed text-[var(--spr-text-muted)]">{diagnostic.detail}</div></div>
        </div>}
      </section>

      <section className="spr-panel p-4">
        <label htmlFor="settings-guide-search" className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Find an instruction</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--spr-text-faint)]" />
          <input id="settings-guide-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Try: GitHub, monitoring, billing, client report, domain…" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] py-2.5 pl-9 pr-3 text-sm text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]" />
        </div>
      </section>

      <div className="grid gap-3">
        {visible.map((item, index) => {
          const open = expanded === item.id;
          return <section key={item.id} className="spr-panel overflow-hidden">
            <button type="button" onClick={() => setExpanded(open ? null : item.id)} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left hover:bg-[var(--spr-surface-hover)]">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] font-mono text-[11px] font-bold text-[var(--spr-highlight)]">{index + 1}</span>
              <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-bold text-[var(--spr-text)]">{item.title}</span><span className="rounded border border-[var(--spr-border)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--spr-text-faint)]">{statusLabel(item.status)}</span></span><span className="mt-1 block leading-relaxed text-[var(--spr-text-muted)]">{item.summary}</span></span>
              <ArrowRight className={`mt-1 h-4 w-4 shrink-0 text-[var(--spr-text-faint)] transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
            {open && <div className="border-t border-[var(--spr-border)] px-4 pb-4 pt-3 sm:pl-14">
              <ol className="space-y-2">
                {item.details.map((detail, i) => <li key={detail} className="flex gap-2 leading-relaxed text-[var(--spr-text-muted)]"><span className="font-mono text-[var(--spr-text-faint)]">{i + 1}.</span><span>{detail}</span></li>)}
              </ol>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {item.href ? <a href={item.href} className="spr-btn spr-btn-primary inline-flex min-h-9 items-center gap-2">{item.action}<ExternalLink className="h-3.5 w-3.5" /></a> : <span className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 font-semibold text-[var(--spr-text-muted)]"><Circle className="h-3 w-3" />{item.action}</span>}
                {item.ownerOnly && !isOwner && <span className="text-[var(--spr-amber)]">This step cannot be completed with the {role} role.</span>}
              </div>
            </div>}
          </section>;
        })}
        {visible.length === 0 && <div className="spr-panel p-8 text-center text-[var(--spr-text-muted)]">No setup instruction matches “{query}”. Try a feature name such as monitoring, GitHub, billing, branding or evidence.</div>}
      </div>

      <section className="spr-panel p-5">
        <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-amber)]" /><div><h4 className="font-bold text-[var(--spr-text)]">SPR evidence rule</h4><p className="mt-1 leading-relaxed text-[var(--spr-text-muted)]">This guide can navigate you to a capability and can query the real readiness endpoint, but it does not invent completion. A connection, scan, monitor, domain, payment or control is only complete when its authoritative backend/provider evidence says it is.</p></div></div>
      </section>
    </div>
  );
}

