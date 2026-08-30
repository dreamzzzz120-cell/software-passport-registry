/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SPR Command Center design primitives.
 *
 * PRESENTATION ONLY. Every component here receives an already-computed
 * authoritative result as props. Nothing in this file evaluates, derives,
 * infers, thresholds or ranks a decision - the single evaluator
 * (src/lib/verification/evaluateVerification.ts) remains the only place a
 * decision is produced.
 *
 * Deliberate design rule: the five states are distinguished by hue and label,
 * never by a good-to-bad gradient. UNKNOWN gets the same bloom budget and the
 * same typographic weight as VERIFIED, because "insufficient evidence to make
 * the claim" is a legitimate conclusion, not a failing grade. Colour is never
 * the sole carrier of meaning - the state text is always rendered.
 */

import type { ReactNode } from 'react';
import type { VerificationDecisionState } from '../trust/TrustStateBadge';

/**
 * One entry from GET /api/user/verification. Shaped to the authoritative
 * response; presentation only, and never constructed in the UI.
 */
export interface VerificationDecisionDetail {
  passportId: string;
  name?: string;
  decision?: {
    state?: VerificationDecisionState;
    explanation?: string;
    policyVersion?: string;
    reasonCodes?: string[];
    targetIdentity?: string | null;
  };
  counts?: { observations?: number; uniqueEvidence?: number; independentSources?: number };
}

/* ------------------------------------------------------------- canvas */

export function CommandCenterBackground({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`cc-canvas ${className}`}>{children}</div>;
}

export function GlassPanel({
  children, className = '', raised = false, interactive = false, as: Tag = 'section',
}: { children: ReactNode; className?: string; raised?: boolean; interactive?: boolean; as?: 'section' | 'div' | 'article' }) {
  return (
    <Tag className={`cc-glass ${raised ? 'cc-glass-raised' : ''} ${interactive ? 'cc-glass-interactive' : ''} ${className}`}>
      {children}
    </Tag>
  );
}

export function SectionHeader({ index, title, description }: { index?: string; title: string; description?: string }) {
  return (
    <header className="mb-4">
      <div className="cc-eyebrow">{index ? `${index} · ` : ''}{title}</div>
      {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--cc-ink-muted)]">{description}</p>}
    </header>
  );
}

/* ----------------------------------------------------------- decisions */

/**
 * Copy for each state. Wording describes what the evaluator concluded; it
 * never editorialises about whether that is good or bad news.
 */
const STATE_COPY: Record<VerificationDecisionState, { label: string; meaning: string }> = {
  VERIFIED: { label: 'Verified', meaning: 'The verification requirements for this claim were satisfied.' },
  PARTIAL: { label: 'Partial', meaning: 'Some requirements were satisfied; others are not yet met.' },
  INVESTIGATE: { label: 'Investigate', meaning: 'Adverse observations require human review before a conclusion.' },
  AVOID: { label: 'Avoid', meaning: 'Evidence meets the defined criteria for an avoid decision.' },
  UNKNOWN: { label: 'Unknown', meaning: 'Evidence is insufficient to make this claim. This is not a statement that the software is unsafe.' },
};

export function decisionCopy(state: VerificationDecisionState | null | undefined) {
  return state ? STATE_COPY[state] : { label: 'Not evaluated', meaning: 'No authoritative decision has been produced for this record yet.' };
}

