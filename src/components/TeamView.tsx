/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, MailPlus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type TeamMember = {
  id: number;
  email: string;
  displayName?: string | null;
  role: string;
  createdAt?: string | null;
};

const INVITABLE_ROLES = ['Admin', 'Technician', 'Viewer', 'Client'] as const;

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

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

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

  return (
    <section className="space-y-6" aria-labelledby="team-title">
      <div className="flex flex-col gap-4 border-b border-white/[.07] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">Workspace administration</div>
          <h1 id="team-title" className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight"><Users className="h-6 w-6 text-cyan-200" />Team</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Manage provisioned workspace members and their RBAC roles. Changes apply to the authenticated tenant only.</p>
        </div>
        <button type="button" onClick={() => void loadMembers()} disabled={loading || working} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-300/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Refresh team members">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-300/20 bg-rose-300/[.06] px-4 py-3 text-sm text-rose-100"><span>{error}</span><button type="button" onClick={() => void loadMembers()} className="rounded-lg border border-rose-200/20 px-3 py-1.5 text-xs font-semibold hover:bg-rose-200/10">Try again</button></div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-300/[.06] px-4 py-3 text-sm text-emerald-100"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-3xl border border-white/[.07] bg-white/[.035] p-5 backdrop-blur-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold text-white">Provisioned members</h2><p className="mt-1 text-xs text-slate-500">{members.length} member{members.length === 1 ? '' : 's'} in this workspace</p></div>
            <ShieldCheck className="h-5 w-5 text-cyan-200" aria-hidden="true" />
          </div>
          {loading ? (
            <div className="space-y-3" aria-live="polite" aria-label="Loading team members"><div className="h-14 animate-pulse rounded-xl bg-white/[.05]" /><div className="h-14 animate-pulse rounded-xl bg-white/[.05]" /></div>
          ) : members.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center"><Users className="mx-auto h-7 w-7 text-slate-600" /><p className="mt-3 text-sm font-semibold text-slate-300">No provisioned members</p><p className="mt-1 text-xs text-slate-500">Invite a teammate to start administering this workspace.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">Workspace team members</caption>
                <thead className="border-b border-white/[.07] text-[10px] uppercase tracking-[.16em] text-slate-600"><tr><th scope="col" className="px-3 py-3">Member</th><th scope="col" className="px-3 py-3">Role</th><th scope="col" className="px-3 py-3">Provisioned</th><th scope="col" className="px-3 py-3 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-white/[.06]">
                  {members.map((member) => <tr key={member.id}>
                    <td className="px-3 py-4"><div className="font-medium text-slate-200">{member.displayName || member.email}</div>{member.displayName && <div className="mt-0.5 text-xs text-slate-500">{member.email}</div>}</td>
                    <td className="px-3 py-4"><label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.email}</label><select id={`role-${member.id}`} value={INVITABLE_ROLES.includes(member.role as any) ? member.role : 'Viewer'} onChange={(event) => void updateRole(member, event.target.value)} disabled={!canManage || member.role === 'Owner' || working} className="rounded-lg border border-white/10 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60">{member.role === 'Owner' && <option value="Owner">Owner</option>}{INVITABLE_ROLES.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></td>
                    <td className="px-3 py-4 text-xs text-slate-500">{formatDate(member.createdAt)}</td>
                    <td className="px-3 py-4 text-right"><button type="button" onClick={() => void removeMember(member)} disabled={!canManage || member.role === 'Owner' || working} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300/20 px-2.5 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Remove ${member.email}`}><Trash2 className="h-3.5 w-3.5" />Remove</button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <form onSubmit={handleInvite} className="rounded-3xl border border-cyan-300/15 bg-cyan-300/[.045] p-5 backdrop-blur-2xl">
          <div className="flex items-center gap-2"><MailPlus className="h-5 w-5 text-cyan-200" /><h2 className="text-sm font-semibold text-white">Invite member</h2></div>
          <p className="mt-2 text-xs leading-5 text-slate-400">Invitations create a provisioned account in this tenant. The recipient receives a Firebase password setup link when available.</p>
          <fieldset disabled={!canManage || working} className="mt-5 space-y-4 disabled:opacity-60">
            <div><label htmlFor="team-invite-email" className="mb-1.5 block text-xs font-semibold text-slate-300">Email address</label><input id="team-invite-email" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@company.com" className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20" /></div>
            <div><label htmlFor="team-invite-role" className="mb-1.5 block text-xs font-semibold text-slate-300">Workspace role</label><select id="team-invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as (typeof INVITABLE_ROLES)[number])} className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20">{INVITABLE_ROLES.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></div>
            <button type="submit" disabled={!inviteEmail.trim()} className="w-full rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">{working ? 'Sending…' : 'Send invitation'}</button>
          </fieldset>
          {!canManage && <p className="mt-4 text-xs text-amber-200/80">Your {role} role has read-only team access.</p>}
          {inviteLink && <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-300/[.06] p-3 text-xs text-emerald-100"><div className="font-semibold">Password setup link returned</div><a href={inviteLink} className="mt-1 block break-all text-emerald-200 underline" target="_blank" rel="noreferrer">Open invitation link</a></div>}
        </form>
      </div>
    </section>
  );
}
