export const AI_CLAIM_VIOLATIONS = [
  'UNSUPPORTED_VULNERABILITY',
  'UNSUPPORTED_EVIDENCE_REFERENCE',
  'UNSUPPORTED_COMPLIANCE_STATUS',
  'UNASSESSED_FRAMEWORK_REFERENCE',
  'UNSUPPORTED_CERTIFICATION',
  'UNSUPPORTED_VENDOR',
  'UNSUPPORTED_DEPENDENCY',
  'UNSUPPORTED_CONTROL',
  'UNSUPPORTED_SCORE',
  'UNSUPPORTED_ABSENCE_CLAIM',
  'RECOMMENDATION_AS_FACT',
  'SPECULATIVE_INFERENCE',
  'MISSING_UNKNOWN_DISCLOSURE',
  'MISSING_PROVENANCE',
] as const;

export type AIClaimViolation = typeof AI_CLAIM_VIOLATIONS[number];

export type AIClaimGrounding = {
  evidenceIds: readonly string[];
  vulnerabilityIds?: readonly string[];
  vendors?: readonly string[];
  dependencies?: readonly string[];
  controlIds?: readonly string[];
  scores?: Readonly<Record<string, number>>;
  assessedFrameworks?: readonly string[];
  verifiedCertifications?: readonly string[];
};

export type AIClaimGuardResult = {
  ok: boolean;
  violations: AIClaimViolation[];
  withheldStatementCount: number;
};

const normalize = (value: string) => value.trim().toLowerCase();
const mentionsAny = (text: string, values: readonly string[]) => {
  const haystack = normalize(text);
  return values.some((value) => value.trim() && haystack.includes(normalize(value)));
};

