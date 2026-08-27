import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpCircle, Bell, CheckCircle2, Clock3, Filter, Search, ShieldAlert, ShieldCheck, User, X } from 'lucide-react';
import type { Alert, AlertStatus } from '../types';

type AlertAction = 'acknowledge' | 'assign' | 'resolve' | 'escalate' | 'snooze' | 'reopen';

interface AlertsViewProps {
  alerts: Alert[];
  onAlertAction: (alert: Alert, action: AlertAction, assigneeDisplay?: string) => Promise<void>;
}

const severityStyles: Record<string, string> = {
  Critical: 'border-[#f14c4c]/40 bg-[#f14c4c]/15 text-[#f14c4c]',
  High: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
  Medium: 'border-yellow-300/25 bg-yellow-300/10 text-yellow-200',
  Low: 'border-[#3794ff]/40 bg-[#094771] text-[#3794ff]',
};

const statusStyles: Record<AlertStatus, string> = {
  Active: 'border-[#f14c4c]/40 bg-[#f14c4c]/15/[.06] text-[#f14c4c]',
  Acknowledged: 'border-[#3794ff]/40 bg-[#094771] text-[#3794ff]',
  Snoozed: 'border-[#3c3c3c] bg-[#252526] text-[#9d9d9d]',
  Resolved: 'border-[#89d185]/40 bg-[#89d185]/15 text-[#89d185]',
  Cancelled: 'border-[#3c3c3c] bg-[#252526] text-[#9d9d9d]',
};

function isEscalated(alert: Alert) {
  if (!alert.slaDueAt || alert.status === 'Resolved' || alert.status === 'Cancelled') return false;
  return new Date(alert.slaDueAt).getTime() - Date.now() < 4 * 3600 * 1000;
}

