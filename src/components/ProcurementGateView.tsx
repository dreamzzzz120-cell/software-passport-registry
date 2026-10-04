import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSearch, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import type { SoftwarePassport } from '../types';

type Decision = 'APPROVE' | 'APPROVE_WITH_CONDITIONS' | 'ESCALATE' | 'REJECT';

function evaluate(passport: SoftwarePassport): { decision: Decision; reasons: string[]; conditions: string[] } {
  const reasons: string[] = [];
  const conditions: string[] = [];
  const verifiedEvidence = passport.evidence.filter(e => e.status === 'VERIFIED').length;
  const failedEvidence = passport.evidence.filter(e => e.status === 'FAILED').length;
  const critical = passport.vulnerabilities.filter(v => v.severity === 'Critical' && v.status === 'Open').length;
  const high = passport.vulnerabilities.filter(v => v.severity === 'High' && v.status === 'Open').length;

  if (failedEvidence > 0) reasons.push(`${failedEvidence} evidence verification item(s) failed.`);
  if (critical > 0) reasons.push(`${critical} open critical vulnerability finding(s) are recorded.`);
  if (!passport.fileHash) reasons.push('Artifact hash is not recorded.');
  if (!passport.sbom?.length) reasons.push('No version-specific SBOM is recorded.');
  if (!passport.evidence.some(e => e.type === 'Signature')) reasons.push('No code-signing/provenance evidence is recorded.');
  if (passport.verificationStatus !== 'verified') reasons.push(`Passport verification state is ${passport.verificationStatus}.`);

  if (failedEvidence > 0 || critical > 0) {
    conditions.push('Security owner review required before purchase or deployment.');
    conditions.push('Resolve or formally accept the recorded failed/critical findings.');
    return { decision: 'REJECT', reasons, conditions };
  }

  if (!passport.fileHash || !passport.sbom?.length || !passport.evidence.some(e => e.type === 'Signature')) {
    conditions.push('Obtain missing provenance/SBOM evidence before unrestricted deployment.');
    conditions.push('Use compensating controls or a limited pilot if business urgency requires use before verification.');
    return { decision: 'ESCALATE', reasons, conditions };
  }

  if (passport.verificationStatus !== 'verified' || high > 0 || verifiedEvidence === 0) {
    conditions.push('Limit approval to the assessed version and environment.');
    conditions.push('Track unresolved high-risk findings and reassess on evidence change.');
    return { decision: 'APPROVE_WITH_CONDITIONS', reasons, conditions };
  }

  return {
    decision: 'APPROVE',
    reasons: ['Core recorded evidence categories are present and the Passport is verified.'],
    conditions: ['Approval applies only to the assessed version and evidence snapshot. Reassess on material change.'],
  };
}

