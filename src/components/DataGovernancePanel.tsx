/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Settings panel for the two data-governance controls a workspace Owner
 * signs off on: the Data Processing Agreement (execute once per version,
 * download the signed copy) and the retention policy the worker enforces.
 * Both talk to real endpoints; nothing here is stored in the browser.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FileSignature, FileDown, Clock3 } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { buildDpaPdf, type DpaExecutionView } from '../lib/dpaPdf';

interface DpaState {
  current: { version: string; effectiveDate: string; sha256: string };
  execution: DpaExecutionView | null;
  executionEnabled: boolean;
}

interface RetentionPolicy { auditDays: number; evidenceDays: number; notificationDays: number; updatedAt: string | null }

export default function DataGovernancePanel({ role }: { role: string }) {
  const isOwner = role === 'Owner';
  const canEditRetention = role === 'Owner' || role === 'Admin';

  const [dpa, setDpa] = useState<DpaState | null>(null);
  const [dpaError, setDpaError] = useState('');
  const [form, setForm] = useState({ customerLegalName: '', signatoryName: '', signatoryTitle: '', accept: false });
  const [executing, setExecuting] = useState(false);

  const [retention, setRetention] = useState<RetentionPolicy | null | undefined>(undefined);
  const [retentionDraft, setRetentionDraft] = useState({ auditDays: 2555, evidenceDays: 730, notificationDays: 180 });
  const [retentionError, setRetentionError] = useState('');
  const [retentionSaved, setRetentionSaved] = useState('');
  const [savingRetention, setSavingRetention] = useState(false);

  const loadDpa = useCallback(async () => {
    try {
      const response = await apiFetch('/api/organization/dpa');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setDpa(await response.json());
    } catch (err) { setDpaError(err instanceof Error ? err.message : 'unavailable'); }
  }, []);

  const loadRetention = useCallback(async () => {
    if (!canEditRetention) { setRetention(null); return; }
    try {
      const response = await apiFetch('/api/commercial/retention');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const row = await response.json();
      setRetention(row);
      if (row) setRetentionDraft({ auditDays: row.auditDays, evidenceDays: row.evidenceDays, notificationDays: row.notificationDays });
    } catch (err) { setRetentionError(err instanceof Error ? err.message : 'unavailable'); setRetention(null); }
  }, [canEditRetention]);

  useEffect(() => { void loadDpa(); void loadRetention(); }, [loadDpa, loadRetention]);

  const execute = async (event: FormEvent) => {
    event.preventDefault();
    setExecuting(true); setDpaError('');
    try {
      const response = await apiFetch('/api/organization/dpa/execute', { method: 'POST', body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setDpaError(data?.message || data?.error || `HTTP ${response.status}`); return; }
      await loadDpa();
    } catch (err) { setDpaError(err instanceof Error ? err.message : 'Network error.'); }
    finally { setExecuting(false); }
  };

  const saveRetention = async (event: FormEvent) => {
    event.preventDefault();
    setSavingRetention(true); setRetentionError(''); setRetentionSaved('');
    try {
      const response = await apiFetch('/api/commercial/retention', { method: 'PUT', body: JSON.stringify(retentionDraft) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setRetentionError(data?.error || `HTTP ${response.status}`); return; }
      setRetention(data);
      setRetentionSaved(`Saved ${new Date(data.updatedAt).toLocaleString()}.`);
    } catch (err) { setRetentionError(err instanceof Error ? err.message : 'Network error.'); }
    finally { setSavingRetention(false); }
  };

  const download = () => {
    if (!dpa?.execution) return;
    const doc = buildDpaPdf(dpa.execution);
    doc.save(`SPR-DPA-${dpa.execution.documentVersion}-${dpa.execution.customerLegalName.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`);
  };

  const numberField = (key: keyof typeof retentionDraft, label: string, hint: string) => (
    <label className="block text-xs">
      <span className="font-semibold text-[var(--spr-text)]">{label}</span>
      <input type="number" min={30} max={3650} value={retentionDraft[key]} disabled={!canEditRetention} onChange={(e) => setRetentionDraft((d) => ({ ...d, [key]: Number(e.target.value) }))} className="mt-1 w-full rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs" />
      <span className="mt-1 block text-[11px] text-[var(--spr-text-faint)]">{hint}</span>
    </label>
  );

  return (
    <div className="spr-panel p-5 space-y-5">
      <h3 className="text-xs font-bold text-[var(--spr-text)] flex items-center gap-1.5 pb-2 border-b border-[var(--spr-border)]">
        <FileSignature className="w-4.5 h-4.5 text-[var(--spr-highlight)]" />
        <span>Data Processing Agreement & Retention</span>
      </h3>

      <div className="space-y-3 text-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="font-semibold text-[var(--spr-text)] block">Data Processing Agreement</span>
            <p className="text-[12px] text-[var(--spr-text-muted)] leading-snug mt-1">
              {dpa ? <>Current version <code>{dpa.current.version}</code> (effective {dpa.current.effectiveDate}), SHA-256 <code title={dpa.current.sha256}>{dpa.current.sha256.slice(0, 16)}…</code>. Read it at <a href="/dpa" target="_blank" rel="noreferrer" className="text-[var(--spr-highlight)] hover:underline">/dpa</a>.</> : dpaError ? `Could not load DPA status (${dpaError}).` : 'Loading…'}
            </p>
          </div>
        </div>

        {dpa?.execution ? (
          <div className="rounded-lg border border-[var(--spr-green)]/40 bg-[var(--spr-green)]/5 p-3.5">
            <div className="font-semibold text-[var(--spr-text)]">Executed {dpa.execution.isCurrentVersion ? '' : `(version ${dpa.execution.documentVersion} — a newer version ${dpa.current.version} is available)`}</div>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-[12px] md:grid-cols-2">
              <div><dt className="text-[var(--spr-text-faint)]">Customer</dt><dd className="text-[var(--spr-text)]">{dpa.execution.customerLegalName}</dd></div>
              <div><dt className="text-[var(--spr-text-faint)]">Signatory</dt><dd className="text-[var(--spr-text)]">{dpa.execution.signatoryName}, {dpa.execution.signatoryTitle} ({dpa.execution.signatoryEmail})</dd></div>
              <div><dt className="text-[var(--spr-text-faint)]">Executed</dt><dd className="text-[var(--spr-text)]">{new Date(dpa.execution.executedAt).toLocaleString()}</dd></div>
              <div><dt className="text-[var(--spr-text-faint)]">Execution id</dt><dd className="text-[var(--spr-text)]"><code>{dpa.execution.id}</code></dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={download} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)]"><FileDown className="h-3.5 w-3.5" /> Download signed PDF</button>
              <a href={dpa.execution.verifyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">Verify signature</a>
            </div>
          </div>
        ) : dpa && (
          !dpa.executionEnabled ? (
            <p className="rounded-lg border border-dashed border-[var(--spr-amber)]/50 p-3 text-[12px] text-[var(--spr-amber)]">Electronic execution is unavailable: this deployment has no document-signing secret configured, so a signed record could not be produced. The agreement can still be read at /dpa.</p>
          ) : (
            <form onSubmit={execute} className="space-y-3 rounded-lg border border-dashed border-[var(--spr-border)] p-3.5">
              <p className="text-[12px] text-[var(--spr-text-muted)]">Not yet executed for this workspace. {isOwner ? 'Execute it here as the workspace Owner; the record is signed by the server and downloadable as a PDF.' : 'Only the workspace Owner can execute it.'}</p>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block"><span className="font-semibold text-[var(--spr-text)]">Customer legal name</span><input required minLength={2} maxLength={200} disabled={!isOwner} value={form.customerLegalName} onChange={(e) => setForm((f) => ({ ...f, customerLegalName: e.target.value }))} className="mt-1 w-full rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs" /></label>
                <label className="block"><span className="font-semibold text-[var(--spr-text)]">Signatory name</span><input required minLength={2} maxLength={120} disabled={!isOwner} value={form.signatoryName} onChange={(e) => setForm((f) => ({ ...f, signatoryName: e.target.value }))} className="mt-1 w-full rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs" /></label>
                <label className="block"><span className="font-semibold text-[var(--spr-text)]">Signatory title</span><input required minLength={2} maxLength={120} disabled={!isOwner} value={form.signatoryTitle} onChange={(e) => setForm((f) => ({ ...f, signatoryTitle: e.target.value }))} className="mt-1 w-full rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 text-xs" /></label>
              </div>
              <label className="flex items-start gap-2 text-[12px] text-[var(--spr-text-muted)]"><input type="checkbox" required disabled={!isOwner} checked={form.accept} onChange={(e) => setForm((f) => ({ ...f, accept: e.target.checked }))} className="mt-0.5" /><span>I am authorised to bind the customer named above and accept the Data Processing Agreement version {dpa.current.version} on its behalf.</span></label>
              {dpaError && <p className="text-[12px] text-[var(--spr-red)]">{dpaError}</p>}
              <button type="submit" disabled={!isOwner || executing || !form.accept} className="rounded-lg bg-[var(--spr-accent)] px-3 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">{executing ? 'Recording…' : 'Execute DPA'}</button>
            </form>
          )
        )}
      </div>

      <div className="space-y-3 border-t border-[var(--spr-border)] pt-4 text-xs">
        <div>
          <span className="font-semibold text-[var(--spr-text)] flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> Retention policy</span>
          <p className="text-[12px] text-[var(--spr-text-muted)] leading-snug mt-1">
            {retention === undefined ? 'Loading…' : retention ? `Enforced by the scheduled retention worker; last updated ${retention.updatedAt ? new Date(retention.updatedAt).toLocaleString() : 'unknown'}.` : 'No policy is set, so nothing is purged on a schedule: notifications, billing audit events and intake files are retained indefinitely until you save one.'}
          </p>
        </div>
        <form onSubmit={saveRetention} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            {numberField('notificationDays', 'Notification records (days)', 'Queued email/in-app notifications older than this are deleted.')}
            {numberField('auditDays', 'Billing audit events (days)', 'Billing audit events older than this are deleted. The hash-chained security audit trail is never purged.')}
            {numberField('evidenceDays', 'Intake files (days)', 'Files uploaded through Universal Intake are marked deleted after this.')}
          </div>
          {retentionError && <p className="text-[12px] text-[var(--spr-red)]">{retentionError}</p>}
          {retentionSaved && <p className="text-[12px] text-[var(--spr-green)]">{retentionSaved}</p>}
          <button type="submit" disabled={!canEditRetention || savingRetention} className="rounded-lg border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">{savingRetention ? 'Saving…' : retention ? 'Update retention policy' : 'Set retention policy'}</button>
          {!canEditRetention && <span className="ml-2 text-[11px] text-[var(--spr-amber)]">Owner or Admin required.</span>}
        </form>
      </div>
    </div>
  );
}