const complianceClaims = /\b(?:compliant|compliance|certified|certification|meets|satisfies|conforms)\b.{0,80}\b(?:soc\s*2|iso\s*27001|iso\s*27701|nist\s*sp\s*800|pci\s*dss|fedramp|hipaa|gdpr|cra)\b|\b(?:soc\s*2|iso\s*27001|iso\s*27701|nist\s*sp\s*800|pci\s*dss|fedramp|hipaa|gdpr|cra)\b.{0,80}\b(?:compliant|compliance|certified|certification|meets|satisfies|conforms)\b/i;
const certificationClaims = /\b(?:is|are|has been|holds)\b.{0,40}\b(?:soc\s*2|iso\s*27001|iso\s*27701|pci\s*dss|fedramp)\b.{0,40}\b(?:certified|certification)\b/i;
const frameworkPattern = /\b(?:nist\s*sp\s*800(?:-\d+)?|iso\s*27001|iso\s*27701|soc\s*2|pci\s*dss|fedramp|hipaa|gdpr|eu\s*cra)\b/i;
const absencePattern = /\b(?:no|none|never|does not|doesn't|without|not present|absent|missing)\b.{0,80}\b(?:vulnerabilit(?:y|ies)|dependencies|secrets?|findings?|issues?|controls?|attestations?|signatures?|evidence)\b/i;
const certaintyPattern = /\b(?:guarantees?|ensures?|eliminates?|fully mitigates?|completely secure|100% secure|will prevent|will eliminate)\b/i;
const speculativePattern = /\b(?:likely|probably|appears to|seems to|may be|might be|could be|presumably|I suspect|I believe)\b/i;
const recommendationAsFactPattern = /\b(?:you should|must|need to|needs to|immediately)\b.{0,100}\b(?:therefore|because|proves?|means?|confirms?)\b/i;
const scorePattern = /\b(?:score|rating)\b\s*(?:is|of|:)\s*(\d{1,3})(?:\s*\/\s*100)?/gi;
const idPattern = /\b(?:CVE-\d{4}-\d+|GHSA-[a-z0-9-]+)\b/gi;

function hasUnknownDisclosure(summary: string, unknowns: readonly string[] | undefined) {
  if ((unknowns?.length ?? 0) > 0) return true;
  return /\b(?:unknown|not verified|not established|insufficient evidence|cannot be determined|not assessed)\b/i.test(summary);
}

/**
 * Final fail-closed boundary for customer-visible AI text. The guard never
 * attempts to repair a model response; callers must discard it on any
 * violation and use a deterministic evidence-only fallback.
 */
export function guardAIClaims(
  summary: string,
  grounding: AIClaimGrounding,
  options: { unknowns?: readonly string[]; provenancePresent?: boolean } = {},
): AIClaimGuardResult {
  const violations = new Set<AIClaimViolation>();
  const text = String(summary ?? '').trim();
  const groundedEvidence = new Set(grounding.evidenceIds.map(String));
  const groundedVulnerabilities = grounding.vulnerabilityIds ?? [];
  const groundedVendors = grounding.vendors ?? [];
  const groundedDependencies = grounding.dependencies ?? [];
  const groundedControls = grounding.controlIds ?? [];
  const frameworks = grounding.assessedFrameworks ?? [];
  const certifications = grounding.verifiedCertifications ?? [];

  if (!text) violations.add('UNSUPPORTED_EVIDENCE_REFERENCE');
  if (complianceClaims.test(text)) violations.add('UNSUPPORTED_COMPLIANCE_STATUS');
  if (certificationClaims.test(text) && certifications.length === 0) violations.add('UNSUPPORTED_CERTIFICATION');
  if (frameworkPattern.test(text) && !mentionsAny(text, frameworks)) violations.add('UNASSESSED_FRAMEWORK_REFERENCE');
  if (certaintyPattern.test(text)) violations.add('RECOMMENDATION_AS_FACT');
  if (speculativePattern.test(text)) violations.add('SPECULATIVE_INFERENCE');
  if (absencePattern.test(text)) violations.add('UNSUPPORTED_ABSENCE_CLAIM');
  if (recommendationAsFactPattern.test(text)) violations.add('RECOMMENDATION_AS_FACT');
  if (!hasUnknownDisclosure(text, options.unknowns)) violations.add('MISSING_UNKNOWN_DISCLOSURE');
  if (options.provenancePresent === false) violations.add('MISSING_PROVENANCE');

  const citedIds = text.match(/(?:evidence|finding|observation)[-_:#\s]*([A-Za-z0-9_-]+)/gi) ?? [];
  for (const token of citedIds) {
    const id = token.replace(/^.*?(?:evidence|finding|observation)[-_:#\s]*/i, '').trim();
    if (id && !groundedEvidence.has(id)) violations.add('UNSUPPORTED_EVIDENCE_REFERENCE');
  }

  for (const cve of text.match(idPattern) ?? []) {
    if (!mentionsAny(cve, groundedVulnerabilities)) violations.add('UNSUPPORTED_VULNERABILITY');
  }

  if (groundedVendors.length > 0 && /\b(?:vendor|publisher|supplier)\b/i.test(text)) {
    const hasGroundedVendor = mentionsAny(text, groundedVendors);
    if (!hasGroundedVendor) violations.add('UNSUPPORTED_VENDOR');
  }

  if (groundedDependencies.length > 0 && /\b(?:dependency|package|component)\b/i.test(text)) {
    const hasGroundedDependency = mentionsAny(text, groundedDependencies);
    if (!hasGroundedDependency) violations.add('UNSUPPORTED_DEPENDENCY');
  }

  if (groundedControls.length > 0 && /\bcontrol\b/i.test(text) && !mentionsAny(text, groundedControls)) {
    violations.add('UNSUPPORTED_CONTROL');
  }

  if (grounding.scores && /\b(?:score|rating)\b/i.test(text)) {
    for (const match of text.matchAll(scorePattern)) {
      const value = Number(match[1]);
      if (!Object.values(grounding.scores).includes(value)) violations.add('UNSUPPORTED_SCORE');
    }
  }

  return {
    ok: violations.size === 0,
    violations: [...violations],
    withheldStatementCount: violations.size > 0 ? 1 : 0,
  };
}
