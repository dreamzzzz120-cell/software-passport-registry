import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Check, Play, Plus, Search, Trash2 } from 'lucide-react';
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

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e]">Compliance workspace</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">Framework controls, schedules, and verification actions for this tenant.</p>
        </div>
      </div>

      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Certifications, auditor claims, hashes, dates, and pass/fail attestations are never inferred from the UI — controls stay "Not verified" until backed by tenant evidence.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Pick a framework to see its controls and current evidence status.</li>
            <li>Add a schedule to periodically request verification for a client.</li>
            <li>"Verify now" generates a real report on demand — it does not email anyone or run automatically.</li>
          </ol>
        </div>
      </details>

      {error && <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-[#a4262c]/30 bg-[#fdf2f2] px-3 py-2 text-[13px] text-[#a4262c]"><AlertCircle size={14} /> {error}</div>}
      {notice && <div role="status" className="mb-4 flex items-center gap-2 rounded-md border border-[#0e700e]/30 bg-[#dff6dd] px-3 py-2 text-[13px] text-[#0e700e]"><Check size={14} /> {notice}</div>}

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {(Object.keys(FRAMEWORKS) as Framework[]).map((item) => (
          <button
            key={item}
            onClick={() => setFramework(item)}
            className={`rounded-md border p-3 text-left ${framework === item ? 'border-[#0f6cbd] bg-[#eff6fc]' : 'border-[#e1dfdd] bg-white hover:bg-black/[.02]'}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-[#8a8886]">Framework</div>
            <div className="mt-0.5 text-[13px] font-semibold text-[#201f1e]">{item}</div>
            <div className="mt-1 text-[12px] text-[#605e5c]">{FRAMEWORKS[item].controls.length} controls</div>
          </button>
        ))}
      </div>

      <section className="mb-4 rounded-md border border-[#e1dfdd] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[#201f1e]">{FRAMEWORKS[framework].name}</h2>
            <p className="mt-0.5 text-[13px] text-[#605e5c]">{FRAMEWORKS[framework].description}</p>
          </div>
          <label className="flex h-9 items-center gap-2 rounded border border-[#c8c6c4] px-3 focus-within:border-[#0f6cbd] focus-within:ring-1 focus-within:ring-[#0f6cbd]">
            <Search size={14} className="text-[#8a8886]" />
            <input aria-label="Search compliance controls" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search controls" className="bg-transparent text-[13px] outline-none placeholder:text-[#8a8886]" />
          </label>
        </div>
        <div className="mt-3 space-y-2">
          {controls.map((control) => (
            <article key={control.code} className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[11px] text-[#0f6cbd]">{control.code}</div>
                  <h3 className="mt-0.5 text-[13px] font-medium text-[#201f1e]">{control.description}</h3>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#8a5700]"><span className="h-1.5 w-1.5 rounded-full bg-[#8a5700]" />Not verified</span>
              </div>
              <p className="mt-1.5 text-[12px] text-[#605e5c]">{control.evidence}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mb-4 rounded-md border border-[#e1dfdd] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[#201f1e]">Compliance verification schedules</h2>
            <p className="mt-0.5 text-[13px] text-[#605e5c]">Server-backed schedules only. A queued audit is not itself a passed audit.</p>
          </div>
          <button
            onClick={() => setShowAdd((value) => !value)}
            disabled={!canManageSchedules}
            title={!canManageSchedules ? `Your ${role} role cannot manage compliance schedules.` : undefined}
            className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} /> Add schedule
          </button>
        </div>

        {showAdd && (
          <form onSubmit={createSchedule} className="mt-3 grid gap-2 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 md:grid-cols-4">
            <select aria-label="Client" value={newClientId} onChange={(event) => setNewClientId(event.target.value)} className="h-9 rounded border border-[#c8c6c4] bg-white px-3 text-[13px] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]">
              <option value="">Select client</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            <select aria-label="Frequency" value={newFrequency} onChange={(event) => setNewFrequency(event.target.value)} className="h-9 rounded border border-[#c8c6c4] bg-white px-3 text-[13px] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]">
              <option>Daily</option>
              <option>Weekly</option>
              <option>Monthly</option>
            </select>
            <input aria-label="Target email" type="email" required value={newTargetEmail} onChange={(event) => setNewTargetEmail(event.target.value)} placeholder="notification@example.com" className="h-9 rounded border border-[#c8c6c4] bg-white px-3 text-[13px] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
            <button type="submit" disabled={actionLoading === 'create'} className="inline-flex h-9 items-center justify-center rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50">{actionLoading === 'create' ? 'Saving…' : 'Create'}</button>
          </form>
        )}

        {loading ? (
          <div className="mt-3 text-[13px] text-[#605e5c]">Loading schedules…</div>
        ) : schedules.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-[#e1dfdd] p-6 text-center">
            <CalendarClock className="mx-auto h-6 w-6 text-[#8a8886]" />
            <p className="mt-2 text-[13px] text-[#605e5c]">No compliance schedules are configured.</p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Schedule</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id} className="border-b border-[#f3f2f1] align-top hover:bg-black/[.02]">
                    <td className="px-3 py-2.5 font-medium text-[#201f1e]">{clients.find((client) => client.id === schedule.clientId)?.name || 'Unresolved client'}</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{schedule.frequency} · Last run {formatDate(schedule.lastAuditAt)} · Next check {formatDate(schedule.nextAuditAt)}</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{schedule.status}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-2">
                        <button
                          disabled={!canManageSchedules || !!actionLoading}
                          title={!canManageSchedules ? `Your ${role} role cannot run compliance verifications.` : undefined}
                          onClick={() => void runSchedule(schedule.id)}
                          className="inline-flex h-7 items-center gap-1.5 rounded bg-[#0f6cbd] px-2.5 text-[12px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Play size={12} /> {actionLoading === `${schedule.id}:run` ? 'Queueing…' : 'Verify now'}
                        </button>
                        <button
                          disabled={!canManageSchedules || !!actionLoading}
                          title={!canManageSchedules ? `Your ${role} role cannot change schedules.` : undefined}
                          onClick={() => void toggleSchedule(schedule)}
                          className="inline-flex h-7 items-center rounded border border-[#c8c6c4] px-2.5 text-[12px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {schedule.status === 'Active' ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          disabled={!canManageSchedules || !!actionLoading}
                          title={!canManageSchedules ? `Your ${role} role cannot delete schedules.` : undefined}
                          onClick={() => void deleteSchedule(schedule.id)}
                          className="inline-flex h-7 items-center gap-1.5 rounded border border-[#a4262c]/30 px-2.5 text-[12px] font-medium text-[#a4262c] hover:bg-[#fdf2f2] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[12px] text-[#605e5c]">{clients.length} client record{clients.length === 1 ? '' : 's'} are available to this workspace. This is observed application data, not a compliance certification.</div>
    </section>
  );
}
