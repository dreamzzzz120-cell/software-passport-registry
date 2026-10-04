import { useMemo, useState } from 'react';
import { Building2, CheckCircle2, FileSearch, GitCompareArrows, Landmark, Network, PackageCheck, Scale, ShieldCheck, Store, XCircle } from 'lucide-react';
import type { Client, SoftwarePassport, Vendor } from '../types';

type Lens = 'buyer' | 'vendor' | 'operator' | 'auditor' | 'executive';

const lenses: { id: Lens; label: string; icon: any; description: string }[] = [
  { id: 'buyer', label: 'Buyer', icon: Store, description: 'Procurement and approval decisions from observed evidence.' },
  { id: 'vendor', label: 'Vendor', icon: Building2, description: 'Reusable evidence packages and unresolved customer requests.' },
  { id: 'operator', label: 'Operator', icon: Network, description: 'What software exists, changed, and still needs attention.' },
  { id: 'auditor', label: 'Auditor', icon: Scale, description: 'Reconstruct claims from source evidence and history.' },
  { id: 'executive', label: 'Executive', icon: Landmark, description: 'Exposure, unknowns, accepted risk, and decision status.' },
];

function evidenceState(passport: SoftwarePassport) {
  const evidence = Array.isArray(passport.evidence) ? passport.evidence : [];
  const observed = evidence.length + (passport.fileHash ? 1 : 0) + (passport.sbom?.length ? 1 : 0);
  return {
    evidenceCount: evidence.length,
    hasHash: Boolean(passport.fileHash),
    hasSbom: Boolean(passport.sbom?.length),
    state: observed >= 3 ? 'EVIDENCE PRESENT' : observed > 0 ? 'PARTIAL' : 'UNKNOWN',
  };
}

export default function EvidenceExchangeView({ clients, passports, vendors, onNavigate }: {
  clients: Client[];
  passports: SoftwarePassport[];
  vendors: Vendor[];
  onNavigate: (path: string) => void;
}) {
  const [lens, setLens] = useState<Lens>('buyer');
  const [selectedId, setSelectedId] = useState(passports[0]?.id || '');
  const selected = passports.find((p) => p.id === selectedId) || passports[0] || null;

  const stats = useMemo(() => {
    const states = passports.map(evidenceState);
    return {
      software: passports.length,
      vendors: vendors.length,
      organizations: clients.length,
      evidencePresent: states.filter((s) => s.state === 'EVIDENCE PRESENT').length,
      partial: states.filter((s) => s.state === 'PARTIAL').length,
      unknown: states.filter((s) => s.state === 'UNKNOWN').length,
    };
  }, [clients.length, passports, vendors.length]);

  if (!passports.length) {
    return <section className="spr-panel p-6 md:p-8">
      <PackageCheck className="h-6 w-6 text-[var(--spr-highlight)]" />
      <h1 className="mt-3 text-2xl font-semibold text-[var(--spr-text)]">Evidence Exchange</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">SPR can serve buyers, vendors, operators, auditors, and executives from the same evidence record. No passports are available yet, so SPR will not fabricate an example.</p>
      <button onClick={() => onNavigate('/passports')} className="spr-btn spr-btn-primary mt-5">Register or investigate software</button>
    </section>;
  }

  const state = evidenceState(selected!);

  return <div className="space-y-5">
    <section className="spr-panel p-6 md:p-8">
      <div className="text-[11px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Software trust infrastructure</div>
      <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--spr-text)]">Evidence Exchange</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">One evidence layer for software buyers, vendors, operators, auditors, and executives. SPR separates what was observed from what was asserted, and keeps unknowns visible.</p>
        </div>
        <button onClick={() => onNavigate('/passports')} className="spr-btn spr-btn-secondary">Open source Passport</button>
      </div>
    </section>

    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Metric label="Software" value={stats.software} />
      <Metric label="Vendors" value={stats.vendors} />
      <Metric label="Organizations" value={stats.organizations} />
      <Metric label="Evidence present" value={stats.evidencePresent} />
      <Metric label="Partial" value={stats.partial} />
      <Metric label="Unknown" value={stats.unknown} />
    </div>

    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <section className="spr-panel h-fit p-3">
        <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[.12em] text-[var(--spr-text-faint)]">Perspective</div>
        {lenses.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} onClick={() => setLens(item.id)} className={`mb-1 w-full rounded-md border px-3 py-3 text-left transition ${lens === item.id ? 'border-[var(--spr-highlight)] bg-[var(--spr-surface-alt)]' : 'border-transparent hover:border-[var(--spr-border)]'}`}>
            <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-[var(--spr-highlight)]" /><span className="text-sm font-semibold text-[var(--spr-text)]">{item.label}</span></div>
            <div className="mt-1 text-[12px] leading-5 text-[var(--spr-text-faint)]">{item.description}</div>
          </button>;
        })}
      </section>

      <div className="space-y-5">
        <section className="spr-panel p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="text-[11px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]">{lens} lens</div><h2 className="mt-1 text-lg font-semibold text-[var(--spr-text)]">{selected?.name} <span className="font-normal text-[var(--spr-text-faint)]">v{selected?.version}</span></h2><p className="text-xs text-[var(--spr-text-faint)]">{selected?.publisher || 'Publisher not recorded'}</p></div>
            <select value={selected?.id || ''} onChange={(e) => setSelectedId(e.target.value)} className="spr-input max-w-sm">
              {passports.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.version}</option>)}
            </select>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <EvidenceFact label="Observed evidence records" value={String(state.evidenceCount)} known={state.evidenceCount > 0} />
            <EvidenceFact label="Artifact hash" value={state.hasHash ? 'Recorded' : 'Unknown'} known={state.hasHash} />
            <EvidenceFact label="SBOM" value={state.hasSbom ? 'Recorded' : 'Unknown'} known={state.hasSbom} />
          </div>
        </section>

        <DecisionTrace passport={selected!} />

        <div className="grid gap-4 md:grid-cols-3">
          <ActionCard icon={FileSearch} title="Show your work" text="Inspect source evidence, chain of custody, findings, and history behind the result." action="Inspect evidence" onClick={() => onNavigate('/evidence-explorer')} />
          <ActionCard icon={GitCompareArrows} title="Trust diff" text="Compare recorded software state over time. Missing history remains unknown instead of being invented." action="Monitor changes" onClick={() => onNavigate('/monitoring')} />
          <ActionCard icon={ShieldCheck} title="Procurement gate" text="Use observed evidence to support approve, conditional, escalate, or reject decisions." action="Review readiness" onClick={() => onNavigate('/enterprise-readiness')} />
        </div>
      </div>
    </div>
  </div>;
}

