import { useEffect, useState } from 'react';
import { AlertCircle, DollarSign, Loader2, Save } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Baseline = {
  hourlyRate: number | null; reportBaselineMinutes: number | null; questionnaireQuestionBaselineMinutes: number | null;
  vendorReviewBaselineMinutes: number | null; remediationBaselineMinutes: number | null;
  toolConsolidationMonthlyCost: number | null; sprMonthlyCost: number | null; updatedAt: string | null;
} | null;

type TimeSavingsLine = { label: string; count: number; minutesPerUnit: number | null; totalMinutes: number | null; basis: string; explanation: string };
type SavingsReport = {
  windowDays: number; hasBaseline: boolean;
  activity: { reportsGenerated: number; questionnaireItemsAnswered: number; questionnaireItemsNeedingReview: number; vendorAuditsCompleted: number; remediationsResolved: number };
  timeSavings: TimeSavingsLine[];
  laborValue: { hours: number | null; dollarValue: number | null; basis: string; explanation: string };
  toolConsolidation: { windowValue: number | null; basis: string; explanation: string };
  sprCost: { windowValue: number | null; basis: string; explanation: string };
  netValue: { value: number | null; basis: string; explanation: string };
  disclaimer: string;
};

const BASIS_STYLE: Record<string, string> = {
  MEASURED: 'text-[var(--spr-highlight)] border-[var(--spr-highlight)]/40', ESTIMATED: 'text-[var(--spr-green)] border-[var(--spr-green)]/40',
  CUSTOMER_PROVIDED: 'text-[#c586c0] border-[#c586c0]/40', INSUFFICIENT_DATA: 'text-[var(--spr-text-muted)] border-[var(--spr-border)]',
};

