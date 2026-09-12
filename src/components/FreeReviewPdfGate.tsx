/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type FormEvent } from 'react';
import { FileDown, Lock } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { apiFetch } from '../utils/apiClient';

// The PDF is rendered here, in the browser, from the result the visitor can
// already see on screen -- nothing the server withheld is added to it. The
// gate exists to capture an email for a real result someone wanted to
// keep, not to hide content behind a form.
type Props = {
  passportId: string;
  statusUrl: string;
  result: any;
  repositoryLabel: string;
};

export const CONSENT_TEXT = 'SPR may email you about this review and related services. Unsubscribe any time.';

function buildPdf(result: any, repositoryLabel: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const generatedAt = new Date().toISOString();
  doc.setFontSize(18); doc.text('Free Software Review', 40, 50);
  doc.setFontSize(11); doc.text(repositoryLabel, 40, 70);
  doc.setFontSize(9); doc.setTextColor(90);
  doc.text(`Software Passport Registry Ltd. · generated ${generatedAt} · passport ${result.passportId}`, 40, 86);
  doc.text(`Scan status: ${result.scanStatus}${result.failureReason ? ` — ${result.failureReason}` : ''}`, 40, 100);
  doc.setTextColor(20);

  const a = result.assessment;
  const summaryRows: string[][] = [
    ['Trust score', a?.score === null || a?.score === undefined ? 'Not measured' : `${a.score} / 100 — ${a.verdict ?? ''}`],
    ['Areas observed', a ? `${a.observedAreas} of ${a.totalAreas}` : 'Not measured'],
    ['SBOM components', result.sbom?.componentCount ?? 'Not measured'],
    ['Open findings', String(result.summary?.openFindings ?? 0)],
    ['Critical or high', String(result.summary?.criticalOrHigh ?? 0)],
    ['Evidence items', `${result.evidence?.total ?? 0} (verified ${result.evidence?.verified ?? 0})`],
  ].map((r) => r.map(String));
  autoTable(doc, { startY: 112, head: [['Summary', 'Observed value']], body: summaryRows, styles: { fontSize: 9 }, headStyles: { fillColor: [31, 95, 122] } });

  const catRows = a ? Object.entries(a.categories || {}).map(([k, v]: [string, any]) => [k, v.status === 'scored' ? `${v.score} / 100` : 'Not observed', v.status === 'scored' ? v.detail : v.reason]) : [];
  if (catRows.length) autoTable(doc, { startY: (doc as any).lastAutoTable.finalY + 14, head: [['Area', 'Score', 'Basis']], body: catRows, styles: { fontSize: 8.5 }, columnStyles: { 2: { cellWidth: 300 } }, headStyles: { fillColor: [31, 95, 122] } });

  const sev = result.findings?.bySeverity || {};
  const sevRows = ['critical', 'high', 'medium', 'low', 'info'].map((s) => [s, String(sev[s] ?? 0)]);
  autoTable(doc, { startY: (doc as any).lastAutoTable.finalY + 14, head: [['Findings by severity', 'Count']], body: sevRows, styles: { fontSize: 9 }, headStyles: { fillColor: [31, 95, 122] } });

  const teasers = (result.findings?.teasers || []).map((t: any) => [t.category, t.severity, String(t.count)]);
  if (teasers.length) autoTable(doc, { startY: (doc as any).lastAutoTable.finalY + 14, head: [['Finding category', 'Severity', 'Count']], body: teasers, styles: { fontSize: 9 }, headStyles: { fillColor: [31, 95, 122] } });

  const y = (doc as any).lastAutoTable.finalY + 20;
  doc.setFontSize(8); doc.setTextColor(90);
  doc.text(doc.splitTextToSize('Every value above was observed by SPR\'s own scan of the public repository. Full finding records, affected components, evidence records and remediation guidance are part of the complete Passport and are not included in this free summary. Absence of a finding is not proof of safety.', 515), 40, y);
  return doc;
}

export default function FreeReviewPdfGate({ passportId, statusUrl, result, repositoryLabel }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const token = statusUrl.split('/status/')[1] || '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(`/api/free-review/scan/${encodeURIComponent(passportId)}/report-request/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), email: email.trim(), company: company.trim() || undefined, consent: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not record your request.'); return; }
      setUnlocked(true);
      buildPdf(result, repositoryLabel).save(`spr-free-review-${repositoryLabel.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5" id="free-review-pdf-gate">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--spr-text)]"><FileDown className="h-4 w-4" />Download this result as a PDF</div>
      <p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">A one-page summary of exactly what is shown above, generated in your browser. Enter your email to download it.</p>
      {unlocked ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-[var(--spr-green)]">Thanks — your download has started.</p>
          <button onClick={() => buildPdf(result, repositoryLabel).save(`spr-free-review-${repositoryLabel.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`)} className="rounded-lg border border-[var(--spr-border)] px-3 py-1.5 text-xs font-semibold text-[var(--spr-text)]">Download again</button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required minLength={2} maxLength={120} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]" />
          <input id="lead-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required maxLength={254} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]" />
          <input id="lead-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)" maxLength={160} className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)] sm:col-span-2" />
          <label className="flex items-start gap-2 text-[11px] leading-4 text-[var(--spr-text-muted)] sm:col-span-2">
            <input id="lead-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required className="mt-0.5" />
            <span>{CONSENT_TEXT}</span>
          </label>
          {error && <p role="alert" className="text-xs text-[var(--spr-red)] sm:col-span-2">{error}</p>}
          <button type="submit" disabled={busy || !consent || !name.trim() || !email.trim()} className="rounded-xl bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">
            <Lock className="mr-2 inline h-3.5 w-3.5" />{busy ? 'Recording…' : 'Get the PDF'}
          </button>
        </form>
      )}
    </div>
  );
}