function DecisionTrace({ passport }: { passport: SoftwarePassport }) {
  const evidence = Array.isArray(passport.evidence) ? passport.evidence : [];
  const missing: { label: string; where: string; request: string }[] = [];
  if (!passport.fileHash) missing.push({ label: 'Authoritative artifact hash', where: 'Vendor release/download portal, signed release manifest, package registry, or the exact installed artifact.', request: `Provide the SHA-256 release hash for ${passport.name} ${passport.version}, preferably in a signed or authenticated release record.` });
  if (!passport.sbom?.length) missing.push({ label: 'Software Bill of Materials', where: 'Vendor security portal, engineering team, release artifacts, CycloneDX/SPDX export, package lockfiles, or a reproducible SBOM generated from the exact artifact.', request: `Provide a version-specific CycloneDX or SPDX SBOM for ${passport.name} ${passport.version}.` });
  if (!evidence.some((e) => e.type === 'Signature')) missing.push({ label: 'Code-signing / provenance evidence', where: 'Executable signature, vendor signing certificate, notarization record, signed release manifest, build attestation, or authenticated repository release.', request: `Provide cryptographic signing or build provenance evidence for ${passport.name} ${passport.version} that can be matched to the assessed artifact.` });

  return <section className="spr-panel p-5">
    <div className="flex items-start justify-between gap-4">
      <div><div className="text-[11px] font-semibold uppercase tracking-[.15em] text-[var(--spr-highlight)]">Decision trace</div><h3 className="mt-1 text-base font-semibold text-[var(--spr-text)]">Show your work</h3><p className="mt-1 text-sm text-[var(--spr-text-muted)]">SPR separates recorded source evidence from interpretation and keeps missing answers explicit.</p></div>
      <span className="rounded-sm border border-[var(--spr-border)] px-2 py-1 text-[10px] font-semibold text-[var(--spr-text-faint)]">NO INVENTED EVIDENCE</span>
    </div>

    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <TraceBlock title="1 · WHAT SPR ACTUALLY HAS">
        <TraceRow label="Software identity" value={`${passport.name} ${passport.version}`} />
        <TraceRow label="Publisher record" value={passport.publisher || 'UNKNOWN'} />
        <TraceRow label="Artifact hash" value={passport.fileHash || 'UNKNOWN'} mono />
        <TraceRow label="SBOM components" value={String(passport.sbom?.length || 0)} />
        <TraceRow label="Evidence records" value={String(evidence.length)} />
        <TraceRow label="Verification state" value={passport.verificationStatus || 'unverified'} />
      </TraceBlock>
      <TraceBlock title="2 · SOURCE EVIDENCE">
        {evidence.length ? evidence.map((item) => <div key={item.id} className="rounded-md border border-[var(--spr-border)] p-3">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-[var(--spr-text)]">{item.name}</span><span className="text-[10px] font-semibold text-[var(--spr-highlight)]">{item.status}</span></div>
          <div className="mt-1 text-[11px] text-[var(--spr-text-faint)]">{item.type} · {item.timestamp || 'timestamp unknown'}</div>
          <div className="mt-2 space-y-1"><TraceRow label="Signer/source" value={item.signer || 'UNKNOWN'} /><TraceRow label="Hash" value={item.hash || item.checksum || 'UNKNOWN'} mono /><TraceRow label="Verifier" value={item.verifierEngineId || 'UNKNOWN'} /></div>
        </div>) : <p className="text-sm leading-6 text-[var(--spr-text-muted)]">No evidence records are persisted for this Passport. SPR therefore does not claim a verified evidence state.</p>}
      </TraceBlock>
    </div>

    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <TraceBlock title="3 · HOW SPR GOT THE ANSWER">
        <p className="text-sm leading-6 text-[var(--spr-text-muted)]">SPR checks the exact software record for persisted evidence, an artifact hash, and an SBOM. Missing evidence does not become a security failure. If proof is absent, the property remains UNKNOWN or PARTIAL.</p>
        <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">This view does not use an AI-generated substitute for missing proof.</p>
      </TraceBlock>
      <TraceBlock title="4 · WHERE TO GET THE MISSING ANSWER">
        {missing.length ? missing.map((item) => <div key={item.label} className="rounded-md border border-[var(--spr-border)] p-3">
          <div className="text-sm font-semibold text-[var(--spr-text)]">{item.label}</div>
          <div className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]"><strong>Look here:</strong> {item.where}</div>
          <div className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]"><strong>Ask for:</strong> {item.request}</div>
        </div>) : <p className="text-sm leading-6 text-[var(--spr-text-muted)]">Core evidence categories shown here are present. Each evidence item still retains its own verification state and source quality.</p>}
      </TraceBlock>
    </div>

    <div className="mt-4"><TraceBlock title="5 · WHAT WOULD CHANGE THE ANSWER"><p className="text-sm leading-6 text-[var(--spr-text-muted)]">The state changes only when new evidence is persisted and validated for this exact product and version. A vendor statement alone is supporting evidence; it must not silently overwrite contradictory direct observation or failed verification.</p></TraceBlock></div>
  </section>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="spr-panel p-3"><div className="text-[10px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]">{label}</div><div className="mt-1 text-xl font-semibold text-[var(--spr-text)]">{value}</div></div>; }
