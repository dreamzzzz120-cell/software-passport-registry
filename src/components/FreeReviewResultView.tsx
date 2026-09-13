import { ArrowRight, FileSearch, Lock, Radar, Share2, ShieldCheck } from 'lucide-react';
import FreeReviewPdfGate from './FreeReviewPdfGate';

type CategoryId = 'security' | 'licensing' | 'supplyChain' | 'reliability' | 'maintainability';
type CategoryResult =
  | { status: 'scored'; score: number; detail: string; facts: Record<string, number> }
  | { status: 'not_observed'; reason: string };

export interface FreeReviewResultData {
  passportId: string;
  scanStatus: 'complete' | 'partial' | 'failed';
  failureReason?: string | null;
  passport: { id?: string; name: string; version: string; publisher: string; verificationStatus: string } | null;
  summary: { openFindings: number; criticalOrHigh: number; evidenceCount: number };
  assessment?: { score: number | null; verdict: string | null; observedAreas: number; totalAreas: number; categories: Record<CategoryId, CategoryResult> } | null;
  findings?: { total: number; elevated: number; bySeverity: Record<string, number>; teasers: { category: string; severity: string; count: number }[] } | null;
  evidence?: { total: number; verified: number; unverified: number; byType: Record<string, number> } | null;
  sbom?: { componentCount: number | null } | null;
  verifiedCapabilities?: string[] | null;
  locked?: { detailedFindings: number; evidenceRecords: number; remediation: boolean; componentLocations: boolean } | null;
  progress?: { percent: number; elapsedSeconds: number; steps: { id: string; label: string; status: string; percent: number }[]; latestMessage: string | null } | null;
}

interface Props { result: FreeReviewResultData; statusUrl: string; repositoryLabel: string; onSignUp: () => void; }

const trustAreas: [CategoryId, string][] = [
  ['security', 'Security'], ['licensing', 'Licensing'], ['supplyChain', 'Buyer readiness'], ['reliability', 'Reliability'], ['maintainability', 'Maintainability'],
];

