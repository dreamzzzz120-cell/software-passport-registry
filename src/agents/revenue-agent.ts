export type RevenueOpportunityType = 'ACTIVE_OPPORTUNITY' | 'FOLLOW_UP' | 'RENEWAL_EXPANSION_SIGNAL' | 'UNKNOWN';
export type RevenueInput = { passport: { id: string; name: string }; openCriticalOrHigh: number; openFindings: number; stale: boolean; vendorRiskStatus: string | null; complianceStatus: string | null; monitoringEnabled: boolean; observedEvidenceCount: number; catalog: Record<string, number> };
export type RevenueResult = { agent: 'revenue'; schemaVersion: 'spr-revenue-agent-v1'; passport: RevenueInput['passport']; opportunities: Array<{ type: RevenueOpportunityType; service: string; value: number | null; trigger: string; nextAction: string }>; policy: { rule: string } };

function price(catalog: Record<string, number>, key: string) {
  const value = catalog[key];
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function evaluateRevenue(input: RevenueInput): RevenueResult {
  const opportunities: RevenueResult['opportunities'] = [];
  if (!input.observedEvidenceCount) {
    opportunities.push({ type: 'UNKNOWN', service: 'Evidence review', value: price(input.catalog, 'evidence_report'), trigger: 'No observed evidence is available.', nextAction: 'Collect observable evidence before proposing a trust-dependent service.' });
  } else {
    if (input.openCriticalOrHigh > 0) opportunities.push({ type: 'ACTIVE_OPPORTUNITY', service: 'Security Assessment', value: price(input.catalog, 'security_assessment'), trigger: `${input.openCriticalOrHigh} open critical/high finding(s) were observed.`, nextAction: 'Review the findings with the client and offer a remediation-focused assessment.' });
    if (input.vendorRiskStatus === 'HIGH' || input.vendorRiskStatus === 'MEDIUM') opportunities.push({ type: 'ACTIVE_OPPORTUNITY', service: 'Vendor Risk', value: price(input.catalog, 'vendor_risk'), trigger: `Vendor Risk Agent reports ${input.vendorRiskStatus}.`, nextAction: 'Present the observed vendor-risk triggers and propose a documented review.' });
    if (input.complianceStatus === 'FAIL' || input.complianceStatus === 'UNKNOWN') opportunities.push({ type: 'FOLLOW_UP', service: 'Compliance Review', value: price(input.catalog, 'audit'), trigger: `Compliance status is ${input.complianceStatus}.`, nextAction: 'Review failed or unknown controls and request the missing evidence.' });
    if (input.stale) opportunities.push({ type: 'RENEWAL_EXPANSION_SIGNAL', service: 'Continuous Verification', value: price(input.catalog, 'continuous_verification'), trigger: 'Observed evidence is stale.', nextAction: 'Offer recurring verification/monitoring using the existing SPR evidence pipeline.' });
    if (input.monitoringEnabled) opportunities.push({ type: 'RENEWAL_EXPANSION_SIGNAL', service: 'Monitoring', value: price(input.catalog, 'monitoring'), trigger: 'Monitoring is enabled for the observed asset.', nextAction: 'Review the current monitoring scope and identify renewal or expansion needs.' });
  }
  opportunities.sort((a, b) => `${a.type}|${a.service}`.localeCompare(`${b.type}|${b.service}`));
  return { agent: 'revenue', schemaVersion: 'spr-revenue-agent-v1', passport: input.passport, opportunities, policy: { rule: 'Revenue opportunities are derived only from observable SPR conditions and explicit configured catalog prices. The agent never changes trust, findings, compliance, pricing, customer budgets, or savings to manufacture revenue.' } };
}