function EvidenceFact({ label, value, known }: { label: string; value: string; known: boolean }) { return <div className="rounded-md border border-[var(--spr-border)] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs text-[var(--spr-text-faint)]">{label}</span>{known ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-[var(--spr-text-faint)]" />}</div><div className="mt-2 text-sm font-semibold text-[var(--spr-text)]">{value}</div></div>; }
function TraceBlock({ title, children }: { title: string; children: any }) { return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="mb-3 text-[11px] font-semibold uppercase tracking-[.1em] text-[var(--spr-text-faint)]">{title}</div><div className="space-y-2">{children}</div></div>; }
function TraceRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="flex items-start justify-between gap-3 text-xs"><span className="text-[var(--spr-text-faint)]">{label}</span><span className={`break-all text-right text-[var(--spr-text)] ${mono ? 'font-mono' : ''}`}>{value}</span></div>; }
function ActionCard({ icon: Icon, title, text, action, onClick }: { icon: any; title: string; text: string; action: string; onClick: () => void }) { return <section className="spr-panel p-4"><Icon className="h-5 w-5 text-[var(--spr-highlight)]" /><h3 className="mt-3 text-sm font-semibold text-[var(--spr-text)]">{title}</h3><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">{text}</p><button onClick={onClick} className="mt-4 text-xs font-semibold text-[var(--spr-highlight)] hover:underline">{action} →</button></section>; }
