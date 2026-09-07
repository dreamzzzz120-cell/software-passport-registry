/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * User feedback: any signed-in user can send a like/dislike, a bug report,
 * or a free-text suggestion from anywhere in the app. Writes go through
 * req.db (tenant-scoped/RLS) like any normal user action. The founder-only
 * cross-tenant read lives in founder-command-center.ts alongside the rest
 * of the platform-wide founder routes, not here.
 */
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth } from '../middleware/security.ts';

const feedbackSchema = z.object({
  sentiment: z.enum(['like', 'dislike', 'neutral']).default('neutral'),
  category: z.enum(['bug', 'complaint', 'suggestion', 'general']).default('general'),
  page: z.string().trim().max(200).nullable().optional(),
  message: z.string().trim().min(1).max(4000),
}).strict();

export function createFeedbackRouter() {
  const router = Router();

  router.post('/feedback', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const { sentiment, category, page, message } = parsed.data;
      const id = `feedback_${crypto.randomUUID().replaceAll('-', '')}`;
      const result = await db.execute(sql`
        INSERT INTO user_feedback (id, tenant_id, user_id, sentiment, category, page, message)
        VALUES (${id}, ${req.user!.tenantId}, ${req.user!.id}, ${sentiment}, ${category}, ${page ?? null}, ${message})
        RETURNING id, sentiment, category, page, message, status, created_at AS "createdAt"
      `);
      return res.status(201).json((result as any).rows?.[0]);
    } catch (error) {
      return next(error);
    }
  });

  // A user's own tenant can see what's been submitted so far (e.g. an Admin
  // reviewing what their team has flagged) -- not cross-tenant, that's the
  // founder-only route.
  router.get('/feedback', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const result = await db.execute(sql`
        SELECT f.id, f.sentiment, f.category, f.page, f.message, f.status, f.created_at AS "createdAt", u.email AS "submittedBy"
        FROM user_feedback f
        JOIN users u ON u.id = f.user_id
        WHERE f.tenant_id = ${req.user!.tenantId}
        ORDER BY f.created_at DESC
        LIMIT 200
      `);
      return res.json((result as any).rows ?? []);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
