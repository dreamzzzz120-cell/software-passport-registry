import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Mail, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';

type Schedule = {
  id: string;
  passportId: string;
  reportType: string;
  cadence: 'weekly' | 'monthly' | string;
  recipientEmails: string[];
  nextRunAt: string;
  enabled: boolean;
  lastRunAt?: string | null;
};

type RawSchedule = Partial<Schedule> & {
  passport_id?: string;
  report_type?: string;
  recipient_emails?: string[];
  next_run_at?: string;
  last_run_at?: string | null;
};

const REPORT_TYPES = [
  ['executive', 'Executive trust report'],
  ['technical', 'Technical / engineering'],
  ['compliance', 'Compliance (by control)'],
  ['sbom', 'SBOM report'],
  ['vendor', 'Vendor risk'],
  ['msp', 'MSP / client'],
  ['customer', 'Customer-facing'],
  ['auditor', 'Auditor'],
  ['evidence-ledger', 'Evidence ledger'],
] as const;

const OWNER_ROLES = new Set(['Owner', 'Admin']);

function normalizeSchedule(value: RawSchedule): Schedule {
  return {
    id: String(value.id || ''),
    passportId: String(value.passportId || value.passport_id || ''),
    reportType: String(value.reportType || value.report_type || 'executive'),
    cadence: String(value.cadence || 'weekly'),
    recipientEmails: Array.isArray(value.recipientEmails)
      ? value.recipientEmails.map(String)
      : Array.isArray(value.recipient_emails)
        ? value.recipient_emails.map(String)
        : [],
    nextRunAt: String(value.nextRunAt || value.next_run_at || ''),
    enabled: value.enabled !== false,
    lastRunAt: value.lastRunAt || value.last_run_at || null,
  };
}