export function DecisionBadge({
  state, size = 'md', className = '',
}: { state: VerificationDecisionState | null | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const copy = decisionCopy(state);
  const sizing = size === 'lg' ? 'px-6 py-3 text-2xl' : size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-xs';
  // An un-evaluated record gets the neutral UNKNOWN treatment rather than any
  // state the evaluator did not actually produce.
  const stateClass = state ? `cc-decision-${state}` : 'cc-decision-UNKNOWN';
  return (
    <span
      className={`cc-decision ${stateClass} ${sizing} inline-flex items-center gap-2 font-bold uppercase tracking-[.14em] ${className}`}
      // The state text is always present, so glow and colour are never the
      // only signal for assistive technology or a monochrome display.
      aria-label={`Decision: ${copy.label}`}
    >
      {state ?? 'NOT EVALUATED'}
    </span>
  );
}

export interface DecisionHeroProps {
  state: VerificationDecisionState | null | undefined;
  /** The authoritative explanation. Rendered verbatim - never re-worded here. */
  explanation?: string;
  policyVersion?: string;
  reasonCodes?: string[];
  evidenceReferenceCount?: number;
  observationCount?: number;
  independentSourceCount?: number;
  evaluatedAt?: number | null;
  targetIdentity?: string | null;
}

export function DecisionHero(props: DecisionHeroProps) {
  const copy = decisionCopy(props.state);
  const stateClass = props.state ? `cc-decision-${props.state}` : 'cc-decision-UNKNOWN';
  return (
    <GlassPanel raised className={`cc-enter p-7 md:p-10 ${stateClass} cc-decision-hero`}>
      <div className="cc-eyebrow">Decision</div>
      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <h1 className="cc-display" style={{ color: 'var(--glow)' }}>{props.state ?? 'NOT EVALUATED'}</h1>
        {props.policyVersion && (
          <span className="cc-mono text-xs text-[var(--cc-ink-faint)]">policy {props.policyVersion}</span>
        )}
      </div>

      <p className="mt-5 max-w-3xl text-[15px] leading-7 text-[var(--cc-ink)]">
        {props.explanation || copy.meaning}
      </p>

      {(props.observationCount !== undefined || props.evidenceReferenceCount !== undefined) && (
        <dl className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {/* Reported side by side and never merged: repeated observations are
              not independent evidence, and neither is a decision. */}
          <HeroStat label="Observations" value={props.observationCount} />
          <HeroStat label="Unique evidence" value={props.evidenceReferenceCount} />
          <HeroStat label="Independent sources" value={props.independentSourceCount} />
          <HeroStat label="Evaluated" value={props.evaluatedAt ? new Date(props.evaluatedAt).toLocaleString() : undefined} />
        </dl>
      )}

      {props.reasonCodes && props.reasonCodes.length > 0 && (
        <div className="mt-7">
          <div className="cc-eyebrow">Reason codes</div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {props.reasonCodes.map((code) => <ReasonCode key={code} code={code} />)}
          </div>
        </div>
      )}

      {props.targetIdentity && (
        <p className="mt-6 text-xs text-[var(--cc-ink-faint)]">
          Applies to <span className="cc-mono text-[var(--cc-ink-muted)]">{props.targetIdentity}</span> only.
        </p>
      )}
    </GlassPanel>
  );
}

function HeroStat({ label, value }: { label: string; value?: number | string }) {
  return (
    <div>
      <dt className="cc-eyebrow">{label}</dt>
      <dd className="cc-numeric mt-1.5 text-lg font-semibold text-[var(--cc-ink)]">
        {value === undefined || value === null ? '—' : value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------- details */

export function ReasonCode({ code, description }: { code: string; description?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--cc-hairline-strong)] bg-[rgba(255,255,255,.03)] px-2.5 py-1.5">
      <span className="cc-mono text-[11px] font-semibold text-[var(--cc-ink)]">{code}</span>
      {description && <span className="text-[11px] text-[var(--cc-ink-muted)]">{description}</span>}
    </span>
  );
}

export function SourceIdentity({ source, party }: { source: string; party?: 'first-party' | 'third-party' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--cc-ink-muted)]">
      <span className="cc-mono">{source}</span>
      {party && (
        <span className="rounded border border-[var(--cc-hairline)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          {party === 'third-party' ? 'third-party' : 'first-party'}
        </span>
      )}
    </span>
  );
}

/** Renders a freshness state the caller was given. It computes nothing. */
export function FreshnessIndicator({ label, observedAt }: { label: string; observedAt?: string | number | null }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-[var(--cc-ink-muted)]">
      <span className="cc-eyebrow">{label}</span>
      {observedAt ? <span className="cc-numeric">{new Date(observedAt).toLocaleString()}</span> : <span>Not observed</span>}
    </span>
  );
}

export function EvidenceCard({
  name, type, source, party, observedAt, hash, children,
}: { name: string; type?: string; source?: string; party?: 'first-party' | 'third-party'; observedAt?: string | number | null; hash?: string | null; children?: ReactNode }) {
  return (
    <GlassPanel as="article" interactive className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--cc-ink)]">{name}</div>
          {type && <div className="cc-eyebrow mt-1">{type}</div>}
        </div>
        {/* Observation, explicitly labelled so it is never mistaken for a decision. */}
        <span className="shrink-0 rounded-md border border-[var(--cc-hairline)] px-2 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-[var(--cc-ink-faint)]">
          Observed
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {source && <SourceIdentity source={source} party={party} />}
        <FreshnessIndicator label="Collected" observedAt={observedAt} />
      </div>
      {hash && <div className="cc-mono mt-2 truncate text-[10px] text-[var(--cc-ink-faint)]">{hash}</div>}
      {children}
    </GlassPanel>
  );
}

export function LimitationPanel({ title = 'What would change this decision', items }: { title?: string; items: string[] }) {
  return (
    <GlassPanel className="p-6">
      <SectionHeader title={title} />
      {items.length === 0 ? (
        <p className="text-sm text-[var(--cc-ink-muted)]">No limitations were supplied with this decision.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-6 text-[var(--cc-ink-muted)]">
              <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--cc-ink-faint)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

export function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <GlassPanel className="p-5">
      <div className="cc-eyebrow">{label}</div>
      <div className="cc-numeric mt-2.5 text-2xl font-semibold text-[var(--cc-ink)]">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--cc-ink-muted)]">{sub}</div>}
    </GlassPanel>
  );
}
