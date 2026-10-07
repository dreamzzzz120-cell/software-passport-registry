import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  buildMissionReceipt,
  decideMission,
  type AdversarialFinding,
  type EvidenceRef,
  type JudgeReview,
  type MissionInput,
  type StrategyCandidate,
} from '../agents/q-legion.ts';
import { DISTRIBUTION_TENANT_ID } from './distribution-engine.ts';

export type ResearchReality = {
  url?: string;
  company?: string | null;
  score?: number | null;
  httpObserved?: boolean;
  observedAt?: string;
  publicRoleEmails?: string[];
  signals?: {
    msp?: boolean;
    cybersecurity?: boolean;
    compliance?: boolean;
    psa?: boolean;
    multiClient?: boolean;
  } | null;
};

export type ShadowMissionBuild = {
  input: MissionInput;
  advisoryStrategyId: string | null;
  advisoryReason: string;
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function probability(score: number | null, modifier = 0) {
  if (score === null) return null;
  return clamp(score / 100 + modifier);
}

function evidenceState(ok: boolean): EvidenceRef['state'] {
  return ok ? 'KNOWN' : 'UNKNOWN';
}

export function buildResearchShadowMission(jobId: string, result: ResearchReality, now = new Date().toISOString()): ShadowMissionBuild {
  const score = Number.isFinite(result.score) ? Number(result.score) : null;
  const signals = result.signals ?? {};
  const emails = Array.isArray(result.publicRoleEmails) ? result.publicRoleEmails.filter(Boolean) : [];
  const rawId = `distribution:${jobId}:research`;
  const fitId = `distribution:${jobId}:fit`;
  const contactId = `distribution:${jobId}:public-contact`;

  const evidence: EvidenceRef[] = [
    { id: rawId, state: evidenceState(Boolean(result.httpObserved && result.url)), observedAt: result.observedAt ?? now, source: result.url ?? 'distribution research result' },
    { id: fitId, state: score === null ? 'UNKNOWN' : 'PROBABLE', observedAt: result.observedAt ?? now, source: `distribution heuristic score ${score ?? 'UNKNOWN'}` },
    { id: contactId, state: evidenceState(emails.length > 0), observedAt: result.observedAt ?? now, source: emails.length ? `public role email count ${emails.length}` : 'no public role email observed' },
  ];

  const strategies: StrategyCandidate[] = [
    {
      id: 'proof_first',
      label: 'Proof-first outreach',
      hypothesis: 'Lead with an evidence-backed Free Review or public repository proof before asking for a meeting.',
      probability: probability(score, signals.cybersecurity ? 0.08 : 0.03),
      expectedValueCents: null,
      estimatedCostCents: null,
      reversibility: 'REVERSIBLE',
      requiredEvidenceIds: [rawId, fitId],
    },
    {
      id: 'revenue_first',
      label: 'Recurring-revenue outreach',
      hypothesis: 'Lead with white-label recurring software assurance and MSP service-margin potential.',
      probability: probability(score, signals.multiClient || signals.msp ? 0.12 : -0.06),
      expectedValueCents: null,
      estimatedCostCents: null,
      reversibility: 'REVERSIBLE',
      requiredEvidenceIds: [rawId, fitId],
    },
    {
      id: 'compliance_first',
      label: 'Compliance-evidence outreach',
      hypothesis: 'Lead with evidence lineage, SBOM, vulnerability and audit-readiness workflows.',
      probability: probability(score, signals.compliance ? 0.14 : signals.cybersecurity ? 0.05 : -0.12),
      expectedValueCents: null,
      estimatedCostCents: null,
      reversibility: 'REVERSIBLE',
      requiredEvidenceIds: [rawId, fitId],
    },
  ];

  const redTeamFindings: AdversarialFinding[] = [];
  if (score === null) redTeamFindings.push({ id: 'score_unknown', severity: 'BLOCKER', statement: 'Prospect fit score is unavailable.', evidenceIds: [fitId] });
  else if (score < 50) redTeamFindings.push({ id: 'weak_fit', severity: 'BLOCKER', statement: 'Observed MSP fit is too weak for autonomous commercial action.', evidenceIds: [fitId] });
  if (!emails.length) redTeamFindings.push({ id: 'no_public_role_email', severity: 'HIGH', statement: 'No public role email was observed; contactability is unresolved.', evidenceIds: [contactId] });

  const judgeReviews: JudgeReview[] = strategies.map((strategy) => {
    let accepted = score !== null && score >= 55;
    if (strategy.id === 'revenue_first') accepted = accepted && Boolean(signals.msp || signals.multiClient);
    if (strategy.id === 'compliance_first') accepted = accepted && Boolean(signals.compliance || signals.cybersecurity);
    return {
      strategyId: strategy.id,
      accepted,
      rationale: accepted ? 'Observed research supports testing this strategy in shadow mode.' : 'Observed evidence is insufficient for this strategy.',
      evidenceIds: [rawId, fitId],
    };
  });

  const input: MissionInput = {
    missionId: `qlegion_${jobId.replace(/[^A-Za-z0-9_]/g, '_')}`,
    objective: `Identify the strongest evidence-backed commercial approach for ${result.company || result.url || jobId}.`,
    evidence,
    strategies,
    redTeamFindings,
    judgeReviews,
    authorityGrant: null,
    now,
  };

  const blocker = redTeamFindings.some((finding) => finding.severity === 'BLOCKER');
  const accepted = strategies
    .filter((strategy) => judgeReviews.find((review) => review.strategyId === strategy.id)?.accepted)
    .filter(() => !blocker)
    .sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1) || a.id.localeCompare(b.id));

  return {
    input,
    advisoryStrategyId: accepted[0]?.id ?? null,
    advisoryReason: accepted[0]
      ? 'Highest-ranked judge-accepted strategy in shadow mode; no execution authority has been granted.'
      : blocker
        ? 'Red-team blocker prevents an advisory winner.'
        : 'No strategy has enough observed support for an advisory winner.',
  };
}