function money(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

const FIELDS: Array<{ key: keyof NonNullable<Baseline>; label: string; suffix: string }> = [
  { key: 'hourlyRate', label: 'Blended hourly labor rate', suffix: '$/hour' },
  { key: 'reportBaselineMinutes', label: 'Time to assemble a trust report by hand', suffix: 'minutes' },
  { key: 'questionnaireQuestionBaselineMinutes', label: 'Time to answer one questionnaire question by hand', suffix: 'minutes' },
  { key: 'vendorReviewBaselineMinutes', label: 'Time to complete one vendor audit review by hand', suffix: 'minutes' },
  { key: 'remediationBaselineMinutes', label: 'Time to track one remediation to resolution by hand', suffix: 'minutes' },
  { key: 'toolConsolidationMonthlyCost', label: 'Monthly savings from tools SPR let you retire', suffix: '$/month' },
  { key: 'sprMonthlyCost', label: 'What you pay for SPR', suffix: '$/month' },
];

export default function SavingsView({ role = 'Viewer' }: { role?: string }) {
  const canEdit = role === 'Owner' || role === 'Admin';
  const [windowDays, setWindowDays] = useState<30 | 60 | 90>(30);
  const [report, setReport] = useState<SavingsReport | null>(null);
  const [baseline, setBaseline] = useState<Baseline>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBaseline, setShowBaseline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = async (days: number) => {
    setLoading(true); setError('');
    try {
      const [reportRes, baselineRes] = await Promise.all([
        apiFetch(`/api/savings/report?windowDays=${days}`),
        apiFetch('/api/savings/baseline'),
      ]);
      if (!reportRes.ok) throw new Error('Unable to load the savings report.');
      setReport(await reportRes.json());
      if (baselineRes.ok) {
        const b: Baseline = await baselineRes.json();
        setBaseline(b);
        setForm(Object.fromEntries(FIELDS.map((f) => [f.key, b?.[f.key] != null ? String(b[f.key]) : ''])));
      }
    } catch (e: any) {
      setError(e?.message || 'Unable to load the savings report.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(windowDays); }, [windowDays]);

  const saveBaseline = async () => {
    setSaving(true); setSaveError('');
    try {
      const body: Record<string, number | null> = {};
      for (const f of FIELDS) {
        const raw = form[f.key]?.trim();
        body[f.key] = raw ? Number(raw) : null;
      }
      const response = await apiFetch('/api/savings/baseline', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.issues?.[0]?.message || 'Unable to save these baseline values.');
      setBaseline(data);
      await load(windowDays);
      setShowBaseline(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Unable to save these baseline values.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="mx-auto max-w-5xl space-y-6 pb-10">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-[var(--spr-highlight)]"><DollarSign className="h-4 w-4" /> Time & tool savings</div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--spr-text)]">ROI estimate</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Activity counts are measured directly from SPR's own records. Time and dollar figures are estimates built only from the baseline you enter below — SPR never assumes an industry-average number on your behalf.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex rounded-md border border-[var(--spr-border)] p-0.5">
          {[30, 60, 90].map((d) => (
            <button key={d} onClick={() => setWindowDays(d as 30 | 60 | 90)} className={`rounded px-3 py-1.5 text-xs font-semibold transition ${windowDays === d ? 'bg-[var(--spr-accent)] text-white' : 'text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-sunken)]'}`}>{d}d</button>
          ))}
        </div>
        {canEdit && <button onClick={() => setShowBaseline(true)} className="spr-btn spr-btn-secondary !text-xs">Edit baseline</button>}
      </div>
    </header>

    {error && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-4 py-3 text-sm text-[var(--spr-red)]">{error}</div>}

    {loading ? <div className="flex items-center gap-2 py-10 text-sm text-[var(--spr-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div> : report && (
      <div className="space-y-5">
        {!report.hasBaseline && (
          <div className="flex items-start gap-2 rounded-md border border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10 px-4 py-3 text-xs text-[var(--spr-amber)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>No time or cost baseline has been entered yet. Activity below is real and measured, but no dollar value can be estimated until {canEdit ? 'you enter one.' : 'an Owner or Admin enters one.'}</span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="spr-panel p-4"><div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Estimated hours saved</div><div className="mt-1 text-2xl font-bold text-[var(--spr-text)]">{report.laborValue.hours ?? '—'}</div><p className="mt-1 text-[11px] text-[var(--spr-text-faint)]">{report.laborValue.explanation}</p></div>
          <div className="spr-panel p-4"><div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Estimated labor value</div><div className="mt-1 text-2xl font-bold text-[var(--spr-text)]">{money(report.laborValue.dollarValue)}</div><span className={`mt-1 inline-block rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase ${BASIS_STYLE[report.laborValue.basis]}`}>{report.laborValue.basis.replace('_', ' ')}</span></div>
          <div className="spr-panel p-4"><div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Net value ({report.windowDays}d)</div><div className="mt-1 text-2xl font-bold text-[var(--spr-text)]">{money(report.netValue.value)}</div><p className="mt-1 text-[11px] text-[var(--spr-text-faint)]">{report.netValue.explanation}</p></div>
        </div>

        <div className="spr-panel p-5">
          <h3 className="text-sm font-bold text-[var(--spr-text)]">Measured activity, this window</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-5 text-center">
            {[
              ['Reports generated', report.activity.reportsGenerated],
              ['Questions answered', report.activity.questionnaireItemsAnswered],
              ['Needing review', report.activity.questionnaireItemsNeedingReview],
              ['Vendor audits', report.activity.vendorAuditsCompleted],
              ['Remediations resolved', report.activity.remediationsResolved],
            ].map(([label, count]) => (
              <div key={label as string} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3">
                <div className="text-xl font-bold text-[var(--spr-text)]">{count as number}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--spr-text-faint)]">{label as string}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="spr-panel p-5">
          <h3 className="text-sm font-bold text-[var(--spr-text)]">Time savings breakdown</h3>
          <div className="mt-3 space-y-2.5">
            {report.timeSavings.map((line) => (
              <div key={line.label} className="flex items-start justify-between gap-3 border-b border-[var(--spr-border)] pb-2.5 last:border-0 last:pb-0">
                <div>
                  <p className="text-xs font-semibold text-[var(--spr-text)]">{line.label} <span className="text-[var(--spr-text-faint)]">({line.count})</span></p>
                  <p className="mt-0.5 text-[11px] text-[var(--spr-text-faint)]">{line.explanation}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold text-[var(--spr-text)]">{line.totalMinutes !== null ? `${line.totalMinutes} min` : '—'}</div>
                  <span className={`mt-0.5 inline-block rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase ${BASIS_STYLE[line.basis]}`}>{line.basis.replace('_', ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="spr-panel p-4"><div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Tool consolidation, this window</div><div className="mt-1 text-lg font-bold text-[var(--spr-text)]">{money(report.toolConsolidation.windowValue)}</div><p className="mt-1 text-[11px] text-[var(--spr-text-faint)]">{report.toolConsolidation.explanation}</p></div>
          <div className="spr-panel p-4"><div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">SPR cost, this window</div><div className="mt-1 text-lg font-bold text-[var(--spr-text)]">{money(report.sprCost.windowValue)}</div><p className="mt-1 text-[11px] text-[var(--spr-text-faint)]">{report.sprCost.explanation}</p></div>
        </div>

        <p className="text-xs italic leading-5 text-[var(--spr-text-faint)]">{report.disclaimer}</p>
      </div>
    )}

    {showBaseline && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-lg rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 shadow-2xl">
          <h2 className="text-lg font-bold text-[var(--spr-text)]">Edit savings baseline</h2>
          <p className="mt-1 text-xs text-[var(--spr-text-muted)]">These are your own numbers. Leave any field blank if you don't know it yet — SPR will show that figure as not yet available rather than guessing.</p>
          <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {saveError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-3 py-2.5 text-xs text-[var(--spr-red)]">{saveError}</div>}
            {FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[var(--spr-text-muted)]">{f.label} <span className="text-[var(--spr-text-faint)]">({f.suffix})</span></label>
                <input type="number" min="0" step="any" value={form[f.key] ?? ''} onChange={(e) => setForm((cur) => ({ ...cur, [f.key]: e.target.value }))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)]" />
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setShowBaseline(false)} className="rounded-md border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]">Cancel</button>
            <button onClick={() => void saveBaseline()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spr-accent)] px-3.5 py-2 text-xs font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    )}
  </div>;
}
