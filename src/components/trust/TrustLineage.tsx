/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowRight, CircleHelp, FileSearch, Fingerprint, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { SoftwarePassport } from '../../types';
import type { ReactNode } from 'react';
import type { VerificationDecisionState } from './TrustStateBadge';

type EvidenceItem = NonNullable<SoftwarePassport['evidence']>[number];

interface Props {
  passport: SoftwarePassport;
  evidence: EvidenceItem[];
  findings: any[];
  verificationDecision?: VerificationDecisionState;
  verificationExplanation?: string;
  verificationPolicyVersion?: string;
  onOpenPassport: () => void;
  onOpenEvidence: (item: EvidenceItem) => void;
  onOpenFinding: (finding: any) => void;
  onOpenVerification: () => void;
}

/**
 * Truth-first lineage view.
 *
 * Only relationships that are guaranteed by the data shape are rendered:
 * Passport -> identity, Passport -> evidence, Passport -> findings, and
 * Passport -> verification decision. Evidence -> finding is shown only when
 * an explicit evidence/evidenceId/evidenceIds reference exists on the finding.
 * No inferred edges are drawn.
 */
export default function TrustLineage({
  passport, evidence, findings, verificationDecision, verificationExplanation,
  verificationPolicyVersion, onOpenPassport, onOpenEvidence, onOpenFinding, onOpenVerification,
}: Props) {
  const evidenceIds = new Set(evidence.map((item) => String((item as any).id ?? '')));
  const findingEvidenceRefs = findings.flatMap((finding) => {
    const refs = Array.isArray(finding?.evidenceIds)
      ? finding.evidenceIds
      : finding?.evidenceId != null
        ? [finding.evidenceId]
        : finding?.evidence?.id != null
          ? [finding.evidence.id]
          : [];
    return refs.map((id: unknown) => String(id)).filter((id: string) => evidenceIds.has(id));
  });
  const linkedEvidenceIds = new Set(findingEvidenceRefs);

  const stateLabel = verificationDecision ?? 'UNKNOWN';
  const StateIcon = stateLabel === 'VERIFIED' ? ShieldCheck : stateLabel === 'UNKNOWN' ? CircleHelp : ShieldAlert;

  return (
    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 sm:p-6" aria-labelledby="trust-lineage-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="cc-eyebrow">Evidence lineage</div>
          <h2 id="trust-lineage-title" className="mt-1 text-xl font-bold text-[var(--spr-text)]">What SPR can actually connect</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">
            Read from left to right: identity, recorded evidence, findings, and the authoritative verification decision. An edge appears only when SPR has the underlying relationship.
          </p>
        </div>
        <span className="rounded-full border border-[var(--spr-border)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--spr-text-faint)]">No inferred edges</span>
      </div>

      <div className="mt-6 overflow-x-auto pb-2">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[170px_30px_190px_30px_minmax(250px,1fr)_30px_minmax(230px,1fr)_30px_240px] items-start gap-3">
            <LineageCard icon={<Fingerprint className="h-4 w-4" />} eyebrow="Passport" title={passport.name || 'Unnamed software'} subtitle={passport.id} onClick={onOpenPassport}>
              <div className="text-xs text-[var(--spr-text-muted)]">Authoritative passport record</div>
            </LineageCard>

            <ArrowColumn label="identifies" />

            <LineageCard icon={<Fingerprint className="h-4 w-4" />} eyebrow="Software identity" title={passport.name || 'Unnamed software'} subtitle={passport.id} onClick={onOpenPassport}>
              <div className="text-xs text-[var(--spr-text-muted)]">{passport.publisher || 'Publisher not observed'}</div>
              <div className="mt-1 text-xs text-[var(--spr-text-muted)]">{passport.version || 'Version not observed'}</div>
            </LineageCard>

            <ArrowColumn label="records" />

            <LineageColumn title="Evidence" count={evidence.length} empty="No evidence recorded.">
              {evidence.map((item) => (
                <LineageCard key={String(item.id)} compact icon={<FileSearch className="h-4 w-4" />} eyebrow={item.type || 'Evidence'} title={item.name || String(item.id)} subtitle={String(item.id)} onClick={() => onOpenEvidence(item)}>
                  <div className="flex flex-wrap gap-2 text-[11px] text-[var(--spr-text-muted)]">
                    <span>{item.status || 'UNKNOWN'}</span>
                    {linkedEvidenceIds.has(String(item.id)) && <span className="text-[var(--spr-highlight)]">explicit finding link</span>}
                  </div>
                </LineageCard>
              ))}
            </LineageColumn>

            <ArrowColumn label={linkedEvidenceIds.size ? 'explicit' : 'none'} muted={!linkedEvidenceIds.size} />

            <LineageColumn title="Findings" count={findings.length} empty="No findings recorded.">
              {findings.map((finding, index) => {
                const id = String(finding?.findingId ?? finding?.id ?? `finding-${index}`);
                const refs = Array.isArray(finding?.evidenceIds) ? finding.evidenceIds : finding?.evidenceId != null ? [finding.evidenceId] : finding?.evidence?.id != null ? [finding.evidence.id] : [];
                const linked = refs.some((ref: unknown) => evidenceIds.has(String(ref)));
                return (
                  <LineageCard key={id} compact icon={<ShieldAlert className="h-4 w-4" />} eyebrow={finding?.severity || 'Finding'} title={finding?.title || id} subtitle={id} onClick={() => onOpenFinding(finding)}>
                    <div className="text-[11px] text-[var(--spr-text-muted)]">{linked ? 'Explicit evidence reference recorded' : 'No evidence relationship recorded'}</div>
                  </LineageCard>
                );
              })}
            </LineageColumn>

            <ArrowColumn label="evaluates" />

            <LineageCard icon={<StateIcon className="h-4 w-4" />} eyebrow="Verification" title={stateLabel} subtitle={verificationPolicyVersion ? `Policy ${verificationPolicyVersion}` : 'Authoritative evaluator'} onClick={onOpenVerification}>
              <div className="text-xs leading-5 text-[var(--spr-text-muted)]">{verificationExplanation || 'No evaluator explanation has been returned.'}</div>
            </LineageCard>
          </div>          <div className="mt-4 flex items-center gap-2 text-[11px] text-[var(--spr-text-faint)]">
            <span className="inline-block h-px w-5 bg-[var(--spr-border)]" aria-hidden="true" />
            <span>Identity and verification are passport-level records. Evidence-to-finding links are displayed only from explicit IDs supplied by the backend.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArrowColumn({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <div className="flex min-h-[70px] flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-[var(--spr-text-faint)]" aria-label={label}>
      <ArrowRight className={`h-4 w-4 ${muted ? 'opacity-30' : ''}`} />
      <span className="whitespace-nowrap">{label}</span>
    </div>
  );
}

function LineageColumn({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--spr-text)]">{title}</h3>
        <span className="rounded-full border border-[var(--spr-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--spr-text-faint)]">{count}</span>
      </div>
      <div className="mt-3 space-y-2">{count ? children : <p className="py-6 text-center text-xs text-[var(--spr-text-faint)]">{empty}</p>}</div>
    </div>
  );
}

function LineageCard({ icon, eyebrow, title, subtitle, children, onClick, compact = false }: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={`group w-full rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface)] text-left transition hover:border-[var(--spr-highlight)]/60 hover:bg-[var(--spr-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--spr-highlight)] ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[var(--spr-highlight)]" aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[.12em] text-[var(--spr-text-faint)]">{eyebrow}</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-[var(--spr-text)]">{title}</div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--spr-text-faint)]">{subtitle}</div>
          {children && <div className="mt-2">{children}</div>}
        </div>
      </div>
    </button>
  );
}
