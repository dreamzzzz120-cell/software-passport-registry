export type ClaimEvaluation = { status: 'UNVERIFIED'; reason: string };

/** Generic natural-language claims have no claim-to-control mapping in this path.
 * Counts of evidence and findings cannot establish that a specific sentence is true.
 */
export function evaluateUnmappedClaim(evidenceCount: number, openFindings: number): ClaimEvaluation {
  if (evidenceCount === 0) return {
    status: 'UNVERIFIED',
    reason: 'No observed evidence exists for this passport. SPR does not infer a claim from absent evidence.'
  };
  if (openFindings > 0) return {
    status: 'UNVERIFIED',
    reason: 'Open findings exist, but their presence alone does not prove or disprove this specific claim. Review the linked controls and evidence.'
  };
  return {
    status: 'UNVERIFIED',
    reason: 'Evidence exists, but this claim is not mapped to a specific validated observation. Zero open findings does not verify a security claim.'
  };
}
