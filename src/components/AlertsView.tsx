import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpCircle, Bell, CheckCircle2, Clock3, Filter, Loader2, MessageSquare, Search, Send, ShieldAlert, ShieldCheck, User, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import type { Alert, AlertStatus } from '../types';

type AlertAction = 'acknowledge' | 'assign' | 'resolve' | 'escalate' | 'snooze' | 'reopen';
type RemediationNote = { id: string; authorDisplay: string; body: string; createdAt: string };
type RemediationDetail = { status: string; clientApprovedAt: string | null; notes: RemediationNote[] };

interface AlertsViewProps {
  alerts: Alert[];
  onAlertAction: (alert: Alert, action: AlertAction, assigneeDisplay?: string) => Promise<void>;
  role?: string;
}

const severityStyles: Record<string, string> = {
  Critical: 'border-[var(--spr-red)]/40 bg-[var(--spr-red)]/15 text-[var(--spr-red)]',
  High: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
  Medium: 'border-yellow-300/25 bg-yellow-300/10 text-yellow-200',
  Low: 'border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]',
};

const statusStyles: Record<AlertStatus, string> = {
  Active: 'border-[var(--spr-red)]/40 bg-[var(--spr-red)]/15/[.06] text-[var(--spr-red)]',
  Acknowledged: 'border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]',
  Snoozed: 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)] text-[var(--spr-text-muted)]',
  Resolved: 'border-[var(--spr-green)]/40 bg-[var(--spr-green)]/15 text-[var(--spr-green)]',
  Cancelled: 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)] text-[var(--spr-text-muted)]',
};

function isEscalated(alert: Alert) {
  if (!alert.slaDueAt || alert.status === 'Resolved' || alert.status === 'Cancelled') return false;
  return new Date(alert.slaDueAt).getTime() - Date.now() < 4 * 3600 * 1000;
}

