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

// The framework catalogue used to be a hard-coded list of SOC 2 / ISO / HIPAA
// / NIST control codes, each with status 'Not verified' and "No authoritative
// evidence connected" baked into the source. Nothing fed it, so it could never
// say anything else. This view now reads the tenant's real governance records
// (compliance_frameworks, controls) and links to Governance → Frameworks,
// where those records are managed.
type GovernanceFramework = { id: string; frameworkKey: string; name: string; version: string | null; publishedBy: string | null; status: string };
type GovernanceControl = { id: string; controlKey: string; name: string; implementationStatus: string; lastTestedAt: string | null; nextTestDueAt: string | null; frequency: string | null };

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not observed';

export default function ComplianceView({ clients, role = 'Viewer' }: { clients: Client[]; role?: string }) {
  // Matches backend gating exactly: POST/PUT/DELETE /api/compliance/schedules
  // and POST .../run all require Owner/Admin/Operator (src/routes/compliance.ts).
  const canManageSchedules = ['Owner', 'Admin', 'Operator'].includes(role);
  const [frameworks, setFrameworks] = useState<GovernanceFramework[] | null>(null);
  const [govControls, setGovControls] = useState<GovernanceControl[] | null>(null);
  const [govError, setGovError] = useState<string | null>(null);
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
  const [refreshing, setRefreshing] = useState(false);

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

  const refreshSchedules = async () => {
    setRefreshing(true);
    try { await loadSchedules(); } finally { setRefreshing(false); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fRes, cRes] = await Promise.all([apiFetch('/api/governance/frameworks'), apiFetch('/api/governance/controls')]);
        const f = fRes.ok ? await fRes.json() : null; const c = cRes.ok ? await cRes.json() : null;
        if (cancelled) return;
        if (!fRes.ok || !cRes.ok) setGovError(`Governance records could not be loaded (frameworks ${fRes.status}, controls ${cRes.status}).`);
        setFrameworks(Array.isArray(f) ? f : []); setGovControls(Array.isArray(c) ? c : []);
      } catch (cause: any) { if (!cancelled) setGovError(cause?.message || 'Governance records could not be loaded.'); }
    })();
    return () => { cancelled = true; };
  }, []);
  const controls = useMemo(() => (govControls ?? []).filter((control) => `${control.controlKey} ${control.name} ${control.implementationStatus}`.toLowerCase().includes(query.toLowerCase())), [govControls, query]);
  const controlsByStatus = useMemo(() => { const out: Record<string, number> = {}; for (const c of govControls ?? []) out[c.implementationStatus || 'unknown'] = (out[c.implementationStatus || 'unknown'] ?? 0) + 1; return out; }, [govControls]);

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
      <div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-md border border-[var(--spr-border)] bg-[var(--spr-accent-soft)] text-[var(--spr-green)]"><ShieldCheck size={18}/></div><div><div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-green)]">Evidence-first governance</div><h1 className="mt-1 text-2xl font-semibold">Compliance workspace</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Framework controls, schedules, and verification actions live here. Certifications, auditor claims, hashes, dates, and pass/fail attestations are not inferred from the UI.</p></div></div>
      {error && <div role="alert" className="mt-4 flex gap-2 rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]"><AlertCircle size={14}/> {error}</div>}
      {notice && <div role="status" className="mt-4 flex gap-2 rounded-md border border-[var(--spr-green)]/30 bg-[var(--spr-green)]/10 px-3 py-2 text-xs text-[var(--spr-green)]"><Check size={14}/> {notice}</div>}
    </header>

    <section className="spr-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Frameworks and controls on record</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Read from this workspace's governance records. A control's status is whatever was recorded for it; nothing here is attested by the page itself. Manage them under Governance → Frameworks and Controls.</p></div>
        <label className="flex items-center gap-2 rounded-md border border-[var(--spr-border)] px-3 py-2"><Search size={15} className="text-[var(--spr-text-muted)]"/><input aria-label="Search controls" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search controls" className="bg-transparent text-sm outline-none"/></label>
      </div>
      {govError && <div role="alert" className="mt-3 text-xs text-[var(--spr-red)]">{govError}</div>}
      {frameworks === null && !govError && <p className="mt-3 text-xs text-[var(--spr-text-muted)]">Loading governance records…</p>}
      {frameworks !== null && (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {frameworks.length === 0 && <p className="text-xs text-[var(--spr-text-muted)] sm:col-span-4">No compliance frameworks recorded yet. Add one under Governance → Frameworks.</p>}
          {frameworks.map((f) => <div key={f.id} className="rounded-md border border-[var(--spr-border)] spr-panel-alt p-4"><div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-text-faint)]">Framework</div><div className="mt-1 font-semibold">{f.name}{f.version ? <span className="ml-1 text-xs font-normal text-[var(--spr-text-muted)]">v{f.version}</span> : null}</div><div className="mt-2 text-xs text-[var(--spr-text-muted)]">{f.status}{f.publishedBy ? ` · ${f.publishedBy}` : ''}</div></div>)}
        </div>
      )}
      {govControls !== null && (
        <div className="mt-5">
          <p className="text-xs text-[var(--spr-text-muted)]">{govControls.length} control{govControls.length === 1 ? '' : 's'} recorded{Object.keys(controlsByStatus).length ? ` — ${Object.entries(controlsByStatus).map(([k, v]) => `${v} ${k}`).join(' · ')}` : ''}.</p>
          <div className="mt-3 space-y-3">
            {controls.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">{govControls.length === 0 ? 'No controls recorded yet. Add them under Governance → Controls.' : 'No controls match the search.'}</p>}
            {controls.map((control) => <article key={control.id} className="spr-panel-alt p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-mono text-[var(--spr-highlight)]">{control.controlKey}</div><h3 className="mt-1 font-medium">{control.name}</h3></div><span className="rounded-full border border-[var(--spr-border)] px-2.5 py-1 text-[12px] font-semibold text-[var(--spr-text)]">{control.implementationStatus || 'status not recorded'}</span></div><p className="mt-2 text-xs text-[var(--spr-text-muted)]">{control.lastTestedAt ? `Last tested ${new Date(control.lastTestedAt).toLocaleDateString()}` : 'Never tested'}{control.nextTestDueAt ? ` · next due ${new Date(control.nextTestDueAt).toLocaleDateString()}` : ''}{control.frequency ? ` · ${control.frequency}` : ''}</p></article>)}
          </div>
        </div>
      )}
    </section>

    <section className="spr-panel p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Compliance verification schedules</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Server-backed schedules only. A queued audit is not itself a passed audit. "Verify now" generates a real report — it does not email anyone or run automatically.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void refreshSchedules()} disabled={loading || refreshing} className="rounded-lg border border-[var(--spr-border)] px-3 py-2 text-xs disabled:opacity-50">{refreshing ? 'Refreshing…' : 'Refresh'}</button><button onClick={() => setShowAdd((value) => !value)} disabled={!canManageSchedules} title={!canManageSchedules ? `Your ${role} role cannot manage compliance schedules.` : undefined} className="spr-btn spr-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={14}/> Add schedule</button></div></div>
      {showAdd && <form onSubmit={createSchedule} className="mt-4 grid gap-3 spr-panel-alt p-4 md:grid-cols-4"><select aria-label="Client" value={newClientId} onChange={(event) => setNewClientId(event.target.value)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]"><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><select aria-label="Frequency" value={newFrequency} onChange={(event) => setNewFrequency(event.target.value)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]"><option>Daily</option><option>Weekly</option><option>Monthly</option></select><input aria-label="Target email" type="email" required value={newTargetEmail} onChange={(event) => setNewTargetEmail(event.target.value)} placeholder="notification@example.com" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]"/><button type="submit" disabled={actionLoading === 'create'} className="spr-btn spr-btn-primary">{actionLoading === 'create' ? 'Saving…' : 'Create'}</button></form>}
      {loading ? <div className="mt-4 text-sm text-[var(--spr-text-muted)]">Loading schedules…</div> : schedules.length === 0 ? <div className="mt-4 rounded-md border border-dashed border-[var(--spr-border)] p-8 text-center"><CalendarClock className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]"/><p className="mt-2 text-sm text-[var(--spr-text-muted)]">No compliance schedules are configured.</p></div> : <div className="mt-4 space-y-3">{schedules.map((schedule) => <article key={schedule.id} className="rounded-md border border-[var(--spr-border)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-semibold">{clients.find((client) => client.id === schedule.clientId)?.name || 'Unresolved client'}</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">{schedule.frequency} · Last run {formatDate(schedule.lastAuditAt)} · Next check {formatDate(schedule.nextAuditAt)}</div></div><span className="rounded-full border border-[var(--spr-border)] px-2 py-1 text-[12px] text-[var(--spr-text-muted)]">{schedule.status}</span></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={!canManageSchedules || !!actionLoading} title={!canManageSchedules ? `Your ${role} role cannot run compliance verifications.` : undefined} onClick={() => void runSchedule(schedule.id)} className="spr-btn spr-btn-primary inline-flex items-center gap-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50"><Play size={13}/> {actionLoading === `${schedule.id}:run` ? 'Queueing…' : 'Verify now'}</button><button disabled={!canManageSchedules || !!actionLoading} title={!canManageSchedules ? `Your ${role} role cannot change schedules.` : undefined} onClick={() => void toggleSchedule(schedule)} className="rounded-lg border border-[var(--spr-border)] px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50">{schedule.status === 'Active' ? 'Pause' : 'Resume'}</button><button disabled={!canManageSchedules || !!actionLoading} title={!canManageSchedules ? `Your ${role} role cannot delete schedules.` : undefined} onClick={() => { if (window.confirm('Delete this compliance schedule? This cannot be undone.')) void deleteSchedule(schedule.id); }} className="inline-flex items-center gap-2 rounded-lg border border-[var(--spr-red)]/25 px-3 py-2 text-xs text-[var(--spr-red)] disabled:cursor-not-allowed disabled:opacity-50"><Trash2 size={13}/> Delete</button></div></article>)}</div>}
    </section>

    <footer className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-4 text-xs text-[var(--spr-text-muted)]">{clients.length} client record{clients.length === 1 ? '' : 's'} are available to this workspace. This is observed application data, not a compliance certification.</footer>
  </section>;
}
