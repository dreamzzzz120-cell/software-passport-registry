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
    <section className="space-y-4" aria-labelledby="team-title">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 id="team-title" className="text-[22px] font-semibold text-[#201f1e]">Team</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">Manage provisioned workspace members and their RBAC roles for this tenant.</p>
        </div>
        <button type="button" onClick={() => { void loadMembers(); void loadSessions(); void loadHistory(); }} disabled={loading || working} className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Refresh team data">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">&#9432; What is this? &middot; How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Reflects the authorization rules enforced by the API, not just UI visibility. Changes apply to the authenticated tenant only.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Invite a teammate by email and assign a workspace role.</li>
            <li>Adjust a member's role or remove their access at any time.</li>
            <li>Review your own active sessions and login history below.</li>
          </ol>
        </div>
      </details>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#e1dfdd] bg-[#fdf2f2] px-3 py-2.5 text-[13px] text-[#a4262c]"><span>{error}</span><button type="button" onClick={() => void loadMembers()} className="rounded border border-[#c8c6c4] px-2.5 py-1 text-[12px] font-medium hover:bg-black/[.03]">Try again</button></div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-md border border-[#e1dfdd] bg-[#dff6dd] px-3 py-2.5 text-[13px] text-[#0e700e]"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{notice}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 className="text-[14px] font-semibold text-[#201f1e]">Provisioned members</h2><p className="mt-0.5 text-[12px] text-[#605e5c]">{members.length} member{members.length === 1 ? '' : 's'} in this workspace</p></div>
            <ShieldCheck className="h-4 w-4 text-[#0f6cbd]" aria-hidden="true" />
          </div>
          {loading ? (
            <div className="space-y-2" aria-live="polite" aria-label="Loading team members"><div className="h-10 animate-pulse rounded bg-[#f3f2f1]" /><div className="h-10 animate-pulse rounded bg-[#f3f2f1]" /></div>
          ) : members.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#c8c6c4] px-5 py-8 text-center"><Users className="mx-auto h-6 w-6 text-[#8a8886]" /><p className="mt-2 text-[13px] font-semibold text-[#323130]">No provisioned members</p><p className="mt-1 text-[12px] text-[#605e5c]">Invite a teammate to start administering this workspace.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <caption className="sr-only">Workspace team members</caption>
                <thead className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]"><tr><th scope="col" className="px-3 py-2">Member</th><th scope="col" className="px-3 py-2">Role</th><th scope="col" className="px-3 py-2">Provisioned</th><th scope="col" className="px-3 py-2 text-right">Actions</th></tr></thead>
                <tbody>
                  {members.map((member) => <tr key={member.id} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#323130]">{member.displayName || member.email}</span>
                        {isPending(member) && <span className="inline-flex items-center gap-1 rounded border border-[#e1dfdd] bg-[#fff4ce] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a5700]"><Clock className="h-3 w-3" />Pending</span>}
                      </div>
                      {member.displayName && <div className="mt-0.5 text-[12px] text-[#605e5c]">{member.email}</div>}
                    </td>
                    <td className="px-3 py-2.5"><label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.email}</label><select id={`role-${member.id}`} value={INVITABLE_ROLES.includes(member.role as any) ? member.role : 'Viewer'} onChange={(event) => void updateRole(member, event.target.value)} disabled={!canManage || member.role === 'Owner' || working} className="h-8 rounded border border-[#c8c6c4] bg-white px-2 text-[12px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd] disabled:cursor-not-allowed disabled:opacity-60">{member.role === 'Owner' && <option value="Owner">Owner</option>}{INVITABLE_ROLES.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></td>
                    <td className="px-3 py-2.5 text-[12px] text-[#605e5c]">{formatDate(member.createdAt)}</td>
                    <td className="px-3 py-2.5 text-right"><button type="button" onClick={() => void removeMember(member)} disabled={!canManage || member.role === 'Owner' || working} className="inline-flex items-center gap-1.5 rounded border border-[#c8c6c4] px-2.5 py-1.5 text-[12px] font-medium text-[#a4262c] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Remove ${member.email}`}><Trash2 className="h-3.5 w-3.5" />Remove</button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 border-t border-[#e1dfdd] pt-4">
            <div className="flex items-center gap-2"><Info className="h-3.5 w-3.5 text-[#605e5c]" /><h3 className="text-[13px] font-semibold text-[#201f1e]">What each role can do</h3></div>
            <p className="mt-1 text-[12px] leading-5 text-[#605e5c]">Reflects the authorization rules enforced by the API, not just UI visibility.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]"><tr><th className="py-2 pr-4">Capability</th>{ALL_ROLES.map((r) => <th key={r} className="py-2 pr-3 text-center">{r}</th>)}</tr></thead>
                <tbody>
                  {PERMISSION_MATRIX.map((row) => (
                    <tr key={row.capability} className="border-b border-[#f3f2f1]">
                      <td className="py-2 pr-4 text-[#323130]">{row.capability}</td>
                      {ALL_ROLES.map((r) => <td key={r} className="py-2 pr-3 text-center">{row.roles.includes(r) ? <CheckCircle2 className="mx-auto h-3.5 w-3.5 text-[#0e700e]" /> : <span className="text-[#c8c6c4]">—</span>}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <form onSubmit={handleInvite} className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="flex items-center gap-2"><MailPlus className="h-4 w-4 text-[#0f6cbd]" /><h2 className="text-[14px] font-semibold text-[#201f1e]">Invite member</h2></div>
          <p className="mt-2 text-[12px] leading-5 text-[#605e5c]">Invitations create a provisioned account in this tenant. The recipient receives a Firebase password setup link when available.</p>
          <fieldset disabled={!canManage || working} className="mt-4 space-y-3 disabled:opacity-60">
            <div><label htmlFor="team-invite-email" className="mb-1 block text-[11px] font-semibold text-[#605e5c]">Email address</label><input id="team-invite-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@company.com" className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]" /></div>
            <div><label htmlFor="team-invite-role" className="mb-1 block text-[11px] font-semibold text-[#605e5c]">Workspace role</label><select id="team-invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as (typeof INVITABLE_ROLES)[number])} className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]">{INVITABLE_ROLES.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></div>
            <button type="submit" disabled={!inviteEmail.trim()} className="h-9 w-full rounded bg-[#0f6cbd] px-4 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50">{working ? 'Sending…' : 'Send invitation'}</button>
          </fieldset>
          {!canManage && <p className="mt-3 text-[12px] text-[#8a5700]">Your {role} role has read-only team access.</p>}
          {inviteLink && <div className="mt-3 rounded-md border border-[#e1dfdd] bg-[#dff6dd] p-3 text-[12px] text-[#0e700e]"><div className="font-semibold">Password setup link returned</div><a href={inviteLink} className="mt-1 block break-all underline" target="_blank" rel="noreferrer">Open invitation link</a></div>}
        </form>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="flex items-center gap-2"><Monitor className="h-4 w-4 text-[#0f6cbd]" /><h2 className="text-[14px] font-semibold text-[#201f1e]">Your active sessions</h2></div>
          <p className="mt-1 text-[12px] text-[#605e5c]">Sessions for your own account only. Revoking a session signs that device out.</p>
          {sessionsError && <p role="alert" className="mt-2 text-[12px] text-[#a4262c]">{sessionsError}</p>}
          {sessionsLoading ? (
            <div className="mt-3 space-y-2"><div className="h-9 animate-pulse rounded bg-[#f3f2f1]" /><div className="h-9 animate-pulse rounded bg-[#f3f2f1]" /></div>
          ) : sessions.length === 0 ? (
            <p className="mt-3 text-[12px] text-[#605e5c]">No active sessions recorded.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 rounded-md border border-[#e1dfdd] bg-[#faf9f8] px-3 py-2 text-[12px]">
                  <div>
                    <div className="flex items-center gap-2 text-[#323130]">{session.device}{session.current && <span className="rounded border border-[#e1dfdd] bg-[#eff6fc] px-1.5 py-0.5 text-[10px] font-semibold text-[#0f6cbd]">This device</span>}</div>
                    <div className="mt-1 text-[#605e5c]">{session.ip} · Last seen {formatDateTime(session.lastSeenAt)}</div>
                  </div>
                  {!session.current && (
                    <button onClick={() => void revokeSession(session)} disabled={revokingId === session.id} className="inline-flex items-center gap-1.5 rounded border border-[#c8c6c4] px-2.5 py-1.5 text-[11px] font-medium text-[#a4262c] hover:bg-black/[.03] disabled:opacity-40">
                      <LogOut className="h-3 w-3" />{revokingId === session.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="flex items-center gap-2"><History className="h-4 w-4 text-[#0f6cbd]" /><h2 className="text-[14px] font-semibold text-[#201f1e]">Your login history</h2></div>
          <p className="mt-1 text-[12px] text-[#605e5c]">Most recent sign-in attempts for your own account, most recent first.</p>
          {historyError && <p role="alert" className="mt-2 text-[12px] text-[#a4262c]">{historyError}</p>}
          {historyLoading ? (
            <div className="mt-3 space-y-2"><div className="h-9 animate-pulse rounded bg-[#f3f2f1]" /><div className="h-9 animate-pulse rounded bg-[#f3f2f1]" /></div>
          ) : loginHistory.length === 0 ? (
            <p className="mt-3 text-[12px] text-[#605e5c]">No login history recorded yet.</p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
              {loginHistory.map((entry) => (
                <li key={entry.id} className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] px-3 py-2 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className={entry.status === 'success' ? 'font-semibold text-[#0e700e]' : 'font-semibold text-[#a4262c]'}>{entry.status === 'success' ? 'Signed in' : entry.status}</span>
                    <span className="text-[#605e5c]">{formatDateTime(entry.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-[#605e5c]">{entry.ip}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