export default function AlertsView({ alerts, onAlertAction, role = 'Viewer' }: AlertsViewProps) {
  const [severityFilter, setSeverityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  const categories = useMemo(() => Array.from(new Set(alerts.map((alert) => alert.category))), [alerts]);
  const filteredAlerts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return alerts.filter((alert) => {
      const haystack = `${alert.title} ${alert.description} ${alert.clientName} ${alert.category}`.toLowerCase();
      return (!normalizedQuery || haystack.includes(normalizedQuery))
        && (severityFilter === 'all' || alert.severity === severityFilter)
        && (categoryFilter === 'all' || alert.category === categoryFilter)
        && (statusFilter === 'all' || alert.status === statusFilter);
    });
  }, [alerts, query, severityFilter, categoryFilter, statusFilter]);
  const activeCount = alerts.filter((alert) => alert.status === 'Active').length;
  const criticalCount = alerts.filter((alert) => alert.status !== 'Resolved' && alert.status !== 'Cancelled' && alert.severity === 'Critical').length;
  const resolvedCount = alerts.filter((alert) => alert.status === 'Resolved').length;
  const selectedAlert = alerts.find((alert) => alert.id === selectedAlertId);

  return (
    <section className="space-y-6" id="msp-alerts-hub">
      <header className="rounded-[28px] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 md:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[var(--spr-red)]"><Bell className="h-4 w-4" /> Attention queue</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--spr-text)]">Alerts that need a decision</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Acknowledge, assign, escalate, or resolve server-backed trust findings. Every action updates the same remediation work item shown elsewhere in SPR.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <label className="flex min-w-56 items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-3 py-2.5"><Search className="h-4 w-4 text-[var(--spr-text-faint)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search alerts" aria-label="Search alerts" className="min-w-0 flex-1 bg-transparent text-xs text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-faint)]" /></label>
            <SelectFilter icon={<Filter />} label="Severity" value={severityFilter} onChange={setSeverityFilter} options={['all', 'Critical', 'High', 'Medium', 'Low']} />
            <SelectFilter icon={<Filter />} label="Status" value={statusFilter} onChange={setStatusFilter} options={['all', 'Active', 'Acknowledged', 'Snoozed', 'Resolved', 'Cancelled']} />
          </div>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <Metric label="Active attention" value={activeCount} tone="rose" icon={<ShieldAlert />} />
          <Metric label="Critical open" value={criticalCount} tone="amber" icon={<AlertTriangle />} />
          <Metric label="Resolved records" value={resolvedCount} tone="emerald" icon={<CheckCircle2 />} />
        </div>
      </header>

      <section className="rounded-[28px] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--spr-text)]">Trust finding queue</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">{filteredAlerts.length} of {alerts.length} alert records shown</p></div><label className="flex items-center gap-2 text-xs text-[var(--spr-text-muted)]">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-2 py-1.5 text-xs text-[var(--spr-text)] outline-none"><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label></div>
        <div className="space-y-2">
          {filteredAlerts.map((alert) => <button key={alert.id} onClick={() => setSelectedAlertId(alert.id)} className={`group flex w-full flex-col gap-4 rounded-md border p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--spr-highlight)]/40 hover:bg-[var(--spr-surface-alt)] md:flex-row md:items-center ${alert.status === 'Resolved' || alert.status === 'Cancelled' ? 'border-[var(--spr-border)] opacity-60' : 'border-[var(--spr-border)] bg-black/10'}`}>
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${alert.status === 'Resolved' ? 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)] text-[var(--spr-text-muted)]' : severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity === 'Critical' ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</span>
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)]/[.06] px-2 py-0.5 text-[10px] font-semibold text-[var(--spr-highlight)]">{alert.clientName}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity}</span><span className="text-[10px] text-[var(--spr-text-faint)]">{alert.category}</span>{isEscalated(alert) && <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200"><ArrowUpCircle className="h-3 w-3" />Escalated</span>}</span><span className="mt-2 block truncate text-sm font-semibold text-[var(--spr-text)] group-hover:text-[var(--spr-text)]">{alert.title}</span><span className="mt-1 block truncate text-xs text-[var(--spr-text-muted)]">{alert.description}</span></span>
            <span className="flex shrink-0 items-center gap-3 md:flex-col md:items-end"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusStyles[alert.status]}`}>{alert.status}</span>{alert.ownerDisplay && <span className="flex items-center gap-1 text-[10px] text-[var(--spr-text-muted)]"><User className="h-3 w-3" />{alert.ownerDisplay}</span>}<span className="flex items-center gap-1 text-[10px] text-[var(--spr-text-faint)]"><Clock3 className="h-3 w-3" />{alert.timestamp || 'Timestamp not observed'}</span></span>
          </button>)}
          {filteredAlerts.length === 0 && <div className="rounded-md border border-dashed border-[var(--spr-border)] px-5 py-14 text-center"><Bell className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]" /><p className="mt-3 text-sm font-semibold text-[var(--spr-text)]">No alert records match these filters.</p><p className="mt-1 text-xs text-[var(--spr-text-faint)]">Try another search or reset the queue filters.</p></div>}
        </div>
      </section>

      {selectedAlert && <AlertDrawer alert={selectedAlert} onClose={() => setSelectedAlertId(null)} onAlertAction={onAlertAction} role={role} />}
    </section>
  );
}

function SelectFilter({ icon, label, value, onChange, options }: { icon: ReactNode; label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="flex items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-3 py-2.5 text-xs text-[var(--spr-text-muted)]">{icon}<span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="bg-transparent font-semibold text-[var(--spr-text)] outline-none">{options.map((option) => <option key={option} value={option}>{option === 'all' ? `All ${label.toLowerCase()}s` : option}</option>)}</select></label>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'rose' | 'amber' | 'emerald' }) {
  const styles = { rose: 'border-[var(--spr-red)]/40 bg-[var(--spr-red)]/15/[.05]', amber: 'border-amber-300/15 bg-amber-300/[.05]', emerald: 'border-[var(--spr-green)]/40 bg-[var(--spr-green)]/15' };
  return <div className={`rounded-md border p-4 ${styles[tone]}`}><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-muted)]"><span className="h-4 w-4 text-[var(--spr-text-muted)]">{icon}</span>{label}</div><div className="mt-3 text-2xl font-semibold text-[var(--spr-text)]">{value}</div></div>;
}

function AlertDrawer({ alert, onClose, onAlertAction, role }: { alert: Alert; onClose: () => void; onAlertAction: (alert: Alert, action: AlertAction, assigneeDisplay?: string) => Promise<void>; role: string }) {
  const [working, setWorking] = useState(false);
  const [assignee, setAssignee] = useState(alert.ownerDisplay || '');
  const [showAssign, setShowAssign] = useState(false);

  const run = async (action: AlertAction, extra?: string) => {
    setWorking(true);
    try { await onAlertAction(alert, action, extra); setShowAssign(false); } finally { setWorking(false); }
  };

  // Remediation notes + client sign-off: loaded lazily from the real
  // remediation record (not derivable from the findings-shaped Alert
  // object itself), only once a remediation work item actually exists for
  // this finding.
  const [remediation, setRemediation] = useState<RemediationDetail | null>(null);
  const [loadingRemediation, setLoadingRemediation] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [postingNote, setPostingNote] = useState(false);
  const [approving, setApproving] = useState(false);
  const [remediationError, setRemediationError] = useState('');

  const loadRemediation = async () => {
    if (!alert.remediationId) return;
    setLoadingRemediation(true);
    try {
      const response = await apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(alert.remediationId)}`);
      if (response.ok) setRemediation(await response.json());
    } finally {
      setLoadingRemediation(false);
    }
  };
  useEffect(() => { void loadRemediation(); }, [alert.remediationId]);

  const submitNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!alert.remediationId || !newNote.trim() || postingNote) return;
    setPostingNote(true); setRemediationError('');
    try {
      const response = await apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(alert.remediationId)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: newNote.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Unable to post this note.');
      setRemediation((current) => current ? { ...current, notes: [...current.notes, data] } : current);
      setNewNote('');
    } catch (error: any) {
      setRemediationError(error?.message || 'Unable to post this note.');
    } finally {
      setPostingNote(false);
    }
  };

  const approveRemediation = async () => {
    if (!alert.remediationId || approving) return;
    setApproving(true); setRemediationError('');
    try {
      const response = await apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(alert.remediationId)}/approve`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error === 'REMEDIATION_NOT_FOUND_OR_NOT_READY' ? 'This remediation is not yet ready for approval.' : (data?.error || 'Unable to approve this remediation.'));
      await loadRemediation();
    } catch (error: any) {
      setRemediationError(error?.message || 'Unable to approve this remediation.');
    } finally {
      setApproving(false);
    }
  };

  return <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
    <aside role="dialog" aria-modal="true" aria-label={`Alert details for ${alert.title}`} onMouseDown={(event) => event.stopPropagation()} className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--spr-border)] bg-[#0a0f18] p-6 shadow-2xl md:p-8">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--spr-border)] pb-5"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]"><ShieldAlert className="h-4 w-4" /> Finding detail</div><h2 className="mt-3 text-xl font-semibold text-[var(--spr-text)]">{alert.title}</h2><p className="mt-1 font-mono text-xs text-[var(--spr-text-faint)]">{alert.id}</p></div><button onClick={onClose} aria-label="Close alert details" className="rounded-xl border border-[var(--spr-border)] p-2 text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-alt)] hover:text-[var(--spr-text)]"><X className="h-4 w-4" /></button></div>
      <div className="mt-6 flex flex-wrap gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity}</span><span className="rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2.5 py-1 text-[10px] text-[var(--spr-text-muted)]">{alert.category}</span><span className="rounded-full border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)]/[.06] px-2.5 py-1 text-[10px] text-[var(--spr-highlight)]">{alert.clientName}</span></div>
      <div className="mt-6 space-y-5">
        <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]">Description</div><p className="mt-3 text-sm leading-7 text-[var(--spr-text)]">{alert.description || 'No description observed.'}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="Observed timestamp" value={alert.timestamp || 'Not observed'} />
          <Detail label="Current workflow state" value={alert.status} />
          <Detail label="Assigned to" value={alert.ownerDisplay || 'Unassigned'} />
          <Detail label="SLA due" value={alert.slaDueAt ? new Date(alert.slaDueAt).toLocaleString() : 'No SLA set'} />
        </div>
      </div>
      <div className="mt-8 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
        <div className="text-xs font-semibold text-[var(--spr-text)]">Record a workflow decision</div>
        <p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">Actions create or update the remediation work item tied to this finding, through the authenticated Trust Loop route.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {(alert.status === 'Active') && <button disabled={working} onClick={() => void run('acknowledge')} className="rounded-xl border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--spr-highlight)] disabled:opacity-40">Acknowledge</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => setShowAssign((open) => !open)} className="rounded-xl border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-alt)] disabled:opacity-40">Assign…</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => void run('escalate')} className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40">Escalate</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => void run('snooze')} className="rounded-xl border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-alt)] disabled:opacity-40">Snooze</button>}
          {(alert.status !== 'Resolved') && <button disabled={working} onClick={() => void run('resolve')} className="rounded-xl bg-emerald-400 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Mark resolved</button>}
          {alert.status === 'Snoozed' && <button disabled={working} onClick={() => void run('reopen')} className="rounded-xl border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--spr-highlight)] disabled:opacity-40">Restore active</button>}
          {alert.status === 'Resolved' && <div className="flex items-center gap-2 text-xs text-[var(--spr-green)]"><ShieldCheck className="h-4 w-4" />Resolved state recorded; new evidence is still required to verify the finding.</div>}
        </div>
        {showAssign && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3">
            <input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Name or email" className="min-w-0 flex-1 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-xs text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-faint)]" />
            <button disabled={working || !assignee.trim()} onClick={() => void run('assign', assignee.trim())} className="rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Assign</button>
          </div>
        )}
      </div>

      {alert.remediationId && (
        <div className="mt-6 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--spr-text)]"><MessageSquare className="h-4 w-4 text-[var(--spr-text-muted)]" /> Remediation notes</div>
          {remediationError && <div role="alert" className="mt-3 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{remediationError}</div>}
          {loadingRemediation ? (
            <div className="mt-4 flex items-center gap-2 text-xs text-[var(--spr-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <>
              {remediation?.clientApprovedAt && (
                <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--spr-green)]/40 bg-[var(--spr-green)]/10 px-3 py-2 text-xs text-[var(--spr-green)]"><ShieldCheck className="h-4 w-4" /> Approved by the client on {new Date(remediation.clientApprovedAt).toLocaleString()}</div>
              )}
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
                {(remediation?.notes || []).length === 0 && <p className="text-xs text-[var(--spr-text-faint)]">No notes yet.</p>}
                {(remediation?.notes || []).map((note) => (
                  <div key={note.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3">
                    <div className="flex items-center justify-between text-[10px] text-[var(--spr-text-faint)]"><span>{note.authorDisplay}</span><span>{new Date(note.createdAt).toLocaleString()}</span></div>
                    <p className="mt-1.5 text-xs text-[var(--spr-text)]">{note.body}</p>
                  </div>
                ))}
              </div>
              <form onSubmit={submitNote} className="mt-4 flex items-center gap-2">
                <input value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Add a note…" className="min-w-0 flex-1 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-3 py-2 text-xs text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-faint)]" />
                <button type="submit" disabled={postingNote || !newNote.trim()} className="rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{postingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
              </form>
              {role === 'Client' && !remediation?.clientApprovedAt && (remediation?.status === 'READY_FOR_VERIFICATION' || remediation?.status === 'VERIFIED') && (
                <button onClick={() => void approveRemediation()} disabled={approving} className="mt-4 w-full rounded-xl bg-emerald-400 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{approving ? 'Approving…' : 'Approve this remediation'}</button>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-[var(--spr-border)] bg-black/15 p-4"><div className="text-[10px] uppercase tracking-[.16em] text-[var(--spr-text-faint)]">{label}</div><div className="mt-2 text-sm font-semibold text-[var(--spr-text)]">{value}</div></div>;
}
