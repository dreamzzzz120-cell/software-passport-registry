export type ReportSource = 'OBSERVED' | 'DERIVED' | 'UNKNOWN' | 'GAP' | 'RECOMMENDED_ACTION';
export type ReportInput = { passport: { id: string; name: string }; verificationStatus: string; evidenceCount: number; findingCount: number; openFindingCount: number; vendorRiskStatus?: string; complianceStatus?: string; monitoringMaterialChanges?: number; freshness: string | null; evaluatedAt: number };
export type ReportResult = { agent: 'report'; schemaVersion: 'spr-report-agent-v1'; passport: ReportInput['passport']; sections: Array<{ title: string; source: ReportSource; facts: string[] }>; policy: { rule: string; evaluatedAt: string } };

export function buildAgentReport(input: ReportInput): ReportResult {
  const sections: ReportResult['sections'] = [
    { title: 'Verification', source: 'OBSERVED', facts: [`Current verification status: ${input.verificationStatus}.`, `Observed evidence items: ${input.evidenceCount}.`] },
    { title: 'Findings', source: 'OBSERVED', facts: [`Total findings observed: ${input.findingCount}.`, `Open findings observed: ${input.openFindingCount}.`] },
  ];
  if (input.vendorRiskStatus) sections.push({ title: 'Vendor Risk', source: 'DERIVED', facts: [`Vendor-risk agent status: ${input.vendorRiskStatus}.`] });
  else sections.push({ title: 'Vendor Risk', source: 'UNKNOWN', facts: ['No vendor-risk result was supplied.'] });
  if (input.complianceStatus) sections.push({ title: 'Compliance', source: 'DERIVED', facts: [`Compliance agent status: ${input.complianceStatus}.`] });
  else sections.push({ title: 'Compliance', source: 'UNKNOWN', facts: ['No compliance result was supplied.'] });
  if (input.monitoringMaterialChanges != null) sections.push({ title: 'Monitoring', source: 'DERIVED', facts: [`Material observed changes: ${input.monitoringMaterialChanges}.`] });
  else sections.push({ title: 'Monitoring', source: 'UNKNOWN', facts: ['No monitoring result was supplied.'] });
  if (input.freshness) sections.push({ title: 'Freshness', source: 'OBSERVED', facts: [`Latest observed freshness: ${input.freshness}.`] });
  else sections.push({ title: 'Freshness gap', source: 'GAP', facts: ['No current freshness value was supplied.'] });
  const actions: string[] = [];
  if (input.openFindingCount > 0) actions.push('Review and remediate unresolved findings.');
  if (input.monitoringMaterialChanges && input.monitoringMaterialChanges > 0) actions.push('Review material changes before relying on the previous assessment.');
  if (!actions.length) actions.push('Continue evidence-backed monitoring and re-evaluate when material evidence changes.');
  sections.push({ title: 'Recommended Actions', source: 'RECOMMENDED_ACTION', facts: actions });
  return { agent: 'report', schemaVersion: 'spr-report-agent-v1', passport: input.passport, sections, policy: { rule: 'Reports separate observed facts, derived agent results, unknowns, gaps, and recommendations. The report agent does not invent evidence, compliance, financial impact, or trust.', evaluatedAt: new Date(input.evaluatedAt).toISOString() } };
}
