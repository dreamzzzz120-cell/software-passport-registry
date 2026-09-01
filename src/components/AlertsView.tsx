import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpCircle, Bell, Filter, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { Alert, AlertStatus } from '../types';

type AlertAction = 'acknowledge' | 'assign' | 'resolve' | 'escalate' | 'snooze' | 'reopen';

interface AlertsViewProps {
  alerts: Alert[];
  onAlertAction: (alert: Alert, action: AlertAction, assigneeDisplay?: string) => Promise<void>;
}

const severityDot: Record<string, string> = {
  Critical: 'bg-[#a4262c]',
  High: 'bg-[#8a5700]',
  Medium: 'bg-[#8a5700]',
  Low: 'bg-[#0f6cbd]',
};

const severityText: Record<string, string> = {
  Critical: 'text-[#a4262c]',
  High: 'text-[#8a5700]',
  Medium: 'text-[#8a5700]',
  Low: 'text-[#0f6cbd]',
};

const statusDot: Record<AlertStatus, string> = {
  Active: 'bg-[#a4262c]',
  Acknowledged: 'bg-[#0f6cbd]',
  Snoozed: 'bg-[#8a8886]',
  Resolved: 'bg-[#0e700e]',
  Cancelled: 'bg-[#8a8886]',
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
    <section className="space-y-4" id="msp-alerts-hub">
      <div>
        <h1 className="text-[22px] font-semibold text-[#201f1e]">Alerts</h1>
        <p className="mt-1 text-[13px] text-[#605e5c]">Acknowledge, assign, escalate or resolve server-backed trust findings that need a decision.</p>
      </div>

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>This queue lists trust findings that require a workflow decision. Every action here updates the same remediation work item shown elsewhere in SPR.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Search or filter the queue, then open an alert to see full detail.</li>
            <li>Acknowledge, assign, escalate, snooze or resolve — each action calls the authenticated Trust Loop route.</li>
            <li>Resolved does not mean verified: new evidence is still required to confirm a finding is fixed.</li>
          </ol>
        </div>
      </details>

      <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        <div><div className="text-[11px] text-[#605e5c]">Active attention</div><div className="text-lg font-semibold text-[#201f1e]">{activeCount}</div></div>
        <div><div className="text-[11px] text-[#605e5c]">Critical open</div><div className="text-lg font-semibold text-[#201f1e]">{criticalCount}</div></div>
        <div><div className="text-[11px] text-[#605e5c]">Resolved records</div><div className="text-lg font-semibold text-[#201f1e]">{resolvedCount}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-56 items-center gap-2 rounded border border-[#c8c6c4] bg-white px-3 focus-within:border-[#0f6cbd] focus-within:ring-1 focus-within:ring-[#0f6cbd]">
          <Search className="h-3.5 w-3.5 text-[#8a8886]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search alerts" aria-label="Search alerts" className="min-w-0 flex-1 bg-transparent text-[13px] text-[#201f1e] outline-none placeholder:text-[#8a8886]" />
        </label>
        <SelectFilter icon={<Filter className="h-3.5 w-3.5 text-[#8a8886]" />} label="Severity" value={severityFilter} onChange={setSeverityFilter} options={['all', 'Critical', 'High', 'Medium', 'Low']} />
        <SelectFilter icon={<Filter className="h-3.5 w-3.5 text-[#8a8886]" />} label="Status" value={statusFilter} onChange={setStatusFilter} options={['all', 'Active', 'Acknowledged', 'Snoozed', 'Resolved', 'Cancelled']} />
        <SelectFilter icon={<Filter className="h-3.5 w-3.5 text-[#8a8886]" />} label="Category" value={categoryFilter} onChange={setCategoryFilter} options={['all', ...categories]} />
      </div>

      <div className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e1dfdd] px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-[#201f1e]">Trust finding queue</h2>
          <p className="text-[12px] text-[#8a8886]">{filteredAlerts.length} of {alerts.length} alert records shown</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]">
                <th className="px-4 py-2.5 font-medium">Alert</th>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">Severity</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Observed</th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr
                  key={alert.id}
                  onClick={() => setSelectedAlertId(alert.id)}
                  className={`cursor-pointer border-b border-[#f3f2f1] text-[13px] hover:bg-black/[.02] ${alert.status === 'Resolved' || alert.status === 'Cancelled' ? 'opacity-60' : ''}`}
                >
                  <td className="max-w-xs px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-[#201f1e]">{alert.title}</span>
                      {isEscalated(alert) && <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#8a5700]"><ArrowUpCircle className="h-3 w-3" />Escalated</span>}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[#8a8886]">{alert.description}</div>
                  </td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{alert.clientName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 text-[13px] ${severityText[alert.severity] || 'text-[#605e5c]'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${severityDot[alert.severity] || 'bg-[#8a8886]'}`} />
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[13px] text-[#605e5c]">
                      <span className={`h-1.5 w-1.5 rounded-full ${statusDot[alert.status]}`} />
                      {alert.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[#605e5c]">{alert.ownerDisplay || 'Unassigned'}</td>
                  <td className="px-4 py-2.5 text-[#8a8886]">{alert.timestamp || 'Not observed'}</td>
                </tr>
              ))}
              {filteredAlerts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    <Bell className="mx-auto h-6 w-6 text-[#c8c6c4]" />
                    <p className="mt-2 text-[13px] font-medium text-[#323130]">No alert records match these filters.</p>
                    <p className="mt-1 text-[12px] text-[#8a8886]">Try another search or reset the queue filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedAlert && <AlertDrawer alert={selectedAlert} onClose={() => setSelectedAlertId(null)} onAlertAction={onAlertAction} />}
    </section>
  );
}

function SelectFilter({ icon, label, value, onChange, options }: { icon: ReactNode; label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="flex h-9 items-center gap-2 rounded border border-[#c8c6c4] bg-white px-3">
      {icon}
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="bg-transparent text-[13px] text-[#323130] outline-none">
        {options.map((option) => <option key={option} value={option}>{option === 'all' ? `All ${label.toLowerCase()}` : option}</option>)}
      </select>
    </label>
  );
}

function AlertDrawer({ alert, onClose, onAlertAction }: { alert: Alert; onClose: () => void; onAlertAction: (alert: Alert, action: AlertAction, assigneeDisplay?: string) => Promise<void> }) {
  const [working, setWorking] = useState(false);
  const [assignee, setAssignee] = useState(alert.ownerDisplay || '');
  const [showAssign, setShowAssign] = useState(false);

  const run = async (action: AlertAction, extra?: string) => {
    setWorking(true);
    try { await onAlertAction(alert, action, extra); setShowAssign(false); } finally { setWorking(false); }
  };

  return <div className="fixed inset-0 z-[70] flex justify-end bg-black/20" onMouseDown={onClose}>
    <aside role="dialog" aria-modal="true" aria-label={`Alert details for ${alert.title}`} onMouseDown={(event) => event.stopPropagation()} className="h-full w-full max-w-xl overflow-y-auto border-l border-[#e1dfdd] bg-white p-6">
      <div className="flex items-start justify-between gap-4 border-b border-[#e1dfdd] pb-4">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#0f6cbd]"><ShieldAlert className="h-3.5 w-3.5" /> Finding detail</div>
          <h2 className="mt-2 text-[18px] font-semibold text-[#201f1e]">{alert.title}</h2>
          <p className="mt-1 font-mono text-[11px] text-[#8a8886]">{alert.id}</p>
        </div>
        <button onClick={onClose} aria-label="Close alert details" className="rounded border border-[#c8c6c4] p-1.5 text-[#605e5c] hover:bg-black/[.03]"><X className="h-3.5 w-3.5" /></button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
        <span className={`inline-flex items-center gap-1.5 ${severityText[alert.severity] || 'text-[#605e5c]'}`}><span className={`h-1.5 w-1.5 rounded-full ${severityDot[alert.severity] || 'bg-[#8a8886]'}`} />{alert.severity}</span>
        <span className="text-[#8a8886]">{alert.category}</span>
        <span className="text-[#605e5c]">{alert.clientName}</span>
      </div>

      <div className="mt-4 space-y-4">
        <div className="rounded-md border border-[#e1dfdd] p-3">
          <div className="text-[11px] uppercase tracking-wide text-[#605e5c]">Description</div>
          <p className="mt-2 text-[13px] leading-6 text-[#323130]">{alert.description || 'No description observed.'}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Detail label="Observed timestamp" value={alert.timestamp || 'Not observed'} />
          <Detail label="Current workflow state" value={alert.status} />
          <Detail label="Assigned to" value={alert.ownerDisplay || 'Unassigned'} />
          <Detail label="SLA due" value={alert.slaDueAt ? new Date(alert.slaDueAt).toLocaleString() : 'No SLA set'} />
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
        <div className="text-[13px] font-semibold text-[#201f1e]">Record a workflow decision</div>
        <p className="mt-1 text-[12px] leading-5 text-[#605e5c]">Actions create or update the remediation work item tied to this finding, through the authenticated Trust Loop route.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(alert.status === 'Active') && <button disabled={working} onClick={() => void run('acknowledge')} className="h-8 rounded bg-[#0f6cbd] px-3 text-[12px] font-medium text-white hover:bg-[#004578] disabled:opacity-40">Acknowledge</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => setShowAssign((open) => !open)} className="h-8 rounded border border-[#c8c6c4] px-3 text-[12px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-40">Assign…</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => void run('escalate')} className="h-8 rounded border border-[#c8c6c4] px-3 text-[12px] font-medium text-[#8a5700] hover:bg-black/[.03] disabled:opacity-40">Escalate</button>}
          {(alert.status === 'Active' || alert.status === 'Acknowledged') && <button disabled={working} onClick={() => void run('snooze')} className="h-8 rounded border border-[#c8c6c4] px-3 text-[12px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-40">Snooze</button>}
          {(alert.status !== 'Resolved') && <button disabled={working} onClick={() => void run('resolve')} className="h-8 rounded bg-[#0e700e] px-3 text-[12px] font-medium text-white hover:bg-[#0e700e]/90 disabled:opacity-40">Mark resolved</button>}
          {alert.status === 'Snoozed' && <button disabled={working} onClick={() => void run('reopen')} className="h-8 rounded border border-[#c8c6c4] px-3 text-[12px] font-medium text-[#0f6cbd] hover:bg-black/[.03] disabled:opacity-40">Restore active</button>}
          {alert.status === 'Resolved' && <div className="flex items-center gap-1.5 text-[12px] text-[#0e700e]"><ShieldCheck className="h-3.5 w-3.5" />Resolved state recorded; new evidence is still required to verify the finding.</div>}
        </div>
        {showAssign && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-[#e1dfdd] bg-white p-2">
            <input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Name or email" className="h-9 min-w-0 flex-1 rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] outline-none placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
            <button disabled={working || !assignee.trim()} onClick={() => void run('assign', assignee.trim())} className="h-9 rounded bg-[#0f6cbd] px-3 text-[12px] font-medium text-white hover:bg-[#004578] disabled:opacity-40">Assign</button>
          </div>
        )}
      </div>
    </aside>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-[#e1dfdd] p-3"><div className="text-[11px] uppercase tracking-wide text-[#605e5c]">{label}</div><div className="mt-1 text-[13px] font-medium text-[#201f1e]">{value}</div></div>;
}
