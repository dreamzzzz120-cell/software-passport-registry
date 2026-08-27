import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { passports } from '../db/schema.ts';

// The single authoritative passport-scoring calculation. Previously
// src/utils/scanner.ts and src/trust/trust-loop.ts each computed and wrote
// passports.overallScore/securityScore/complianceScore/vendorReputationScore
// with their own independent formulas -- trust-loop.ts wrote the exact same
// number into all three dimensions, and (having no findings to penalize when
// it had collected almost no evidence) could legitimately produce a "perfect"
// 100 for software that was barely checked at all. Both pipelines now
// normalize their own data into CanonicalScoreInput and call the one
// function below; neither maintains a competing formula.
//
// Core rule: a score is only ever a real measurement of evidence that was
// actually resolved (PASS/FAIL), never a default for evidence that is
// missing or still UNKNOWN. "No findings" is not evidence of a clean bill of
// health unless there was something to check in the first place.

export type CanonicalSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type CanonicalFindingCategory = 'security' | 'compliance' | 'vendor';
export type VerificationStatus = 'unverified' | 'partial' | 'verified';

export interface CanonicalFinding {
  severity: CanonicalSeverity;
  category: CanonicalFindingCategory;
  /** true = still open and counts against the score; false = resolved/passed, no penalty. */
  open: boolean;
  /** Multiplies this finding's severity weight for this dimension only (e.g. a signature failure hitting security harder than compliance). Defaults to 1. */
  weightMultiplier?: number;
}

export interface CanonicalEvidenceSummary {
  /** Total evidence/observation units considered (evidence_items rows, ControlObservations, etc). */
  totalUnits: number;
  /** How many of those units were actually resolved to PASS/FAIL rather than left UNKNOWN/unavailable. */
  knownUnits: number;
  /** 0..1 average freshness across known units. Pipelines without per-item freshness tracking pass 1. */
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
// (not UNKNOWN) before its score is presented as a settled "verified"
// conclusion rather than a provisional one. Below this floor the score is
// still calculated from what is known (partial evidence is still real
// evidence), but the verification status makes clear the conclusion could
// change materially as more evidence comes in.
export const VERIFIED_COMPLETENESS_THRESHOLD = 70;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateCanonicalScores(input: CanonicalScoreInput): CanonicalScoreResult {
  const totalUnits = Math.max(0, Math.round(input.evidence.totalUnits));
  const knownUnits = Math.max(0, Math.min(totalUnits, Math.round(input.evidence.knownUnits)));
  const evidenceCompleteness = totalUnits > 0 ? Math.round((knownUnits / totalUnits) * 100) : 0;

  // No evidence at all, or evidence exists but none of it has actually been
  // resolved yet -- there is nothing legitimate to score.
  if (totalUnits === 0 || knownUnits === 0) {
    return { overallScore: null, securityScore: null, complianceScore: null, vendorReputationScore: null, confidenceScore: null, evidenceCompleteness, verificationStatus: 'unverified' };
  }

  const freshness = Math.max(0, Math.min(1, input.evidence.freshness ?? 1));
  const confidenceScore = Math.round(evidenceCompleteness * freshness);

  let securityScore = 100;
  let complianceScore = 100;
  // Vendor reputation starts from vendor-audit pass/fail evidence (if any)
  // rather than a flat 100 -- this must happen BEFORE the findings loop
  // below so a vendor-category finding's penalty is applied on top of it,
  // not overwritten by it.
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

  const verificationStatus: VerificationStatus = evidenceCompleteness >= VERIFIED_COMPLETENESS_THRESHOLD ? 'verified' : 'partial';

  return { overallScore, securityScore, complianceScore, vendorReputationScore, confidenceScore, evidenceCompleteness, verificationStatus };
}

/** Calculates and persists the canonical score. The only function that should ever write these six passport columns. */
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
