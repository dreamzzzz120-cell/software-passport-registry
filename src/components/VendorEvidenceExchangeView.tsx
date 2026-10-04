import { useMemo, useState } from 'react';
import { Building2, FileCheck2, FileClock, FileText, Hash, Send, ShieldCheck } from 'lucide-react';
import type { Vendor, VendorAudit } from '../types';
import { apiFetch } from '../utils/apiClient';

export default function VendorEvidenceExchangeView({ vendors, role, onNavigate }: { vendors: Vendor[]; role: string; onNavigate: (path: string) => void }) {
  const [selectedId, setSelectedId] = useState(vendors[0]?.id || '');
  const [evidenceType, setEvidenceType] = useState('Signed Release Manifest');
  const [source, setSource] = useState('');
  const [referenceHash, setReferenceHash] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState('');
  const selected = vendors.find(v => v.id === selectedId) || vendors[0] || null;
  const canSubmit = ['Owner','Admin','Technician'].includes(role);

  const records = useMemo(() => (selected?.auditHistory || []).filter(a =>
    a.auditType.startsWith('Evidence:') || a.status === 'Under Review'
  ), [selected]);

  if (!selected) return <section className="spr-panel p-6 md:p-8">
    <Building2 className="h-6 w-6 text-[var(--spr-highlight)]" />
    <h1 className="mt-3 text-2xl font-semibold text-[var(--spr-text)]">Vendor Evidence Exchange</h1>
    <p className="mt-2 text-sm text-[var(--spr-text-muted)]">No vendor records exist yet. SPR will not invent a vendor package.</p>
    <button onClick={() => onNavigate('/vendors')} className="spr-btn spr-btn-primary mt-5">Open Vendors</button>
  </section>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true); setResult('');
    try {
      const response = await apiFetch(`/api/vendors/${encodeURIComponent(selected.id)}/audits`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          auditType:`Evidence: ${evidenceType}`,
          status:'Under Review',
          details:JSON.stringify({ source: source.trim() || null, notes: notes.trim() || null, evidenceState:'SUBMITTED_UNVERIFIED' }),
          auditor:'Vendor Evidence Exchange Intake',
          referenceHash:referenceHash.trim(),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message || data?.error || 'Submission failed.');
      setResult('Evidence package persisted as UNDER REVIEW. It has not changed the vendor score or verification state.');
      setSource(''); setReferenceHash(''); setNotes('');
    } catch (error:any) {
      setResult(error?.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="space-y-5">
    <section className="spr-panel p-6 md:p-8">
      <div className="text-[11px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Reusable vendor proof</div>
      <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--spr-text)]">Vendor Evidence Exchange</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Capture version-specific vendor evidence once, preserve the original source and hash, and keep it unverified until SPR or an authorized reviewer validates what the evidence actually proves.</p>
        </div>
        <select className="spr-input max-w-sm" value={selected.id} onChange={e=>setSelectedId(e.target.value)}>
          {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
    </section>

    <section className="spr-panel p-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Stored exchange records" value={String(records.length)} icon={FileText}/>
        <Stat label="Under review" value={String(records.filter(r=>r.status==='Under Review').length)} icon={FileClock}/>
        <Stat label="Verified by this exchange" value="0" icon={ShieldCheck}/>
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--spr-text-faint)]">A submitted document is evidence of a vendor claim, not proof that the claim is true. This first production slice intentionally does not convert intake into VERIFIED.</p>
    </section>

    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <section className="spr-panel p-5">
        <h2 className="text-sm font-semibold text-[var(--spr-text)]">Evidence package intake</h2>
        <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Saved to the append-only vendor evidence/audit ledger as UNDER REVIEW with zero reputation-score impact.</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-xs text-[var(--spr-text-muted)]">Evidence type
            <select className="spr-input mt-1 w-full" value={evidenceType} onChange={e=>setEvidenceType(e.target.value)}>
              {['Signed Release Manifest','Code Signing Certificate','CycloneDX SBOM','SPDX SBOM','Build Provenance Attestation','Network Requirements','Data Flow Documentation','Support Lifecycle','Pentest / Audit Report','Security Policy'].map(x=><option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="block text-xs text-[var(--spr-text-muted)]">Original source / location
            <input className="spr-input mt-1 w-full" value={source} onChange={e=>setSource(e.target.value)} placeholder="Vendor trust center, release URL, support case, repository..." />
          </label>
          <label className="block text-xs text-[var(--spr-text-muted)]">Reference hash
            <input className="spr-input mt-1 w-full font-mono" value={referenceHash} onChange={e=>setReferenceHash(e.target.value)} placeholder="SHA-256 if available" />
          </label>
          <label className="block text-xs text-[var(--spr-text-muted)]">Scope / notes
            <textarea className="spr-input mt-1 min-h-24 w-full" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Product, version, effective date, claim supported, limitations..." />
          </label>
          <button disabled={!canSubmit || submitting} className="spr-btn spr-btn-primary inline-flex items-center gap-2 disabled:opacity-50"><Send className="h-4 w-4"/>{submitting?'Submitting…':'Submit as unverified evidence'}</button>
          {!canSubmit && <p className="text-xs text-[var(--spr-text-faint)]">Your current role can review evidence but cannot submit vendor records.</p>}
          {result && <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3 text-xs text-[var(--spr-text-muted)]">{result}</div>}
        </form>
      </section>

      <section className="spr-panel p-5">
        <h2 className="text-sm font-semibold text-[var(--spr-text)]">Stored vendor evidence</h2>
        <div className="mt-4 space-y-3">
          {records.length ? records.map((r: VendorAudit)=><article key={r.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div><div className="text-sm font-semibold text-[var(--spr-text)]">{r.auditType.replace(/^Evidence:\s*/, '')}</div><div className="mt-1 text-[11px] text-[var(--spr-text-faint)]">{r.date} · {r.auditor}</div></div>
              <span className="rounded-sm border border-[var(--spr-border)] px-2 py-1 text-[10px] font-semibold text-[var(--spr-text-muted)]">{r.status}</span>
            </div>
            {r.referenceHash && <div className="mt-2 flex gap-2 text-[11px] text-[var(--spr-text-muted)]"><Hash className="h-3.5 w-3.5 shrink-0"/><span className="break-all font-mono">{r.referenceHash}</span></div>}
            <div className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">{r.details}</div>
          </article>) : <div className="rounded-md border border-dashed border-[var(--spr-border)] p-4 text-sm text-[var(--spr-text-muted)]">No vendor evidence packages are stored for this vendor yet.</div>}
        </div>
      </section>
    </div>

    <section className="spr-panel p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-sm font-semibold text-[var(--spr-text)]">Use evidence elsewhere</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">Evidence remains separate from the decision until validated. Review procurement or open the Evidence Exchange to trace what a claim actually supports.</p></div>
        <div className="flex gap-2"><button onClick={()=>onNavigate('/procurement-gate')} className="spr-btn spr-btn-primary">Procurement Gate</button><button onClick={()=>onNavigate('/evidence-exchange')} className="spr-btn spr-btn-secondary">Decision Trace</button></div>
      </div>
    </section>
  </div>;
}

function Stat({label,value,icon:Icon}:{label:string;value:string;icon:any}) {
  return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><Icon className="h-4 w-4 text-[var(--spr-highlight)]"/><div className="mt-3 text-[11px] text-[var(--spr-text-faint)]">{label}</div><div className="mt-1 text-xl font-semibold text-[var(--spr-text)]">{value}</div></div>;
}
