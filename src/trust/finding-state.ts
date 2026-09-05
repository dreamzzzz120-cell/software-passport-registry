/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The finding state machine.
//
// The whole point of this table is that a human claim and a verified fact are
// different things. A technician closing a ticket as "false positive" is a
// CLAIM; it becomes VERIFIED_NOT_AFFECTED only when a fresh scan has looked
// again and agreed. Encoding that as a transition table rather than as scattered
// UPDATE statements is what stops a caller writing the verified state directly
// and turning an unverified assertion into evidence -- the one failure this
// product cannot survive.
//
// Deliberately NOT modelled as "delete the row when a technician closes the
// ticket". Deleting loses the claim, the claimant and the reason, and the next
// scan re-detects the same finding and re-opens a ticket, which is the bouncing
// this replaces.

export const FINDING_STATES = [
  'detected',
  'claimed_false_positive',
  'under_verification',
  'verified_not_affected',
  'risk_accepted',
  'remediated_claimed',
  'remediated_verified',
] as const;

export type FindingState = (typeof FINDING_STATES)[number];

export const VEX_STATUSES = ['not_affected', 'affected', 'fixed', 'under_investigation'] as const;
export type VexStatus = (typeof VEX_STATUSES)[number];

export const REACHABILITY = ['reachable', 'unreachable', 'unknown', 'not_analyzed'] as const;
export type Reachability = (typeof REACHABILITY)[number];

/**
 * Legal transitions.
 *
 * Note what is absent: nothing reaches `verified_not_affected` or
 * `remediated_verified` except from `under_verification`. A claim cannot be
 * promoted straight to a verified state, by a webhook, an operator, or a
 * mistake, because there is no edge for it.
 *
 * Every verified state can fall back to `detected`, because a later scan
 * finding the vulnerability again outranks any earlier conclusion.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<FindingState, readonly FindingState[]>> = Object.freeze({
  detected: ['claimed_false_positive', 'remediated_claimed', 'risk_accepted', 'under_verification'],
  claimed_false_positive: ['under_verification', 'detected'],
  remediated_claimed: ['under_verification', 'detected'],
  risk_accepted: ['detected', 'under_verification'],
  under_verification: ['verified_not_affected', 'remediated_verified', 'detected'],
  verified_not_affected: ['detected'],
  remediated_verified: ['detected'],
});

export function isFindingState(value: unknown): value is FindingState {
  return typeof value === 'string' && (FINDING_STATES as readonly string[]).includes(value);
}

export function canTransition(from: FindingState, to: FindingState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class InvalidFindingTransition extends Error {
  constructor(public readonly from: FindingState, public readonly to: FindingState) {
    super(`A finding cannot move from "${from}" to "${to}".`);
    this.name = 'InvalidFindingTransition';
  }
}

/** Throws rather than returning false, so a bad transition cannot be ignored. */
export function assertTransition(from: FindingState, to: FindingState): void {
  if (!canTransition(from, to)) throw new InvalidFindingTransition(from, to);
}

/** States that represent a human assertion nothing has checked yet. */
export const CLAIMED_STATES: readonly FindingState[] = ['claimed_false_positive', 'remediated_claimed'];

/** States a fresh scan has actually confirmed. */
export const VERIFIED_STATES: readonly FindingState[] = ['verified_not_affected', 'remediated_verified'];

export const isClaimed = (state: FindingState) => CLAIMED_STATES.includes(state);
export const isVerified = (state: FindingState) => VERIFIED_STATES.includes(state);

export interface VerificationOutcome {
  state: FindingState;
  vexStatus: VexStatus;
  confidence: number;
  reason: string;
}

/**
 * The result of re-scanning a finding that carried a human claim.
 *
 * `stillPresent` is the scanner's answer, not the technician's. When the
 * scanner still sees the vulnerability the claim is overruled and the finding
 * returns to `detected` at full confidence -- it is not deleted, and the reason
 * records that an automated check invalidated the override, so the disagreement
 * is visible in the ledger rather than silently resolved in the human's favour.
 */
export function resolveVerification(
  claim: FindingState,
  stillPresent: boolean,
  observedAt: string,
): VerificationOutcome {
  if (stillPresent) {
    return {
      state: 'detected',
      vexStatus: 'affected',
      confidence: 1,
      reason: `Verification failed: the vulnerability was still detected at ${observedAt}. The manual claim of "${claim}" does not match the evidence.`,
    };
  }
  // A false-positive claim that verifies means the finding was never applicable.
  // A remediation claim that verifies means it was applicable and is now fixed.
  // Collapsing both into one state would lose that distinction for the buyer.
  return claim === 'claimed_false_positive'
    ? {
        state: 'verified_not_affected',
        vexStatus: 'not_affected',
        confidence: 1,
        reason: `Verification succeeded: the vulnerability was not observed at ${observedAt}.`,
      }
    : {
        state: 'remediated_verified',
        vexStatus: 'fixed',
        confidence: 1,
        reason: `Verification succeeded: remediation confirmed at ${observedAt}.`,
      };
}

/**
 * Whether a finding should still be counted as an open risk.
 *
 * A claim on its own does not close a finding. `risk_accepted` does not either:
 * accepting a risk records a decision about it, it does not make the
 * vulnerability go away, and a buyer reading a Passport is entitled to see it.
 */
export function countsAsOpen(state: FindingState): boolean {
  return !isVerified(state);
}
