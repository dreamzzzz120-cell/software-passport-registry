import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Check, Play, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { Client } from '../types';
import { apiFetch } from '../utils/apiClient';

type ComplianceSchedule = {
  id: string;
  tenantId: string;
  clientId: string;
  frequency: string;
  targetEmail: string;
  lastAuditAt: string | null;
  nextAuditAt: string | null;
  status: string;
  createdAt: string;
};

type Framework = 'SOC2' | 'ISO27001' | 'HIPAA' | 'NIST';

type Control = {
  code: string;
  description: string;
  status: 'Not verified';
  evidence: string;
};

const FRAMEWORKS: Record<Framework, { name: string; description: string; controls: Control[] }> = {
  SOC2: {
    name: 'SOC 2 Type II',
    description: 'Trust Services Criteria controls are shown only when backed by tenant evidence.',
    controls: [
      { code: 'CC6.1', description: 'Logical access and signature controls.', status: 'Not verified', evidence: 'No authoritative control evidence connected.' },
      { code: 'CC7.2', description: 'Vulnerability evaluation and remediation.', status: 'Not verified', evidence: 'No authoritative scan evidence connected.' },
      { code: 'CC8.1', description: 'Supplier and license review.', status: 'Not verified', evidence: 'No authoritative supplier evidence connected.' },
    ],
  },
  ISO27001: {
    name: 'ISO/IEC 27001',
    description: 'ISMS controls remain unverified until supporting records are observed.',
    controls: [
      { code: 'A.12.6.1', description: 'Management of technical vulnerabilities.', status: 'Not verified', evidence: 'No authoritative vulnerability evidence connected.' },
      { code: 'A.18.1.1', description: 'Applicable legal and license requirements.', status: 'Not verified', evidence: 'No authoritative legal/compliance evidence connected.' },
    ],
  },
  HIPAA: {
    name: 'HIPAA Security & Privacy',
    description: 'HIPAA safeguards are not attested by UI state; evidence must be supplied and verified.',
    controls: [
      { code: '§164.312(a)', description: 'Access control mechanisms for systems handling PHI.', status: 'Not verified', evidence: 'No authoritative HIPAA evidence connected.' },
    ],
  },
  NIST: {
    name: 'NIST / SSDF',
    description: 'NIST control mappings require recorded evidence from the tenant environment.',
    controls: [
      { code: 'PS.1', description: 'Protect all forms of code from unauthorized access and tampering.', status: 'Not verified', evidence: 'No authoritative SSDF evidence connected.' },
      { code: 'PW.4', description: 'Reuse existing, well-secured software when feasible.', status: 'Not verified', evidence: 'No authoritative dependency evidence connected.' },
    ],
  },
};

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not observed';

