/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { verifyEvidenceIntegrity } from './evidence-integrity.ts';

export type SlsaVerificationOutcome = 'VERIFIED' | 'FAILED';

export interface SlsaVerificationResult {
  outcome: SlsaVerificationOutcome;
  failureReason: string | null;
  predicateType: string | null;
  builderId: string | null;
  buildType: string | null;
  subjectName: string | null;
  subjectDigestSha256: string | null;
}

const RECOGNIZED_STATEMENT_TYPES = new Set([
  'https://in-toto.io/Statement/v0.1',
  'https://in-toto.io/Statement/v1',
]);

const RECOGNIZED_SLSA_PREDICATE_TYPES = new Set([
  'https://slsa.dev/provenance/v1',
  'https://slsa.dev/provenance/v0.2',
  'https://slsa.dev/provenance/v0.1',
]);

const emptyFields = { predicateType: null, builderId: null, buildType: null, subjectName: null, subjectDigestSha256: null };

// Independently re-verifies a self-reported SLSA/in-toto provenance
// statement. It never trusts the submitter's own claim: the statement's
// content must hash-match the declared digest, and the statement must
// structurally be a real in-toto Statement carrying a recognized SLSA
// provenance predicate with a concrete builder id and subject digest. This
// deliberately does NOT verify the attestation's Sigstore/DSSE signature
// chain (certificate chain, Rekor transparency-log inclusion) -- that is a
// distinct, stronger guarantee this function does not claim to provide.
// Callers must never present a VERIFIED result here as full cryptographic
// signature verification, and must never invent a SLSA "level" -- this
// function reports only what it actually checked.
export function verifySlsaProvenance(rawStatement: string, declaredHash: string): SlsaVerificationResult {
  const integrity = verifyEvidenceIntegrity(rawStatement, declaredHash);
  if (!integrity.verified) {
    return { outcome: 'FAILED', failureReason: `HASH_MISMATCH:${integrity.failureReason}`, ...emptyFields };
  }

  let statement: any;
  try {
    statement = JSON.parse(rawStatement);
  } catch {
    return { outcome: 'FAILED', failureReason: 'MALFORMED_JSON', ...emptyFields };
  }
  if (!statement || typeof statement !== 'object') {
    return { outcome: 'FAILED', failureReason: 'MALFORMED_JSON', ...emptyFields };
  }

  const statementType = typeof statement._type === 'string' ? statement._type : null;
  const predicateType = typeof statement.predicateType === 'string' ? statement.predicateType : null;
  const builderId = typeof statement.predicate?.builder?.id === 'string' && statement.predicate.builder.id.trim()
    ? statement.predicate.builder.id.trim()
    : null;
  const buildType = typeof statement.predicate?.buildType === 'string' ? statement.predicate.buildType : null;
  const subject = Array.isArray(statement.subject) ? statement.subject[0] : null;
  const subjectName = subject && typeof subject.name === 'string' ? subject.name : null;
  const subjectDigestSha256 = subject?.digest && typeof subject.digest.sha256 === 'string' ? subject.digest.sha256 : null;
  const fields = { predicateType, builderId, buildType, subjectName, subjectDigestSha256 };

  if (!statementType || !RECOGNIZED_STATEMENT_TYPES.has(statementType)) {
    return { outcome: 'FAILED', failureReason: 'UNRECOGNIZED_STATEMENT_TYPE', ...fields };
  }
  if (!predicateType || !RECOGNIZED_SLSA_PREDICATE_TYPES.has(predicateType)) {
    return { outcome: 'FAILED', failureReason: 'UNRECOGNIZED_PREDICATE_TYPE', ...fields };
  }
  if (!builderId) {
    return { outcome: 'FAILED', failureReason: 'MISSING_BUILDER_ID', ...fields };
  }
  if (!subjectDigestSha256) {
    return { outcome: 'FAILED', failureReason: 'MISSING_SUBJECT_DIGEST', ...fields };
  }

  return { outcome: 'VERIFIED', failureReason: null, ...fields };
}
