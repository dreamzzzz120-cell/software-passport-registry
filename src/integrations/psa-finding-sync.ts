/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Vendor-neutral core of the PSA <-> finding loop.
//
// Deliberately knows nothing about ConnectWise, Autotask or NinjaOne. Each
// vendor speaks its own status vocabulary and its own wire format; that belongs
// in an adapter. What lives here is the part that must be identical whoever the
// vendor is: how a technician's ticket disposition becomes a finding state, and
// what that is allowed to do to the trust record.
//
// The rule this module exists to enforce: a PSA ticket carries a HUMAN CLAIM,
// never a verified fact. Closing a ticket as "resolved" is somebody asserting
// they fixed it. It moves the finding to a *claimed* state, which SPR then
// verifies by scanning again. Nothing a PSA can send maps to
// verified_not_affected or remediated_verified -- those are reachable only from
// under_verification, and only by the verification path. A vendor integration
// that could write them would let anyone with a ticket close a vulnerability by
// asserting it away, which is the failure this product exists to prevent.

import {
  canTransition,
  isVerified,
  type FindingState,
} from '../trust/finding-state.ts';

/**
 * Normalised dispositions. Each vendor adapter maps its own status strings onto
 * these; the set is deliberately small, and anything an adapter cannot confidently
 * classify must come back as `unknown` rather than being guessed into a bucket.
 */
export const PSA_DISPOSITIONS = [
  'resolved_fixed',
  'resolved_not_applicable',
  'reopened',
  'acknowledged',
  'unknown',
] as const;

export type PsaDisposition = (typeof PSA_DISPOSITIONS)[number];

export function isPsaDisposition(value: unknown): value is PsaDisposition {
  return typeof value === 'string' && (PSA_DISPOSITIONS as readonly string[]).includes(value);
}

/**
 * The finding state a disposition claims. Returns null when the disposition
 * carries no claim about the finding at all.
 *
 * Note what is absent: no disposition maps to a verified state. That is the
 * point.
 */
export function claimedStateFor(disposition: PsaDisposition): FindingState | null {
  switch (disposition) {
    case 'resolved_fixed': return 'remediated_claimed';
    case 'resolved_not_applicable': return 'claimed_false_positive';
    case 'reopened': return 'detected';
    case 'acknowledged': return null; // an acknowledgement is not a claim
    case 'unknown': return null;
    default: return null;
  }
}

export interface FindingUpdatePlan {
  /** The state to write. Always a real state -- never undefined. */
  nextState: FindingState;
  humanClaimReason: string;
  /** True when SPR should now re-scan to test the claim. */
  requiresVerification: boolean;
}

export interface FindingUpdateRejection {
  rejected: true;
  code: 'NO_CLAIM' | 'ILLEGAL_TRANSITION' | 'ALREADY_VERIFIED';
  reason: string;
}

export type FindingUpdateOutcome = FindingUpdatePlan | FindingUpdateRejection;

export const isRejection = (outcome: FindingUpdateOutcome): outcome is FindingUpdateRejection =>
  (outcome as FindingUpdateRejection).rejected === true;

/**
 * Decide what a ticket disposition does to a finding.
 *
 * Returns a plan or a rejection; it never throws for ordinary input, and it
 * never returns undefined. The earlier sketch of this integration assigned the
 * result of `assertTransition()` -- which returns void -- straight into the
 * state column, so every synchronised finding would have been written as
 * `state: undefined`. Returning an explicit object makes that shape of mistake
 * impossible at the call site.
 */
export function planFindingUpdate(
  currentState: FindingState,
  disposition: PsaDisposition,
  options: { ticketId: string; actor: string; note?: string; observedAt: string },
): FindingUpdateOutcome {
  const target = claimedStateFor(disposition);
  if (target === null) {
    return {
      rejected: true,
      code: 'NO_CLAIM',
      reason: `Ticket ${options.ticketId} reported "${disposition}", which asserts nothing about the finding.`,
    };
  }

  // A finding a scan has already verified is not reopened by a ticket comment.
  // Only a fresh detection reopens it, and that comes from the scanner.
  if (isVerified(currentState) && target !== 'detected') {
    return {
      rejected: true,
      code: 'ALREADY_VERIFIED',
      reason: `Finding is ${currentState}, which SPR verified by scanning. Ticket ${options.ticketId} cannot move it to ${target}.`,
    };
  }

  if (!canTransition(currentState, target)) {
    return {
      rejected: true,
      code: 'ILLEGAL_TRANSITION',
      reason: `A finding cannot move from ${currentState} to ${target}.`,
    };
  }

  const note = options.note?.trim();
  return {
    nextState: target,
    requiresVerification: target !== 'detected',
    humanClaimReason: [
      `PSA ticket ${options.ticketId} reported ${disposition} by ${options.actor} at ${options.observedAt}.`,
      note ? `Note: ${note}` : null,
      target === 'detected'
        ? null
        : 'Recorded as a claim. SPR re-scans to verify it; the claim does not close the finding on its own.',
    ].filter(Boolean).join(' '),
  };
}

/**
 * The vendor seam.
 *
 * An adapter turns one vendor's request into the neutral shape above. It is
 * deliberately NOT implemented for any vendor yet: ConnectWise's webhook
 * signature scheme, header name and payload shape are not documented in this
 * repository, and guessing them would produce an endpoint that looks finished,
 * passes its own mocks, and cannot authenticate a single real request. The
 * transport around this seam is real and tested; only the wire format is
 * pending vendor documentation or one captured sample request.
 */
export interface PsaWebhookEvent {
  ticketId: string;
  disposition: PsaDisposition;
  actor: string;
  note?: string;
}

export interface PsaAdapter {
  provider: string;
  /** Header carrying the signature, for the transport to read. */
  signatureHeader: string;
  /** Parse a verified raw body into the neutral event shape. */
  parse(rawBody: string, headers: Record<string, string | undefined>): PsaWebhookEvent;
  /**
   * Verify the vendor's signature. Optional: without it the transport falls
   * back to SPR's native t=<unix>,v1=<hex> scheme. A vendor that signs
   * differently -- ConnectWise does -- must supply its own, because the native
   * verifier would reject every genuine request from it.
   */
  verify?(secret: string, rawBody: string, header: string): boolean;
  /**
   * A stable id for this delivery, used to reject replays. Vendors whose
   * signature carries no timestamp cannot bound replay in the signature itself.
   */
  eventId?(rawBody: string): string;
}

export class PsaVendorContractUnverified extends Error {
  readonly code = 'PSA_VENDOR_CONTRACT_UNVERIFIED';
  constructor(provider: string) {
    super(
      `The ${provider} webhook contract is not verified in this deployment. `
      + 'Supply the vendor signature documentation or one captured sample request, '
      + 'then implement the adapter. SPR will not guess a signature scheme.',
    );
    this.name = 'PsaVendorContractUnverified';
  }
}

const ADAPTERS = new Map<string, PsaAdapter>();

export function registerPsaAdapter(adapter: PsaAdapter): void {
  ADAPTERS.set(adapter.provider, adapter);
}

export function adapterFor(provider: string): PsaAdapter {
  const adapter = ADAPTERS.get(provider);
  if (!adapter) throw new PsaVendorContractUnverified(provider);
  return adapter;
}

export const registeredPsaProviders = (): string[] => [...ADAPTERS.keys()].sort();
