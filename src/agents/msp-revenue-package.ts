import { evaluateRevenue, type RevenueInput, type RevenueOpportunity } from './revenue-agent.ts';

/**
 * Generates a client-reviewable service package from SPR's evidence-backed revenue agent.
 * This is a proposal DRAFT, never an invoice, checkout session or realized revenue.
 */
export type RevenuePackage = {
  schemaVersion: 'spr-msp-revenue-package-v1';
  status: 'DRAFT_REQUIRES_APPROVAL';
  passport: RevenueInput['passport'];
  service: string;
  scope: string[];
  deliverables: string[];
  evidence: { basis: RevenueOpportunity['basis']; evidenceIds: string[]; findingIds: string[]; unknowns: string[]; trigger: string };
  pricing: {
    currency: 'CAD';
    proposedAmount: number | null;
    source: 'CONFIGURED_CATALOG' | 'NOT_CONFIGURED';
    directCostEstimate: number | null;
    estimatedContribution: number | null;
  };
  nextAction: string;
  disclaimers: string[];
};

export type PackageOptions = {
  /** Optional local cost estimate provided by an authorized MSP user, not inferred by AI. */
  directCostEstimate?: number | null;
  currency?: 'CAD';
};

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function buildMspRevenuePackages(input: RevenueInput, options: PackageOptions = {}): RevenuePackage[] {
  if (options.currency && options.currency !== 'CAD') throw new Error('Unsupported proposal currency');
  if (options.directCostEstimate != null && !finiteNonnegative(options.directCostEstimate)) {
    throw new Error('Cost estimate must be a finite nonnegative amount');
  }

  const result = evaluateRevenue(input);
  return result.opportunities.map((opportunity) => {
    const proposedAmount = finiteNonnegative(opportunity.value) ? opportunity.value : null;
    const cost = options.directCostEstimate ?? null;
    return {
      schemaVersion: 'spr-msp-revenue-package-v1',
      status: 'DRAFT_REQUIRES_APPROVAL',
      passport: { id: input.passport.id, name: input.passport.name },
      service: opportunity.service,
      scope: [
        'Confirm customer authorization, covered assets and exclusions before any inspection or change.',
        opportunity.nextAction,
        'Record the inspected sources and any limitations; re-verify after approved remediation.',
      ],
      deliverables: [
        'Client-facing explanation of observed conditions and explicitly UNKNOWN conditions.',
        'Evidence-linked findings and recommended next actions.',
        'Dated service report with scope and verification limitations.',
      ],
      evidence: {
        basis: opportunity.basis,
        evidenceIds: [...opportunity.evidenceIds],
        findingIds: [...opportunity.findingIds],
        unknowns: [...opportunity.unknowns],
        trigger: opportunity.trigger,
      },
      pricing: {
        currency: 'CAD',
        proposedAmount,
        source: proposedAmount === null ? 'NOT_CONFIGURED' : 'CONFIGURED_CATALOG',
        directCostEstimate: cost,
        estimatedContribution: proposedAmount !== null && cost !== null ? proposedAmount - cost : null,
      },
      nextAction: opportunity.nextAction,
      disclaimers: [
        'Draft only: client approval, acceptance, invoice and payment are separate recorded events.',
        'Configured service price is not earned revenue or proof of customer willingness to pay.',
        'An evidence gap is not proof of insecurity; unresolved claims remain UNKNOWN.',
        'No security remediation, monitoring change, customer contact or payment is initiated by this proposal.',
      ],
    };
  });
}