export async function recordResearchShadowMission(pool: Pool, jobId: string, result: ResearchReality) {
  const built = buildResearchShadowMission(jobId, result);
  const decision = decideMission(built.input);
  const receipt = buildMissionReceipt(built.input, decision);
  const receiptPayload = { ...receipt, mode: 'SHADOW', advisoryStrategyId: built.advisoryStrategyId, advisoryReason: built.advisoryReason };
  const receiptHash = createHash('sha256').update(JSON.stringify(receiptPayload)).digest('hex');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [DISTRIBUTION_TENANT_ID]);
    await client.query(
      `INSERT INTO q_legion_missions
        (id,tenant_id,source_kind,source_id,objective,mode,state,advisory_strategy_id,authority_level,evidence,strategies,red_team_findings,judge_reviews,decision,shadow_assessment,observed_at,updated_at)
       VALUES ($1,$2,'distribution_research',$3,$4,'SHADOW',$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id,source_kind,source_id) DO UPDATE SET
         objective=EXCLUDED.objective,state=EXCLUDED.state,advisory_strategy_id=EXCLUDED.advisory_strategy_id,
         authority_level=EXCLUDED.authority_level,evidence=EXCLUDED.evidence,strategies=EXCLUDED.strategies,
         red_team_findings=EXCLUDED.red_team_findings,judge_reviews=EXCLUDED.judge_reviews,decision=EXCLUDED.decision,
         shadow_assessment=EXCLUDED.shadow_assessment,observed_at=EXCLUDED.observed_at,updated_at=CURRENT_TIMESTAMP`,
      [
        built.input.missionId,
        DISTRIBUTION_TENANT_ID,
        jobId,
        built.input.objective,
        decision.status,
        built.advisoryStrategyId,
        decision.authorityLevel,
        JSON.stringify(built.input.evidence),
        JSON.stringify(built.input.strategies),
        JSON.stringify(built.input.redTeamFindings),
        JSON.stringify(built.input.judgeReviews),
        JSON.stringify(decision),
        JSON.stringify({ advisoryStrategyId: built.advisoryStrategyId, advisoryReason: built.advisoryReason }),
        result.observedAt ?? built.input.now,
      ],
    );
    await client.query(
      `INSERT INTO q_legion_mission_receipts (id,tenant_id,mission_id,receipt_hash,receipt)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (mission_id,receipt_hash) DO NOTHING`,
      [`qrcpt_${receiptHash.slice(0, 32)}`, DISTRIBUTION_TENANT_ID, built.input.missionId, receiptHash, JSON.stringify(receiptPayload)],
    );
    await client.query('COMMIT');
    return { missionId: built.input.missionId, decision, advisoryStrategyId: built.advisoryStrategyId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
