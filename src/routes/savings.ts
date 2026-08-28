/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { buildSavingsReport, type ActivityCounts, type SavingsBaseline } from '../trust/savings-report.ts';

// MSP Time & Tool Savings is MSP-internal financial/operational data (labor
// rates, tool costs, ROI) -- never something a 'Client'-role user should be
// able to read, same reasoning as Vendor Risk.
const NOT_CLIENT_ROLE = ['Owner', 'Admin', 'Technician', 'Viewer'];

const baselineSchema = z.object({
  hourlyRate: z.number().positive().max(10000).nullable().optional(),
  reportBaselineMinutes: z.number().positive().max(10000).nullable().optional(),
  questionnaireQuestionBaselineMinutes: z.number().positive().max(10000).nullable().optional(),
  vendorReviewBaselineMinutes: z.number().positive().max(10000).nullable().optional(),
  remediationBaselineMinutes: z.number().positive().max(10000).nullable().optional(),
  toolConsolidationMonthlyCost: z.number().positive().max(10000000).nullable().optional(),
  sprMonthlyCost: z.number().positive().max(10000000).nullable().optional(),
}).strict();

const ALLOWED_WINDOW_DAYS = [30, 60, 90] as const;

function publicBaseline(row: any): SavingsBaseline {
  if (!row) return null;
  return {
    hourlyRate: row.hourlyRate === null ? null : Number(row.hourlyRate),
    reportBaselineMinutes: row.reportBaselineMinutes === null ? null : Number(row.reportBaselineMinutes),
    questionnaireQuestionBaselineMinutes: row.questionnaireQuestionBaselineMinutes === null ? null : Number(row.questionnaireQuestionBaselineMinutes),
    vendorReviewBaselineMinutes: row.vendorReviewBaselineMinutes === null ? null : Number(row.vendorReviewBaselineMinutes),
    remediationBaselineMinutes: row.remediationBaselineMinutes === null ? null : Number(row.remediationBaselineMinutes),
    toolConsolidationMonthlyCost: row.toolConsolidationMonthlyCost === null ? null : Number(row.toolConsolidationMonthlyCost),
    sprMonthlyCost: row.sprMonthlyCost === null ? null : Number(row.sprMonthlyCost),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

async function loadBaseline(db: any, tenantId: string): Promise<SavingsBaseline> {
  const row = (await db.execute(sql`
    SELECT hourly_rate AS "hourlyRate", report_baseline_minutes AS "reportBaselineMinutes",
      questionnaire_question_baseline_minutes AS "questionnaireQuestionBaselineMinutes",
      vendor_review_baseline_minutes AS "vendorReviewBaselineMinutes",
      remediation_baseline_minutes AS "remediationBaselineMinutes",
      tool_consolidation_monthly_cost AS "toolConsolidationMonthlyCost",
      spr_monthly_cost AS "sprMonthlyCost", updated_at AS "updatedAt"
    FROM msp_savings_baseline WHERE tenant_id = ${tenantId}
  `) as any).rows?.[0];
  return publicBaseline(row);
}

export function createSavingsRouter() {
  const router = Router();

  router.get('/baseline', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json(await loadBaseline(req.db!, req.user!.tenantId));
    } catch (error) { next(error); }
  });

  router.put('/baseline', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = baselineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const b = parsed.data;
      await db.execute(sql`
        INSERT INTO msp_savings_baseline (
          tenant_id, hourly_rate, report_baseline_minutes, questionnaire_question_baseline_minutes,
          vendor_review_baseline_minutes, remediation_baseline_minutes, tool_consolidation_monthly_cost,
          spr_monthly_cost, updated_by, updated_at
        ) VALUES (
          ${tenantId}, ${b.hourlyRate ?? null}, ${b.reportBaselineMinutes ?? null}, ${b.questionnaireQuestionBaselineMinutes ?? null},
          ${b.vendorReviewBaselineMinutes ?? null}, ${b.remediationBaselineMinutes ?? null}, ${b.toolConsolidationMonthlyCost ?? null},
          ${b.sprMonthlyCost ?? null}, ${req.user!.uid}, CURRENT_TIMESTAMP
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          hourly_rate = EXCLUDED.hourly_rate,
          report_baseline_minutes = EXCLUDED.report_baseline_minutes,
          questionnaire_question_baseline_minutes = EXCLUDED.questionnaire_question_baseline_minutes,
          vendor_review_baseline_minutes = EXCLUDED.vendor_review_baseline_minutes,
          remediation_baseline_minutes = EXCLUDED.remediation_baseline_minutes,
          tool_consolidation_monthly_cost = EXCLUDED.tool_consolidation_monthly_cost,
          spr_monthly_cost = EXCLUDED.spr_monthly_cost,
          updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP
      `);
      res.json(await loadBaseline(db, tenantId));
    } catch (error) { next(error); }
  });

  router.get('/report', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const windowDays = Number(req.query.windowDays ?? 30);
    if (!ALLOWED_WINDOW_DAYS.includes(windowDays as any)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', issues: [{ message: 'windowDays must be 30, 60, or 90' }] });
    }
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const until = new Date();
      const since = new Date(until.getTime() - windowDays * 24 * 60 * 60 * 1000);
      const sinceIso = since.toISOString();
      const untilIso = until.toISOString();

      const [reportsRow, questionnaireRows, vendorAuditRow, remediationRow] = await Promise.all([
        db.execute(sql`SELECT COUNT(*)::int AS count FROM trust_report_snapshots WHERE tenant_id = ${tenantId} AND generated_at >= ${sinceIso} AND generated_at <= ${untilIso}`) as Promise<any>,
        db.execute(sql`
          SELECT status, COUNT(*)::int AS count FROM questionnaire_items
          WHERE tenant_id = ${tenantId} AND updated_at >= ${sinceIso}::timestamp AND updated_at <= ${untilIso}::timestamp
          GROUP BY status
        `) as Promise<any>,
        db.execute(sql`SELECT COUNT(*)::int AS count FROM vendor_audits WHERE tenant_id = ${tenantId} AND created_at >= ${sinceIso}::timestamp AND created_at <= ${untilIso}::timestamp`) as Promise<any>,
        db.execute(sql`
          SELECT COUNT(*)::int AS count FROM trust_remediation_work_items
          WHERE tenant_id = ${tenantId} AND status IN ('VERIFIED','CLOSED') AND closed_at >= ${sinceIso} AND closed_at <= ${untilIso}
        `) as Promise<any>,
      ]);

      const statusCounts = new Map<string, number>((questionnaireRows.rows ?? []).map((r: any) => [r.status, r.count]));
      const activity: ActivityCounts = {
        reportsGenerated: reportsRow.rows?.[0]?.count ?? 0,
        questionnaireItemsAnswered: (statusCounts.get('ANSWERED') ?? 0) + (statusCounts.get('APPROVED') ?? 0),
        questionnaireItemsNeedingReview: statusCounts.get('NEEDS_REVIEW') ?? 0,
        vendorAuditsCompleted: vendorAuditRow.rows?.[0]?.count ?? 0,
        remediationsResolved: remediationRow.rows?.[0]?.count ?? 0,
      };

      const baseline = await loadBaseline(db, tenantId);
      res.json(buildSavingsReport(windowDays, sinceIso, untilIso, activity, baseline));
    } catch (error) { next(error); }
  });

  return router;
}
