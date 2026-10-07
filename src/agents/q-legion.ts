/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Q-LEGION governed mission core.
 *
 * This module is intentionally pure and deterministic. It does not execute
 * tools, mutate tenant data, or grant authority. It turns candidate strategies,
 * evidence references, adversarial review, and an externally-issued authority
 * grant into a decision receipt that can be persisted by a caller.
 */

export const QLEGION_EVIDENCE_STATES = [
  'KNOWN',
  'PROBABLE',
  'CONTESTED',
  'STALE',
  'UNKNOWN',
  'UNKNOWABLE_WITH_CURRENT_ACCESS',
] as const;
export type QLegionEvidenceState = typeof QLEGION_EVIDENCE_STATES[number];

export const QLEGION_REVERSIBILITY = ['REVERSIBLE', 'PARTIALLY_REVERSIBLE', 'IRREVERSIBLE'] as const;
export type QLegionReversibility = typeof QLEGION_REVERSIBILITY[number];

export const QLEGION_AUTHORITY = ['NONE', 'AGENT', 'CONSTELLATION', 'HUMAN'] as const;
export type QLegionAuthority = typeof QLEGION_AUTHORITY[number];

export type EvidenceRef = {
  id: string;
  state: QLegionEvidenceState;
  observedAt: string | null;
  source: string;
};

export type StrategyCandidate = {
  id: string;
  label: string;
  hypothesis: string;
  probability: number | null;
  expectedValueCents: number | null;
  estimatedCostCents: number | null;
  reversibility: QLegionReversibility;
  requiredEvidenceIds: string[];
};

export type AdversarialFinding = {
  id: string;
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW';
  statement: string;
  evidenceIds: string[];
};

export type JudgeReview = {
  strategyId: string;
  accepted: boolean;
  rationale: string;
  evidenceIds: string[];
};

export type AuthorityGrant = {
  issuer: 'human' | 'constellation';
  level: Exclude<QLegionAuthority, 'NONE' | 'AGENT'>;
  scope: string[];
  expiresAt: string | null;
};

export type MissionInput = {
  missionId: string;
  objective: string;
  evidence: EvidenceRef[];
  strategies: StrategyCandidate[];
  redTeamFindings: AdversarialFinding[];
  judgeReviews: JudgeReview[];
  authorityGrant: AuthorityGrant | null;
  now: string;
};

export type StrategyAssessment = {
  strategyId: string;
  eligible: boolean;
  reasons: string[];
  advisoryProbability: number | null;
  expectedNetValueCents: number | null;
};

export type MissionDecision = {
  missionId: string;
  objective: string;
  status: 'READY_FOR_EXECUTION' | 'HOLD' | 'UNKNOWN';
  selectedStrategyId: string | null;
  selectedStrategyLabel: string | null;
  authorityLevel: QLegionAuthority;
  assessments: StrategyAssessment[];
  unknowns: string[];
  policy: string;
  decidedAt: string;
};

export const QLEGION_POLICY =
  'Q-LEGION probabilities are advisory, never evidence. UNKNOWN remains UNKNOWN. ' +
  'A strategy with unsupported evidence references, a red-team BLOCKER, a rejected judge review, ' +
  'or insufficient external authority cannot execute. Agents cannot self-grant authority.';

