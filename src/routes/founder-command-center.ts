/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — platform-operator-only routes.
//
// Deliberately separate from the self-passport route in src/routes/auth.ts:
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
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
const founderReadLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole, requireFounder, rateLimiter } from '../middleware/security.ts';
import { db } from '../db/index.ts';
import {
  checkRailway,
  checkVercel,
  checkGithubCi,
  checkStripeAndMrr,
  checkSupabaseAuth,
} from '../lib/server/founder/connections.ts';
import { connectionGuides } from '../lib/server/founder/connection-guides.ts';
import { allAgentReports } from '../lib/server/founder/agents.ts';
import { founderOverview } from '../lib/server/founder/overview.ts';

export function createFounderCommandCenterRouter() {
  const router = Router();

  router.get('/founder/command-center', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const [railway, vercel, githubCi, stripeResult, supabaseAuth] = await Promise.all([
        checkRailway(),
        checkVercel(),
        checkGithubCi(),
        checkStripeAndMrr(),
        checkSupabaseAuth(),
      ]);

      // Platform-wide counts. organizations = real customer accounts
      // (migration 0049); users includes every provisioned login across every
      // tenant. A failed query is NOT the same thing as a count of zero: keep
      // unavailable values as null so the UI can render "Not verified" rather
      // than confidently reporting a false zero.
      let organizationCount: number | null = null;
      let userCount: number | null = null;
      try {
        const orgResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM organizations`);
        const rawCount = (orgResult as any).rows?.[0]?.count;
        if (rawCount !== undefined && rawCount !== null) organizationCount = Number(rawCount);
      } catch (err) {
        console.error('[FounderCommandCenter] organizations count failed:', err instanceof Error ? err.message : String(err));
      }
      try {
        const userResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM users`);
        const rawCount = (userResult as any).rows?.[0]?.count;
        if (rawCount !== undefined && rawCount !== null) userCount = Number(rawCount);
      } catch (err) {
        console.error('[FounderCommandCenter] users count failed:', err instanceof Error ? err.message : String(err));
      }

      return res.json({
        connections: [railway, vercel, githubCi, stripeResult.connection, supabaseAuth],
        // Static guidance plus which settings are present on this process (names
        // only). Lets the Founder page explain each card without guessing.
        connectionGuides: connectionGuides(),
        businessMetrics: {
          organizationCount,
          userCount,
          mrrCents: stripeResult.mrrCents,
          stripeCustomerCount: stripeResult.customerCount,
          activeSubscriptionCount: stripeResult.activeSubscriptionCount,
          successfulPaymentCount30d: stripeResult.successfulPaymentCount30d,
          successfulPaymentAmount30dCents: stripeResult.successfulPaymentAmount30dCents,
          ciStatus: githubCi.status,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  });

  // Platform traffic telemetry. Cross-tenant site analytics are founder-only
  // platform data, so this endpoint uses the same founder gate as the command center
  // and reads the existing traffic_events ledger directly.
  router.get('/founder/traffic', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const [summary, topPages, recent] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 minutes')::int AS "activeEvents",
            COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 minutes')::int AS "activeSessions",
            COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS "users24h",
            COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS "pageviews24h",
            COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')::int AS "users7d",
            COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')::int AS "pageviews7d"
          FROM traffic_events
        `),
        db.execute(sql`
          SELECT path, COUNT(*)::int AS views
          FROM traffic_events
          WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
          GROUP BY path ORDER BY views DESC LIMIT 20
        `),
        db.execute(sql`
          SELECT occurred_at AS "occurredAt", path, device_type AS "deviceType", country
          FROM traffic_events
          ORDER BY occurred_at DESC LIMIT 100
        `),
      ]);
      return res.json({ summary: (summary as any).rows?.[0] ?? null, topPages: (topPages as any).rows ?? [], recent: (recent as any).rows ?? [], generatedAt: new Date().toISOString() });
    } catch (error) {
      return next(error);
    }
  });

  // Per-agent activity: what each background agent is doing, from the rows the
  // worker writes. See src/lib/server/founder/agents.ts for the sources.
  router.get('/founder/agents', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (_req: AuthenticatedRequest, res, next) => {
    try { return res.json({ agents: await allAgentReports(), generatedAt: new Date().toISOString() }); }
    catch (error) { return next(error); }
  });

  // Platform pulse (the /ready checks, worker last-seen, queue depths) and the
  // 7-day funnel, every value a count from a table or null when unavailable.
  router.get('/founder/overview', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (_req: AuthenticatedRequest, res, next) => {
    try { return res.json(await founderOverview()); }
    catch (error) { return next(error); }
  });

  // Platform-wide passport registry. Free Review is a system/intake tenant,
  // not a customer tenant, so its generated passports must not inflate the
  // platform registry or appear as customer-owned records. We retain those
  // rows for the Free Review flow and evidence history; this endpoint simply
  // excludes them from the customer-facing founder registry.
  //
  // A repository can also have multiple historical passports from repeated
  // scans. The Founder registry is an inventory view, so show only the newest
  // passport for each tenant + publisher + software name and expose the number
  // of historical versions separately. The window functions run before the
  // newest-row filter so versionCount represents the actual retained history.
  router.get('/founder/passports', requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`
        SELECT
          p.id,
          p.tenant_id AS "tenantId",
          p.name,
          p.version,
          p.publisher,
          p.category,
          p.overall_score AS "overallScore",
          p.verification_status AS "verificationStatus",
          p.release_date AS "releaseDate",
          p.version_count AS "versionCount",
          holder.email AS "holderEmail",
          holder.company_name AS "holderCompany"
        FROM (
          SELECT ranked.*
          FROM (
            SELECT
              p.*,
              ROW_NUMBER() OVER (
                PARTITION BY p.tenant_id, LOWER(p.name), LOWER(p.publisher)
                ORDER BY p.release_date DESC NULLS LAST, p.id DESC
              ) AS rn,
              COUNT(*) OVER (
                PARTITION BY p.tenant_id, LOWER(p.name), LOWER(p.publisher)
              ) AS version_count
            FROM passports p
            WHERE p.tenant_id <> 'tenant-free-review-system'
          ) ranked
          WHERE ranked.rn = 1
        ) p
        LEFT JOIN LATERAL (
          SELECT email, company_name
          FROM users
          WHERE users.tenant_id = p.tenant_id AND users.role = 'Owner'
          ORDER BY created_at ASC
          LIMIT 1
        ) holder ON true
        ORDER BY p.release_date DESC NULLS LAST, p.id DESC
      `);
      return res.json((result as any).rows ?? []);
    } catch (error) {
      return next(error);
    }
  });

  // Platform-wide feedback inbox: every like/dislike/bug/complaint/suggestion
  // from every tenant, newest first. Uses the plain `db` import for the same
  // reason the passport registry does above -- deliberately cross-tenant.
  router.get('/founder/feedback', requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`
        SELECT f.id, f.tenant_id AS "tenantId", f.sentiment, f.category, f.page, f.message, f.status, f.created_at AS "createdAt",
               u.email AS "submittedBy", u.company_name AS "submittedByCompany"
        FROM user_feedback f
        JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC
        LIMIT 500
      `);
      return res.json((result as any).rows ?? []);
    } catch (error) {
      return next(error);
    }
  });

  const feedbackStatusSchema = z.object({ status: z.enum(['new', 'seen', 'resolved', 'dismissed']) }).strict();
  router.patch('/founder/feedback/:id', requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    const parsed = feedbackStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    try {
      const result = await db.execute(sql`
        UPDATE user_feedback SET status = ${parsed.data.status} WHERE id = ${req.params.id}
        RETURNING id, status
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Feedback not found' });
      return res.json(row);
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

  // Free Review leads: visitors who gave a work email to download their
  // result PDF. Rows live in the Free Review system tenant; the owner
  // connection reads them for the founder only.
  router.get('/founder/leads', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT id, name, email, company, repository, passport_id AS "passportId", consented_at AS "consentedAt", created_at AS "createdAt" FROM free_review_leads ORDER BY created_at DESC LIMIT 500`);
      return res.json((result as any).rows ?? []);
    } catch (error) {
      return next(error);
    }
  });

  // Public registry crawler telemetry: the registry's real size (completed
  // reviews), the Free Review queue depth, the discovery cursor and the
  // last passes exactly as registry_crawl_runs recorded them.
  router.get('/founder/registry-crawler', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const size = (await db.execute(sql`
        SELECT count(*)::int AS n FROM (
          SELECT DISTINCT lower(s.repository_owner), lower(s.repository_name)
          FROM agent_jobs j JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
          WHERE j.tenant_id = 'tenant-free-review-system' AND j.job_type = 'repository_scan' AND j.status = 'Completed'
            AND EXISTS (SELECT 1 FROM agent_jobs sj WHERE sj.tenant_id = j.tenant_id AND sj.passport_id = j.passport_id AND sj.job_type = 'repository_security_scan' AND sj.status = 'Completed')
        ) d
      `) as any).rows?.[0];
      const queue = (await db.execute(sql`SELECT status, count(*)::int AS n FROM agent_jobs WHERE tenant_id = 'tenant-free-review-system' AND job_type = 'repository_scan' GROUP BY status`) as any).rows ?? [];
      const cursor = (await db.execute(sql`SELECT language_index AS "languageIndex", page, updated_at AS "updatedAt" FROM registry_crawl_state WHERE id = 'default'`) as any).rows?.[0] ?? null;
      const runs = (await db.execute(sql`SELECT id, started_at AS "startedAt", finished_at AS "finishedAt", discovered, enqueued, skipped, error, note FROM registry_crawl_runs ORDER BY started_at DESC LIMIT 48`) as any).rows ?? [];
      return res.json({ registrySize: Number(size?.n ?? 0), queue: Object.fromEntries(queue.map((r: any) => [String(r.status), Number(r.n)])), cursor, runs, enabled: process.env.REGISTRY_CRAWLER_ENABLED !== 'false' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/founder/tasks', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT * FROM founder_tasks ORDER BY status, created_at DESC`);
      return res.json((result as any).rows ?? []);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/founder/tasks', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
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

  router.patch('/founder/tasks/:id', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid task id' });
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: 'No fields to update' });
    try {
      const { title, category, status, notes, dueDate } = parsed.data;
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

  router.delete('/founder/tasks/:id', requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid task id' });
    try {
      await db.execute(sql`DELETE FROM founder_tasks WHERE id = ${id}`);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  // Reality reconciliation: machine-observed platform state, active incidents,
  // and immutable repair receipts. Founder-only because this is cross-platform
  // operational telemetry rather than tenant data.
  router.get('/founder/reality', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const [states, incidents, receipts] = await Promise.all([
        db.execute(sql`
          SELECT DISTINCT ON (c.id)
            c.id AS "contractId", c.component, c.description, c.expected,
            o.state, o.observed, o.evidence, o.explanation, o.observed_at AS "observedAt"
          FROM reality_contracts c
          LEFT JOIN reality_observations o ON o.contract_id=c.id
          WHERE c.enabled=TRUE
          ORDER BY c.id, o.observed_at DESC NULLS LAST
        `),
        db.execute(sql`
          SELECT id, contract_id AS "contractId", component, severity, status,
                 expected, observed, evidence, root_cause_state AS "rootCauseState",
                 root_cause AS "rootCause", impact, repair_class AS "repairClass",
                 repair_action AS "repairAction", first_detected_at AS "firstDetectedAt",
                 last_seen_at AS "lastSeenAt", resolved_at AS "resolvedAt"
          FROM reality_incidents
          ORDER BY
            CASE status WHEN 'INVESTIGATING' THEN 0 WHEN 'REPAIRING' THEN 1 WHEN 'VERIFYING' THEN 2 WHEN 'UNKNOWN' THEN 3 ELSE 4 END,
            last_seen_at DESC
          LIMIT 200
        `),
        db.execute(sql`
          SELECT id, incident_id AS "incidentId", authority_class AS "authorityClass",
                 before_state AS "beforeState", evidence, cause, impact, repair,
                 verification, after_state AS "afterState", result, created_at AS "createdAt"
          FROM reality_repair_receipts
          ORDER BY created_at DESC LIMIT 100
        `),
      ]);
      const componentStates = (states as any).rows ?? [];
      const activeIncidents = ((incidents as any).rows ?? []).filter((row: any) => !['PROVEN_FIXED','FAILED'].includes(String(row.status)));
      const counts = componentStates.reduce((acc: Record<string, number>, row: any) => {
        const state = row.state ?? 'UNKNOWN';
        acc[state] = (acc[state] ?? 0) + 1;
        return acc;
      }, {});
      return res.json({
        systemState: {
          observed: componentStates.length,
          healthy: counts.HEALTHY ?? 0,
          degrading: counts.DEGRADING ?? 0,
          failed: counts.FAILED ?? 0,
          unknown: counts.UNKNOWN ?? 0,
          activeIncidents: activeIncidents.length,
          observabilityCompromised: componentStates.some((row: any) => row.contractId === 'reconciler_self_watch' && row.state !== 'HEALTHY'),
        },
        components: componentStates,
        incidents: (incidents as any).rows ?? [],
        receipts: (receipts as any).rows ?? [],
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return next(error);
    }
  });

  // Bounded self-healing executors. These mutate only states for which the
  // platform already has deterministic lease/age semantics. They never mark
  // an incident fixed: the reality reconciler must observe HEALTHY afterward
  // and writes the PROVEN_FIXED receipt itself.
  router.post('/founder/reality/incidents/:id/repair', requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      const incidentId = String(req.params.id || '').trim();
      if (!/^inc_[a-f0-9]{32}$/i.test(incidentId)) return res.status(400).json({ error: 'INVALID_INCIDENT_ID' });

      const incident = (await db.execute(sql`
        SELECT id, contract_id AS "contractId", component, status, observed, evidence,
               root_cause AS "rootCause", impact, repair_class AS "repairClass"
        FROM reality_incidents
        WHERE id = ${incidentId} AND status NOT IN ('PROVEN_FIXED','FAILED')
        LIMIT 1
      `) as any).rows?.[0];
      if (!incident) return res.status(404).json({ error: 'ACTIVE_INCIDENT_NOT_FOUND' });

      let changed = 0;
      let repair = '';
      let executor = '';

      if (incident.contractId === 'worker_queue_flow') {
        executor = 'recover_expired_agent_job_leases';
        const running = await db.execute(sql`
          UPDATE agent_jobs
          SET status = CASE WHEN attempt_count < max_attempts THEN 'Pending' ELSE 'Failed' END,
              error = CASE WHEN attempt_count < max_attempts THEN NULL ELSE 'FOUNDER_REPAIR_LEASE_EXHAUSTED' END,
              next_attempt_at = CASE WHEN attempt_count < max_attempts THEN CURRENT_TIMESTAMP ELSE next_attempt_at END,
              locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP,
              completed_at = CASE WHEN attempt_count >= max_attempts THEN CURRENT_TIMESTAMP ELSE completed_at END
          WHERE status = 'Running'
            AND locked_at IS NOT NULL
            AND locked_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'
          RETURNING id
        `);
        const pending = await db.execute(sql`
          UPDATE agent_jobs
          SET next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE status = 'Pending'
            AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
            AND attempt_count < max_attempts
            AND (next_attempt_at IS NULL OR next_attempt_at > CURRENT_TIMESTAMP)
          RETURNING id
        `);
        changed = Number((running as any).rows?.length ?? 0) + Number((pending as any).rows?.length ?? 0);
        repair = `Recovered ${Number((running as any).rows?.length ?? 0)} expired running lease(s) and nudged ${Number((pending as any).rows?.length ?? 0)} delayed pending job(s).`;
      } else if (incident.contractId === 'scan_terminality') {
        executor = 'recover_stale_scan_jobs';
        const recovered = await db.execute(sql`
          UPDATE agent_jobs j
          SET status = CASE WHEN j.attempt_count < j.max_attempts THEN 'Pending' ELSE 'Failed' END,
              error = CASE WHEN j.attempt_count < j.max_attempts THEN NULL ELSE 'FOUNDER_REPAIR_SCAN_JOB_EXHAUSTED' END,
              next_attempt_at = CASE WHEN j.attempt_count < j.max_attempts THEN CURRENT_TIMESTAMP ELSE j.next_attempt_at END,
              locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP,
              completed_at = CASE WHEN j.attempt_count >= j.max_attempts THEN CURRENT_TIMESTAMP ELSE j.completed_at END
          WHERE j.scan_id IN (
            SELECT s.id FROM scans s
            WHERE s.status IN ('Queued','Scanning')
              AND s.updated_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'
          )
            AND (
              (j.status='Running' AND j.locked_at IS NOT NULL AND j.locked_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
              OR (j.status='Pending' AND j.updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
            )
          RETURNING j.id
        `);
        changed = Number((recovered as any).rows?.length ?? 0);
        repair = `Recovered ${changed} stale scan job(s); scan status remains unproven until the worker and reconciliation cycle observe terminal progress.`;
      } else {
        return res.status(409).json({
          error: 'NO_SAFE_AUTOMATIC_EXECUTOR',
          contractId: incident.contractId,
          message: 'This incident requires infrastructure access, configuration change, or human approval. SPR will not fabricate an automatic repair.',
        });
      }

      const receiptId = `receipt_${randomUUID().replace(/-/g, '')}`;
      await db.execute(sql`
        UPDATE reality_incidents
        SET status='VERIFYING', repair_action=${repair}, last_seen_at=CURRENT_TIMESTAMP
        WHERE id=${incidentId}
      `);
      await db.execute(sql`
        INSERT INTO reality_repair_receipts
          (id,incident_id,authority_class,before_state,evidence,cause,impact,repair,verification,after_state,result)
        VALUES (
          ${receiptId}, ${incidentId}, ${Number(incident.repairClass ?? 0)}, ${JSON.stringify(incident.observed ?? {})}::jsonb,
          ${JSON.stringify([{ source: 'founder_control_plane', executor, changed }])}::jsonb,
          ${incident.rootCause ?? null}, ${JSON.stringify(incident.impact ?? {})}::jsonb, ${repair},
          ${JSON.stringify({ method: 'automatic_reconciliation', requiredState: 'HEALTHY' })}::jsonb,
          NULL, 'UNKNOWN'
        )
      `);

      return res.status(202).json({
        incidentId,
        executor,
        changed,
        repair,
        status: 'VERIFYING',
        receiptId,
        verification: 'automatic_reconciliation',
        fixed: false,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
