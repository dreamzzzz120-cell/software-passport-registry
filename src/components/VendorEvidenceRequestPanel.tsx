import { useMemo, useState } from 'react';
import { Clipboard, Download, FileQuestion, SearchCheck } from 'lucide-react';
import type { SoftwarePassport } from '../types';
import { buildVendorDeficits, buildVendorEvidenceRequestText, type VendorRequestReport } from '../utils/vendorEvidenceRequest';

function downloadText(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function VendorEvidenceRequestPanel({
  report,
  passport,
  clientName,
  organization,
}: {
  report: VendorRequestReport;
  passport: SoftwarePassport;
  clientName?: string;
  organization?: string;
}) {
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [notice, setNotice] = useState('');
  const deficits = useMemo(() => buildVendorDeficits(report), [report]);
  const letter = useMemo(() => buildVendorEvidenceRequestText({
    report,
    productName: passport.name,
    version: passport.version,
    clientName,
    organization,
    contactName,
    contactEmail,
  }), [report, passport, clientName, organization, contactName, contactEmail]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(letter);
      setNotice('Vendor request copied.');
    } catch {
      setNotice('Copy failed — use download instead.');
    }
  };

  return (
    <div className="spr-panel p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2"><FileQuestion size={18} className="text-[var(--spr-highlight)]" /><h2 className="text-lg font-semibold">Vendor Evidence Request</h2></div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Generated from the currently loaded SPR report. The letter shows what SPR checked, the evidence-limited result, the exact records behind that result, and what the vendor must provide. Missing evidence remains missing; this tool does not manufacture a pass.</p>
        </div>
        <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text-muted)]">
          Assessment reference<br /><span className="font-mono text-[var(--spr-text)]">{report.reportHash || 'NOT OBSERVED'}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {deficits.map((deficit) => (
          <div key={deficit.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--spr-text)]"><SearchCheck size={14} className="text-[var(--spr-highlight)]" />{deficit.id}</div>
            <div className="mt-2 text-sm font-semibold">{deficit.title}</div>
            <div className="mt-2 inline-flex rounded-full border border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10 px-2 py-1 text-[11px] font-bold text-[var(--spr-amber)]">{deficit.status}</div>
            <p className="mt-3 text-xs leading-5 text-[var(--spr-text-muted)]">{deficit.currentResult}</p>
            <div className="mt-3 text-[11px] text-[var(--spr-text-faint)]">{deficit.matchingEvidence.length} matching source record{deficit.matchingEvidence.length === 1 ? '' : 's'}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Requestor contact name (optional)" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-sm text-[var(--spr-text)] placeholder:text-[var(--spr-text-faint)]" />
        <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Requestor email (optional)" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2.5 text-sm text-[var(--spr-text)] placeholder:text-[var(--spr-text-faint)]" />
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={() => void copy()} className="inline-flex items-center gap-2 spr-btn spr-btn-primary"><Clipboard size={15} /> Copy vendor request</button>
        <button onClick={() => downloadText(`spr-vendor-evidence-request-${passport.id}.txt`, letter)} className="inline-flex items-center gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)]"><Download size={15} /> Download request</button>
      </div>
      {notice && <p className="mt-2 text-xs text-[var(--spr-text-muted)]" role="status">{notice}</p>}

      <details className="mt-5 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--spr-text)]">Show complete vendor letter and evidence trail</summary>
        <pre className="max-h-[36rem] overflow-auto border-t border-[var(--spr-border)] p-4 text-xs leading-5 text-[var(--spr-text-muted)] whitespace-pre-wrap">{letter}</pre>
      </details>
    </div>
  );
}
