/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { matchQuestionToEvidence, type QuestionnaireFinding } from '../trust/questionnaire-matcher.ts';

function newId(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

// v1 intake is plain text, one question per line -- pasted directly from
// wherever the real questionnaire lives (spreadsheet, email, PDF text).
// Real CSV/XLSX parsing needs a library this project doesn't depend on yet
// (no xlsx/csv-parse in package.json); rather than add an unvetted
// dependency for this pass, intake is scoped to what's actually reliable
// today. Blank lines are dropped; nothing here fabricates a question that
// wasn't actually in the pasted text.
const createQuestionnaireSchema = z.object({
  name: z.string().trim().min(1).max(255),
  clientId: z.string().trim().min(1).max(255).nullable().optional(),
  passportId: z.string().trim().min(1).max(255),
  questionsText: z.string().trim().min(1).max(200_000),
}).strict();

const itemUpdateSchema = z.object({
  draftAnswer: z.string().max(4000).nullable().optional(),
  status: z.enum(['UNKNOWN', 'NEEDS_REVIEW', 'ANSWERED', 'APPROVED']).optional(),
}).strict().refine((body) => Object.keys(body).length > 0);

function publicQuestionnaire(row: any) {
  return { id: row.id, name: row.name, clientId: row.clientId, passportId: row.passportId, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function publicItem(row: any) {
  return {
    id: row.id, sequenceNumber: row.sequenceNumber, questionText: row.questionText, category: row.category,
    draftAnswer: row.draftAnswer, confidenceBasisPoints: row.confidenceBasisPoints, status: row.status,
    evidenceIds: JSON.parse(row.evidenceIds ?? '[]'), approvedBy: row.approvedBy, approvedAt: row.approvedAt,
  };
}

export function createQuestionnairesRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const clientScope = req.user!.role === 'Client' ? req.user!.clientId : null;
      const rows = (await db.execute(sql`
        SELECT id, name, client_id AS "clientId", passport_id AS "passportId", status, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM questionnaires WHERE tenant_id=${tenantId} AND (${clientScope}::text IS NULL OR client_id = ${clientScope})
        ORDER BY updated_at DESC
      `) as any).rows ?? [];
      res.json(rows.map(publicQuestionnaire));
    } catch (error) { next(error); }
  });

  router.post('/', requireAuth, requireRole(['Owner', 'Admin', 'Technician']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = createQuestionnaireSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const passport = (await db.execute(sql`SELECT id, client_id FROM passports WHERE id=${parsed.data.passportId} AND tenant_id=${tenantId}`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
      if (parsed.data.clientId) {
        const client = (await db.execute(sql`SELECT id FROM clients WHERE id=${parsed.data.clientId} AND tenant_id=${tenantId}`) as any).rows?.[0];
        if (!client) return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });
      }
      const questions = parsed.data.questionsText.split('\n').map((line) => line.trim()).filter(Boolean);
      if (!questions.length) return res.status(400).json({ error: 'NO_QUESTIONS_FOUND' });
      const questionnaireId = newId('questionnaire');
      const now = new Date().toISOString();
      await db.execute(sql`
        INSERT INTO questionnaires (id, tenant_id, client_id, passport_id, name, status, created_by, created_at, updated_at)
        VALUES (${questionnaireId}, ${tenantId}, ${parsed.data.clientId ?? passport.client_id ?? null}, ${passport.id}, ${parsed.data.name}, 'DRAFT', ${req.user!.uid}, ${now}, ${now})
      `);
      for (let i = 0; i < questions.length; i += 1) {
        await db.execute(sql`
          INSERT INTO questionnaire_items (id, tenant_id, questionnaire_id, sequence_number, question_text, status, created_at, updated_at)
          VALUES (${newId('qitem')}, ${tenantId}, ${questionnaireId}, ${i + 1}, ${questions[i]}, 'UNKNOWN', ${now}, ${now})
        `);
      }
      res.status(201).json({ id: questionnaireId, itemCount: questions.length, passportId: passport.id });
    } catch (error) { next(error); }
  });

  router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const clientScope = req.user!.role === 'Client' ? req.user!.clientId : null;
      const questionnaire = (await db.execute(sql`
        SELECT id, name, client_id AS "clientId", passport_id AS "passportId", status, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM questionnaires WHERE id=${req.params.id} AND tenant_id=${tenantId} AND (${clientScope}::text IS NULL OR client_id = ${clientScope})
      `) as any).rows?.[0];
      if (!questionnaire) return res.status(404).json({ error: 'QUESTIONNAIRE_NOT_FOUND' });
      const items = (await db.execute(sql`
        SELECT id, sequence_number AS "sequenceNumber", question_text AS "questionText", category, draft_answer AS "draftAnswer",
          confidence_basis_points AS "confidenceBasisPoints", status, evidence_ids AS "evidenceIds", approved_by AS "approvedBy", approved_at AS "approvedAt"
        FROM questionnaire_items WHERE tenant_id=${tenantId} AND questionnaire_id=${req.params.id} ORDER BY sequence_number
      `) as any).rows ?? [];
      res.json({ ...publicQuestionnaire(questionnaire), items: items.map(publicItem) });
    } catch (error) { next(error); }
  });

  // Re-runnable: evidence changes over time (a new collection, a
  // remediated finding), and re-matching should reflect that -- this is
  // never a one-shot action.
  router.post('/:id/generate-drafts', requireAuth, requireRole(['Owner', 'Admin', 'Technician']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const clientScope = req.user!.role === 'Client' ? req.user!.clientId : null;
      const questionnaire = (await db.execute(sql`
        SELECT q.id, q.client_id AS "clientId", q.passport_id AS "passportId" FROM questionnaires q
        WHERE q.id=${req.params.id} AND q.tenant_id=${tenantId} AND (${clientScope}::text IS NULL OR q.client_id = ${clientScope})
      `) as any).rows?.[0];
      if (!questionnaire) return res.status(404).json({ error: 'QUESTIONNAIRE_NOT_FOUND' });

      // Scoped to the questionnaire's own passport, not just its client --
      // a client can have more than one passport, and matching against
      // every one of them would draft an answer sourced from the wrong
      // software's evidence entirely.
      const findingRows = (await db.execute(sql`
        SELECT id, control_id AS "controlId", title, description, status, severity, evidence_ids AS "evidenceIds", updated_at AS "updatedAt"
        FROM trust_findings WHERE tenant_id=${tenantId} AND (${questionnaire.passportId}::text IS NULL OR passport_id = ${questionnaire.passportId})
      `) as any).rows ?? [];
      const findings: QuestionnaireFinding[] = findingRows.map((row: any) => ({ ...row, evidenceIds: JSON.parse(row.evidenceIds ?? '[]') }));

      const items = (await db.execute(sql`SELECT id, question_text AS "questionText", status FROM questionnaire_items WHERE tenant_id=${tenantId} AND questionnaire_id=${req.params.id}`) as any).rows ?? [];
      const now = new Date().toISOString();
      let updated = 0;
      for (const item of items) {
        if (item.status === 'APPROVED') continue; // never overwrite a human's sign-off
        const match = matchQuestionToEvidence(item.questionText, findings);
        await db.execute(sql`
          UPDATE questionnaire_items SET draft_answer=${match.draftAnswer}, confidence_basis_points=${match.confidenceBasisPoints},
            status=${match.status}, category=${match.category}, evidence_ids=${JSON.stringify(match.evidenceIds)}, updated_at=${now}
          WHERE id=${item.id} AND tenant_id=${tenantId}
        `);
        updated += 1;
      }
      await db.execute(sql`UPDATE questionnaires SET status='IN_REVIEW', updated_at=${now} WHERE id=${req.params.id} AND tenant_id=${tenantId} AND status='DRAFT'`);
      res.json({ updated });
    } catch (error) { next(error); }
  });

  router.patch('/:id/items/:itemId', requireAuth, requireRole(['Owner', 'Admin', 'Technician']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = itemUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const now = new Date().toISOString();
      const isApproving = parsed.data.status === 'APPROVED';
      const rows = await db.execute(sql`
        UPDATE questionnaire_items SET
          draft_answer = CASE WHEN ${parsed.data.draftAnswer !== undefined} THEN ${parsed.data.draftAnswer ?? null} ELSE draft_answer END,
          status = COALESCE(${parsed.data.status ?? null}, status),
          approved_by = CASE WHEN ${isApproving} THEN ${req.user!.uid} ELSE approved_by END,
          approved_at = CASE WHEN ${isApproving} THEN ${now} ELSE approved_at END,
          updated_at = ${now}
        WHERE id=${req.params.itemId} AND tenant_id=${tenantId} AND questionnaire_id=${req.params.id}
        RETURNING id, sequence_number AS "sequenceNumber", question_text AS "questionText", category, draft_answer AS "draftAnswer",
          confidence_basis_points AS "confidenceBasisPoints", status, evidence_ids AS "evidenceIds", approved_by AS "approvedBy", approved_at AS "approvedAt"
      `);
      const row = (rows as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'QUESTIONNAIRE_ITEM_NOT_FOUND' });
      res.json(publicItem(row));
    } catch (error) { next(error); }
  });

  return router;
}