export default function ComplianceView({ clients, role = 'Viewer' }: { clients: Client[]; role?: string }) {
  // Matches backend gating exactly: POST/PUT/DELETE /api/compliance/schedules
  // and POST .../run all require Owner/Admin/Operator (src/routes/compliance.ts).
  const canManageSchedules = ['Owner', 'Admin', 'Operator'].includes(role);
  const [framework, setFramework] = useState<Framework>('SOC2');
  const [query, setQuery] = useState('');
  const [schedules, setSchedules] = useState<ComplianceSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newClientId, setNewClientId] = useState('');
  const [newFrequency, setNewFrequency] = useState('Weekly');
  const [newTargetEmail, setNewTargetEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSchedules = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/compliance/schedules');
      if (!response.ok) throw new Error('Compliance schedules are unavailable.');
      const data = await response.json().catch(() => []);
      setSchedules(Array.isArray(data) ? data : []);
    } catch (cause: any) {
      setError(cause?.message || 'Compliance schedules are unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSchedules(); }, []);

  const controls = useMemo(() => FRAMEWORKS[framework].controls.filter((control) => `${control.code} ${control.description} ${control.evidence}`.toLowerCase().includes(query.toLowerCase())), [framework, query]);

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageSchedules) return;
    if (!newClientId || !newTargetEmail) { setError('Select a client and provide a target email.'); return; }
    setActionLoading('create'); setError(null);
    try {
      const response = await apiFetch('/api/compliance/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: newClientId, frequency: newFrequency, targetEmail: newTargetEmail }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to create compliance schedule.');
      setSchedules((current) => [...current, data]);
      setShowAdd(false); setNewClientId(''); setNewTargetEmail(''); setNotice('Compliance schedule created.');
    } catch (cause: any) { setError(cause?.message || 'Failed to create compliance schedule.'); }
    finally { setActionLoading(null); }
  };

  const toggleSchedule = async (schedule: ComplianceSchedule) => {
    if (!canManageSchedules) return;
    setActionLoading(`${schedule.id}:toggle`); setError(null);
    try {
      const nextStatus = schedule.status === 'Active' ? 'Paused' : 'Active';
      const response = await apiFetch(`/api/compliance/schedules/${encodeURIComponent(schedule.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Failed to update schedule.');
      setSchedules((current) => current.map((item) => item.id === schedule.id ? data : item));
    } catch (cause: any) { setError(cause?.message || 'Failed to update schedule.'); }
    finally { setActionLoading(null); }
  };

  const deleteSchedule = async (id: string) => {
    if (!canManageSchedules) return;
    setActionLoading(`${id}:delete`); setError(null);
    try {
      const response = await apiFetch(`/api/compliance/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete schedule.');
      setSchedules((current) => current.filter((item) => item.id !== id));
    } catch (cause: any) { setError(cause?.message || 'Failed to delete schedule.'); }
    finally { setActionLoading(null); }
  };

  const runSchedule = async (id: string) => {
    if (!canManageSchedules) return;
    setActionLoading(`${id}:run`); setError(null);
    try {
      const response = await apiFetch(`/api/compliance/schedules/${encodeURIComponent(id)}/run`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || data?.message || 'Compliance verification could not be queued.');
      if (data?.schedule) setSchedules((current) => current.map((item) => item.id === id ? data.schedule : item));
      setNotice(data?.message || 'Compliance verification queued.');
    } catch (cause: any) { setError(cause?.message || 'Compliance verification could not be queued.'); }
    finally { setActionLoading(null); }
  };

  return <section className="space-y-6">
    <header className="spr-panel p-6">
      <div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-md border border-[#3c3c3c] bg-[#094771] text-[#89d185]"><ShieldCheck size={18}/></div><div><div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#89d185]">Evidence-first governance</div><h1 className="mt-1 text-2xl font-semibold">Compliance workspace</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#9d9d9d]">Framework controls, schedules, and verification actions live here. Certifications, auditor claims, hashes, dates, and pass/fail attestations are not inferred from the UI.</p></div></div>
      {error && <div role="alert" className="mt-4 flex gap-2 rounded-md border border-[#f14c4c]/30 bg-[#f14c4c]/10 px-3 py-2 text-xs text-[#f14c4c]"><AlertCircle size={14}/> {error}</div>}
      {notice && <div role="status" className="mt-4 flex gap-2 rounded-md border border-[#89d185]/30 bg-[#89d185]/10 px-3 py-2 text-xs text-[#89d185]"><Check size={14}/> {notice}</div>}
    </header>

    <div className="grid gap-3 sm:grid-cols-4">{(Object.keys(FRAMEWORKS) as Framework[]).map((item) => <button key={item} onClick={() => setFramework(item)} className={`rounded-md border p-4 text-left ${framework === item ? 'border-[#0e639c] bg-[#094771]' : 'border-[#3c3c3c] spr-panel-alt'}`}><div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#6f6f6f]">Framework</div><div className="mt-1 font-semibold">{item}</div><div className="mt-2 text-xs text-[#9d9d9d]">{FRAMEWORKS[item].controls.length} controls</div></button>)}</div>

    <section className="spr-panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{FRAMEWORKS[framework].name}</h2><p className="mt-1 text-sm text-[#9d9d9d]">{FRAMEWORKS[framework].description}</p></div><label className="flex items-center gap-2 rounded-md border border-[#3c3c3c] px-3 py-2"><Search size={15} className="text-[#9d9d9d]"/><input aria-label="Search compliance controls" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search controls" className="bg-transparent text-sm outline-none"/></label></div><div className="mt-5 space-y-3">{controls.map((control) => <article key={control.code} className="spr-panel-alt p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-mono text-[#3794ff]">{control.code}</div><h3 className="mt-1 font-medium">{control.description}</h3></div><span className="rounded-full border border-[#cca700]/30 bg-[#cca700]/10 px-2.5 py-1 text-[10px] font-semibold text-[#cca700]">Not verified</span></div><p className="mt-2 text-xs text-[#9d9d9d]">{control.evidence}</p></article>)}</div></section>

    <section className="spr-panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Compliance verification schedules</h2><p className="mt-1 text-sm text-[#9d9d9d]">Server-backed schedules only. A queued audit is not itself a passed audit. "Verify now" generates a real report — it does not email anyone or run automatically.</p></div><button onClick={() => setShowAdd((value) => !value)} disabled={!canManageSchedules} title={!canManageSchedules ? `Your ${role} role cannot manage compliance schedules.` : undefined} className="spr-btn spr-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={14}/> Add schedule</button></div>
      {showAdd && <form onSubmit={createSchedule} className="mt-4 grid gap-3 spr-panel-alt p-4 md:grid-cols-4"><select aria-label="Client" value={newClientId} onChange={(event) => setNewClientId(event.target.value)} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm text-[#d4d4d4]"><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><select aria-label="Frequency" value={newFrequency} onChange={(event) => setNewFrequency(event.target.value)} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm text-[#d4d4d4]"><option>Daily</option><option>Weekly</option><option>Monthly</option></select><input aria-label="Target email" type="email" required value={newTargetEmail} onChange={(event) => setNewTargetEmail(event.target.value)} placeholder="notification@example.com" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-sm text-[#d4d4d4]"/><button type="submit" disabled={actionLoading === 'create'} className="spr-btn spr-btn-primary">{actionLoading === 'create' ? 'Saving…' : 'Create'}</button></form>}
      {loading ? <div className="mt-4 text-sm text-[#9d9d9d]">Loading schedules…</div> : schedules.length === 0 ? <div className="mt-4 rounded-md border border-dashed border-[#3c3c3c] p-8 text-center"><CalendarClock className="mx-auto h-8 w-8 text-[#6f6f6f]"/><p className="mt-2 text-sm text-[#9d9d9d]">No compliance schedules are configured.</p></div> : <div className="mt-4 space-y-3">{schedules.map((schedule) => <article key={schedule.id} className="rounded-md border border-[#3c3c3c] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold">{clients.find((client) => client.id === schedule.clientId)?.name || 'Unresolved client'}</div><div className="mt-1 text-xs text-[#9d9d9d]">{schedule.frequency} · Last run {formatDate(schedule.lastAuditAt)} · Next check {formatDate(schedule.nextAuditAt)}</div></div><span className="rounded-full border border-[#3c3c3c] px-2 py-1 text-[10px] text-[#9d9d9d]">{schedule.status}</span></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={!canManageSchedules || !!actionLoading} title={!canManageSchedules ? `Your ${role} role cannot run compliance verifications.` : undefined} onClick={() => void runSchedule(schedule.id)} className="spr-btn spr-btn-primary inline-flex items-center gap-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50"><Play size={13}/> {actionLoading === `${schedule.id}:run` ? 'Queueing…' : 'Verify now'}</button><button disabled={!canManageSchedules || !!actionLoading} title={!canManageSchedules ? `Your ${role} role cannot change schedules.` : undefined} onClick={() => void toggleSchedule(schedule)} className="rounded-lg border border-[#3c3c3c] px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50">{schedule.status === 'Active' ? 'Pause' : 'Resume'}</button><button disabled={!canManageSchedules || !!actionLoading} title={!canManageSchedules ? `Your ${role} role cannot delete schedules.` : undefined} onClick={() => void deleteSchedule(schedule.id)} className="inline-flex items-center gap-2 rounded-lg border border-[#f14c4c]/25 px-3 py-2 text-xs text-[#f14c4c] disabled:cursor-not-allowed disabled:opacity-50"><Trash2 size={13}/> Delete</button></div></article>)}</div>}
    </section>

    <footer className="rounded-md border border-[#3c3c3c] bg-[#181818] p-4 text-xs text-[#9d9d9d]">{clients.length} client record{clients.length === 1 ? '' : 's'} are available to this workspace. This is observed application data, not a compliance certification.</footer>
  </section>;
}
