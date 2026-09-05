/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Free Review trust scoring.
//
// Every number this module produces traces back to a row a scan actually wrote:
// findings in scan_findings, components in passports.sbom, evidence in
// evidence_items, and the terminal status of the jobs in agent_jobs. Nothing is
// estimated, interpolated, or defaulted upward.
//
// The rule that shapes the whole design: an unobserved area is not a good area.
// A category with no evidence behind it returns `not_observed` and is excluded
// from the overall average entirely, rather than scoring 100 (which would read
// as "we checked and it was clean") or 0 (which would read as "we checked and it
// was terrible"). Two of the five categories are in that state today because no
// collector produces their signal yet, and saying so plainly is the honest
// answer until one does.
//
// This module is pure: it takes already-fetched scan rows and returns numbers.
// It performs no IO, so it is fully unit testable, and the same inputs always
// produce the same score.

export type CategoryId = 'security' | 'licensing' | 'supplyChain' | 'reliability' | 'maintainability';

export type CategoryResult =
  | { status: 'scored'; score: number; detail: string; facts: Record<string, number> }
  | { status: 'not_observed'; reason: string };

export type Verdict = 'STRONG' | 'GOOD' | 'INVESTIGATE' | 'ATTENTION' | 'HIGH RISK';

export interface ScoringFinding {
  severity: string;
  category: string;
  status: string;
}

export interface ScoringEvidence {
  type: string;
  verified: boolean | number | null;
  engineId?: string | null;
}

export interface ScoringInput {
  /** True only when the security engine reached its terminal success status. */
  securityEngineCompleted: boolean;
  /**
   * True only when the repository engine reached its terminal success status.
   * The repository engine is what produces the SBOM, so it gates licensing for
   * the same reason the security engine gates security: a run that died partway
   * leaves a partial component list behind, and measuring licence coverage
   * against a partial denominator invents a ratio.
   *
   * Found in production: a Free Review where BOTH engines ended Failed still
   * scored licensing 0 of 9 components and published "35 / 100 -- HIGH RISK".
   * The repository was never fully read; that verdict was an artefact of a
   * broken scan, and it is exactly the fabricated assurance -- in the negative
   * direction -- that this model exists to prevent.
   */
  repositoryEngineCompleted: boolean;
  findings: ScoringFinding[];
  /** Components in the generated SBOM. null when no SBOM was produced. */
  sbomComponentCount: number | null;
  evidence: ScoringEvidence[];
}

// Deduction per open finding. Chosen so a single critical costs a quarter of the
// score and a wall of low-severity noise cannot sink an otherwise sound result.
export const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
  informational: 0,
};

// Documented verdict bands. Deterministic, and derived from the overall score
// alone so the headline can never contradict the numbers printed beneath it.
export const VERDICT_BANDS: { min: number; verdict: Verdict }[] = [
  { min: 90, verdict: 'STRONG' },
  { min: 75, verdict: 'GOOD' },
  { min: 60, verdict: 'INVESTIGATE' },
  { min: 40, verdict: 'ATTENTION' },
  { min: 0, verdict: 'HIGH RISK' },
];

const CLOSED_STATUSES = new Set(['resolved', 'closed', 'verified']);

/** Findings still open. A remediated finding should not keep costing points. */
export function openFindings(findings: ScoringFinding[]): ScoringFinding[] {
  return findings.filter((finding) => !CLOSED_STATUSES.has(String(finding.status).toLowerCase()));
}

const isLicenceFinding = (finding: ScoringFinding) => String(finding.category).toLowerCase() === 'license';

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const isVerified = (item: ScoringEvidence) => item.verified === true || Number(item.verified) === 1;

/**
 * Security: 100 minus the severity-weighted cost of every open security finding,
 * floored at 0. Licence findings are excluded because they are scored as their
 * own category and would otherwise be counted twice.
 *
 * Scored only when the security engine actually completed. A run where the
 * engine failed has no security result at all: reporting 100 there would turn a
 * broken scan into a clean bill of health, which is the single most dangerous
 * thing this product could do.
 */
export function scoreSecurity(input: ScoringInput): CategoryResult {
  if (!input.securityEngineCompleted) {
    return { status: 'not_observed', reason: 'The security engine did not complete, so no security result was produced.' };
  }
  const relevant = openFindings(input.findings).filter((finding) => !isLicenceFinding(finding));
  const deduction = relevant.reduce((total, finding) => total + (SEVERITY_WEIGHTS[String(finding.severity).toLowerCase()] ?? 0), 0);
  return {
    status: 'scored',
    score: clampScore(100 - deduction),
    detail: relevant.length === 0
      ? 'No findings observed by the completed security engine.'
      : `${relevant.length} open security finding${relevant.length === 1 ? '' : 's'} observed.`,
    facts: { findings: relevant.length, deduction },
  };
}

/**
 * Licensing: the real proportion of SBOM components carrying an observed licence.
 * Every "License not observed" finding names one component the licence scanner
 * could not resolve, so the components with a declared licence are the SBOM total
 * minus those findings.
 *
 * Requires an SBOM. Without one there is no denominator and therefore no ratio --
 * not a zero.
 */