export default function ProcurementGateView({ passports, onNavigate }: { passports: SoftwarePassport[]; onNavigate: (path: string) => void }) {
  const [selectedId, setSelectedId] = useState(passports[0]?.id || '');
  const selected = passports.find(p => p.id === selectedId) || passports[0] || null;
  const evaluation = useMemo(() => selected ? evaluate(selected) : null, [selected]);

  if (!selected || !evaluation) return <section className="spr-panel p-6 md:p-8">
    <ShieldCheck className="h-6 w-6 text-[var(--spr-highlight)]" />
    <h1 className="mt-3 text-2xl font-semibold text-[var(--spr-text)]">Procurement Gate</h1>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">No software Passport is available to evaluate. SPR will not fabricate a procurement decision.</p>
    <button onClick={() => onNavigate('/passports')} className="spr-btn spr-btn-primary mt-5">Open Passports</button>
  </section>;

  const style = evaluation.decision === 'APPROVE'
    ? 'border-emerald-500/30 bg-emerald-500/5'
    : evaluation.decision === 'APPROVE_WITH_CONDITIONS'
      ? 'border-amber-500/30 bg-amber-500/5'
      : evaluation.decision === 'ESCALATE'
        ? 'border-orange-500/30 bg-orange-500/5'
        : 'border-red-500/30 bg-red-500/5';

  return <div className="space-y-5">
    <section className="spr-panel p-6 md:p-8">
      <div className="text-[11px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Evidence-backed buying decision</div>
      <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--spr-text)]">Procurement Gate</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">SPR evaluates the evidence it can actually see. Unknowns remain unknown. A procurement recommendation is not a claim that software is safe.</p>
        </div>
        <select className="spr-input max-w-sm" value={selected.id} onChange={e => setSelectedId(e.target.value)}>
          {passports.map(p => <option key={p.id} value={p.id}>{p.name} · {p.version}</option>)}
        </select>
      </div>
    </section>

    <section className={`rounded-md border p-5 ${style}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]">Recommendation</div>
          <div className="mt-1 text-2xl font-semibold text-[var(--spr-text)]">{evaluation.decision.replaceAll('_', ' ')}</div>
          <div className="mt-1 text-sm text-[var(--spr-text-muted)]">{selected.name} {selected.version} · {selected.publisher || 'Publisher unknown'}</div>
        </div>
        <DecisionIcon decision={evaluation.decision} />
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="spr-panel p-5">
        <h2 className="text-sm font-semibold text-[var(--spr-text)]">Why SPR reached this recommendation</h2>
        <div className="mt-3 space-y-2">
          {evaluation.reasons.map(r => <div key={r} className="flex gap-2 text-sm text-[var(--spr-text-muted)]"><FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-highlight)]" /><span>{r}</span></div>)}
        </div>
      </section>

      <section className="spr-panel p-5">
        <h2 className="text-sm font-semibold text-[var(--spr-text)]">Conditions / next action</h2>
        <div className="mt-3 space-y-2">
          {evaluation.conditions.map(c => <div key={c} className="flex gap-2 text-sm text-[var(--spr-text-muted)]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-highlight)]" /><span>{c}</span></div>)}
        </div>
      </section>
    </div>

    <section className="spr-panel p-5">
      <h2 className="text-sm font-semibold text-[var(--spr-text)]">Evidence snapshot used</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Fact label="Verification state" value={selected.verificationStatus} />
        <Fact label="Artifact hash" value={selected.fileHash ? 'Recorded' : 'UNKNOWN'} />
        <Fact label="SBOM components" value={String(selected.sbom?.length || 0)} />
        <Fact label="Evidence records" value={String(selected.evidence?.length || 0)} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Fact label="Verified evidence" value={String(selected.evidence.filter(e => e.status === 'VERIFIED').length)} />
        <Fact label="Failed evidence" value={String(selected.evidence.filter(e => e.status === 'FAILED').length)} />
        <Fact label="Open critical CVEs" value={String(selected.vulnerabilities.filter(v => v.severity === 'Critical' && v.status === 'Open').length)} />
        <Fact label="Open high CVEs" value={String(selected.vulnerabilities.filter(v => v.severity === 'High' && v.status === 'Open').length)} />
      </div>
    </section>

    <section className="spr-panel p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--spr-text)]">Audit the decision</h2>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Open the evidence trace to inspect source records and see where missing answers can be obtained.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onNavigate('/evidence-exchange')} className="spr-btn spr-btn-primary">Show your work</button>
          <button onClick={() => onNavigate('/evidence-explorer')} className="spr-btn spr-btn-secondary">Source evidence</button>
        </div>
      </div>
    </section>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3"><div className="text-[11px] text-[var(--spr-text-faint)]">{label}</div><div className="mt-1 break-all text-sm font-semibold text-[var(--spr-text)]">{value}</div></div>;
}

function DecisionIcon({ decision }: { decision: Decision }) {
  if (decision === 'APPROVE') return <CheckCircle2 className="h-10 w-10 text-emerald-400" />;
  if (decision === 'REJECT') return <XCircle className="h-10 w-10 text-red-400" />;
  if (decision === 'ESCALATE') return <ShieldAlert className="h-10 w-10 text-orange-400" />;
  return <AlertTriangle className="h-10 w-10 text-amber-400" />;
}