export default function ReportSchedulePanel({ passports, role = 'Viewer' }: { passports: SoftwarePassport[]; role?: string }) {
  const canManage = OWNER_ROLES.has(role);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [passportId, setPassportId] = useState(passports[0]?.id || '');
  const [reportType, setReportType] = useState('executive');
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>('weekly');
  const [recipients, setRecipients] = useState('');

  useEffect(() => {
    if (!passports.some((passport) => passport.id === passportId)) setPassportId(passports[0]?.id || '');
  }, [passports, passportId]);

  const loadSchedules = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/report-schedules');
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error?.message || payload?.error || `Unable to load schedules (${response.status})`));
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.schedules) ? payload.schedules : [];
      setSchedules(rows.map(normalizeSchedule));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load schedules.');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { void loadSchedules(); }, [loadSchedules]);

  const submitSchedule = async () => {
    const emails = [...new Set(recipients.split(/[,\n\s]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (!passportId || !emails.length) {
      setError('Choose a passport and enter at least one recipient email.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/report-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passportId, reportType, cadence, recipientEmails: emails }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error?.message || payload?.error || `Unable to create schedule (${response.status})`));
      setRecipients('');
      setNotice('Report schedule created.');
      await loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create schedule.');
    } finally {
      setSaving(false);
    }
  };

  const updateSchedule = async (schedule: Schedule, enabled: boolean) => {
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/report-schedules/${encodeURIComponent(schedule.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error?.message || payload?.error || `Unable to update schedule (${response.status})`));
      setNotice(enabled ? 'Schedule resumed.' : 'Schedule paused.');
      await loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update schedule.');
    }
  };

  const deleteSchedule = async (schedule: Schedule) => {
    if (!window.confirm('Delete this scheduled report?')) return;
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/report-schedules/${encodeURIComponent(schedule.id)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error?.message || payload?.error || `Unable to delete schedule (${response.status})`));
      setNotice('Schedule deleted.');
      await loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete schedule.');
    }
  };

  const passportName = useMemo(() => new Map(passports.map((passport) => [passport.id, `${passport.name} · ${passport.version}`])), [passports]);

  if (!canManage) {
    return (
      <div className="spr-panel p-6" data-testid="report-schedules">
        <div className="flex items-center gap-2"><CalendarClock size={18} className="text-[var(--spr-highlight)]" /><h2 className="text-lg font-semibold">Scheduled report delivery</h2></div>
        <p className="mt-2 text-sm text-[var(--spr-text-muted)]">Schedule management is restricted to Owner and Admin roles.</p>
      </div>
    );
  }

  return (
    <div className="spr-panel p-6" data-testid="report-schedules">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2"><CalendarClock size={18} className="text-[var(--spr-highlight)]" /><h2 className="text-lg font-semibold">Scheduled report delivery</h2></div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Automatically deliver the same evidence-backed PDF to selected recipients on a weekly or monthly cadence. Delivery runs through SPR’s existing notification pipeline.</p>
        </div>
        <button onClick={() => void loadSchedules()} disabled={loading} className="inline-flex items-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)] disabled:opacity-40" aria-label="Refresh schedules"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      <div className="mt-5 grid gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4 lg:grid-cols-[1.2fr_1fr_.8fr_1.4fr_auto]">
        <label className="text-xs text-[var(--spr-text-muted)]">Passport<select value={passportId} onChange={(event) => setPassportId(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-sm text-[var(--spr-text)]">{passports.length === 0 && <option value="">No passports</option>}{passports.map((passport) => <option key={passport.id} value={passport.id}>{passport.name} · {passport.version}</option>)}</select></label>
        <label className="text-xs text-[var(--spr-text-muted)]">Report type<select value={reportType} onChange={(event) => setReportType(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-sm text-[var(--spr-text)]">{REPORT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs text-[var(--spr-text-muted)]">Cadence<select value={cadence} onChange={(event) => setCadence(event.target.value as 'weekly' | 'monthly')} className="mt-1 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-sm text-[var(--spr-text)]"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <label className="text-xs text-[var(--spr-text-muted)]">Recipients<sup className="ml-1">comma or space separated</sup><div className="relative"><Mail size={14} className="pointer-events-none absolute left-3 top-2.5 text-[var(--spr-text-faint)]" /><input value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="security@example.com" className="mt-1 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] py-2 pl-9 pr-3 text-sm text-[var(--spr-text)] placeholder:text-[var(--spr-text-faint)]" /></div></label>
        <button onClick={() => void submitSchedule()} disabled={saving || !passportId || !recipients.trim()} className="inline-flex items-center justify-center gap-2 self-end rounded-md bg-[var(--spr-accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><Plus size={16} /> {saving ? 'Saving…' : 'Schedule'}</button>
      </div>

      {(error || notice) && <p className={`mt-3 text-xs ${error ? 'text-[var(--spr-red)]' : 'text-[var(--spr-green)]'}`} role="status">{error || notice}</p>}

      <div className="mt-5 space-y-2">
        {schedules.length === 0 && !loading && <div className="rounded-md border border-dashed border-[var(--spr-border)] p-5 text-sm text-[var(--spr-text-muted)]">No scheduled reports yet.</div>}
        {schedules.map((schedule) => (
          <div key={schedule.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-sm text-[var(--spr-text)]">{passportName.get(schedule.passportId) || schedule.passportId}</span><span className="rounded-full border border-[var(--spr-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--spr-text-muted)]">{schedule.reportType}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${schedule.enabled ? 'border-[var(--spr-green)]/30 text-[var(--spr-green)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{schedule.enabled ? 'Active' : 'Paused'}</span></div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--spr-text-muted)]"><span>{schedule.cadence}</span><span>Next: {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : 'not scheduled'}</span>{schedule.lastRunAt && <span>Last: {new Date(schedule.lastRunAt).toLocaleString()}</span>}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-[var(--spr-text-faint)]">{schedule.recipientEmails.map((email) => <span key={email} className="rounded bg-[var(--spr-surface)] px-1.5 py-0.5">{email}</span>)}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => void updateSchedule(schedule, !schedule.enabled)} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)]">{schedule.enabled ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}</button>
                <button onClick={() => void deleteSchedule(schedule)} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-surface)] px-3 py-2 text-xs font-semibold text-[var(--spr-red)]"><Trash2 size={14} /> Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
