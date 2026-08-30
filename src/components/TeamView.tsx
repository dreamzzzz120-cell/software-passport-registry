/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Clock, History, Info, LogOut, MailPlus, Monitor, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type TeamMember = {
  id: number;
  email: string;
  displayName?: string | null;
  role: string;
  onboarded?: number | boolean | null;
  createdAt?: string | null;
};

type SessionRecord = {
  id: string;
  current: boolean;
  ip: string;
  device: string;
  location: string;
  lastSeenAt: string;
};

type LoginHistoryRecord = {
  id: string;
  status: string;
  action: string;
  timestamp: string;
  ip: string;
  location: string;
};

const INVITABLE_ROLES = ['Admin', 'Technician', 'Viewer', 'Client'] as const;

// Sourced from the actual `requireRole(...)` gates enforced across src/routes/*.ts —
// kept here as a static reference so the explanation can never drift silently out of
// sync with a route's real authorization without someone noticing the mismatch.
const PERMISSION_MATRIX: Array<{ capability: string; roles: string[] }> = [
  { capability: 'Invite, re-role, or remove team members', roles: ['Owner', 'Admin'] },
  { capability: 'Manage API keys and integration credentials', roles: ['Owner', 'Admin'] },
  { capability: 'Create/edit monitoring configurations', roles: ['Owner', 'Admin'] },
  { capability: 'Trigger scans, repository scans, agent jobs', roles: ['Owner', 'Admin', 'Operator'] },
  { capability: 'Create report share links', roles: ['Owner', 'Admin', 'Operator'] },
  { capability: 'Install/remove workspace extensions', roles: ['Owner', 'Admin', 'Operator'] },
  { capability: 'Run monitoring checks, manage alert subscriptions', roles: ['Owner', 'Admin', 'Technician'] },
  { capability: 'View passports, evidence, reports, audit log', roles: ['Owner', 'Admin', 'Operator', 'Technician', 'Viewer', 'Client'] },
  { capability: 'Offboard tenant, view founder metrics', roles: ['Owner'] },
];
const ALL_ROLES = ['Owner', 'Admin', 'Operator', 'Technician', 'Viewer', 'Client'];

function responseError(data: any, fallback: string) {
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.error?.message === 'string') return data.error.message;
  if (typeof data?.message === 'string') return data.message;
  return fallback;
}

function formatDate(value?: string | null) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

function isPending(member: TeamMember) {
  return member.onboarded === 0 || member.onboarded === false;
}

