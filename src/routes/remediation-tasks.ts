/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backend for MSPCommandCenter.tsx's remediation-task workflow:
 * create -> start -> ready-for-verification -> queue verification (a real
 * collector_jobs row processed by the live trust-monitoring-worker) -> poll
 * -> verified/failed. Built on trust_remediation_work_items, the table
 * routes/trust-loop.ts already uses for remediation -- not a new table --
 * per migration 0046's reasoning: a competing remediation_tasks schema
 * (migration 0009) already exists and is permanently dead (its alert_id FK
 * points at the `alerts` table, which nothing ever inserts into), and
 * building a second parallel schema here would just add a third.
 */
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';
import { COLLECTORS, collectorJobKey, observationWindow } from '../utils/monitoring.ts';

const STAFF_ROLES = ['Owner', 'Admin', 'Technician'] as const;

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function routeParam(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] || '' : value || ''; }

const createSchema = z.object({ alertId: z.string().trim().min(1).max(255) }).strict();
const patchSchema = z.object({
  ownerId: z.string().max(255).nullable().optional(),
  ownerDisplay: z.string().max(255).nullable().optional(),
}).strict().refine(body => Object.keys(body).length > 0, { message: 'At least one field is required' });
const verifySchema = z.object({ monitoringConfigurationId: z.string().trim().min(1).max(255) }).strict();

function clientScopeOf(req: AuthenticatedRequest) {
  return req.user!.role === 'Client' ? req.user!.clientId : null;
}

// The frontend renders task.title/task.status/task.createdAt directly and
// tracks task.id -- this is the exact shape MSPCommandCenter.tsx expects,
// including the alertId/collectorJobId camelCase fields it reads.
function toTaskJson(row: any) {
  return {
    id: row.id,
    alertId: row.finding_id,
    passportId: row.passport_id,
    clientId: row.client_id,
    title: row.title,
    description: row.remediation_plan,
    status: row.status,
    ownerId: row.owner_id,
    ownerDisplay: row.owner_display,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    readyForVerificationAt: row.ready_for_verification_at,
    verificationConfigurationId: row.verification_configuration_id,
    collectorJobId: row.verification_job_id,
    verifiedAt: row.verified_at,
    verificationResult: row.verification_result ? JSON.parse(row.verification_result) : null,
    verificationFailureReason: row.verification_failure_reason,
    closedAt: row.closed_at,
  };
}

async function recordTransition(db: any, tenantId: string, taskId: string, fromStatus: string | null, toStatus: string, actorId: string) {
  await db.execute(sql`
    INSERT INTO remediation_task_transitions (id, tenant_id, task_id, from_status, to_status, actor_id, occurred_at)
    VALUES (${id('remtxn')}, ${tenantId}, ${taskId}, ${fromStatus}, ${toStatus}, ${actorId}, ${new Date().toISOString()})
  `);
}

async function loadTask(db: any, tenantId: string, clientScope: string | null, taskId: string) {
  return (await db.execute(sql`
    SELECT * FROM trust_remediation_work_items
    WHERE id = ${taskId} AND tenant_id = ${tenantId} AND (${clientScope}::text IS NULL OR client_id = ${clientScope})
  `) as any).rows?.[0] ?? null;
}

// A single named transition = one legal `from` status and the fields that
// move with it. Clients can never reach a status by any other path -- PATCH
// deliberately has no status field at all -- so an invalid transition is
// impossible to request, not just rejected after the fact.
function makeTransitionRoute(router: Router, action: string, fromStatus: string, toStatus: string, extraColumns: (now: string) => Record<string, string>) {
  router.post(`/:id/${action}`, requireRole(STAFF_ROLES as unknown as string[]), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const clientScope = clientScopeOf(req);
      const current = await loadTask(db, tenantId, clientScope, routeParam(req.params.id));
      if (!current) return res.status(404).json({ error: 'REMEDIATION_TASK_NOT_FOUND' });
      if (current.status !== fromStatus) {
        return res.status(409).json({ error: 'INVALID_TRANSITION', from: current.status, requestedTransition: action, expectedFrom: fromStatus });
      }
      const now = new Date().toISOString();
      const columns = extraColumns(now);
      let updateQuery = sql`UPDATE trust_remediation_work_items SET status = ${toStatus}, updated_at = ${now}`;
      for (const [col, val] of Object.entries(columns)) {
        updateQuery = sql`${updateQuery}, ${sql.raw(col)} = ${val}`;
      }
      updateQuery = sql`${updateQuery} WHERE id = ${req.params.id} AND tenant_id = ${tenantId} RETURNING *`;
      const updated = (await db.execute(updateQuery) as any).rows[0];
      await recordTransition(db, tenantId, routeParam(req.params.id), fromStatus, toStatus, req.user!.uid);
      await appendAuditEntry(db, { tenantId, action: `remediation_task.${action.replace(/-/g, '_')}`, actor: req.user!.uid, payload: { taskId: req.params.id, from: fromStatus, to: toStatus } });
      return res.json(toTaskJson(updated));
    } catch (error) { return next(error); }
  });
}

