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
import { auth } from '../lib/supabase-auth';
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
                <div>
                  <span className="font-semibold text-[var(--spr-text)] block">Multi-Factor Authentication</span>
                  <p className="text-[12px] text-[var(--spr-text-faint)]">Not available. SPR does not currently offer authenticator (TOTP) enrolment; sign-in is protected by your Supabase password and email confirmation only.</p>
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
  type GuideItem = { id: string; category: string; title: string; summary: string; details: string[]; href?: string; action?: string; status: GuideStatus; ownerOnly?: boolean };
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [expanded, setExpanded] = useState<string | null>('first-scan');
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<{ api: 'PASS' | 'FAIL' | 'UNKNOWN'; database: 'PASS' | 'FAIL' | 'UNKNOWN'; detail: string } | null>(null);
  const isOwner = role === 'Owner';
  const canAdmin = isOwner || role === 'Admin';

  const items: GuideItem[] = [
    { id:'onboarding', category:'Start here', title:'Create and orient a new workspace', summary:'Use onboarding and the dashboard to establish the first real client, Passport and scan.', details:['Complete onboarding with real workspace data.','Add the first client or start a New Review; do not seed demo records into a production tenant.','Use Dashboard and Coverage to see what SPR has actually observed and what is still missing.'], href:'/onboarding', action:'Open Onboarding', status:'action' },
    { id:'clients', category:'Inventory', title:'Create and manage clients', summary:'Build the tenant-scoped client portfolio that software, evidence and reports attach to.', details:['Open Clients and create the real customer record.','Select a client to inspect its software/evidence context.','Client limits are enforced server-side by the active plan.'], href:'/clients', action:'Open Clients', status:'action' },
    { id:'assets', category:'Inventory', title:'Review software and assets', summary:'Inspect the software estate discovered or created through evidence workflows.', details:['Open Software/Assets to inspect observed software.','Use Passports for the evidence-backed software record.','Do not treat an empty or failed collection as proof that no software exists.'], href:'/assets', action:'Open Software', status:'ready' },
    { id:'review', category:'Evidence collection', title:'Start a new software review', summary:'Create a Passport through a real review/scan rather than a blank catalog record.', details:['Open Extensions → New Review.','Provide the real repository/artifact/source requested by the workflow.','SPR creates evidence from collection results; unavailable evidence remains UNKNOWN.'], href:'/extensions/new-review', action:'Start New Review', status:'action' },
    { id:'integrations', category:'Evidence collection', title:'Connect GitHub, cloud, PSA and RMM systems', summary:'Use tenant-scoped credentials and provider live tests before relying on integration evidence.', details:['Open Integrations and choose the provider.','Save only the credential fields required by that provider and run its live test.','MSP connectors can discover provider customers for mapping to SPR Clients; failed tests stay failed.'], href:'/integrations', action:'Manage Integrations', status:'action' },
    { id:'scan', category:'Evidence collection', title:'Run SBOM and vulnerability scans', summary:'Collect software composition and vulnerability evidence into the scan ledger.', details:['Open Scans or launch a scan from an eligible integration/review.','Repository scans collect real dependency/SBOM evidence and vulnerability observations.','Review scan history and provenance; a scanner failure is not converted into a clean result.'], href:'/scans', action:'Open Scans', status:'action' },
    { id:'evidence', category:'Evidence & trust', title:'Trace evidence and provenance', summary:'Follow the evidence behind a Passport instead of relying on a naked score.', details:['Use Evidence Explorer to inspect source records and provenance.','Use the Trust Graph to understand relationships among clients, software, evidence and findings.','Use Evidence Exchange when evidence must move between participants while preserving its source context.'], href:'/evidence-explorer', action:'Open Evidence Explorer', status:'ready' },
    { id:'passports', category:'Evidence & trust', title:'Read and manage Passports', summary:'Use the Passport as the evidence-backed software record and inspect its authoritative verification decision.', details:['Open Passports and select the software record.','Review evidence, findings, timeline and authoritative verification explanation.','Share only the intended public evidence surface; internal trust detail remains internal.'], href:'/passports', action:'Open Passports', status:'ready' },
    { id:'trust-graph', category:'Evidence & trust', title:'Investigate relationships in Trust Graph', summary:'See how clients, software, evidence and findings connect.', details:['Open Trust Graph after evidence exists.','Trace the relationship rather than assuming causation from proximity.','Return to Evidence Explorer for the underlying record when a relationship needs proof.'], href:'/trust-graph', action:'Open Trust Graph', status:'ready' },
    { id:'monitoring', category:'Continuous assurance', title:'Enroll and operate continuous monitoring', summary:'Re-collect evidence over time and surface meaningful change.', details:['Enroll an eligible Passport/repository in Monitoring.','A positively observed public GitHub repository may run without a tenant token; private or unproven repositories require tenant credentials.','Credential failures remain visibly blocked and direct the operator to repair the connection.'], href:'/monitoring', action:'Open Monitoring', status:'action' },
    { id:'alerts', category:'Continuous assurance', title:'Triage alerts and remediation', summary:'Acknowledge, assign, escalate, snooze, resolve or reopen evidence-backed findings.', details:['Open Alerts and inspect the finding before acting.','SPR creates/updates the remediation work item for workflow state; the finding row alone is not the remediation state.','Resolve only after the required evidence supports closure.'], href:'/alerts', action:'Open Alerts', status:'action' },
    { id:'vendors', category:'Vendor risk', title:'Manage vendors and request missing evidence', summary:'Track vendors and close evidence deficits without inventing controls.', details:['Open Vendors to maintain the vendor record.','Use Vendor Evidence Exchange to request attributable evidence for unresolved deficits.','Use Questionnaires where structured vendor answers are required, then verify supplied evidence independently.'], href:'/vendors', action:'Open Vendors', status:'action' },
    { id:'vendor-exchange', category:'Vendor risk', title:'Run vendor evidence exchange', summary:'Request, receive and review vendor-supplied evidence.', details:['Choose the vendor and evidence deficit.','Send the evidence request through the supported workflow.','Treat vendor statements as supplied evidence, not independent verification, until SPR can verify them.'], href:'/vendor-evidence-exchange', action:'Open Vendor Evidence Exchange', status:'action' },
    { id:'questionnaires', category:'Vendor risk', title:'Operate security questionnaires', summary:'Collect structured answers and match them to the evidence context.', details:['Open Questionnaires and select the relevant client/software context.','Complete or review requested answers.','Use evidence records to support conclusions rather than treating questionnaire text alone as proof.'], href:'/questionnaires', action:'Open Questionnaires', status:'action' },
    { id:'procurement', category:'Decision workflows', title:'Use the procurement gate', summary:'Review evidence before a software procurement decision.', details:['Open Procurement Gate and choose the software under review.','Inspect known evidence, findings and unknowns.','Do not turn missing evidence into approval; unresolved evidence remains visible in the decision.'], href:'/procurement-gate', action:'Open Procurement Gate', status:'action' },
    { id:'governance', category:'Governance & compliance', title:'Operate governance, risks, controls and policies', summary:'Use Governance for frameworks, controls, findings, risks, policies and audit evidence.', details:['Open Governance and select the relevant tab/work item.','Link claims to evidence and preserve the WHY behind findings.','Use Compliance for client/framework posture without claiming unsupported compliance.'], href:'/governance', action:'Open Governance', status:'action' },
    { id:'compliance', category:'Governance & compliance', title:'Review compliance posture', summary:'Inspect evidence coverage against compliance requirements.', details:['Open Compliance and choose the client/context.','Review supported, unsupported and unknown control evidence.','Use Governance to manage the related controls, risks, findings and policy work.'], href:'/compliance', action:'Open Compliance', status:'ready' },
    { id:'privacy', category:'Governance & compliance', title:'Operate privacy inventory, PIAs and requests', summary:'Manage privacy-specific evidence and workflows.', details:['Open Privacy and select Inventory, PIA or Requests.','Record attributable evidence for privacy decisions.','Keep missing or unverified information explicit.'], href:'/privacy', action:'Open Privacy', status:'action' },
    { id:'dpa-retention', category:'Governance & compliance', title:'Execute the DPA and configure retention', summary:'Complete the signed data-processing agreement and explicit retention policy.', details:['Read the public, versioned DPA before execution.','Owner executes the DPA in Settings; the server signs the execution record.','Set retention explicitly; until saved, SPR does not claim scheduled purging is active.'], action:isOwner?'Use Data Governance above':'Owner action required', status:isOwner?'ready':'info', ownerOnly:true },
    { id:'reports', category:'Client delivery', title:'Generate and schedule client reports', summary:'Turn real inventory, scans, evidence and findings into client-facing deliverables.', details:['Open Reports and select the client/report type.','Choose only sections backed by the loaded client data.','Use report scheduling where enabled; review generated output before client delivery.'], href:'/reports', action:'Open Reports', status:'action' },
    { id:'white-label', category:'Client delivery', title:'Configure white-label identity and custom domains', summary:'Apply MSP branding to workspace, reports, public surfaces and account email.', details:['Open White-label and configure identity, logo, colours, typography and support details.','Branding applies to verification, password-reset and invitation emails.','Custom domains become Active only after the provider itself reports the domain verified and correctly configured.'], href:'/white-label', action:'Open White-label', status:'action' },
    { id:'registry', category:'Public trust', title:'Use the public Registry', summary:'Browse the public registry surface while keeping deeper/internal evidence appropriately scoped.', details:['Open Registry to inspect public software records.','Public presentation must come from observed registry evidence and freshness/lineage state.','Use Passports/Evidence Explorer for authorized deeper investigation.'], href:'/registry', action:'Open Registry', status:'ready' },
    { id:'public-share', category:'Public trust', title:'Share a public Passport safely', summary:'Generate a signed public evidence link without exposing the authoritative internal trust score.', details:['Open the Passport detail and generate the supported public link.','Public views expose observed evidence and evidence status, not the authoritative internal score.','Review the public view before sending it externally.'], href:'/passports', action:'Open Passports', status:'ready' },
    { id:'security', category:'Security & access', title:'Review the Security Center', summary:'Inspect security posture and the evidence available to SPR.', details:['Open Security Center for the current client/software context.','Investigate the underlying scan/evidence record behind a security finding.','A missing scanner/provider response stays UNKNOWN rather than becoming secure.'], href:'/security', action:'Open Security Center', status:'ready' },
    { id:'team', category:'Security & access', title:'Manage team, roles and client access', summary:'Invite users with the minimum authority required.', details:['Owner/Admin can invite, change roles and revoke access.','Map Client users only to the client they are permitted to see.','Review active sessions in Settings and revoke sessions you do not recognize.'], href:'/team', action:canAdmin?'Open Team':'View Team', status:canAdmin?'action':'info' },
    { id:'audit', category:'Security & access', title:'Review the audit log', summary:'Inspect recorded workspace actions when investigating who did what.', details:['Open Audit Log and locate the relevant event/time window.','Use the recorded event as evidence; do not infer actions that are not logged.','Correlate with evidence/scan/monitoring records where the workflow spans systems.'], href:'/audit-log', action:'Open Audit Log', status:'ready' },
    { id:'billing', category:'Commercial', title:'Billing', summary:'Use Real Stripe Checkout, the billing portal and server-enforced plan limits.', details:['Checkout prices are read from Stripe; unreadable prices are shown unavailable rather than guessed.','Client limits are enforced server-side.','Use the billing portal for payment methods, invoices and cancellation.'], href:'/billing', action:'Open Billing', status:'action' },
    { id:'savings', category:'Commercial', title:'Review savings and value evidence', summary:'Use the Savings surface to communicate operational value without inventing outcomes.', details:['Open Savings and inspect the available workspace calculations.','Distinguish measured values from estimates.','Use Reports for client-facing delivery when the underlying data is appropriate.'], href:'/savings', action:'Open Savings', status:'ready' },
    { id:'msp-ops', category:'MSP operations', title:'Run the MSP operations command center', summary:'Work across clients, alerts, Passports and verification state from one operational surface.', details:['Open MSP Operations to prioritize client work.','Select the client/Passport that needs attention.','Follow evidence and remediation state into the specialist surface instead of treating the overview as the source of truth.'], href:'/msp', action:'Open MSP Operations', status:'ready' },
    { id:'ai-trust', category:'AI & automation', title:'Review AI and agent trust', summary:'Inspect AI/agent evidence and trust-specific workflows separately from ordinary software evidence.', details:['Use AI Trust Center for AI-specific evidence context.','Use Agent Trust for agent-specific trust state.','Do not transfer an evidence observation into execution authority automatically.'], href:'/ai-trust-center', action:'Open AI Trust Center', status:'ready' },
    { id:'enterprise', category:'Readiness', title:'Review enterprise readiness and coverage', summary:'Inspect whether the workspace has the evidence and operational coverage expected for broader deployment.', details:['Open Enterprise Readiness for the current workspace/client context.','Use Coverage to identify collection gaps.','Treat incomplete coverage as incomplete—not as a passing readiness conclusion.'], href:'/enterprise-readiness', action:'Open Enterprise Readiness', status:'ready' },
    { id:'extensions', category:'Extensions', title:'Use workflow extensions', summary:'Discover additional SPR workflows and enter them through the extension marketplace.', details:['Open Extensions and select the workflow.','Follow the extension boundary and its evidence requirements.','Extension availability does not imply its external dependencies are configured; verify them in the workflow.'], href:'/extensions', action:'Open Extensions', status:'ready' },
    { id:'founder', category:'Founder only', title:'Operate Founder Mission Control', summary:'Use founder-only telemetry, connections, growth, registry and repair controls without exposing them to tenant Owners.', details:['Founder access is determined by the server founder allowlist, not by the tenant Owner role.','Use founder telemetry to investigate production, traffic, connections, registry and growth state.','Keep UNKNOWN when an external system cannot be observed; repair and reverify rather than painting a green status.'], href:'/founder', action:'Open Founder', status:'info' },
  ];

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => (category === 'All' || item.category === category) && (!needle || [item.category, item.title, item.summary, ...item.details].join(' ').toLowerCase().includes(needle)));
  }, [query, category, role]);
  const categories = ['All', ...Array.from(new Set(items.map((item) => item.category)))];

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
        <div className="mt-3 flex flex-wrap gap-2">{categories.map((name) => <button key={name} type="button" onClick={() => setCategory(name)} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${category === name ? 'border-[var(--spr-highlight)] text-[var(--spr-highlight)]' : 'border-[var(--spr-border)] text-[var(--spr-text-faint)]'}`}>{name}</button>)}</div>
        <div className="mt-3 text-[11px] text-[var(--spr-text-faint)]">Showing {visible.length} of {items.length} documented workflows.</div>
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