export default function TeamView({ role }: { role: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<(typeof INVITABLE_ROLES)[number]>('Technician');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const canManage = role === 'Owner' || role === 'Admin';

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [loginHistory, setLoginHistory] = useState<LoginHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/organization/team');
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to load workspace members.'));
      setMembers(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load workspace members.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const response = await apiFetch('/api/auth/sessions');
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to load active sessions.'));
      setSessions(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setSessionsError(loadError instanceof Error ? loadError.message : 'Unable to load active sessions.');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await apiFetch('/api/auth/login-history');
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to load login history.'));
      setLoginHistory(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : 'Unable to load login history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMembers();
    void loadSessions();
    void loadHistory();
  }, [loadMembers, loadSessions, loadHistory]);

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !inviteEmail.trim()) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    setInviteLink(null);
    try {
      const response = await apiFetch('/api/organization/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to send workspace invitation.'));
      setInviteEmail('');
      setInviteLink(typeof data?.inviteLink === 'string' ? data.inviteLink : null);
      setNotice(`Invitation sent to ${inviteEmail.trim()}.`);
      await loadMembers();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Unable to send workspace invitation.');
    } finally {
      setWorking(false);
    }
  };

  const updateRole = async (member: TeamMember, nextRole: string) => {
    if (!canManage || member.role === nextRole || member.role === 'Owner') return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/organization/team/${encodeURIComponent(String(member.id))}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to update member role.'));
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, role: String(data?.role || nextRole) } : item));
      setNotice(`Role updated for ${member.email}.`);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Unable to update member role.');
    } finally {
      setWorking(false);
    }
  };

  const removeMember = async (member: TeamMember) => {
    if (!canManage || member.role === 'Owner' || !window.confirm(`Remove ${member.email} from this workspace?`)) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/organization/team/${encodeURIComponent(String(member.id))}`, { method: 'DELETE' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to remove workspace member.'));
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setNotice(`${member.email} no longer has workspace access.`);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove workspace member.');
    } finally {
      setWorking(false);
    }
  };

  const revokeSession = async (session: SessionRecord) => {
    if (session.current || !window.confirm('Revoke this session? The device will be signed out.')) return;
    setRevokingId(session.id);
    setSessionsError(null);
    try {
      const response = await apiFetch('/api/auth/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(responseError(data, 'Unable to revoke session.'));
      }
      setSessions((current) => current.filter((item) => item.id !== session.id));
    } catch (revokeError) {
      setSessionsError(revokeError instanceof Error ? revokeError.message : 'Unable to revoke session.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="team-title">
      <div className="flex flex-col gap-4 border-b border-[var(--spr-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#4ec9b0]">Workspace administration</div>
          <h1 id="team-title" className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight"><Users className="h-6 w-6 text-[#4ec9b0]" />Team</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Manage provisioned workspace members and their RBAC roles. Changes apply to the authenticated tenant only.</p>
        </div>
        <button type="button" onClick={() => { void loadMembers(); void loadSessions(); void loadHistory(); }} disabled={loading || working} className="spr-btn spr-btn-secondary inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Refresh team data">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 px-4 py-3 text-sm text-[var(--spr-red)]"><span>{error}</span><button type="button" onClick={() => void loadMembers()} className="rounded-md border border-[var(--spr-red)]/30 px-3 py-1.5 text-xs font-semibold hover:bg-[var(--spr-red)]/10">Try again</button></div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-md border border-[var(--spr-green)]/30 bg-[var(--spr-green)]/10 px-4 py-3 text-sm text-[var(--spr-green)]"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="spr-panel p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold text-[var(--spr-text)]">Provisioned members</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">{members.length} member{members.length === 1 ? '' : 's'} in this workspace</p></div>
            <ShieldCheck className="h-5 w-5 text-[var(--spr-highlight)]" aria-hidden="true" />
          </div>
          {loading ? (
            <div className="space-y-3" aria-live="polite" aria-label="Loading team members"><div className="h-14 animate-pulse rounded-md bg-[var(--spr-surface-sunken)]" /><div className="h-14 animate-pulse rounded-md bg-[var(--spr-surface-sunken)]" /></div>
          ) : members.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--spr-border)] px-5 py-10 text-center"><Users className="mx-auto h-7 w-7 text-[var(--spr-text-faint)]" /><p className="mt-3 text-sm font-semibold text-[var(--spr-text)]">No provisioned members</p><p className="mt-1 text-xs text-[var(--spr-text-muted)]">Invite a teammate to start administering this workspace.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">Workspace team members</caption>
                <thead className="border-b border-[var(--spr-border)] text-[10px] uppercase tracking-[.16em] text-[var(--spr-text-faint)]"><tr><th scope="col" className="px-3 py-3">Member</th><th scope="col" className="px-3 py-3">Role</th><th scope="col" className="px-3 py-3">Provisioned</th><th scope="col" className="px-3 py-3 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-[var(--spr-border)]">
                  {members.map((member) => <tr key={member.id}>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--spr-text)]">{member.displayName || member.email}</span>
                        {isPending(member) && <span className="inline-flex items-center gap-1 rounded-full border border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--spr-amber)]"><Clock className="h-3 w-3" />Pending</span>}
                      </div>
                      {member.displayName && <div className="mt-0.5 text-xs text-[var(--spr-text-muted)]">{member.email}</div>}
                    </td>
                    <td className="px-3 py-4"><label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.email}</label><select id={`role-${member.id}`} value={INVITABLE_ROLES.includes(member.role as any) ? member.role : 'Viewer'} onChange={(event) => void updateRole(member, event.target.value)} disabled={!canManage || member.role === 'Owner' || working} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-2 text-xs text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]/50 focus:ring-2 focus:ring-[var(--spr-highlight)]/20 disabled:cursor-not-allowed disabled:opacity-60">{member.role === 'Owner' && <option value="Owner">Owner</option>}{INVITABLE_ROLES.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></td>
                    <td className="px-3 py-4 text-xs text-[var(--spr-text-muted)]">{formatDate(member.createdAt)}</td>
                    <td className="px-3 py-4 text-right"><button type="button" onClick={() => void removeMember(member)} disabled={!canManage || member.role === 'Owner' || working} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--spr-red)]/30 px-2.5 py-2 text-xs font-semibold text-[var(--spr-red)] transition hover:bg-[var(--spr-red)]/10 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Remove ${member.email}`}><Trash2 className="h-3.5 w-3.5" />Remove</button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 border-t border-[var(--spr-border)] pt-5">
            <div className="flex items-center gap-2"><Info className="h-4 w-4 text-[var(--spr-text-muted)]" /><h3 className="text-sm font-semibold text-[var(--spr-text)]">What each role can do</h3></div>
            <p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">Reflects the authorization rules enforced by the API, not just UI visibility.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-[var(--spr-text-muted)]"><tr><th className="pb-2 pr-4">Capability</th>{ALL_ROLES.map((r) => <th key={r} className="pb-2 pr-3 text-center">{r}</th>)}</tr></thead>
                <tbody className="text-[var(--spr-text)]">
                  {PERMISSION_MATRIX.map((row) => (
                    <tr key={row.capability} className="border-t border-[var(--spr-border)]">
                      <td className="py-2 pr-4">{row.capability}</td>
                      {ALL_ROLES.map((r) => <td key={r} className="py-2 pr-3 text-center">{row.roles.includes(r) ? <CheckCircle2 className="mx-auto h-3.5 w-3.5 text-[var(--spr-green)]" /> : <span className="text-[var(--spr-text-faint)]">—</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <form onSubmit={handleInvite} className="spr-panel p-5">
          <div className="flex items-center gap-2"><MailPlus className="h-5 w-5 text-[var(--spr-highlight)]" /><h2 className="text-sm font-semibold text-[var(--spr-text)]">Invite member</h2></div>
          <p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">Invitations create a provisioned account in this tenant. The recipient receives a Firebase password setup link when available.</p>
          <fieldset disabled={!canManage || working} className="mt-5 space-y-4 disabled:opacity-60">
            <div><label htmlFor="team-invite-email" className="mb-1.5 block text-xs font-semibold text-[var(--spr-text)]">Email address</label><input id="team-invite-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@company.com" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-sm text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-faint)] focus:border-[var(--spr-highlight)]/50 focus:ring-2 focus:ring-[var(--spr-highlight)]/20" /></div>
            <div><label htmlFor="team-invite-role" className="mb-1.5 block text-xs font-semibold text-[var(--spr-text)]">Workspace role</label><select id="team-invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as (typeof INVITABLE_ROLES)[number])} className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-sm text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]/50 focus:ring-2 focus:ring-[var(--spr-highlight)]/20">{INVITABLE_ROLES.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></div>
            <button type="submit" disabled={!inviteEmail.trim()} className="w-full spr-btn spr-btn-primary disabled:cursor-not-allowed disabled:opacity-50">{working ? 'Sending…' : 'Send invitation'}</button>
          </fieldset>
          {!canManage && <p className="mt-4 text-xs text-[var(--spr-amber)]/80">Your {role} role has read-only team access.</p>}
          {inviteLink && <div className="mt-4 rounded-md border border-[var(--spr-green)]/30 bg-[var(--spr-green)]/10 p-3 text-xs text-[var(--spr-green)]"><div className="font-semibold">Password setup link returned</div><a href={inviteLink} className="mt-1 block break-all text-[var(--spr-green)] underline" target="_blank" rel="noreferrer">Open invitation link</a></div>}
        </form>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="spr-panel p-5">
          <div className="flex items-center gap-2"><Monitor className="h-4 w-4 text-[var(--spr-highlight)]" /><h2 className="text-sm font-semibold text-[var(--spr-text)]">Your active sessions</h2></div>
          <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Sessions for your own account only. Revoking a session signs that device out.</p>
          {sessionsError && <p role="alert" className="mt-3 text-xs text-[var(--spr-red)]">{sessionsError}</p>}
          {sessionsLoading ? (
            <div className="mt-4 space-y-2"><div className="h-10 animate-pulse rounded-md bg-[var(--spr-surface-sunken)]" /><div className="h-10 animate-pulse rounded-md bg-[var(--spr-surface-sunken)]" /></div>
          ) : sessions.length === 0 ? (
            <p className="mt-4 text-xs text-[var(--spr-text-muted)]">No active sessions recorded.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-xs">
                  <div>
                    <div className="flex items-center gap-2 text-[var(--spr-text)]">{session.device}{session.current && <span className="rounded-full border border-[var(--spr-accent)]/50 bg-[var(--spr-accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--spr-highlight)]">This device</span>}</div>
                    <div className="mt-1 text-[var(--spr-text-muted)]">{session.ip} · Last seen {formatDateTime(session.lastSeenAt)}</div>
                  </div>
                  {!session.current && (
                    <button onClick={() => void revokeSession(session)} disabled={revokingId === session.id} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--spr-red)]/30 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--spr-red)] hover:bg-[var(--spr-red)]/10 disabled:opacity-40">
                      <LogOut className="h-3 w-3" />{revokingId === session.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="spr-panel p-5">
          <div className="flex items-center gap-2"><History className="h-4 w-4 text-[var(--spr-highlight)]" /><h2 className="text-sm font-semibold text-[var(--spr-text)]">Your login history</h2></div>
          <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Most recent sign-in attempts for your own account, most recent first.</p>
          {historyError && <p role="alert" className="mt-3 text-xs text-[var(--spr-red)]">{historyError}</p>}
          {historyLoading ? (
            <div className="mt-4 space-y-2"><div className="h-10 animate-pulse rounded-md bg-[var(--spr-surface-sunken)]" /><div className="h-10 animate-pulse rounded-md bg-[var(--spr-surface-sunken)]" /></div>
          ) : loginHistory.length === 0 ? (
            <p className="mt-4 text-xs text-[var(--spr-text-muted)]">No login history recorded yet.</p>
          ) : (
            <ul className="mt-4 max-h-64 space-y-2 overflow-auto pr-1">
              {loginHistory.map((entry) => (
                <li key={entry.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className={entry.status === 'success' ? 'font-semibold text-[var(--spr-green)]' : 'font-semibold text-[var(--spr-red)]'}>{entry.status === 'success' ? 'Signed in' : entry.status}</span>
                    <span className="text-[var(--spr-text-muted)]">{formatDateTime(entry.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-[var(--spr-text-muted)]">{entry.ip}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
