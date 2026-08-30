/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, FileSearch, Loader2, Radio, ShieldQuestion } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';
import TrustField from './TrustField';
import TrustStateBadge, { trustStateFromDecision, type VerificationDecisionState } from './TrustStateBadge';
import { DecisionHero } from '../design/CommandCenter';
import type { Client, SoftwarePassport } from '../../types';

interface Props {
  passport: SoftwarePassport;
  client?: Client;
  canRunAudit: boolean;
  auditBusy: boolean;
  onRunAudit: () => void;
  canCreateRemediation: boolean;
  remediationBusy: string | null;
  onCreateRemediation: (vulnerability: any) => void;
  onNavigateTab: (tab: string, itemId?: string) => void;
  onViewLineage: () => void;
  canSharePassport: boolean;
  /**
   * The authoritative evaluator's decision for this passport, supplied by the
   * batch retrieval in App. Undefined means "not yet evaluated", which
   * renders UNINITIALIZED - never a fallback to the legacy column.
   */
  verificationDecision?: VerificationDecisionState;
  /** Authoritative explanation, rendered verbatim. */
  verificationExplanation?: string;
  verificationPolicyVersion?: string;
  verificationReasonCodes?: string[];
  verificationTargetIdentity?: string | null;
  verificationCounts?: { observations?: number; uniqueEvidence?: number; independentSources?: number };
}

// This predicate must stay identical to the one in SoftwareLineageTracker.tsx
// -- both read the same real evidence array to answer the same question
// (has a SLSA/in-toto provenance attestation been submitted for this
// passport?), and SPR must never have two different answers to that
// question depending on which screen you're looking at. Lineage itself is
// out of scope for this phase, so the check is duplicated here rather than
// extracted, to avoid touching that file.
function findSlsaEvidence(passport: SoftwarePassport) {
  return (passport.evidence || []).find((item) => item.type === 'Attestation' && /slsa/i.test(item.name)) || null;
}