export function createRemediationTasksRouter() {
  const router = Router();

  router.get('/', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const clientScope = clientScopeOf(req);
      const rows = (await db.execute(sql`
        SELECT * FROM trust_remediation_work_items
        WHERE tenant_id = ${tenantId} AND (${clientScope}::text IS NULL OR client_id = ${clientScope})
        ORDER BY CASE status
          WHEN 'OPEN' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'READY_FOR_VERIFICATION' THEN 3
          WHEN 'VERIFICATION_QUEUED' THEN 4 WHEN 'VERIFYING' THEN 5 ELSE 6 END, updated_at DESC
      `) as any).rows ?? [];
      return res.json(rows.map(toTaskJson));
    } catch (error) { return next(error); }
  });

  router.post('/', requireRole(STAFF_ROLES as unknown as string[]), async (req: AuthenticatedRequest, res, next) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const findingId = parsed.data.alertId;
      const finding = (await db.execute(sql`SELECT id, client_id, passport_id, title, description FROM trust_findings WHERE id = ${findingId} AND tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!finding) return res.status(404).json({ error: 'FINDING_NOT_FOUND' });
      // Idempotent: never create a second active task for the same finding --
      // a duplicate POST (double-click, retry) returns the existing task.
      const existing = (await db.execute(sql`
        SELECT * FROM trust_remediation_work_items
        WHERE tenant_id = ${tenantId} AND finding_id = ${findingId} AND status NOT IN ('CLOSED', 'CANCELLED')
        ORDER BY created_at DESC LIMIT 1
      `) as any).rows?.[0];
      if (existing) return res.status(200).json(toTaskJson(existing));

      const now = new Date().toISOString();
      const taskId = id('remtask');
      const title = String(finding.title || 'Remediation task').slice(0, 255);
      await db.execute(sql`
        INSERT INTO trust_remediation_work_items
          (id, tenant_id, passport_id, finding_id, client_id, external_system, owner_id, status, title, remediation_plan, created_at, updated_at)
        VALUES (${taskId}, ${tenantId}, ${finding.passport_id}, ${finding.id}, ${finding.client_id}, 'SPR', ${req.user!.uid}, 'OPEN', ${title}, ${finding.description || title}, ${now}, ${now})
      `);
      await recordTransition(db, tenantId, taskId, null, 'OPEN', req.user!.uid);
      await appendAuditEntry(db, { tenantId, action: 'remediation_task.created', actor: req.user!.uid, payload: { taskId, findingId } });
      const created = (await db.execute(sql`SELECT * FROM trust_remediation_work_items WHERE id = ${taskId} AND tenant_id = ${tenantId}`) as any).rows[0];
      return res.status(201).json(toTaskJson(created));
    } catch (error) { return next(error); }
  });

  router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const task = await loadTask(db, req.user!.tenantId, clientScopeOf(req), routeParam(req.params.id));
      if (!task) return res.status(404).json({ error: 'REMEDIATION_TASK_NOT_FOUND' });
      return res.json(toTaskJson(task));
    } catch (error) { return next(error); }
  });

  router.patch('/:id', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const p = parsed.data;
      const now = new Date().toISOString();
      const rows = await db.execute(sql`
        UPDATE trust_remediation_work_items
        SET owner_id = COALESCE(${p.ownerId ?? null}, owner_id), owner_display = COALESCE(${p.ownerDisplay ?? null}, owner_display), updated_at = ${now}
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId} RETURNING *
      `);
      const row = (rows as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'REMEDIATION_TASK_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'remediation_task.updated', actor: req.user!.uid, payload: { taskId: req.params.id, fields: Object.keys(p) } });
      return res.json(toTaskJson(row));
    } catch (error) { return next(error); }
  });

  makeTransitionRoute(router, 'start', 'OPEN', 'IN_PROGRESS', (now) => ({ started_at: now }));
  makeTransitionRoute(router, 'ready-for-verification', 'IN_PROGRESS', 'READY_FOR_VERIFICATION', (now) => ({ ready_for_verification_at: now }));

  router.post('/:id/verify', requireRole(STAFF_ROLES as unknown as string[]), async (req: AuthenticatedRequest, res, next) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PAYLOAD', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const clientScope = clientScopeOf(req);
      const task = await loadTask(db, tenantId, clientScope, routeParam(req.params.id));
      if (!task) return res.status(404).json({ error: 'REMEDIATION_TASK_NOT_FOUND' });
      if (task.status !== 'READY_FOR_VERIFICATION') {
        return res.status(409).json({ error: 'INVALID_TRANSITION', from: task.status, requestedTransition: 'verify', expectedFrom: 'READY_FOR_VERIFICATION' });
      }
      const configuration = (await db.execute(sql`
        SELECT * FROM monitoring_configurations WHERE id = ${parsed.data.monitoringConfigurationId} AND tenant_id = ${tenantId} AND enabled = 1
      `) as any).rows?.[0];
      if (!configuration) return res.status(404).json({ error: 'MONITORING_CONFIGURATION_NOT_FOUND' });
      const definition = COLLECTORS[configuration.collector_id as string];
      if (!definition) return res.status(409).json({ error: 'UNSUPPORTED_COLLECTOR' });

      const now = new Date();
      const nowIso = now.toISOString();
      const window = observationWindow(now, configuration.schedule_seconds);
      const key = collectorJobKey({
        tenantId, assetId: configuration.asset_id, collectorId: configuration.collector_id,
        subjectIdentifier: configuration.subject_identifier, monitoredVersion: 'current',
        observationWindow: window, collectorVersion: definition.version,
      });
      const jobId = id('collector-job');
      let resolvedJobId = jobId;
      try {
        await db.execute(sql`
          INSERT INTO collector_jobs
            (id, tenant_id, client_id, asset_id, passport_id, monitoring_configuration_id, collector_id, collector_version, subject_type, subject_identifier, schedule_source, observation_window, idempotency_key, state, attempt_number, maximum_attempts, created_at, next_attempt_at)
          VALUES (${jobId}, ${tenantId}, ${configuration.client_id}, ${configuration.asset_id}, ${configuration.passport_id}, ${configuration.id}, ${configuration.collector_id}, ${definition.version}, ${configuration.subject_type}, ${configuration.subject_identifier}, 'manual', ${window}, ${key}, 'queued', 0, ${definition.maximumRetries}, ${nowIso}, ${nowIso})
        `);
      } catch (error: any) {
        if (error?.code !== '23505' && error?.cause?.code !== '23505') throw error;
        const existingJob = (await db.execute(sql`SELECT id FROM collector_jobs WHERE tenant_id = ${tenantId} AND idempotency_key = ${key}`) as any).rows?.[0];
        if (!existingJob) throw error;
        resolvedJobId = existingJob.id;
      }

      const updated = (await db.execute(sql`
        UPDATE trust_remediation_work_items
        SET status = 'VERIFICATION_QUEUED', verification_configuration_id = ${configuration.id}, verification_job_id = ${resolvedJobId}, updated_at = ${nowIso}
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId} RETURNING *
      `) as any).rows[0];
      await recordTransition(db, tenantId, routeParam(req.params.id), 'READY_FOR_VERIFICATION', 'VERIFICATION_QUEUED', req.user!.uid);
      await appendAuditEntry(db, { tenantId, action: 'remediation_task.verification_queued', actor: req.user!.uid, payload: { taskId: req.params.id, collectorJobId: resolvedJobId, monitoringConfigurationId: configuration.id } });
      return res.status(202).json({ ...toTaskJson(updated), collectorJobId: resolvedJobId });
    } catch (error) { return next(error); }
  });

  router.get('/:id/verification', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const task = await loadTask(db, tenantId, clientScopeOf(req), routeParam(req.params.id));
      if (!task) return res.status(404).json({ error: 'REMEDIATION_TASK_NOT_FOUND' });
      if (!task.verification_job_id) return res.status(404).json({ error: 'VERIFICATION_NOT_QUEUED' });
      const job = (await db.execute(sql`SELECT id, state, safe_error_code, safe_error_message, completed_at FROM collector_jobs WHERE id = ${task.verification_job_id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      return res.json({
        taskId: task.id,
        taskStatus: task.status,
        collectorJobId: task.verification_job_id,
        collectorJobState: job?.state ?? 'unknown',
        collectorFailureCode: job?.safe_error_code ?? null,
        collectorFailureMessage: job?.safe_error_message ?? null,
        verificationResult: task.verification_result ? JSON.parse(task.verification_result) : null,
        verificationFailureReason: task.verification_failure_reason,
        verifiedAt: task.verified_at,
      });
    } catch (error) { return next(error); }
  });

  return router;
}