export default function AlertsView({ alerts, onAlertAction }: AlertsViewProps) {
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
      <header className="rounded-[28px] border border-[#3c3c3c] bg-[#252526] p-6 md:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#3794ff]"><Bell className="h-4 w-4" /> Attention queue</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#d4d4d4]">Alerts that need a decision</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9d9d9d]">Acknowledge, assign, escalate, or resolve server-backed trust findings. Every action updates the same remediation work item shown elsewhere in SPR.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <label className="flex min-w-56 items-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#181818] px-3 py-2.5"><Search className="h-4 w-4 text-[#6f6f6f]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search alerts" aria-label="Search alerts" className="min-w-0 flex-1 bg-transparent text-xs text-[#d4d4d4] outline-none placeholder:text-[#6f6f6f]" /></label>
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

      <section className="rounded-[28px] border border-[#3c3c3c] bg-[#252526] p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[#d4d4d4]">Trust finding queue</h2><p className="mt-1 text-xs text-[#9d9d9d]">{filteredAlerts.length} of {alerts.length} alert records shown</p></div><label className="flex items-center gap-2 text-xs text-[#9d9d9d]">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-lg border border-[#3c3c3c] bg-[#181818] px-2 py-1.5 text-xs text-[#d4d4d4] outline-none"><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label></div>
        <div className="space-y-2">
          {filteredAlerts.map((alert) => <button key={alert.id} onClick={() => setSelectedAlertId(alert.id)} className={`group flex w-full flex-col gap-4 rounded-md border p-4 text-left transition hover:-translate-y-0.5 hover:border-[#3794ff]/40 hover:bg-[#252526] md:flex-row md:items-center ${alert.status === 'Resolved' || alert.status === 'Cancelled' ? 'border-[#3c3c3c] opacity-60' : 'border-[#3c3c3c] bg-black/10'}`}>
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${alert.status === 'Resolved' ? 'border-[#3c3c3c] bg-[#252526] text-[#9d9d9d]' : severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity === 'Critical' ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</span>
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-[#3794ff]/40 bg-[#094771]/[.06] px-2 py-0.5 text-[10px] font-semibold text-[#3794ff]">{alert.clientName}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity}</span><span className="text-[10px] text-[#6f6f6f]">{alert.category}</span>{isEscalated(alert) && <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200"><ArrowUpCircle className="h-3 w-3" />Escalated</span>}</span><span className="mt-2 block truncate text-sm font-semibold text-[#d4d4d4] group-hover:text-[#d4d4d4]">{alert.title}</span><span className="mt-1 block truncate text-xs text-[#9d9d9d]">{alert.description}</span></span>
            <span className="flex shrink-0 items-center gap-3 md:flex-col md:items-end"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusStyles[alert.status]}`}>{alert.status}</span>{alert.ownerDisplay && <span className="flex items-center gap-1 text-[10px] text-[#9d9d9d]"><User className="h-3 w-3" />{alert.ownerDisplay}</span>}<span className="flex items-center gap-1 text-[10px] text-[#6f6f6f]"><Clock3 className="h-3 w-3" />{alert.timestamp || 'Timestamp not observed'}</span></span>
          </button>)}
          {filteredAlerts.length === 0 && <div className="rounded-md border border-dashed border-[#3c3c3c] px-5 py-14 text-center"><Bell className="mx-auto h-8 w-8 text-[#6f6f6f]" /><p className="mt-3 text-sm font-semibold text-[#d4d4d4]">No alert records match these filters.</p><p className="mt-1 text-xs text-[#6f6f6f]">Try another search or reset the queue filters.</p></div>}
        </div>
      </section>

      {selectedAlert && <AlertDrawer alert={selectedAlert} onClose={() => setSelectedAlertId(null)} onAlertAction={onAlertAction} />}
    </section>
  );
}

function SelectFilter({ icon, label, value, onChange, options }: { icon: ReactNode; label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="flex items-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#181818] px-3 py-2.5 text-xs text-[#9d9d9d]">{icon}<span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="bg-transparent font-semibold text-[#d4d4d4] outline-none">{options.map((option) => <option key={option} value={option}>{option === 'all' ? `All ${label.toLowerCase()}s` : option}</option>)}</select></label>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'rose' | 'amber' | 'emerald' }) {
  const styles = { rose: 'border-[#f14c4c]/40 bg-[#f14c4c]/15/[.05]', amber: 'border-amber-300/15 bg-amber-300/[.05]', emerald: 'border-[#89d185]/40 bg-[#89d185]/15' };
  return <div className={`rounded-md border p-4 ${styles[tone]}`}><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#9d9d9d]"><span className="h-4 w-4 text-[#9d9d9d]">{icon}</span>{label}</div><div className="mt-3 text-2xl font-semibold text-[#d4d4d4]">{value}</div></div>;
}

function AlertDrawer({ alert, onClose, onAlertAction }: { alert: Alert; onClose: () => void; onAlertAction: (alert: Alert, action: AlertAction, assigneeDisplay?: string) => Promise<void> }) {
  const [working, setWorking] = useState(false);
  const [assignee, setAssignee] = useState(alert.ownerDisplay || '');
  const [showAssign, setShowAssign] = useState(false);

  const run = async (action: AlertAction, extra?: string) => {
    setWorking(true);
    try { await onAlertAction(alert, action, extra); setShowAssign(false); } finally { setWorking(false); }
  };

  return <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
    <aside role="dialog" aria-modal="true" aria-label={`Alert details for ${alert.title}`} onMouseDown={(event) => event.stopPropagation()} className="h-full w-full max-w-xl overflow-y-auto border-l border-[#3c3c3c] bg-[#0a0f18] p-6 shadow-2xl md:p-8">
      <div className="flex items-start justify-between gap-4 border-b border-[#3c3c3c] pb-5"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#3794ff]"><ShieldAlert className="h-4 w-4" /> Finding detail</div><h2 className="mt-3 text-xl font-semibold text-[#d4d4d4]">{alert.title}</h2><p className="mt-1 font-mono text-xs text-[#6f6f6f]">{alert.id}</p></div><button onClick={onClose} aria-label="Close alert details" className="rounded-xl border border-[#3c3c3c] p-2 text-[#9d9d9d] hover:bg-[#252526] hover:text-[#d4d4d4]"><X className="h-4 w-4" /></button></div>
      <div className="mt-6 flex flex-wrap gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity}</span><span className="rounded-full border border-[#3c3c3c] bg-[#252526] px-2.5 py-1 text-[10px] text-[#9d9d9d]">{alert.category}</span><span className="rounded-full border border-[#3794ff]/40 bg-[#094771]/[.06] px-2.5 py-1 text-[10px] text-[#3794ff]">{alert.clientName}</span></div>
      <div className="mt-6 space-y-5">
        <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#6f6f6f]">Description</div><p className="mt-3 text-sm leading-7 text-[#d4d4d4]">{alert.description || 'No description observed.'}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="Observed timestamp" value={alert.timestamp || 'Not observed'} />
          <Detail label="Current workflow state" value={alert.status} />
          <Detail label="Assigned to" value={alert.ownerDisplay || 'Unassigned'} />
          <Detail label="SLA due" value={alert.slaDueAt ? new Date(alert.slaDueAt).toLocaleString() : 'No SLA set'} />
        </div>
      </div>
      <div className="mt-8 rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
        <div className="text-xs font-semibold text-[#d4d4d4]">Record a workflow decision</div>
        <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">Actions create or update the remediation work item tied to this finding, through the authenticated Trust Loop route.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {(alert.status === 'Active') && <button disabled={working} onClick={() => void run('acknowledge')} className="rounded-xl border border-[#3794ff]/40 bg-[#094771] px-3 py-2 text-xs font-semibold text-[#3794ff] disabled:opacity-40">Acknowledge</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => setShowAssign((open) => !open)} className="rounded-xl border border-[#3c3c3c] px-3 py-2 text-xs font-semibold text-[#d4d4d4] hover:bg-[#252526] disabled:opacity-40">Assign…</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => void run('escalate')} className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40">Escalate</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => void run('snooze')} className="rounded-xl border border-[#3c3c3c] px-3 py-2 text-xs font-semibold text-[#d4d4d4] hover:bg-[#252526] disabled:opacity-40">Snooze</button>}
          {(alert.status !== 'Resolved') && <button disabled={working} onClick={() => void run('resolve')} className="rounded-xl bg-emerald-400 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Mark resolved</button>}
          {alert.status === 'Snoozed' && <button disabled={working} onClick={() => void run('reopen')} className="rounded-xl border border-[#3794ff]/40 bg-[#094771] px-3 py-2 text-xs font-semibold text-[#3794ff] disabled:opacity-40">Restore active</button>}
          {alert.status === 'Resolved' && <div className="flex items-center gap-2 text-xs text-[#89d185]"><ShieldCheck className="h-4 w-4" />Resolved state recorded; new evidence is still required to verify the finding.</div>}
        </div>
        {showAssign && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#3c3c3c] bg-[#181818] p-3">
            <input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Name or email" className="min-w-0 flex-1 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] px-3 py-2 text-xs text-[#d4d4d4] outline-none placeholder:text-[#6f6f6f]" />
            <button disabled={working || !assignee.trim()} onClick={() => void run('assign', assignee.trim())} className="rounded-lg bg-[#0e639c] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Assign</button>
          </div>
        )}
      </div>
    </aside>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-[#3c3c3c] bg-black/15 p-4"><div className="text-[10px] uppercase tracking-[.16em] text-[#6f6f6f]">{label}</div><div className="mt-2 text-sm font-semibold text-[#d4d4d4]">{value}</div></div>;
}