function formatTimestamp(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

export default function TrustRoom({ passport, client, canRunAudit, auditBusy, onRunAudit, canCreateRemediation, remediationBusy, onCreateRemediation, onNavigateTab, onViewLineage, canSharePassport, verificationDecision, verificationExplanation, verificationPolicyVersion, verificationReasonCodes, verificationTargetIdentity, verificationCounts }: Props) {
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Verification state comes from the authoritative evaluator, never from
  // passports.verification_status. The legacy column is hardcoded to
  // 'unverified' by the scanner and is not a decision. When no authoritative
  // decision has been retrieved yet the badge stays UNINITIALIZED rather than
  // falling back to the legacy mapping, so an un-evaluated passport can never
  // display a state the evaluator did not produce.
  const trustState = trustStateFromDecision(verificationDecision);
  const evidence = passport.evidence || [];
  const vulnerabilities = passport.vulnerabilities || [];
  const timeline = passport.timeline || [];
  const slsaEvidence = findSlsaEvidence(passport);

  const dimensions = [
    { key: 'security', label: 'Security', value: passport.securityScore ?? null },
    { key: 'compliance', label: 'Compliance', value: passport.complianceScore ?? null },
    { key: 'vendor', label: 'Vendor Rep.', value: passport.vendorReputationScore ?? null },
    { key: 'confidence', label: 'Confidence', value: passport.confidenceScore ?? null },
  ];
  const unmeasuredDimensions = dimensions.filter((dimension) => dimension.value === null);

  // The single, honest explanation of "why this state": a real count of how
  // many recorded evidence items are independently verified out of the
  // total. This is intentionally not attributed to a specific dimension --
  // evidence items don't carry a dimension field, so doing that would
  // fabricate a causal link the data doesn't actually support.
  const verifiedEvidenceCount = evidence.filter((item) => item.status === 'VERIFIED').length;
  const whyText = evidence.length === 0
    ? 'No evidence has been recorded for this software yet.'
    : trustState === 'VERIFIED'
      ? `${verifiedEvidenceCount} of ${evidence.length} recorded evidence items are independently verified.`
      : trustState === 'PARTIALLY_VERIFIED'
        ? `${verifiedEvidenceCount} of ${evidence.length} recorded evidence items are independently verified; the remainder are unresolved.`
        : `${verifiedEvidenceCount} of ${evidence.length} recorded evidence items are independently verified -- not enough to establish a verified trust state.`;

  const lastObserved = (() => {
    const timestamps = [
      ...evidence.map((item) => item.timestamp),
      ...timeline.map((entry) => entry.date),
    ].map((value) => Date.parse(value || '')).filter((value) => !Number.isNaN(value));
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps)).toLocaleString();
  })();

  const zeroData = evidence.length === 0 && vulnerabilities.length === 0 && timeline.length === 0;

  const sharePassport = async () => {
    setShareBusy(true); setShareError(null); setCopied(false);
    try {
      const response = await apiFetch(`/api/public/v1/passports/${encodeURIComponent(passport.id)}/token`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message || data?.error || 'Unable to create a share link.');
      setShareUrl(data?.verificationUrl || null);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Unable to create a share link.');
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <div className="space-y-6" id="trust-room">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--spr-text-faint)]">
        <button onClick={() => onNavigateTab('/msp')} className="hover:text-[var(--spr-highlight)]">Trust Network</button>
        {client && <><span aria-hidden="true">/</span><button onClick={() => onNavigateTab('/clients', client.id)} className="hover:text-[var(--spr-highlight)]">{client.name}</button></>}
        <span aria-hidden="true">/</span><span className="text-[var(--spr-text-muted)]">{passport.name}</span>
      </nav>

      {/* 01 - Identity */}
      <header>
        <div className="cc-eyebrow">01 · Software identity</div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--spr-text)]">{passport.name}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-[var(--spr-text-muted)] sm:grid-cols-4">
          <div><dt className="text-[10px] uppercase tracking-wide text-[var(--spr-text-faint)]">Publisher</dt><dd className="text-[var(--spr-text)]">{passport.publisher || 'Not observed'}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-[var(--spr-text-faint)]">Version</dt><dd className="text-[var(--spr-text)]">{passport.version || 'Not observed'}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-[var(--spr-text-faint)]">Passport ID</dt><dd className="font-mono text-[var(--spr-text)]">{passport.id}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-[var(--spr-text-faint)]">Last observed</dt><dd className="text-[var(--spr-text)]">{lastObserved || 'Not yet observed'}</dd></div>
        </dl>
      </header>

      {/* 02 - Decision Hero. Every value below is passed straight through from
          the authoritative decision supplied by App's batch retrieval; this
          component computes nothing and never re-words the explanation. */}
      <DecisionHero
        state={verificationDecision}
        explanation={verificationExplanation}
        policyVersion={verificationPolicyVersion}
        reasonCodes={verificationReasonCodes}
        observationCount={verificationCounts?.observations}
        evidenceReferenceCount={verificationCounts?.uniqueEvidence}
        independentSourceCount={verificationCounts?.independentSources}
        targetIdentity={verificationTargetIdentity}
      />

      {zeroData ? (
        <section className="rounded-md border border-dashed border-[var(--spr-border)] bg-[var(--spr-surface-deep)] py-16 text-center">
          <ShieldQuestion className="mx-auto h-9 w-9 text-[var(--spr-text-faint)]" />
          <h2 className="mt-4 text-xl font-bold text-[var(--spr-text)]">Trust state: Unknown</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--spr-text-muted)]">Evidence is not yet sufficient to establish a verified trust state.</p>
          <h3 className="mt-6 text-sm font-bold text-[var(--spr-text)]">Build the evidence record</h3>
          <button onClick={onRunAudit} disabled={!canRunAudit || auditBusy} title={!canRunAudit ? 'Your role cannot run audits.' : undefined} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50">
            {auditBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Collect evidence
          </button>
        </section>
      ) : <>

      <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <h2 className="text-xs font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Current trust state</h2>
        <div className="mt-3"><TrustStateBadge state={trustState} /></div>
        <p className="mt-2 text-sm text-[var(--spr-text-muted)]">{trustState === 'EVIDENCE_INCOMPLETE' ? 'Authoritative evidence is unavailable or insufficient. SPR does not infer a pass.' : 'Based on the latest available verified observations.'}</p>

        <div className="mt-6 flex justify-center">
          <TrustField state={trustState} centerLabel={passport.name?.slice(0, 12).toUpperCase() || 'PASSPORT'} size={300} dimensions={dimensions} />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--spr-text-faint)]">Trust score</p>
            <p className="mt-1 text-2xl font-bold text-[var(--spr-text)]">{passport.overallScore == null ? 'Not available' : passport.overallScore}</p>
          </div>
          <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--spr-text-faint)]">Evidence confidence</p>
            <p className="mt-1 text-2xl font-bold text-[var(--spr-text)]">{passport.confidenceScore == null ? 'Not available' : `${passport.confidenceScore}%`}</p>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <h2 className="text-lg font-bold text-[var(--spr-text)]">Why this state?</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{whyText}</p>
      </section>

      <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-[var(--spr-text)]">Evidence supporting this state</h2><span className="text-xs text-[var(--spr-text-faint)]">{evidence.length} item{evidence.length === 1 ? '' : 's'}</span></div>
        {evidence.length > 0 ? (
          <ul className="mt-4 space-y-2.5">
            {evidence.map((item) => (
              <li key={item.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--spr-text)]">{item.name || item.type}</p>
                  <TrustStateBadge state={item.status === 'VERIFIED' ? 'VERIFIED' : item.status === 'PARTIALLY_VERIFIED' ? 'PARTIALLY_VERIFIED' : item.status === 'FAILED' ? 'VERIFICATION_FAILED' : 'EVIDENCE_INCOMPLETE'} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-[var(--spr-text-muted)] sm:grid-cols-4">
                  <div><dt className="text-[var(--spr-text-faint)]">Source</dt><dd className="text-[var(--spr-text)]">{item.signer || 'Not available'}</dd></div>
                  <div><dt className="text-[var(--spr-text-faint)]">Type</dt><dd className="text-[var(--spr-text)]">{item.type}</dd></div>
                  <div><dt className="text-[var(--spr-text-faint)]">Observed</dt><dd className="text-[var(--spr-text)]">{formatTimestamp(item.timestamp) || 'Not available'}</dd></div>
                  <div><dt className="text-[var(--spr-text-faint)]">Hash</dt><dd className="truncate font-mono text-[var(--spr-text)]" title={item.hash || undefined}>{item.hash || 'Not available'}</dd></div>
                </dl>
                {item.failureReason && <p className="mt-2 text-[11px] text-[var(--spr-red)]">{item.failureReason}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-4 text-sm text-[var(--spr-text-faint)]">No evidence recorded for this software.</p>}
        <button onClick={() => onNavigateTab('/evidence-explorer')} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--spr-highlight)] hover:underline">Inspect evidence <ArrowRight className="h-3.5 w-3.5" /></button>
      </section>

      <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <h2 className="text-lg font-bold text-[var(--spr-text)]">What we don't know</h2>
        <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Uncertainty is shown, not hidden. Unknown means insufficient evidence, not a failure.</p>
        {(unmeasuredDimensions.length > 0 || !slsaEvidence) ? (
          <ul className="mt-4 space-y-2">
            {unmeasuredDimensions.map((dimension) => (
              <li key={dimension.key} className="flex items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3.5 py-2.5">
                <span className="text-sm text-[var(--spr-text)]">{dimension.label}</span>
                <span className="text-xs text-[var(--spr-text-faint)]">Evidence not available</span>
              </li>
            ))}
            {!slsaEvidence && (
              <li className="flex items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3.5 py-2.5">
                <span className="text-sm text-[var(--spr-text)]">Provenance</span>
                <span className="text-xs text-[var(--spr-text-faint)]">Evidence not available</span>
              </li>
            )}
          </ul>
        ) : <p className="mt-4 text-sm text-[var(--spr-green)]">No unmeasured dimensions -- every supported dimension has recorded evidence.</p>}
      </section>

      <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-[var(--spr-text)]">Trust observations</h2><span className="text-xs text-[var(--spr-text-faint)]">{vulnerabilities.length} recorded</span></div>
        {vulnerabilities.length > 0 ? (
          <div className="mt-4 space-y-2.5">
            {vulnerabilities.map((v: any) => {
              const id = String(v.findingId ?? v.id ?? '');
              return (
                <div key={id} className="flex flex-col gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2"><span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${v.severity === 'Critical' ? 'border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 text-[var(--spr-red)]' : v.severity === 'High' ? 'border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/10 text-[var(--spr-amber)]' : 'border-[var(--spr-highlight)]/30 bg-[var(--spr-highlight)]/10 text-[var(--spr-highlight)]'}`}>{v.severity || 'Unknown severity'}</span><span className="text-sm font-semibold text-[var(--spr-text)]">{v.title || id}</span></div>
                    <p className="mt-1 text-xs text-[var(--spr-text-muted)]">{v.status || 'Open'} · {v.description || 'No description recorded.'}</p>
                  </div>
                  <button onClick={() => onCreateRemediation(v)} disabled={!canCreateRemediation || !id || remediationBusy === id} title={!canCreateRemediation ? 'Your role cannot create remediations.' : undefined} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">{remediationBusy === id ? 'Persisting…' : 'Investigate'}</button>
                </div>
              );
            })}
          </div>
        ) : <p className="mt-4 flex items-center gap-2 text-sm text-[var(--spr-green)]"><CheckCircle2 className="h-4 w-4" /> No open trust observations recorded.</p>}
      </section>

      <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <h2 className="text-lg font-bold text-[var(--spr-text)]">What changed</h2>
        {timeline.length > 0 ? (
          <ul className="mt-4 space-y-2.5 border-l border-[var(--spr-border)] pl-4">
            {[...timeline].sort((a, b) => Date.parse(b.date || '') - Date.parse(a.date || '')).map((entry, index) => (
              <li key={index} className="relative">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-[var(--spr-highlight)]" aria-hidden="true" />
                <p className="text-xs font-mono text-[var(--spr-text-faint)]">{entry.date}</p>
                <p className="text-sm text-[var(--spr-text)]">{entry.event}</p>
                {entry.details && <p className="text-xs text-[var(--spr-text-muted)]">{entry.details}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-4 text-sm text-[var(--spr-text-faint)]">No observations yet.</p>}
      </section>

      <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <h2 className="text-lg font-bold text-[var(--spr-text)]">Software lineage</h2>
        <div className="mt-3 flex items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-[var(--spr-text)]">Provenance</p>
            <p className="mt-0.5 text-xs text-[var(--spr-text-muted)]">{slsaEvidence ? (slsaEvidence.status === 'VERIFIED' ? 'Verified' : slsaEvidence.status === 'FAILED' ? 'Verification failed' : 'Detected, not yet verified') : 'Provenance not available'}</p>
          </div>
          <button onClick={onViewLineage} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--spr-border)] px-3.5 py-2 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">View lineage <ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
      </section>

      <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6">
        <h2 className="text-lg font-bold text-[var(--spr-text)]">Actions</h2>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button onClick={() => onNavigateTab('/evidence-explorer')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--spr-border)] px-3.5 py-2 text-sm font-medium text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]"><FileSearch className="h-4 w-4" /> View evidence</button>
          <button onClick={onViewLineage} className="inline-flex items-center gap-2 rounded-lg border border-[var(--spr-border)] px-3.5 py-2 text-sm font-medium text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]"><Radio className="h-4 w-4" /> View lineage</button>
          <button onClick={() => onNavigateTab('/monitoring')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--spr-border)] px-3.5 py-2 text-sm font-medium text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]"><AlertTriangle className="h-4 w-4" /> View monitoring</button>
          {canSharePassport && (
            <button onClick={() => void sharePassport()} disabled={shareBusy} className="inline-flex items-center gap-2 rounded-lg border border-[var(--spr-border)] px-3.5 py-2 text-sm font-medium text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50">{shareBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Share passport</button>
          )}
        </div>
        {shareError && <p role="alert" className="mt-3 text-xs text-[var(--spr-red)]">{shareError}</p>}
        {shareUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--spr-highlight)]/40 bg-[var(--spr-accent-soft)]/15 px-3.5 py-2.5">
            <code className="min-w-0 flex-1 truncate text-xs text-[var(--spr-highlight)]">{shareUrl}</code>
            <button onClick={() => { void navigator.clipboard.writeText(shareUrl); setCopied(true); }} className="shrink-0 rounded-md border border-[var(--spr-highlight)]/40 px-2.5 py-1 text-[11px] font-semibold text-[var(--spr-highlight)] hover:bg-[var(--spr-highlight)]/10">{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        )}
      </section>

      </>}
    </div>
  );
}
