import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { passports } from '../db/schema.ts';

// The single authoritative passport-scoring calculation. Previously
// src/utils/scanner.ts and src/trust/trust-loop.ts each computed and wrote
// passports.overallScore/securityScore/complianceScore/vendorReputationScore
// with their own independent formulas. Both pipelines now normalize their
// data into CanonicalScoreInput and call this one function.
//
// Core rule: a score is only ever a settled measurement of evidence that was
// actually resolved (PASS/FAIL). Missing or unresolved evidence cannot become
// a default score, and partial evidence cannot be published as a settled
// numeric trust score. "No findings" is not evidence of a clean bill of health
// unless there was enough evidence to justify the conclusion.

export type CanonicalSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type CanonicalFindingCategory = 'security' | 'compliance' | 'vendor';
export type VerificationStatus = 'unverified' | 'partial' | 'verified';

export interface CanonicalFinding {
  severity: CanonicalSeverity;
  category: CanonicalFindingCategory;
  /** true = still open and counts against the score; false = resolved/passed, no penalty. */
  open: boolean;
  /** Multiplies this finding's severity weight for this dimension only. Defaults to 1. */
  weightMultiplier?: number;
}

export interface CanonicalEvidenceSummary {
  /** Total evidence/observation units considered. */
  totalUnits: number;
  /** Units actually resolved to PASS/FAIL rather than UNKNOWN/unavailable. */
  knownUnits: number;
  /** 0..1 average freshness across known units. */
  freshness?: number;
  hasValidSignature?: boolean;
  hasInvalidSignature?: boolean;
  hasAuditReport?: boolean;
  vendorPassCount?: number;
  vendorFailCount?: number;
}

export interface CanonicalScoreInput {
  findings: CanonicalFinding[];
  evidence: CanonicalEvidenceSummary;
}

export interface CanonicalScoreResult {
  overallScore: number | null;
  securityScore: number | null;
  complianceScore: number | null;
  vendorReputationScore: number | null;
  confidenceScore: number | null;
  evidenceCompleteness: number | null;
  verificationStatus: VerificationStatus;
}

const SEVERITY_WEIGHT: Record<CanonicalSeverity, number> = { informational: 0, low: 5, medium: 10, high: 20, critical: 35 };
const SIGNATURE_BONUS = 5;
const INVALID_SIGNATURE_PENALTY = 15;
const MISSING_SIGNATURE_PENALTY = 5;
const AUDIT_BONUS = 3;
const MISSING_AUDIT_PENALTY = 8;

// A passport needs at least this much of its evidence actually resolved
// (not UNKNOWN) before a numeric score is a settled conclusion.
export const VERIFIED_COMPLETENESS_THRESHOLD = 70;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateCanonicalScores(input: CanonicalScoreInput): CanonicalScoreResult {
  const totalUnits = Math.max(0, Math.round(input.evidence.totalUnits));
  const knownUnits = Math.max(0, Math.min(totalUnits, Math.round(input.evidence.knownUnits)));
  // No evidence is a distinct state from "0% of expected evidence is known".
  const evidenceCompleteness = totalUnits > 0 ? Math.round((knownUnits / totalUnits) * 100) : null;

  // No evidence at all, or evidence exists but none has actually been
  // resolved yet -- there is nothing legitimate to score.
  if (totalUnits === 0 || knownUnits === 0) {
    return { overallScore: null, securityScore: null, complianceScore: null, vendorReputationScore: null, confidenceScore: null, evidenceCompleteness, verificationStatus: 'unverified' };
  }

  const freshness = Math.max(0, Math.min(1, input.evidence.freshness ?? 1));
  const confidenceScore = Math.round((evidenceCompleteness ?? 0) * freshness);

  // Partial evidence remains useful for completeness/confidence and for the
  // verification workflow, but it must never publish a settled numeric trust
  // score. Otherwise a clean-looking subset could render as 95/100 or 100/100
  // while 30%+ of the evidence universe is still unknown. The score becomes a
  // numeric claim only once the verification completeness threshold is met.
  if (evidenceCompleteness < VERIFIED_COMPLETENESS_THRESHOLD) {
    return { overallScore: null, securityScore: null, complianceScore: null, vendorReputationScore: null, confidenceScore, evidenceCompleteness, verificationStatus: 'partial' };
  }

  let securityScore = 100;
  let complianceScore = 100;
  const vendorPassCount = input.evidence.vendorPassCount ?? 0;
  const vendorFailCount = input.evidence.vendorFailCount ?? 0;
  let vendorReputationScore = vendorPassCount > 0 || vendorFailCount > 0 ? 100 - vendorFailCount * 20 + vendorPassCount * 3 : 100;

  for (const finding of input.findings) {
    if (!finding.open) continue;
    const weight = SEVERITY_WEIGHT[finding.severity] * (finding.weightMultiplier ?? 1);
    if (finding.category === 'security') securityScore -= weight;
    else if (finding.category === 'compliance') complianceScore -= weight;
    else vendorReputationScore -= weight;
  }

  if (input.evidence.hasValidSignature) securityScore += SIGNATURE_BONUS;
  else if (input.evidence.hasInvalidSignature) securityScore -= INVALID_SIGNATURE_PENALTY;
  else securityScore -= MISSING_SIGNATURE_PENALTY;

  if (input.evidence.hasAuditReport) complianceScore += AUDIT_BONUS;
  else complianceScore -= MISSING_AUDIT_PENALTY;

  securityScore = clamp(securityScore);
  complianceScore = clamp(complianceScore);
  vendorReputationScore = clamp(vendorReputationScore);
  const overallScore = clamp(securityScore * 0.4 + complianceScore * 0.4 + vendorReputationScore * 0.2);

  return { overallScore, securityScore, complianceScore, vendorReputationScore, confidenceScore, evidenceCompleteness, verificationStatus: 'verified' };
}

/** Calculates and persists the canonical score. The only function that should ever write these passport score columns. */
export async function calculateAndPersistPassportScore(tenantId: string, passportId: string, input: CanonicalScoreInput): Promise<CanonicalScoreResult> {
  const result = calculateCanonicalScores(input);
  await db.update(passports)
    .set({
      overallScore: result.overallScore,
      securityScore: result.securityScore,
      complianceScore: result.complianceScore,
      vendorReputationScore: result.vendorReputationScore,
      confidenceScore: result.confidenceScore,
      evidenceCompleteness: result.evidenceCompleteness,
      verificationStatus: result.verificationStatus,
    })
    .where(and(eq(passports.id, passportId), eq(passports.tenantId, tenantId)));
  return result;
}
