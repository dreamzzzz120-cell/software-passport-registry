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

export default function ComplianceView({ clients }: { clients: Client[] }) {
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
    setActionLoading(`${id}:delete`); setError(null);
    try {
      const response = await apiFetch(`/api/compliance/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete schedule.');
      setSchedules((current) => current.filter((item) => item.id !== id));
    } catch (cause: any) { setError(cause?.message || 'Failed to delete schedule.'); }
    finally { setActionLoading(null); }
  };

  const runSchedule = async (id: string) => {
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
    <header className="rounded-3xl border border-white/[.07] bg-white/[.035] p-6 backdrop-blur-2xl">
      <div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><ShieldCheck size={18}/></div><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200">Evidence-first governance</div><h1 className="mt-1 text-2xl font-semibold">Compliance workspace</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Framework controls, schedules, and verification actions live here. Certifications, auditor claims, hashes, dates, and pass/fail attestations are not inferred from the UI.</p></div></div>
      {error && <div role="alert" className="mt-4 flex gap-2 rounded-xl border border-rose-300/20 bg-rose-300/[.05] px-3 py-2 text-xs text-rose-100"><AlertCircle size={14}/> {error}</div>}
      {notice && <div role="status" className="mt-4 flex gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/[.05] px-3 py-2 text-xs text-emerald-100"><Check size={14}/> {notice}</div>}
    </header>

    <div className="grid gap-3 sm:grid-cols-4">{(Object.keys(FRAMEWORKS) as Framework[]).map((item) => <button key={item} onClick={() => setFramework(item)} className={`rounded-2xl border p-4 text-left ${framework === item ? 'border-cyan-300/20 bg-cyan-300/[.07]' : 'border-white/[.07] bg-white/[.025]'}`}><div className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-600">Framework</div><div className="mt-1 font-semibold">{item}</div><div className="mt-2 text-xs text-slate-500">{FRAMEWORKS[item].controls.length} controls</div></button>)}</div>

    <section className="rounded-3xl border border-white/[.07] bg-white/[.025] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{FRAMEWORKS[framework].name}</h2><p className="mt-1 text-sm text-slate-500">{FRAMEWORKS[framework].description}</p></div><label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2"><Search size={15} className="text-slate-500"/><input aria-label="Search compliance controls" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search controls" className="bg-transparent text-sm outline-none"/></label></div><div className="mt-5 space-y-3">{controls.map((control) => <article key={control.code} className="rounded-2xl border border-white/[.07] bg-black/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-mono text-cyan-200">{control.code}</div><h3 className="mt-1 font-medium">{control.description}</h3></div><span className="rounded-full border border-amber-300/20 bg-amber-300/[.05] px-2.5 py-1 text-[10px] font-semibold text-amber-100">Not verified</span></div><p className="mt-2 text-xs text-slate-500">{control.evidence}</p></article>)}</div></section>

    <section className="rounded-3xl border border-white/[.07] bg-white/[.025] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Compliance verification schedules</h2><p className="mt-1 text-sm text-slate-500">Server-backed schedules only. A queued audit is not itself a passed audit.</p></div><button onClick={() => setShowAdd((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950"><Plus size={14}/> Add schedule</button></div>
      {showAdd && <form onSubmit={createSchedule} className="mt-4 grid gap-3 rounded-2xl border border-white/[.07] bg-black/10 p-4 md:grid-cols-4"><select aria-label="Client" value={newClientId} onChange={(event) => setNewClientId(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><select aria-label="Frequency" value={newFrequency} onChange={(event) => setNewFrequency(event.target.value)} className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"><option>Daily</option><option>Weekly</option><option>Monthly</option></select><input aria-label="Target email" type="email" required value={newTargetEmail} onChange={(event) => setNewTargetEmail(event.target.value)} placeholder="notification@example.com" className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"/><button type="submit" disabled={actionLoading === 'create'} className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-bold text-slate-950">{actionLoading === 'create' ? 'Saving…' : 'Create'}</button></form>}
      {loading ? <div className="mt-4 text-sm text-slate-500">Loading schedules…</div> : schedules.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-8 text-center"><CalendarClock className="mx-auto h-8 w-8 text-slate-600"/><p className="mt-2 text-sm text-slate-400">No compliance schedules are configured.</p></div> : <div className="mt-4 space-y-3">{schedules.map((schedule) => <article key={schedule.id} className="rounded-2xl border border-white/[.07] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold">{clients.find((client) => client.id === schedule.clientId)?.name || 'Unresolved client'}</div><div className="mt-1 text-xs text-slate-500">{schedule.frequency} · Last run {formatDate(schedule.lastAuditAt)} · Next check {formatDate(schedule.nextAuditAt)}</div></div><span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-400">{schedule.status}</span></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={!!actionLoading} onClick={() => void runSchedule(schedule.id)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold disabled:opacity-50"><Play size={13}/> {actionLoading === `${schedule.id}:run` ? 'Queueing…' : 'Verify now'}</button><button disabled={!!actionLoading} onClick={() => void toggleSchedule(schedule)} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-50">{schedule.status === 'Active' ? 'Pause' : 'Resume'}</button><button disabled={!!actionLoading} onClick={() => void deleteSchedule(schedule.id)} className="inline-flex items-center gap-2 rounded-lg border border-rose-300/15 px-3 py-2 text-xs text-rose-200 disabled:opacity-50"><Trash2 size={13}/> Delete</button></div></article>)}</div>}
    </section>

    <footer className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4 text-xs text-slate-500">{clients.length} client record{clients.length === 1 ? '' : 's'} are available to this workspace. This is observed application data, not a compliance certification.</footer>
  </section>;
}