function ActionButton({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  const className = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${primary ? 'bg-[var(--spr-accent)] text-white' : 'border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]'}`;
  return <a className={className} href={href}>{children}</a>;
}

export default function FreeReviewResultView({ result, statusUrl, repositoryLabel, onSignUp }: Props) {
  const passportId = result.passportId;
  const passportPath = result.passport ? `/passports/${encodeURIComponent(passportId)}` : '/passports';
  const findingsPath = `/scans?passportId=${encodeURIComponent(passportId)}`;
  const evidencePath = `/evidence?passportId=${encodeURIComponent(passportId)}`;
  const monitoringPath = `/monitoring?passportId=${encodeURIComponent(passportId)}`;

  if (result.scanStatus === 'failed') return (
    <section className="space-y-4" aria-label="Review result">
      <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[#f48771]"><ShieldCheck className="h-5 w-5" /> Review could not be completed</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{result.failureReason || 'The scan could not be completed. No evidence was collected.'}</p>
        <p className="mt-4 text-xs leading-5 text-[var(--spr-text-faint)]">SPR does not turn an unsuccessful scan into a clean result. Nothing here should be read as a security conclusion.</p>
      </div>
    </section>
  );

  const observed = result.assessment?.observedAreas ?? 0;
  const totalAreas = result.assessment?.totalAreas ?? 0;
  const findings = result.findings?.total ?? result.summary.openFindings;
  const elevated = result.findings?.elevated ?? result.summary.criticalOrHigh;
  const evidence = result.evidence?.total ?? result.summary.evidenceCount;
  const components = result.sbom?.componentCount;

  return (
    <section className="space-y-5" aria-label="Software review result">
      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]">Review result</div><h2 className="mt-2 text-2xl font-bold text-[var(--spr-text)]">{repositoryLabel}</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">SPR observed this repository and separated evidence-backed conclusions from unknowns.</p></div>
          <div className="flex flex-wrap gap-2"><ActionButton href={passportPath} primary><ShieldCheck className="h-4 w-4" />Open Passport</ActionButton><ActionButton href={evidencePath}><FileSearch className="h-4 w-4" />Evidence Explorer</ActionButton></div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[['Repository', repositoryLabel], ['Review ID', passportId.slice(-12)], ['Components', components == null ? 'Not observed' : String(components)], ['Findings', String(findings)], ['Evidence', String(evidence)]].map(([label, value]) => <div key={label} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--spr-text-faint)]">{label}</div><div className="mt-1 truncate text-sm font-semibold text-[var(--spr-text)]">{value}</div></div>)}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <div className="flex items-center justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Executive result</div><h3 className="mt-1 text-lg font-bold text-[var(--spr-text)]">What SPR discovered</h3></div><span className="rounded-full border border-[var(--spr-border)] px-3 py-1 text-xs font-semibold">{result.scanStatus === 'partial' ? 'Incomplete evidence' : 'Review complete'}</span></div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[var(--spr-border)] p-4"><div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-muted)]">What SPR observed</div><p className="mt-2 text-sm leading-6 text-[var(--spr-text)]">{evidence} evidence item{evidence === 1 ? '' : 's'}{components != null ? ` and ${components} software component${components === 1 ? '' : 's'}` : ''} were included in the review.</p></div>
          <div className="rounded-xl border border-[var(--spr-border)] p-4"><div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-muted)]">What SPR verified</div><p className="mt-2 text-sm leading-6 text-[var(--spr-text)]">{result.verifiedCapabilities?.length ? `${result.verifiedCapabilities.length} evidence-backed capability${result.verifiedCapabilities.length === 1 ? '' : 'ies'} were observed.` : 'No capability is presented as verified without supporting evidence.'}</p></div>
          <div className="rounded-xl border border-[var(--spr-border)] p-4"><div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-muted)]">What SPR could not verify</div><p className="mt-2 text-sm leading-6 text-[var(--spr-text)]">{Math.max(0, totalAreas - observed)} of {totalAreas || 'the available'} trust areas are not currently backed by observed evidence.</p></div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="flex items-end justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Trust coverage</div><h3 className="mt-1 text-lg font-bold">Evidence-backed areas</h3></div>{result.assessment?.score != null ? <div className="text-3xl font-bold">{result.assessment.score}<span className="text-sm text-[var(--spr-text-muted)]"> / 100</span></div> : <div className="text-sm font-bold">No score</div>}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{result.assessment ? trustAreas.map(([id, label]) => { const area = result.assessment!.categories[id]; return <div key={id} className="rounded-xl border border-[var(--spr-border)] p-3"><div className="flex justify-between gap-2 text-sm font-semibold"><span>{label}</span><span>{area.status === 'scored' ? `${area.score}/100` : 'UNKNOWN'}</span></div><p className="mt-1.5 text-xs leading-5 text-[var(--spr-text-muted)]">{area.status === 'scored' ? area.detail : area.reason}</p></div>; }) : <div className="text-sm text-[var(--spr-text-muted)]">Assessment data was not returned.</div>}</div>
        </div>
        <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Evidence breakdown</div><div className="mt-4 space-y-2">{Object.entries(result.evidence?.byType ?? {}).map(([type, count]) => <div key={type} className="flex justify-between rounded-lg bg-[var(--spr-surface-deep)] px-3 py-2 text-sm"><span>{type}</span><span className="font-bold tabular-nums">{count}</span></div>)}{!Object.keys(result.evidence?.byType ?? {}).length && <p className="text-sm text-[var(--spr-text-muted)]">No evidence type was observed.</p>}</div><div className="mt-4 border-t border-[var(--spr-border)] pt-4 text-xs leading-5 text-[var(--spr-text-muted)]">{result.evidence ? `${result.evidence.verified} of ${result.evidence.total} evidence item${result.evidence.total === 1 ? '' : 's'} are cryptographically verified.` : 'Verification status is UNKNOWN.'}</div></div>
      </div>

      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Findings</div><h3 className="mt-1 text-lg font-bold">Signals that need attention</h3></div><div className="text-sm font-semibold">{elevated} elevated · {findings} total</div></div><div className="mt-4 grid gap-2 sm:grid-cols-5">{(['critical','high','medium','low','info'] as const).map((severity) => <div key={severity} className="rounded-xl border border-[var(--spr-border)] p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-muted)]">{severity}</div><div className="mt-1 text-xl font-bold">{result.findings?.bySeverity?.[severity] ?? 0}</div></div>)}</div>{result.findings?.teasers?.length ? <div className="mt-4 grid gap-2 md:grid-cols-2">{result.findings.teasers.map((teaser) => <div key={`${teaser.category}-${teaser.severity}`} className="rounded-xl border border-[var(--spr-border)] p-3 text-sm"><span className="font-bold uppercase tracking-wider">{teaser.severity}</span><span className="mx-2 text-[var(--spr-text-faint)]">·</span>{teaser.category}<span className="float-right text-xs text-[var(--spr-text-muted)]">{teaser.count}</span></div>)}</div> : null}</div>

      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Next actions</div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><ActionButton href={passportPath} primary><ShieldCheck className="h-4 w-4" />Open Passport</ActionButton><ActionButton href={evidencePath}><FileSearch className="h-4 w-4" />Evidence Explorer</ActionButton><ActionButton href={findingsPath}><ArrowRight className="h-4 w-4" />Open Findings</ActionButton><ActionButton href={statusUrl}><Share2 className="h-4 w-4" />Share review</ActionButton><ActionButton href={monitoringPath}><Radar className="h-4 w-4" />Start monitoring</ActionButton><ActionButton href="#download-report">Download report</ActionButton></div><div id="download-report" className="mt-4"><FreeReviewPdfGate passportId={passportId} statusUrl={statusUrl} result={result} repositoryLabel={repositoryLabel} /></div></div>

      <div className="rounded-2xl border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent)]/10 p-6"><div className="flex items-start gap-3"><Lock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--spr-highlight)]" /><div><h3 className="font-bold">Turn this one-time review into continuous verification</h3><p className="mt-1 text-sm leading-6 text-[var(--spr-text-muted)]">Keep the observed evidence, findings and passport current as the software changes. SPR does not claim money saved unless you actually measure it; the value here is the workflow: review once, then keep watching.</p><button onClick={onSignUp} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-3 text-sm font-bold text-white"><ShieldCheck className="h-4 w-4" />Claim this Passport</button></div></div></div>

      <p className="text-center text-xs leading-5 text-[var(--spr-text-faint)]">SPR reports observed evidence only. UNKNOWN means the available evidence did not support a conclusion.</p>
    </section>
  );
}
