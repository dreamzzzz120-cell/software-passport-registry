export type RevenueOpportunityType = 'ACTIVE_OPPORTUNITY' | 'FOLLOW_UP' | 'RENEWAL_EXPANSION_SIGNAL' | 'UNKNOWN';
export type RevenueUrgency = 'IMMEDIATE' | 'PLANNED' | 'WATCH' | 'UNKNOWN';

export type RevenueInput = {
  passport: { id: string; name: string };
  openCriticalOrHigh: number;
  openFindings: number;
  stale: boolean;
  vendorRiskStatus: string | null;
  complianceStatus: string | null;
  monitoringEnabled: boolean;
  observedEvidenceCount: number;
  catalog: Record<string, number>;
  evidenceIds?: string[];
  findingIds?: string[];
  unknowns?: string[];
};

export type RevenueOpportunity = {
  type: RevenueOpportunityType;
  service: string;
  value: number | null;
  trigger: string;
  nextAction: string;
  urgency: RevenueUrgency;
  basis: 'OBSERVED_EVIDENCE' | 'VERIFIED_FINDING' | 'EVIDENCE_GAP' | 'STALE_EVIDENCE' | 'CONFIGURED_STATE';
  evidenceIds: string[];
  findingIds: string[];
  unknowns: string[];
};

export type RevenueResult = {
  agent: 'revenue';
  schemaVersion: 'spr-revenue-agent-v2';
  passport: RevenueInput['passport'];
  opportunities: RevenueOpportunity[];
  summary: {
    total: number;
    active: number;
    followUp: number;
    expansion: number;
    unknown: number;
    configuredValue: number;
  };
  policy: { rule: string; valueRule: string; evidenceRule: string };
};

function price(catalog: Record<string, number>, key: string) {
  const value = catalog[key];
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function ids(values?: string[]) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))].sort();
}
function opportunity(input: Omit<RevenueOpportunity, 'evidenceIds' | 'findingIds' | 'unknowns'> & Partial<Pick<RevenueOpportunity, 'evidenceIds' | 'findingIds' | 'unknowns'>>): RevenueOpportunity {
  return { ...input, evidenceIds: ids(input.evidenceIds), findingIds: ids(input.findingIds), unknowns: ids(input.unknowns) };
}

