import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpCircle, Bell, CheckCircle2, Clock3, Filter, Search, ShieldAlert, ShieldCheck, User, X } from 'lucide-react';
import type { Alert, AlertStatus } from '../types';

type AlertAction = 'acknowledge' | 'assign' | 'resolve' | 'escalate' | 'snooze' | 'reopen';

interface AlertsViewProps {
  alerts: Alert[];
  onAlertAction: (alert: Alert, action: AlertAction, assigneeDisplay?: string) => Promise<void>;
}

const severityStyles: Record<string, string> = {
  Critical: 'border-rose-300/25 bg-rose-300/10 text-rose-200',
  High: 'border-amber-300/25 bg-amber-300/10 text-amber-200',
  Medium: 'border-yellow-300/25 bg-yellow-300/10 text-yellow-200',
  Low: 'border-cyan-300/20 bg-cyan-300/[.06] text-cyan-200',
};

const statusStyles: Record<AlertStatus, string> = {
  Active: 'border-rose-300/20 bg-rose-300/[.06] text-rose-200',
  Acknowledged: 'border-cyan-300/20 bg-cyan-300/[.06] text-cyan-200',
  Snoozed: 'border-white/10 bg-white/[.04] text-slate-400',
  Resolved: 'border-emerald-300/20 bg-emerald-300/[.06] text-emerald-200',
  Cancelled: 'border-white/10 bg-white/[.04] text-slate-500',
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
      <header className="rounded-[28px] border border-white/10 bg-white/[.035] p-6 backdrop-blur-2xl md:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200"><Bell className="h-4 w-4" /> Attention queue</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Alerts that need a decision</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Acknowledge, assign, escalate, or resolve server-backed trust findings. Every action updates the same remediation work item shown elsewhere in SPR.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <label className="flex min-w-56 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"><Search className="h-4 w-4 text-slate-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search alerts" aria-label="Search alerts" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-slate-600" /></label>
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

      <section className="rounded-[28px] border border-white/10 bg-white/[.025] p-4 backdrop-blur-xl md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-white">Trust finding queue</h2><p className="mt-1 text-xs text-slate-500">{filteredAlerts.length} of {alerts.length} alert records shown</p></div><label className="flex items-center gap-2 text-xs text-slate-500">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200 outline-none"><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label></div>
        <div className="space-y-2">
          {filteredAlerts.map((alert) => <button key={alert.id} onClick={() => setSelectedAlertId(alert.id)} className={`group flex w-full flex-col gap-4 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/20 hover:bg-white/[.04] md:flex-row md:items-center ${alert.status === 'Resolved' || alert.status === 'Cancelled' ? 'border-white/[.06] opacity-60' : 'border-white/[.08] bg-black/10'}`}>
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${alert.status === 'Resolved' ? 'border-white/10 bg-white/[.04] text-slate-500' : severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity === 'Critical' ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</span>
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-indigo-300/15 bg-indigo-300/[.06] px-2 py-0.5 text-[10px] font-semibold text-indigo-200">{alert.clientName}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity}</span><span className="text-[10px] text-slate-600">{alert.category}</span>{isEscalated(alert) && <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200"><ArrowUpCircle className="h-3 w-3" />Escalated</span>}</span><span className="mt-2 block truncate text-sm font-semibold text-slate-200 group-hover:text-white">{alert.title}</span><span className="mt-1 block truncate text-xs text-slate-500">{alert.description}</span></span>
            <span className="flex shrink-0 items-center gap-3 md:flex-col md:items-end"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusStyles[alert.status]}`}>{alert.status}</span>{alert.ownerDisplay && <span className="flex items-center gap-1 text-[10px] text-slate-500"><User className="h-3 w-3" />{alert.ownerDisplay}</span>}<span className="flex items-center gap-1 text-[10px] text-slate-600"><Clock3 className="h-3 w-3" />{alert.timestamp || 'Timestamp not observed'}</span></span>
          </button>)}
          {filteredAlerts.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-5 py-14 text-center"><Bell className="mx-auto h-8 w-8 text-slate-700" /><p className="mt-3 text-sm font-semibold text-slate-300">No alert records match these filters.</p><p className="mt-1 text-xs text-slate-600">Try another search or reset the queue filters.</p></div>}
        </div>
      </section>

      {selectedAlert && <AlertDrawer alert={selectedAlert} onClose={() => setSelectedAlertId(null)} onAlertAction={onAlertAction} />}
    </section>
  );
}

function SelectFilter({ icon, label, value, onChange, options }: { icon: ReactNode; label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-slate-500">{icon}<span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="bg-transparent font-semibold text-slate-200 outline-none">{options.map((option) => <option key={option} value={option}>{option === 'all' ? `All ${label.toLowerCase()}s` : option}</option>)}</select></label>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'rose' | 'amber' | 'emerald' }) {
  const styles = { rose: 'border-rose-300/15 bg-rose-300/[.05]', amber: 'border-amber-300/15 bg-amber-300/[.05]', emerald: 'border-emerald-300/15 bg-emerald-300/[.05]' };
  return <div className={`rounded-2xl border p-4 ${styles[tone]}`}><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-500"><span className="h-4 w-4 text-slate-400">{icon}</span>{label}</div><div className="mt-3 text-2xl font-semibold text-white">{value}</div></div>;
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
    <aside role="dialog" aria-modal="true" aria-label={`Alert details for ${alert.title}`} onMouseDown={(event) => event.stopPropagation()} className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0a0f18] p-6 shadow-2xl md:p-8">
      <div className="flex items-start justify-between gap-4 border-b border-white/[.07] pb-5"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200"><ShieldAlert className="h-4 w-4" /> Finding detail</div><h2 className="mt-3 text-xl font-semibold text-white">{alert.title}</h2><p className="mt-1 font-mono text-xs text-slate-600">{alert.id}</p></div><button onClick={onClose} aria-label="Close alert details" className="rounded-xl border border-white/10 p-2 text-slate-500 hover:bg-white/[.05] hover:text-white"><X className="h-4 w-4" /></button></div>
      <div className="mt-6 flex flex-wrap gap-2"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${severityStyles[alert.severity] || severityStyles.Low}`}>{alert.severity}</span><span className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-[10px] text-slate-400">{alert.category}</span><span className="rounded-full border border-indigo-300/15 bg-indigo-300/[.06] px-2.5 py-1 text-[10px] text-indigo-200">{alert.clientName}</span></div>
      <div className="mt-6 space-y-5">
        <div className="rounded-2xl border border-white/[.08] bg-white/[.025] p-5"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-600">Description</div><p className="mt-3 text-sm leading-7 text-slate-300">{alert.description || 'No description observed.'}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="Observed timestamp" value={alert.timestamp || 'Not observed'} />
          <Detail label="Current workflow state" value={alert.status} />
          <Detail label="Assigned to" value={alert.ownerDisplay || 'Unassigned'} />
          <Detail label="SLA due" value={alert.slaDueAt ? new Date(alert.slaDueAt).toLocaleString() : 'No SLA set'} />
        </div>
      </div>
      <div className="mt-8 rounded-2xl border border-white/[.08] bg-white/[.025] p-5">
        <div className="text-xs font-semibold text-white">Record a workflow decision</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">Actions create or update the remediation work item tied to this finding, through the authenticated Trust Loop route.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {(alert.status === 'Active') && <button disabled={working} onClick={() => void run('acknowledge')} className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40">Acknowledge</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => setShowAssign((open) => !open)} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[.05] disabled:opacity-40">Assign…</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => void run('escalate')} className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40">Escalate</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => void run('snooze')} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[.05] disabled:opacity-40">Snooze</button>}
          {(alert.status !== 'Resolved') && <button disabled={working} onClick={() => void run('resolve')} className="rounded-xl bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">Mark resolved</button>}
          {alert.status === 'Snoozed' && <button disabled={working} onClick={() => void run('reopen')} className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40">Restore active</button>}
          {alert.status === 'Resolved' && <div className="flex items-center gap-2 text-xs text-emerald-200"><ShieldCheck className="h-4 w-4" />Resolved state recorded; new evidence is still required to verify the finding.</div>}
        </div>
        {showAssign && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/[.08] bg-black/20 p-3">
            <input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Name or email" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none placeholder:text-slate-600" />
            <button disabled={working || !assignee.trim()} onClick={() => void run('assign', assignee.trim())} className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">Assign</button>
          </div>
        )}
      </div>
    </aside>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4"><div className="text-[10px] uppercase tracking-[.16em] text-slate-600">{label}</div><div className="mt-2 text-sm font-semibold text-slate-200">{value}</div></div>;
}
