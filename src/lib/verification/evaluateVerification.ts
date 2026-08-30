/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SOURCE_PARTY,
  VERIFICATION_POLICY,
  VERIFICATION_POLICY_VERSION,
  requirementFor,
  type ClaimId,
  type NormalizedEvidence,
  type ReasonCode,
  type SourceIdentity,
  type VerificationState,
} from './verificationPolicy.ts';

/**
 * The single authoritative verification evaluator.
 *
 * Pure and deterministic: no database, no network, no Date.now(). The
 * evaluation instant is supplied by the caller so the same inputs always
 * produce the same decision, and so tests can pin time.
 */

export interface ClaimDecision {
  claimId: ClaimId;
  state: VerificationState;
  reasonCodes: ReasonCode[];
  explanation: string;
  supportingEvidenceIds: string[];
  distinctSources: SourceIdentity[];
  distinctThirdPartySources: SourceIdentity[];
  /** Milliseconds since epoch of the newest accepted observation. */
  newestObservationAt: number | null;
}

export interface VerificationDecision {
  policyVersion: string;
  state: VerificationState;
  reasonCodes: ReasonCode[];
  explanation: string;
  claims: ClaimDecision[];
  /** Every distinct observation supplied, before independence collapsing. */
  observationCount: number;
  /** Distinct evidence records after de-duplicating by evidence id. */
  uniqueEvidenceCount: number;
  /** Distinct source identities across all accepted evidence. */
  independentSourceCount: number;
  evaluatedAt: number;
  targetIdentity: string | null;
}

