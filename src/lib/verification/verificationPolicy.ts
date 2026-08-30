/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SPR Verification Policy - the single authoritative definition of what
 * "VERIFIED" means. See docs/verification-policy.md for the plain-English
 * version; the two must not contradict each other.
 *
 * Nothing in this file reads a database, a network, or the clock. It
 * declares types, reason codes and the policy itself; evaluation lives in
 * evaluateVerification.ts and is a pure function.
 */

export const VERIFICATION_POLICY_VERSION = '1.0.0';

/** Machine-readable outcome for a single claim or a whole passport. */
export type VerificationState =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'INVESTIGATE'
  | 'AVOID'
  | 'UNKNOWN';

/**
 * Evidence source identity. Independence is judged on THIS value, never on
 * record ids, job ids, timestamps or response hashes - two OSV responses a
 * week apart remain one source (`api.osv.dev`).
 */
export type SourceIdentity =
  | 'github.com'
  | 'api.osv.dev'
  | 'syft'
  | 'spr-scanner'
  | 'publisher-attestation'
  | 'unknown';

/**
 * Whether SPR itself produced the evidence. SPR's own scanners are
 * first-party: useful observations, but SPR asserting its own trustworthiness
 * is not independent corroboration.
 */
export type SourceParty = 'first-party' | 'third-party';

export const SOURCE_PARTY: Record<SourceIdentity, SourceParty> = {
  'github.com': 'third-party',
  'api.osv.dev': 'third-party',
  syft: 'first-party',
  'spr-scanner': 'first-party',
  'publisher-attestation': 'third-party',
  unknown: 'first-party',
};

/** The claim taxonomy. Each is evaluated separately; there is no blanket "software is verified". */
export type ClaimId =
  | 'REPOSITORY_IDENTITY'
  | 'DEPENDENCY_INVENTORY'
  | 'DEPENDENCY_VULNERABILITY_STATE'
  | 'SECRET_EXPOSURE_STATE'
  | 'BUILD_PROVENANCE';

export type ReasonCode =
  | 'POLICY_SATISFIED'
  | 'NO_EVIDENCE'
  | 'REQUIRED_EVIDENCE_MISSING'
  | 'INSUFFICIENT_INDEPENDENT_SOURCES'
  | 'STALE_EVIDENCE'
  | 'MISSING_PROVENANCE'
  | 'IDENTITY_UNVERIFIED'
  | 'IDENTITY_MISMATCH'
  | 'UNPINNED_TARGET'
  | 'CONFLICTING_EVIDENCE'
  | 'ADVERSE_FINDINGS_PRESENT';

/** One normalized evidence record. Acquisition/normalization happens elsewhere. */
export interface NormalizedEvidence {
  evidenceId: string;
  claimId: ClaimId;
  source: SourceIdentity;
  /** Milliseconds since epoch. Supplied by the caller, never read from the clock here. */
  observedAt: number;
  /** Content hash. Absent hash means provenance cannot be established. */
  contentHash?: string;
  /** Immutable target identity, e.g. a 40-char commit SHA. A branch name is not pinned. */
  targetIdentity?: string;
  /** True when the record is an adverse observation (an open finding). */
  adverse?: boolean;
}

export interface ClaimRequirement {
  claimId: ClaimId;
  /** Sources able to satisfy this claim at all. */
  acceptedSources: SourceIdentity[];
  /** Distinct source identities required. */
  minDistinctSources: number;
  /** Distinct THIRD-PARTY sources required. First-party evidence alone can never verify. */
  minThirdPartySources: number;
  maxAgeDays: number;
  requiresContentHash: boolean;
  requiresPinnedTarget: boolean;
  /** Required for an overall VERIFIED passport decision. */
  requiredForPassport: boolean;
}

/**
 * Policy 1.0.0.
 *
 * Deliberately strict. Under it, a repository scan alone yields PARTIAL at
 * best, never VERIFIED, because BUILD_PROVENANCE requires an attestation
 * SPR did not generate. That is the intended, honest outcome: SPR observing
 * its own scan output is not proof, and the current production passport is
 * expected to remain UNKNOWN or PARTIAL until a publisher attestation
 * exists.
 */
export const VERIFICATION_POLICY: {
  version: string;
  claims: ClaimRequirement[];
} = {
  version: VERIFICATION_POLICY_VERSION,
  claims: [
    {
      claimId: 'REPOSITORY_IDENTITY',
      acceptedSources: ['github.com'],
      minDistinctSources: 1,
      minThirdPartySources: 1,
      maxAgeDays: 90,
      requiresContentHash: true,
      requiresPinnedTarget: true,
      requiredForPassport: true,
    },
    {
      claimId: 'DEPENDENCY_INVENTORY',
      acceptedSources: ['syft', 'github.com'],
      minDistinctSources: 1,
      // Syft is first-party (SPR runs it), so an inventory can be OBSERVED
      // but never independently VERIFIED on its own.
      minThirdPartySources: 1,
      maxAgeDays: 30,
      requiresContentHash: true,
      requiresPinnedTarget: true,
      requiredForPassport: true,
    },
    {
      claimId: 'DEPENDENCY_VULNERABILITY_STATE',
      acceptedSources: ['api.osv.dev'],
      minDistinctSources: 1,
      minThirdPartySources: 1,
      maxAgeDays: 7,
      requiresContentHash: true,
      requiresPinnedTarget: false,
      requiredForPassport: true,
    },
    {
      claimId: 'SECRET_EXPOSURE_STATE',
      acceptedSources: ['spr-scanner'],
      minDistinctSources: 1,
      // First-party only by design: SPR cannot independently verify absence
      // of secrets, so this claim can never reach VERIFIED under 1.0.0.
      minThirdPartySources: 1,
      maxAgeDays: 30,
      requiresContentHash: true,
      requiresPinnedTarget: true,
      requiredForPassport: false,
    },
    {
      claimId: 'BUILD_PROVENANCE',
      acceptedSources: ['publisher-attestation'],
      minDistinctSources: 1,
      minThirdPartySources: 1,
      maxAgeDays: 365,
      requiresContentHash: true,
      requiresPinnedTarget: true,
      requiredForPassport: true,
    },
  ],
};

export function requirementFor(claimId: ClaimId): ClaimRequirement | undefined {
  return VERIFICATION_POLICY.claims.find((claim) => claim.claimId === claimId);
}
