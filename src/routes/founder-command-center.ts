/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — platform-operator-only routes.
//
// Deliberately separate from the existing /founder/metrics in src/routes/auth.ts:
// that route is per-tenant (any customer's Owner can see their own tenant's
// counts). This route is cross-platform (connections, MRR, growth tasks) and
// is gated by BOTH requireRole('Owner') AND requireFounder (FOUNDER_EMAILS
// allowlist) — see src/middleware/security.ts.
//
// Business-metric queries use the plain `db` import (the privileged,
// BYPASSRLS connection also used by offboardTenantData in src/db/sync.ts),
// not req.db (the per-request RLS-scoped connection) — this page is
// deliberately platform-wide, not tenant-scoped.

import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole, requireFounder } from '../middleware/security.ts';
import { db } from '../db/index.ts';
import {
  checkRailway,
  checkVercel,
  checkGithubCi,
  checkStripeAndMrr,
  checkFirebase,
} from '../lib/server/founder/connections.ts';

export function createFounderCommandCenterRouter() {
  const router = Router();

  router.get('/founder/command-center', requireAuth, requireRole('Owner'), requireFounder, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const [railway, vercel, githubCi, stripeResult, firebase] = await Promise.all([
        checkRailway(),
        checkVercel(),
        checkGithubCi(),
        checkStripeAndMrr(),
        checkFirebase(),
      ]);

      // Platform-wide counts. organizations = real customer accounts
      // (migration 0049); users includes every provisioned login across every
      // tenant. Each wrapped independently so one query shape drifting doesn't
      // take down the whole page.
      let organizationCount = 0;
      let userCount = 0;
      try {
        const orgResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM organizations`);
        organizationCount = Number((orgResult as any).rows?.[0]?.count ?? 0);
      } catch (err) {
        console.error('[FounderCommandCenter] organizations count failed:', err instanceof Error ? err.message : String(err));
      }
      try {
        const userResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM users`);
        userCount = Number((userResult as any).rows?.[0]?.count ?? 0);
      } catch (err) {
        console.error('[FounderCommandCenter] users count failed:', err instanceof Error ? err.message : String(err));
      }

      return res.json({
        connections: [railway, vercel, githubCi, stripeResult.connection, firebase],
        businessMetrics: {
          organizationCount,
          userCount,
          mrrCents: stripeResult.mrrCents,
          stripeCustomerCount: stripeResult.customerCount,
          ciStatus: githubCi.status,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  });

  const taskSchema = z.object({
    title: z.string().trim().min(1).max(300),
    category: z.enum(['seo', 'backlinks', 'outreach', 'infra', 'general']).default('general'),
    status: z.enum(['open', 'in_progress', 'done']).default('open'),
    notes: z.string().trim().max(2000).nullable().optional(),
    dueDate: z.string().trim().max(32).nullable().optional(),
  }).strict();
  const taskUpdateSchema = taskSchema.partial();

  router.get('/founder/tasks', requireAuth, requireRole('Owner'), requireFounder, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT * FROM founder_tasks ORDER BY status, created_at DESC`);
      return res.json((result as any).rows ?? []);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/founder/tasks', requireAuth, requireRole('Owner'), requireFounder, async (req: AuthenticatedRequest, res, next) => {
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    try {
      const { title, category, status, notes, dueDate } = parsed.data;
      const result = await db.execute(sql`
        INSERT INTO founder_tasks (title, category, status, notes, due_date)
        VALUES (${title}, ${category}, ${status}, ${notes ?? null}, ${dueDate ?? null})
        RETURNING *
      `);
      return res.status(201).json((result as any).rows?.[0]);
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/founder/tasks/:id', requireAuth, requireRole('Owner'), requireFounder, async (req: AuthenticatedRequest, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid task id' });
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: 'No fields to update' });
    try {
      const { title, category, status, notes, dueDate } = parsed.data;
      // COALESCE against a sentinel-free partial update: only fields present
      // in the parsed body override the existing column, matching the
      // partial-PATCH semantics used elsewhere in this codebase.
      const result = await db.execute(sql`
        UPDATE founder_tasks SET
          title = COALESCE(${title ?? null}, title),
          category = COALESCE(${category ?? null}, category),
          status = COALESCE(${status ?? null}, status),
          notes = CASE WHEN ${notes !== undefined} THEN ${notes ?? null} ELSE notes END,
          due_date = CASE WHEN ${dueDate !== undefined} THEN ${dueDate ?? null} ELSE due_date END,
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Task not found' });
      return res.json(row);
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/founder/tasks/:id', requireAuth, requireRole('Owner'), requireFounder, async (req: AuthenticatedRequest, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid task id' });
    try {
      await db.execute(sql`DELETE FROM founder_tasks WHERE id = ${id}`);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