function finiteProbability(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function validIso(value: string | null): boolean {
  if (!value) return false;
  return Number.isFinite(new Date(value).getTime());
}

function authorityRank(level: QLegionAuthority): number {
  if (level === 'HUMAN') return 3;
  if (level === 'CONSTELLATION') return 2;
  if (level === 'AGENT') return 1;
  return 0;
}

function requiredAuthority(strategy: StrategyCandidate): QLegionAuthority {
  if (strategy.reversibility === 'IRREVERSIBLE') return 'HUMAN';
  if (strategy.reversibility === 'PARTIALLY_REVERSIBLE') return 'CONSTELLATION';
  return 'CONSTELLATION';
}

function grantLevel(grant: AuthorityGrant | null, now: string): QLegionAuthority {
  if (!grant) return 'NONE';
  if (grant.issuer !== 'human' && grant.issuer !== 'constellation') return 'NONE';
  if (grant.expiresAt && validIso(grant.expiresAt) && new Date(grant.expiresAt).getTime() <= new Date(now).getTime()) return 'NONE';
  return grant.level;
}

function hasScope(grant: AuthorityGrant | null, missionId: string, strategyId: string): boolean {
  if (!grant) return false;
  return grant.scope.includes('*') || grant.scope.includes(`mission:${missionId}`) || grant.scope.includes(`strategy:${strategyId}`);
}

function evidenceMap(input: MissionInput): Map<string, EvidenceRef> {
  return new Map(input.evidence.map((e) => [e.id, e]));
}

function evidenceUsable(ref: EvidenceRef | undefined): boolean {
  if (!ref) return false;
  return ref.state === 'KNOWN' || ref.state === 'PROBABLE';
}

function judgeFor(input: MissionInput, strategyId: string): JudgeReview | null {
  return input.judgeReviews.find((review) => review.strategyId === strategyId) ?? null;
}

function blockerFor(input: MissionInput, strategyId: string, evidenceIds: Set<string>): AdversarialFinding | null {
  return input.redTeamFindings.find((finding) => {
    if (finding.severity !== 'BLOCKER') return false;
    if (finding.evidenceIds.length === 0) return true;
    return finding.evidenceIds.some((id) => evidenceIds.has(id));
  }) ?? null;
}

export function assessStrategies(input: MissionInput): StrategyAssessment[] {
  const eMap = evidenceMap(input);
  const level = grantLevel(input.authorityGrant, input.now);

  return input.strategies.map((strategy) => {
    const reasons: string[] = [];
    const refs = new Set(strategy.requiredEvidenceIds);
    const missing = strategy.requiredEvidenceIds.filter((id) => !eMap.has(id));
    const unusable = strategy.requiredEvidenceIds.filter((id) => !evidenceUsable(eMap.get(id)));
    const judge = judgeFor(input, strategy.id);
    const blocker = blockerFor(input, strategy.id, refs);
    const required = requiredAuthority(strategy);

    if (strategy.requiredEvidenceIds.length === 0) reasons.push('NO_REQUIRED_EVIDENCE_DECLARED');
    if (missing.length) reasons.push(`MISSING_EVIDENCE:${missing.join(',')}`);
    if (unusable.length) reasons.push(`EVIDENCE_NOT_ACTIONABLE:${unusable.join(',')}`);
    if (!judge) reasons.push('JUDGE_REVIEW_MISSING');
    else if (!judge.accepted) reasons.push('JUDGE_REJECTED');
    if (blocker) reasons.push(`RED_TEAM_BLOCKER:${blocker.id}`);
    if (!input.authorityGrant || !hasScope(input.authorityGrant, input.missionId, strategy.id)) reasons.push('AUTHORITY_SCOPE_MISSING');
    if (authorityRank(level) < authorityRank(required)) reasons.push(`AUTHORITY_INSUFFICIENT:${required}`);

    return {
      strategyId: strategy.id,
      eligible: reasons.length === 0,
      reasons,
      advisoryProbability: finiteProbability(strategy.probability),
      expectedNetValueCents:
        strategy.expectedValueCents === null || strategy.estimatedCostCents === null
          ? null
          : strategy.expectedValueCents - strategy.estimatedCostCents,
    };
  });
}

function rankAssessment(a: StrategyAssessment, b: StrategyAssessment): number {
  const ap = a.advisoryProbability ?? -1;
  const bp = b.advisoryProbability ?? -1;
  if (bp !== ap) return bp - ap;

  const av = a.expectedNetValueCents ?? Number.MIN_SAFE_INTEGER;
  const bv = b.expectedNetValueCents ?? Number.MIN_SAFE_INTEGER;
  if (bv !== av) return bv - av;

  return a.strategyId.localeCompare(b.strategyId);
}

export function decideMission(input: MissionInput): MissionDecision {
  const assessments = assessStrategies(input);
  const eligible = assessments.filter((item) => item.eligible).sort(rankAssessment);
  const unknowns: string[] = [];

  if (input.evidence.length === 0) unknowns.push('No mission evidence was supplied.');
  if (input.strategies.length === 0) unknowns.push('No candidate strategies were supplied.');
  if (input.evidence.some((e) => e.state === 'UNKNOWN' || e.state === 'CONTESTED' || e.state === 'STALE' || e.state === 'UNKNOWABLE_WITH_CURRENT_ACCESS')) {
    unknowns.push('One or more mission evidence items are not action-grade.');
  }

  const selected = eligible[0] ?? null;
  const strategy = selected ? input.strategies.find((item) => item.id === selected.strategyId) ?? null : null;
  const authorityLevel = grantLevel(input.authorityGrant, input.now);

  return {
    missionId: input.missionId,
    objective: input.objective,
    status: selected ? 'READY_FOR_EXECUTION' : input.strategies.length === 0 || input.evidence.length === 0 ? 'UNKNOWN' : 'HOLD',
    selectedStrategyId: selected?.strategyId ?? null,
    selectedStrategyLabel: strategy?.label ?? null,
    authorityLevel,
    assessments,
    unknowns,
    policy: QLEGION_POLICY,
    decidedAt: input.now,
  };
}

export type MissionReceipt = {
  schemaVersion: 'spr-q-legion-mission-v1';
  missionId: string;
  objective: string;
  status: MissionDecision['status'];
  selectedStrategyId: string | null;
  authorityLevel: QLegionAuthority;
  evidenceIds: string[];
  redTeamFindingIds: string[];
  judgeStrategyIds: string[];
  policy: string;
  decidedAt: string;
};

export function buildMissionReceipt(input: MissionInput, decision: MissionDecision): MissionReceipt {
  return {
    schemaVersion: 'spr-q-legion-mission-v1',
    missionId: input.missionId,
    objective: input.objective,
    status: decision.status,
    selectedStrategyId: decision.selectedStrategyId,
    authorityLevel: decision.authorityLevel,
    evidenceIds: [...new Set(input.evidence.map((e) => e.id))].sort(),
    redTeamFindingIds: [...new Set(input.redTeamFindings.map((f) => f.id))].sort(),
    judgeStrategyIds: [...new Set(input.judgeReviews.map((j) => j.strategyId))].sort(),
    policy: decision.policy,
    decidedAt: decision.decidedAt,
  };
}