export function evaluateRevenue(input: RevenueInput): RevenueResult {
  const opportunities: RevenueOpportunity[] = [];
  const evidenceIds = ids(input.evidenceIds);
  const findingIds = ids(input.findingIds);
  const declaredUnknowns = ids(input.unknowns);

  // No evidence means SPR cannot legitimately sell a trust-dependent conclusion.
  // The commercial opportunity is evidence acquisition itself, with UNKNOWN preserved.
  if (!input.observedEvidenceCount) {
    opportunities.push(opportunity({
      type: 'UNKNOWN',
      service: 'Evidence Baseline',
      value: price(input.catalog, 'evidence_report'),
      trigger: 'No observed evidence is available for this passport.',
      nextAction: 'Connect an observable source or collect evidence before proposing a trust-dependent service.',
      urgency: 'UNKNOWN',
      basis: 'EVIDENCE_GAP',
      unknowns: declaredUnknowns.length ? declaredUnknowns : ['Current trust condition cannot be established from observed evidence.'],
    }));
  } else {
    if (input.openCriticalOrHigh > 0) {
      opportunities.push(opportunity({
        type: 'ACTIVE_OPPORTUNITY',
        service: 'Security Remediation Assessment',
        value: price(input.catalog, 'security_assessment'),
        trigger: `${input.openCriticalOrHigh} open critical/high finding(s) are present in the persisted trust state.`,
        nextAction: 'Open the supporting findings, confirm scope with the client, remediate, then recollect evidence to verify closure.',
        urgency: 'IMMEDIATE',
        basis: 'VERIFIED_FINDING',
        evidenceIds,
        findingIds,
      }));
    }

    if (input.openFindings > input.openCriticalOrHigh) {
      opportunities.push(opportunity({
        type: 'FOLLOW_UP',
        service: 'Risk Reduction Review',
        value: price(input.catalog, 'risk_review'),
        trigger: `${input.openFindings - input.openCriticalOrHigh} additional open non-critical finding(s) require review.`,
        nextAction: 'Prioritize the remaining findings by observed impact and create a documented remediation plan.',
        urgency: 'PLANNED',
        basis: 'VERIFIED_FINDING',
        evidenceIds,
        findingIds,
      }));
    }

    if (input.vendorRiskStatus === 'HIGH' || input.vendorRiskStatus === 'MEDIUM') {
      opportunities.push(opportunity({
        type: 'ACTIVE_OPPORTUNITY',
        service: 'Vendor Risk Review',
        value: price(input.catalog, 'vendor_risk'),
        trigger: `Vendor Risk Agent reports ${input.vendorRiskStatus} from the current evidence state.`,
        nextAction: 'Present the supporting vendor-risk evidence and offer a documented vendor review with re-verification.',
        urgency: input.vendorRiskStatus === 'HIGH' ? 'IMMEDIATE' : 'PLANNED',
        basis: 'OBSERVED_EVIDENCE',
        evidenceIds,
        unknowns: declaredUnknowns,
      }));
    }

    if (input.complianceStatus === 'FAIL') {
      opportunities.push(opportunity({
        type: 'ACTIVE_OPPORTUNITY',
        service: 'Control Remediation Review',
        value: price(input.catalog, 'audit'),
        trigger: 'One or more evaluated controls are in FAIL state.',
        nextAction: 'Review failed controls, map each to supporting evidence/findings, remediate, and recollect evidence.',
        urgency: 'PLANNED',
        basis: 'VERIFIED_FINDING',
        evidenceIds,
        findingIds,
      }));
    } else if (input.complianceStatus === 'UNKNOWN') {
      opportunities.push(opportunity({
        type: 'FOLLOW_UP',
        service: 'Compliance Evidence Gap Review',
        value: price(input.catalog, 'audit'),
        trigger: 'Compliance state is UNKNOWN because the available evidence cannot establish the required controls.',
        nextAction: 'Request or connect the missing evidence; do not represent the unknown controls as passing or failing.',
        urgency: 'PLANNED',
        basis: 'EVIDENCE_GAP',
        evidenceIds,
        unknowns: declaredUnknowns.length ? declaredUnknowns : ['Compliance control state is not established.'],
      }));
    }

    if (input.stale) {
      opportunities.push(opportunity({
        type: 'RENEWAL_EXPANSION_SIGNAL',
        service: 'Evidence Refresh & Continuous Verification',
        value: price(input.catalog, 'continuous_verification'),
        trigger: 'Persisted evidence is outside its freshness policy.',
        nextAction: 'Recollect from the source, compare the new snapshot with the previous state, and verify material changes.',
        urgency: 'PLANNED',
        basis: 'STALE_EVIDENCE',
        evidenceIds,
      }));
    }

    if (!input.monitoringEnabled) {
      opportunities.push(opportunity({
        type: 'FOLLOW_UP',
        service: 'Continuous Monitoring Setup',
        value: price(input.catalog, 'monitoring'),
        trigger: 'Observed evidence exists but continuous monitoring is not enabled.',
        nextAction: 'Offer monitoring only for sources SPR can actually recollect and verify on a recurring schedule.',
        urgency: 'WATCH',
        basis: 'CONFIGURED_STATE',
        evidenceIds,
      }));
    } else {
      opportunities.push(opportunity({
        type: 'RENEWAL_EXPANSION_SIGNAL',
        service: 'Continuous Monitoring',
        value: price(input.catalog, 'monitoring'),
        trigger: 'Continuous monitoring is enabled for the observed asset.',
        nextAction: 'Review evidence coverage and freshness at renewal; expand only where additional observable sources exist.',
        urgency: 'WATCH',
        basis: 'CONFIGURED_STATE',
        evidenceIds,
      }));
    }

    if (declaredUnknowns.length) {
      opportunities.push(opportunity({
        type: 'FOLLOW_UP',
        service: 'Unknowns Resolution',
        value: price(input.catalog, 'evidence_report'),
        trigger: `${declaredUnknowns.length} explicit unknown condition(s) remain unresolved.`,
        nextAction: 'Resolve unknowns by collecting new evidence; never convert missing evidence into a positive trust claim.',
        urgency: 'PLANNED',
        basis: 'EVIDENCE_GAP',
        evidenceIds,
        unknowns: declaredUnknowns,
      }));
    }
  }

  opportunities.sort((a, b) => `${a.type}|${a.service}|${a.trigger}`.localeCompare(`${b.type}|${b.service}|${b.trigger}`));
  const configuredValue = opportunities.reduce((sum, item) => sum + (item.value ?? 0), 0);

  return {
    agent: 'revenue',
    schemaVersion: 'spr-revenue-agent-v2',
    passport: input.passport,
    opportunities,
    summary: {
      total: opportunities.length,
      active: opportunities.filter((o) => o.type === 'ACTIVE_OPPORTUNITY').length,
      followUp: opportunities.filter((o) => o.type === 'FOLLOW_UP').length,
      expansion: opportunities.filter((o) => o.type === 'RENEWAL_EXPANSION_SIGNAL').length,
      unknown: opportunities.filter((o) => o.type === 'UNKNOWN').length,
      configuredValue,
    },
    policy: {
      rule: 'Revenue opportunities are derived only from persisted observable conditions, verified findings, explicit evidence gaps, stale evidence, or configured monitoring state.',
      valueRule: 'Opportunity value is shown only when an administrator configured that service price. SPR never invents customer budget, ROI, savings, or willingness to pay.',
      evidenceRule: 'Every trust-dependent opportunity must preserve its evidence, finding, stale-state, or UNKNOWN basis. Missing evidence never becomes a positive trust or revenue claim.',
    },
  };
}
