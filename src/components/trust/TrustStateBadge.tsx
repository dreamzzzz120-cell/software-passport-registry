/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CheckCircle2, HelpCircle, ShieldAlert, XCircle, Circle, Eye, FileText, Clock, Unplug } from 'lucide-react';
import type { EvidenceStatus, VerificationStatus } from '../../types';
import { GREEN, AMBER, RED, BLUE } from '../../workflows/featureColors';

const NEUTRAL = 'var(--spr-text-faint)';

export type TrustState = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'EVIDENCE_INCOMPLETE' | 'VERIFICATION_FAILED' | 'UNINITIALIZED';

// Absence of evidence is never presented as a negative finding -- there is no
// state here that reads as "unsafe" purely because nothing has been
// submitted yet. EVIDENCE_INCOMPLETE and UNINITIALIZED are both neutral, not
// alarming, by design.
const STATE_META: Record<TrustState, { label: string; color: string; icon: typeof CheckCircle2; description: string }> = {
  VERIFIED: { label: 'Verified', color: GREEN, icon: CheckCircle2, description: 'Available evidence supports the current trust observation.' },
  PARTIALLY_VERIFIED: { label: 'Partially Verified', color: AMBER, icon: ShieldAlert, description: 'Some relevant evidence is verified, but meaningful gaps remain.' },
  EVIDENCE_INCOMPLETE: { label: 'Evidence Incomplete', color: NEUTRAL, icon: HelpCircle, description: 'There is insufficient evidence to establish the requested trust state.' },
  VERIFICATION_FAILED: { label: 'Verification Failed', color: RED, icon: XCircle, description: 'Submitted evidence failed verification.' },
  UNINITIALIZED: { label: 'Trust State Uninitialized', color: NEUTRAL, icon: Circle, description: 'No Passport or evidence exists yet.' },
};

/**
 * LEGACY mapping, retained deliberately and documented per the integration
 * rules. It maps the stored passports.verification_status column, which the
 * repository scanner hardcodes to 'unverified' on every write, so it always
 * yields EVIDENCE_INCOMPLETE for scanned software.
 *
 * It is NOT the authoritative verification decision. Prefer
 * trustStateFromDecision() below, which consumes the evaluator's result from
 * GET /api/user/passports/:id/verification. This function remains only
 * because TrustRoom and MSPCommandCenter still read the column directly; it
 * must not be used for any new surface.
 */
export function trustStateFromVerification(status: VerificationStatus | null | undefined): TrustState {
  if (status === 'verified') return 'VERIFIED';
  if (status === 'partial') return 'PARTIALLY_VERIFIED';
  return 'EVIDENCE_INCOMPLETE';
}

/** The authoritative evaluator's states (src/lib/verification/verificationPolicy.ts). */
export type VerificationDecisionState = 'VERIFIED' | 'PARTIAL' | 'INVESTIGATE' | 'AVOID' | 'UNKNOWN';

/**
 * The single mapping from the authoritative verification decision onto a
 * display state. This formats the evaluator's result; it never reinterprets
 * it, and it can never upgrade one state into a stronger one.
 *
 * INVESTIGATE and AVOID both map to VERIFICATION_FAILED's visual treatment
 * only in the sense of "not a pass" - the caller is expected to render the
 * evaluator's own explanation and reason codes alongside the badge, so the
 * distinction between "adverse findings need review" and "insufficient
 * evidence" stays visible to the reader.
 */
export function trustStateFromDecision(state: VerificationDecisionState | null | undefined): TrustState {
  switch (state) {
    case 'VERIFIED': return 'VERIFIED';
    case 'PARTIAL': return 'PARTIALLY_VERIFIED';
    case 'INVESTIGATE': return 'VERIFICATION_FAILED';
    case 'AVOID': return 'VERIFICATION_FAILED';
    case 'UNKNOWN': return 'EVIDENCE_INCOMPLETE';
    default: return 'UNINITIALIZED';
  }
}

export default function TrustStateBadge({ state, showDescription = false, className = '' }: { state: TrustState; showDescription?: boolean; className?: string }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold uppercase tracking-wider" style={{ borderColor: `${meta.color}66`, color: meta.color, backgroundColor: `${meta.color}1a` }}>
        <Icon className="h-3 w-3" style={{ color: meta.color }} />
        {meta.label}
      </span>
      {showDescription && <span className="text-xs text-[var(--spr-text-muted)]">{meta.description}</span>}
    </span>
  );
}

// Per-evidence-item status. Distinct from the passport-level trust state
// above on purpose: an OSV response with status OBSERVED is a complete,
// hashed record of what api.osv.dev returned -- rendering it as "Evidence
// Incomplete" (which is what happened when every non-VERIFIED status was
// collapsed into the passport-level badge) described something that did not
// happen. Each status here says exactly what SPR did and did not do.
const EVIDENCE_STATUS_META: Record<EvidenceStatus, { label: string; color: string; icon: typeof CheckCircle2; description: string }> = {
  VERIFIED: { label: 'Verified', color: GREEN, icon: CheckCircle2, description: 'Independently verified against its source.' },
  PARTIALLY_VERIFIED: { label: 'Partially verified', color: AMBER, icon: ShieldAlert, description: 'Some checks passed; others could not be completed.' },
  OBSERVED: { label: 'Observed', color: BLUE, icon: Eye, description: 'Response recorded from the named source and hashed as received. Not a cryptographic verification.' },
  DECLARED: { label: 'Declared', color: NEUTRAL, icon: FileText, description: 'Stated by the submitter; not checked against an independent source.' },
  CONFIGURED: { label: 'Configured', color: NEUTRAL, icon: Circle, description: 'Source is set up; no observation has been recorded from it yet.' },
  FAILED: { label: 'Verification failed', color: RED, icon: XCircle, description: 'Verification was attempted and did not pass.' },
  UNKNOWN: { label: 'Unknown', color: NEUTRAL, icon: HelpCircle, description: 'The scanner recorded this item without classifying it.' },
  STALE: { label: 'Stale', color: AMBER, icon: Clock, description: 'Recorded, but older than the policy allows for a current decision.' },
  SOURCE_DISCONNECTED: { label: 'Source disconnected', color: AMBER, icon: Unplug, description: 'The source that produced this item is no longer connected.' },
  NOT_APPLICABLE: { label: 'Not applicable', color: NEUTRAL, icon: Circle, description: 'Does not apply to this software.' },
};

export function evidenceStatusMeta(status: string | null | undefined) {
  return EVIDENCE_STATUS_META[(status as EvidenceStatus) in EVIDENCE_STATUS_META ? (status as EvidenceStatus) : 'UNKNOWN'];
}

export function EvidenceStatusBadge({ status, className = '' }: { status: string | null | undefined; className?: string }) {
  const meta = evidenceStatusMeta(status);
  const Icon = meta.icon;
  return (
    <span title={meta.description} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold uppercase tracking-wider ${className}`} style={{ borderColor: `${meta.color}66`, color: meta.color, backgroundColor: `${meta.color}14` }}>
      <Icon className="h-3 w-3" style={{ color: meta.color }} />
      {meta.label}
    </span>
  );
}
