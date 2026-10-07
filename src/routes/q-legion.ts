import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sql } from 'drizzle-orm';
import { appPool, db } from '../db/index.ts';
import { requireAuth, requireFounder, requireRole, type AuthenticatedRequest } from '../middleware/security.ts';
import { DISTRIBUTION_TENANT_ID } from '../lib/distribution-engine.ts';
import { recordResearchShadowMission } from '../lib/q-legion-shadow.ts';

const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });

export function createQLegionRouter() {
  const router = Router();
  const founderOnly = [requireAuth, requireRole('Owner'), requireFounder, limiter];

  router.get('/founder/q-legion', ...founderOnly, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await db.execute(sql`
        SELECT id, source_kind AS "sourceKind", source_id AS "sourceId", objective, mode, state,
               advisory_strategy_id AS "advisoryStrategyId", authority_level AS "authorityLevel",
               evidence, strategies, red_team_findings AS "redTeamFindings", judge_reviews AS "judgeReviews",
               decision, shadow_assessment AS "shadowAssessment", observed_at AS "observedAt",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM q_legion_missions
        WHERE tenant_id=${DISTRIBUTION_TENANT_ID}
        ORDER BY updated_at DESC
        LIMIT 100
      `) as any).rows ?? [];

      const receipts = (await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM q_legion_mission_receipts
        WHERE tenant_id=${DISTRIBUTION_TENANT_ID}
      `) as any).rows?.[0]?.count ?? 0;

      const summary = rows.reduce((acc: Record<string, number>, row: any) => {
        const key = String(row.state || 'UNKNOWN');
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

      const outcomeRows = (await db.execute(sql`
        SELECT m.q_legion_mission_id AS "missionId",
               COUNT(DISTINCT m.contact_id) FILTER (WHERE m.kind='initial' AND m.status='sent')::int AS sent,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.replied_at IS NOT NULL)::int AS replied,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.demo_at IS NOT NULL)::int AS demos,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.checkout_at IS NOT NULL)::int AS checkouts,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.pilot_at IS NOT NULL)::int AS pilots,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.customer_at IS NOT NULL)::int AS customers,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.lost_at IS NOT NULL)::int AS lost,
               MIN(m.sent_at) FILTER (WHERE m.kind='initial' AND m.status='sent') AS "firstSentAt",
               MAX(c.updated_at) AS "lastOutcomeAt"
        FROM distribution_messages m
        JOIN distribution_contacts c ON c.id=m.contact_id AND c.tenant_id=m.tenant_id
        WHERE m.tenant_id=${DISTRIBUTION_TENANT_ID}
          AND m.q_legion_mission_id IS NOT NULL
        GROUP BY m.q_legion_mission_id
      `) as any).rows ?? [];

      const strategyOutcomeRows = (await db.execute(sql`
        SELECT COALESCE(m.q_legion_strategy_id,'baseline') AS "strategyId",
               COUNT(DISTINCT m.contact_id) FILTER (WHERE m.kind='initial' AND m.status='sent')::int AS sent,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.replied_at IS NOT NULL)::int AS replied,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.demo_at IS NOT NULL)::int AS demos,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.checkout_at IS NOT NULL)::int AS checkouts,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.customer_at IS NOT NULL)::int AS customers,
               COUNT(DISTINCT m.contact_id) FILTER (WHERE c.lost_at IS NOT NULL)::int AS lost,
               AVG(m.q_legion_strategy_probability) FILTER (WHERE m.kind='initial') AS "avgProbability"
        FROM distribution_messages m
        JOIN distribution_contacts c ON c.id=m.contact_id AND c.tenant_id=m.tenant_id
        WHERE m.tenant_id=${DISTRIBUTION_TENANT_ID}
          AND m.kind='initial'
          AND m.status='sent'
        GROUP BY COALESCE(m.q_legion_strategy_id,'baseline')
      `) as any).rows ?? [];

      const strategyMissionRows = (await db.execute(sql`
        SELECT COALESCE(advisory_strategy_id,'unknown') AS "strategyId", COUNT(*)::int AS missions
        FROM q_legion_missions
        WHERE tenant_id=${DISTRIBUTION_TENANT_ID}
        GROUP BY COALESCE(advisory_strategy_id,'unknown')
      `) as any).rows ?? [];

      const settings = (await db.execute(sql`
        SELECT strategy_execution_enabled AS "strategyExecutionEnabled", updated_at AS "updatedAt"
        FROM q_legion_settings
        WHERE tenant_id=${DISTRIBUTION_TENANT_ID}
        LIMIT 1
      `) as any).rows?.[0] ?? { strategyExecutionEnabled: false, updatedAt: null };

      const outcomeByMission = new Map<string, any>(outcomeRows.map((row: any) => [String(row.missionId), row]));
      const missions = rows.map((row: any) => {
        const outcome = outcomeByMission.get(String(row.id)) ?? {
          sent: 0, replied: 0, demos: 0, checkouts: 0, pilots: 0, customers: 0, lost: 0,
          firstSentAt: null, lastOutcomeAt: null,
        };
        const blockers = Array.isArray(row.redTeamFindings)
          ? row.redTeamFindings.filter((finding: any) => finding?.severity === 'BLOCKER').length
          : 0;
        let recommendedNextMove = 'Observe more evidence.';
        if (Number(outcome.customers) > 0) recommendedNextMove = 'Customer acquired — retain, expand, and preserve the winning strategy outcome.';
        else if (Number(outcome.lost) > 0) recommendedNextMove = 'Closed lost — preserve the loss as training evidence and test another strategy on future matches.';
        else if (Number(outcome.checkouts) > 0) recommendedNextMove = 'Checkout observed — verify payment and entitlement before calling this a customer.';
        else if (Number(outcome.demos) > 0) recommendedNextMove = 'Demo observed — move the prospect to a concrete commercial offer or checkout.';
        else if (Number(outcome.replied) > 0) recommendedNextMove = 'Reply observed — qualify intent and book the next meeting.';
        else if (Number(outcome.sent) > 0) recommendedNextMove = 'Outreach sent — wait for reply or the existing follow-up schedule.';
        else if (blockers > 0) recommendedNextMove = 'Resolve the red-team blocker before any Q-LEGION-guided outreach.';
        else if (row.advisoryStrategyId) recommendedNextMove = 'Eligible for bounded strategy-guided outreach through SPR Distribution.';
        return { ...row, outcome, recommendedNextMove };
      });

      const missionCounts = new Map(strategyMissionRows.map((row: any) => [String(row.strategyId), Number(row.missions || 0)]));
      const strategyIds = new Set<string>([
        ...strategyMissionRows.map((row: any) => String(row.strategyId)),
        ...strategyOutcomeRows.map((row: any) => String(row.strategyId)),
      ]);
      const strategyPerformance = [...strategyIds].sort().map((strategyId) => {
        const observed = strategyOutcomeRows.find((row: any) => String(row.strategyId) === strategyId) ?? {};
        const sent = Number(observed.sent || 0);
        const replied = Number(observed.replied || 0);
        const demos = Number(observed.demos || 0);
        const checkouts = Number(observed.checkouts || 0);
        const customers = Number(observed.customers || 0);
        return {
          strategyId,
          missions: missionCounts.get(strategyId) ?? 0,
          sent,
          replied,
          demos,
          checkouts,
          customers,
          lost: Number(observed.lost || 0),
          avgProbability: observed.avgProbability == null ? null : Number(observed.avgProbability),
          replyRate: sent > 0 ? replied / sent : null,
          demoRate: sent > 0 ? demos / sent : null,
          checkoutRate: sent > 0 ? checkouts / sent : null,
          customerRate: sent > 0 ? customers / sent : null,
        };
      });

      const totals = strategyPerformance.reduce((acc, item) => ({
        sent: acc.sent + item.sent,
        replied: acc.replied + item.replied,
        demos: acc.demos + item.demos,
        checkouts: acc.checkouts + item.checkouts,
        customers: acc.customers + item.customers,
        lost: acc.lost + item.lost,
      }), { sent: 0, replied: 0, demos: 0, checkouts: 0, customers: 0, lost: 0 });

      return res.json({
        mode: settings.strategyExecutionEnabled ? 'ACTIVE_GUIDANCE' : 'SHADOW',
        strategyExecutionEnabled: settings.strategyExecutionEnabled,
        missionCount: rows.length,
        receiptCount: Number(receipts),
        states: summary,
        totals,
        strategyPerformance,
        missions,
        policy: settings.strategyExecutionEnabled
          ? 'Q-LEGION may choose outreach strategy, but SPR Distribution remains the only sender and still enforces campaign controls, role-address rules, dedupe, daily limits, opt-out, and evidence boundaries. Probabilities are advisory; UNKNOWN remains UNKNOWN.'
          : 'Q-LEGION ranks observed strategies in shadow mode. Probabilities are advisory; UNKNOWN remains UNKNOWN.',
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/founder/q-legion/shadow/backfill', ...founderOnly, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const research = (await db.execute(sql`
        SELECT id, result
        FROM distribution_jobs
        WHERE tenant_id=${DISTRIBUTION_TENANT_ID}
          AND kind='research_url'
          AND status='succeeded'
          AND result IS NOT NULL
        ORDER BY updated_at DESC
        LIMIT 100
      `) as any).rows ?? [];

      let processed = 0;
      const failures: { jobId: string; error: string }[] = [];

      for (const row of research) {
        try {
          await recordResearchShadowMission(appPool, String(row.id), row.result && typeof row.result === 'object' ? row.result : {});
          processed++;
        } catch (error) {
          failures.push({ jobId: String(row.id), error: error instanceof Error ? error.message : String(error) });
        }
      }

      return res.status(failures.length ? 207 : 200).json({
        processed,
        attempted: research.length,
        failures,
        mode: 'SHADOW',
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
