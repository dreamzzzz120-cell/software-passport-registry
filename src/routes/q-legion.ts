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

      return res.json({
        mode: 'SHADOW',
        missionCount: rows.length,
        receiptCount: Number(receipts),
        states: summary,
        missions: rows,
        policy: 'Q-LEGION shadow missions rank observed strategies but have no execution authority. Probabilities are advisory; UNKNOWN remains UNKNOWN.',
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