export interface EvaluationInput {
  evidence: NormalizedEvidence[];
  /** Evaluation instant, milliseconds since epoch. Required - never defaulted to the clock. */
  evaluatedAt: number;
  /** The immutable identity the decision applies to, e.g. a commit SHA. */
  targetIdentity?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PINNED_COMMIT = /^[a-f0-9]{40}$/i;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function evaluateClaim(
  claimId: ClaimId,
  allEvidence: NormalizedEvidence[],
  evaluatedAt: number,
  targetIdentity: string | null,
): ClaimDecision {
  const requirement = requirementFor(claimId)!;
  const reasonCodes: ReasonCode[] = [];

  const forClaim = allEvidence.filter((e) => e.claimId === claimId);
  if (forClaim.length === 0) {
    return {
      claimId, state: 'UNKNOWN', reasonCodes: ['NO_EVIDENCE'],
      explanation: 'No evidence of this type was observed.',
      supportingEvidenceIds: [], distinctSources: [], distinctThirdPartySources: [],
      newestObservationAt: null,
    };
  }

  const accepted: NormalizedEvidence[] = [];
  for (const item of forClaim) {
    if (!requirement.acceptedSources.includes(item.source)) continue;
    if (requirement.requiresContentHash && !item.contentHash) {
      if (!reasonCodes.includes('MISSING_PROVENANCE')) reasonCodes.push('MISSING_PROVENANCE');
      continue;
    }
    if (requirement.requiresPinnedTarget) {
      if (!item.targetIdentity || !PINNED_COMMIT.test(item.targetIdentity)) {
        if (!reasonCodes.includes('UNPINNED_TARGET')) reasonCodes.push('UNPINNED_TARGET');
        continue;
      }
      if (targetIdentity && item.targetIdentity.toLowerCase() !== targetIdentity.toLowerCase()) {
        if (!reasonCodes.includes('IDENTITY_MISMATCH')) reasonCodes.push('IDENTITY_MISMATCH');
        continue;
      }
    }
    if (evaluatedAt - item.observedAt > requirement.maxAgeDays * DAY_MS) {
      if (!reasonCodes.includes('STALE_EVIDENCE')) reasonCodes.push('STALE_EVIDENCE');
      continue;
    }
    accepted.push(item);
  }

  if (accepted.length === 0) {
    if (reasonCodes.length === 0) reasonCodes.push('REQUIRED_EVIDENCE_MISSING');
    return {
      claimId, state: 'UNKNOWN', reasonCodes,
      explanation: 'Evidence of this type was observed but none of it satisfied the policy requirements.',
      supportingEvidenceIds: [], distinctSources: [], distinctThirdPartySources: [],
      newestObservationAt: null,
    };
  }

  // Independence is judged on source identity, so repeated observations from
  // one source collapse to one source no matter how many records exist.
  const distinctSources = unique(accepted.map((e) => e.source));
  const distinctThirdPartySources = distinctSources.filter((s) => SOURCE_PARTY[s] === 'third-party');
  const adverse = accepted.filter((e) => e.adverse);
  const newestObservationAt = Math.max(...accepted.map((e) => e.observedAt));

  const meetsSources = distinctSources.length >= requirement.minDistinctSources;
  const meetsThirdParty = distinctThirdPartySources.length >= requirement.minThirdPartySources;
  if (!meetsSources || !meetsThirdParty) reasonCodes.push('INSUFFICIENT_INDEPENDENT_SOURCES');

  let state: VerificationState;
  if (adverse.length > 0) {
    // Adverse observations are never silently absorbed into a pass, and are
    // equally never treated as a verification failure - they are a separate
    // dimension requiring review.
    state = 'INVESTIGATE';
    reasonCodes.push('ADVERSE_FINDINGS_PRESENT');
  } else if (meetsSources && meetsThirdParty) {
    state = 'VERIFIED';
    reasonCodes.push('POLICY_SATISFIED');
  } else {
    state = 'PARTIAL';
  }

  return {
    claimId,
    state,
    reasonCodes: unique(reasonCodes),
    explanation: buildClaimExplanation(claimId, state, distinctSources, distinctThirdPartySources, accepted.length, adverse.length),
    supportingEvidenceIds: unique(accepted.map((e) => e.evidenceId)),
    distinctSources,
    distinctThirdPartySources,
    newestObservationAt,
  };
}

function buildClaimExplanation(
  claimId: ClaimId,
  state: VerificationState,
  sources: SourceIdentity[],
  thirdParty: SourceIdentity[],
  acceptedCount: number,
  adverseCount: number,
): string {
  const base = `${acceptedCount} accepted observation(s) from ${sources.length} distinct source(s) (${sources.join(', ') || 'none'}); ${thirdParty.length} third-party.`;
  if (state === 'VERIFIED') return `${claimId} satisfied the policy. ${base}`;
  if (state === 'INVESTIGATE') return `${claimId} has ${adverseCount} adverse observation(s) requiring review. ${base}`;
  if (state === 'PARTIAL') return `${claimId} has supporting evidence but not enough independent sources. ${base}`;
  return `${claimId} could not be established. ${base}`;
}

export function evaluateVerification(input: EvaluationInput): VerificationDecision {
  const { evidence, evaluatedAt } = input;
  const targetIdentity = input.targetIdentity ?? null;

  const claims = VERIFICATION_POLICY.claims.map((requirement) =>
    evaluateClaim(requirement.claimId, evidence, evaluatedAt, targetIdentity),
  );

  const required = claims.filter((claim) => requirementFor(claim.claimId)!.requiredForPassport);
  const anyInvestigate = claims.some((claim) => claim.state === 'INVESTIGATE');
  const allRequiredVerified = required.length > 0 && required.every((claim) => claim.state === 'VERIFIED');
  const anyVerified = claims.some((claim) => claim.state === 'VERIFIED');

  let state: VerificationState;
  const reasonCodes: ReasonCode[] = [];
  if (anyInvestigate) {
    state = 'INVESTIGATE';
    reasonCodes.push('ADVERSE_FINDINGS_PRESENT');
  } else if (allRequiredVerified) {
    state = 'VERIFIED';
    reasonCodes.push('POLICY_SATISFIED');
  } else if (anyVerified) {
    state = 'PARTIAL';
    reasonCodes.push('REQUIRED_EVIDENCE_MISSING');
  } else {
    state = 'UNKNOWN';
    reasonCodes.push(evidence.length === 0 ? 'NO_EVIDENCE' : 'REQUIRED_EVIDENCE_MISSING');
  }

  const acceptedSources = unique(claims.flatMap((claim) => claim.distinctSources));

  return {
    policyVersion: VERIFICATION_POLICY_VERSION,
    state,
    reasonCodes: unique(reasonCodes),
    explanation: buildPassportExplanation(state, claims),
    claims,
    observationCount: evidence.length,
    uniqueEvidenceCount: unique(evidence.map((e) => e.evidenceId)).length,
    independentSourceCount: acceptedSources.length,
    evaluatedAt,
    targetIdentity,
  };
}

function buildPassportExplanation(state: VerificationState, claims: ClaimDecision[]): string {
  const verified = claims.filter((c) => c.state === 'VERIFIED').map((c) => c.claimId);
  const unknown = claims.filter((c) => c.state === 'UNKNOWN').map((c) => c.claimId);
  const investigate = claims.filter((c) => c.state === 'INVESTIGATE').map((c) => c.claimId);
  const parts = [`Decision: ${state} under policy ${VERIFICATION_POLICY_VERSION}.`];
  parts.push(verified.length ? `Verified claims: ${verified.join(', ')}.` : 'No claim met the verification requirements.');
  if (investigate.length) parts.push(`Requires review: ${investigate.join(', ')}.`);
  if (unknown.length) parts.push(`Insufficient evidence: ${unknown.join(', ')}.`);
  parts.push('Unknown means SPR does not have enough evidence to make the claim - it is not a statement that the software is unsafe.');
  return parts.join(' ');
}