export function scoreLicensing(input: ScoringInput): CategoryResult {
  if (!input.repositoryEngineCompleted) {
    return { status: 'not_observed', reason: 'The repository engine did not complete, so the component list is incomplete and licence coverage could not be measured.' };
  }
  const total = input.sbomComponentCount;
  if (total === null || !Number.isFinite(total) || total <= 0) {
    return { status: 'not_observed', reason: 'No SBOM was produced, so licence coverage could not be measured.' };
  }
  const withoutLicence = Math.min(total, openFindings(input.findings).filter(isLicenceFinding).length);
  const withLicence = total - withoutLicence;
  const percent = Math.round((withLicence / total) * 100);
  return {
    status: 'scored',
    score: clampScore(percent),
    detail: `${withLicence} of ${total} component${total === 1 ? '' : 's'} carry an observed licence.`,
    facts: { components: total, withLicence, withoutLicence, percentWithLicence: percent },
  };
}

// Supply-chain points, stated openly so the number can be argued with:
//   up to 40  breadth  -- 20 per distinct engine that produced evidence, capped
//   up to 30  attestation present
//   up to 30  the proportion of evidence that is cryptographically verified
// Unverified evidence therefore caps this category at 70, which is the honest
// position for a free scan that signs nothing.
export const SUPPLY_CHAIN_POINTS = { perEngine: 20, engineCap: 40, attestation: 30, verification: 30 } as const;

/**
 * Supply chain / buyer readiness: how much independent, checkable evidence the
 * scan actually collected. Claims no compliance and no certification.
 */
export function scoreSupplyChain(input: ScoringInput): CategoryResult {
  const evidence = input.evidence;
  if (evidence.length === 0) {
    return { status: 'not_observed', reason: 'No evidence items were collected, so evidence coverage could not be measured.' };
  }
  // Evidence a failed run happened to leave behind is not coverage. Scoring it
  // rewarded a broken scan for the rows it managed to write before dying.
  if (!input.securityEngineCompleted && !input.repositoryEngineCompleted) {
    return { status: 'not_observed', reason: 'No engine completed, so the evidence collected is partial and coverage could not be measured.' };
  }
  const engines = new Set(evidence.map((item) => String(item.engineId || '')).filter(Boolean));
  const attestations = evidence.filter((item) => String(item.type).toLowerCase() === 'attestation').length;
  const verified = evidence.filter(isVerified).length;
  const verifiedRatio = verified / evidence.length;

  const breadth = Math.min(SUPPLY_CHAIN_POINTS.engineCap, engines.size * SUPPLY_CHAIN_POINTS.perEngine);
  const attestation = attestations > 0 ? SUPPLY_CHAIN_POINTS.attestation : 0;
  const verification = Math.round(verifiedRatio * SUPPLY_CHAIN_POINTS.verification);

  return {
    status: 'scored',
    score: clampScore(breadth + attestation + verification),
    detail: verified === 0
      ? `${evidence.length} evidence items from ${engines.size} engine${engines.size === 1 ? '' : 's'}. None are cryptographically verified.`
      : `${evidence.length} evidence items from ${engines.size} engine${engines.size === 1 ? '' : 's'}, ${verified} cryptographically verified.`,
    facts: {
      evidenceItems: evidence.length,
      engines: engines.size,
      attestations,
      verified,
      percentVerified: Math.round(verifiedRatio * 100),
    },
  };
}

// Reliability and maintainability are kept visible and unscored. No collector in
// this codebase produces a reliability or maintainability signal, so any number
// here would be invented. They stay on the page precisely so the gap is legible
// rather than hidden.
export const RELIABILITY_NOT_OBSERVED: CategoryResult = {
  status: 'not_observed',
  reason: 'No reliability collector currently produced evidence.',
};

export const MAINTAINABILITY_NOT_OBSERVED: CategoryResult = {
  status: 'not_observed',
  reason: 'No maintainability collector currently produced evidence.',
};

export interface TrustAssessment {
  score: number | null;
  verdict: Verdict | null;
  observedAreas: number;
  totalAreas: number;
  categories: Record<CategoryId, CategoryResult>;
}

/** Verdict for an overall score. Null in, null out -- never a default verdict. */
export function verdictFor(score: number | null): Verdict | null {
  if (score === null || !Number.isFinite(score)) return null;
  return VERDICT_BANDS.find((band) => score >= band.min)?.verdict ?? 'HIGH RISK';
}

/**
 * The whole assessment. The overall score is the mean of the categories that
 * were actually scored; unobserved categories are absent from the numerator AND
 * the denominator, so five areas with one observed reports that one area's score
 * against "1 of 5 areas observed" rather than being diluted toward zero.
 *
 * With nothing observed at all, score and verdict are null. There is no such
 * thing as a default result here.
 */
export function assessTrust(input: ScoringInput): TrustAssessment {
  const categories: Record<CategoryId, CategoryResult> = {
    security: scoreSecurity(input),
    licensing: scoreLicensing(input),
    supplyChain: scoreSupplyChain(input),
    reliability: RELIABILITY_NOT_OBSERVED,
    maintainability: MAINTAINABILITY_NOT_OBSERVED,
  };
  const scored = Object.values(categories).filter((category): category is Extract<CategoryResult, { status: 'scored' }> => category.status === 'scored');
  const score = scored.length === 0 ? null : clampScore(scored.reduce((total, category) => total + category.score, 0) / scored.length);
  return {
    score,
    verdict: verdictFor(score),
    observedAreas: scored.length,
    totalAreas: 5,
    categories,
  };
}

/** Severity histogram over open findings, for the preview's results panel. */
export function severityBreakdown(findings: ScoringFinding[]): Record<string, number> {
  const buckets: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of openFindings(findings)) {
    const severity = String(finding.severity).toLowerCase();
    const key = severity === 'informational' ? 'info' : severity;
    if (key in buckets) buckets[key] += 1;
  }
  return buckets;
}
