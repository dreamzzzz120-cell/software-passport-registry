import crypto from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import {
  alertSubscriptions, collectorJobs, inAppNotifications, monitoringConfigurations,
  passports,
} from '../db/schema.ts';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { COLLECTORS, advanceSchedule, collectorJobKey, observationWindow } from '../utils/monitoring.ts';
import { createIntegrationRouter } from './integration.ts';

const scheduleSchema = z.number().int().min(900).max(2_592_000);
const monitoringCreateSchema = z.object({
  clientId: z.string().min(1).max(200),
  assetId: z.string().min(1).max(200),
  passportId: z.string().min(1).max(200),
  collectorId: z.enum(['repository', 'dependency', 'tls', 'domain_dns', 'uptime', 'release']),
  subjectType: z.enum(['github_repository', 'hostname', 'domain', 'url']),
  subjectIdentifier: z.string().min(1).max(2048),
  scheduleSeconds: scheduleSchema,
  credentialReferenceId: z.string().min(1).max(200).nullable().optional(),
}).strict();
const monitoringPatchSchema = z.object({
  enabled: z.boolean().optional(),
  scheduleSeconds: scheduleSchema.optional(),
  credentialReferenceId: z.string().min(1).max(200).nullable().optional(),
}).strict().refine(body => Object.keys(body).length > 0);
const alertTypes = [
  'collector_failed', 'collector_repeatedly_failed', 'collector_timed_out', 'collector_recovered',
  'authorization_expired', 'authorization_revoked', 'evidence_became_stale', 'evidence_expired',
  'finding_created', 'finding_severity_increased', 'finding_resolved', 'completeness_decreased',
  'dimension_became_unknown', 'dimension_became_unavailable', 'score_became_ineligible',
  'repository_commit_changed', 'dependency_advisory_status_changed',
  'tls_certificate_approaching_expiry', 'tls_certificate_expired',
  'domain_expiry_approaching', 'monitored_endpoint_became_unreachable',
  'monitored_endpoint_recovered',
] as const;
const subscriptionCreateSchema = z.object({
  clientId: z.string().min(1).max(200).nullable().optional(),
  assetId: z.string().min(1).max(200).nullable().optional(),
  passportId: z.string().min(1).max(200).nullable().optional(),
  collectorId: z.enum(['repository', 'dependency', 'tls', 'domain_dns', 'uptime', 'release']).nullable().optional(),
  alertTypes: z.array(z.enum(alertTypes)).min(1),
  minimumSeverity: z.enum(['informational', 'low', 'medium', 'high', 'critical']),
  enabled: z.boolean().default(true),
  deliveryChannel: z.literal('in_app').default('in_app'),
}).strict();
const subscriptionPatchSchema = subscriptionCreateSchema.partial().refine(body => Object.keys(body).length > 0);

function parse<T>(schema: z.ZodType<T>, body: unknown, res: any): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues.map(issue => ({
      path: issue.path.join('.'), message: issue.message,
    })) });
    return null;
  }
  return parsed.data;
}

async function ownedPassport(tenantId: string, passportId: string) {
  return db.select({ id: passports.id }).from(passports).where(and(
    eq(passports.id, passportId), eq(passports.tenantId, tenantId),
  )).then(rows => rows[0] || null);
}

function publicConfiguration(row: typeof monitoringConfigurations.$inferSelect) {
  return {
    ...row,
    enabled: row.enabled === 1,
    credentialReferenceId: row.credentialReferenceId ? 'stored' : null,
  };
}

export function createMonitoringRouter() {
  const router = Router();
  // SPR Connect is deliberately mounted before the monitoring auth/tenant gate.
  // Its machine-to-machine routes perform their own API-key authentication.
  router.use('/v1', createIntegrationRouter());
  router.use((req: AuthenticatedRequest, res, next) => {
    const requestId = typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id'].slice(0, 100)
      : `req_${crypto.randomUUID()}`;
    res.setHeader('x-request-id', requestId);
    res.locals.requestId = requestId;
    next();
  });
  router.use(requireAuth);
  router.use((req: AuthenticatedRequest, res, next) => {
    const approved = new Set(config.monitoring.enabledTenantIds);
    if (!approved.has(req.user!.tenantId)) {
      return res.status(404).json({
        error: {
          code: 'MONITORING_NOT_ENABLED',
          message: 'Monitoring is not enabled for this tenant.',
          requestId: res.locals.requestId,
        },
      });
    }
    next();
  });

  router.get('/collectors', (_req, res) => {
    res.json(Object.values(COLLECTORS));
  });

  router.get('/monitoring-configurations', async (req: AuthenticatedRequest, res) => {
    const rows = await db.select().from(monitoringConfigurations).where(
      eq(monitoringConfigurations.tenantId, req.user!.tenantId),
    ).orderBy(desc(monitoringConfigurations.updatedAt));
    res.json(rows.map(publicConfiguration));
  });

  router.get('/monitoring-configurations/:id', async (req: AuthenticatedRequest, res) => {
    const row = await db.select().from(monitoringConfigurations).where(and(
      eq(monitoringConfigurations.id, req.params.id),
      eq(monitoringConfigurations.tenantId, req.user!.tenantId),
    )).then(rows => rows[0]);
    if (!row) return res.status(404).json({ error: 'MONITORING_CONFIGURATION_NOT_FOUND' });
    res.json(publicConfiguration(row));
  });

  router.post('/monitoring-configurations', requireRole(['Admin']), async (req: AuthenticatedRequest, res) => {
    const body = parse(monitoringCreateSchema, req.body, res);
    if (!body) return;
    const definition = COLLECTORS[body.collectorId];
    if (!definition.supportedSubjectTypes.includes(body.subjectType)) {
      return res.status(400).json({ error: 'UNSUPPORTED_COLLECTOR_SUBJECT' });
    }
    if (body.scheduleSeconds < definition.minimumScheduleSeconds) {
      return res.status(400).json({ error: 'SCHEDULE_BELOW_COLLECTOR_MINIMUM' });
    }
    if (!await ownedPassport(req.user!.tenantId, body.passportId)) {
      return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
    }
    const now = new Date();
    const row: typeof monitoringConfigurations.$inferInsert = {
      id: `monitor-${crypto.randomUUID()}`, tenantId: req.user!.tenantId,
      clientId: body.clientId, assetId: body.assetId, passportId: body.passportId,
      collectorId: body.collectorId, subjectType: body.subjectType,
      subjectIdentifier: body.subjectIdentifier, scheduleSeconds: body.scheduleSeconds,
      enabled: 1, credentialReferenceId: body.credentialReferenceId || null,
      nextScheduledAt: now.toISOString(), lastStatus: 'unknown',
      freshnessPolicyId: definition.freshnessPolicyId,
      confidencePolicyId: definition.confidencePolicyId,
      createdBy: req.user!.uid, updatedBy: req.user!.uid,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    try {
      const [created] = await db.insert(monitoringConfigurations).values(row).returning();
      res.status(201).json(publicConfiguration(created));
    } catch (error: any) {
      if (error?.code === '23505') return res.status(409).json({ error: 'MONITORING_CONFIGURATION_EXISTS' });
      throw error;
    }
  });

  router.patch('/monitoring-configurations/:id', requireRole(['Admin']), async (req: AuthenticatedRequest, res) => {
    const body = parse(monitoringPatchSchema, req.body, res);
    if (!body) return;
    const current = await db.select().from(monitoringConfigurations).where(and(
      eq(monitoringConfigurations.id, req.params.id),
      eq(monitoringConfigurations.tenantId, req.user!.tenantId),
    )).then(rows => rows[0]);
    if (!current) return res.status(404).json({ error: 'MONITORING_CONFIGURATION_NOT_FOUND' });
    const definition = COLLECTORS[current.collectorId];
    if (body.scheduleSeconds && body.scheduleSeconds < definition.minimumScheduleSeconds) {
      return res.status(400).json({ error: 'SCHEDULE_BELOW_COLLECTOR_MINIMUM' });
    }
    const [updated] = await db.update(monitoringConfigurations).set({
      ...(body.enabled === undefined ? {} : { enabled: body.enabled ? 1 : 0 }),
      ...(body.scheduleSeconds === undefined ? {} : { scheduleSeconds: body.scheduleSeconds }),
      ...(body.credentialReferenceId === undefined ? {} : { credentialReferenceId: body.credentialReferenceId }),
      updatedBy: req.user!.uid, updatedAt: new Date().toISOString(),
    }).where(and(
      eq(monitoringConfigurations.id, req.params.id),
      eq(monitoringConfigurations.tenantId, req.user!.tenantId),
    )).returning();
    res.json(publicConfiguration(updated));
  });

  router.post('/monitoring-configurations/:id/run', requireRole(['Technician']), async (req: AuthenticatedRequest, res) => {
    const configuration = await db.select().from(monitoringConfigurations).where(and(
      eq(monitoringConfigurations.id, req.params.id),
      eq(monitoringConfigurations.tenantId, req.user!.tenantId),
      eq(monitoringConfigurations.enabled, 1),
    )).then(rows => rows[0]);
    if (!configuration) return res.status(404).json({ error: 'MONITORING_CONFIGURATION_NOT_FOUND' });
    const definition = COLLECTORS[configuration.collectorId];
    const now = new Date();
    const window = observationWindow(now, configuration.scheduleSeconds);
    const key = collectorJobKey({
      tenantId: configuration.tenantId, assetId: configuration.assetId,
      collectorId: configuration.collectorId, subjectIdentifier: configuration.subjectIdentifier,
      monitoredVersion: 'current', observationWindow: window, collectorVersion: definition.version,
    });
    const row: typeof collectorJobs.$inferInsert = {
      id: `collector-job-${crypto.randomUUID()}`, tenantId: configuration.tenantId,
      clientId: configuration.clientId, assetId: configuration.assetId,
      passportId: configuration.passportId, monitoringConfigurationId: configuration.id,
      collectorId: configuration.collectorId, collectorVersion: definition.version,
      subjectType: configuration.subjectType, subjectIdentifier: configuration.subjectIdentifier,
      scheduleSource: 'manual', observationWindow: window, idempotencyKey: key,
      state: 'queued', maximumAttempts: definition.maximumRetries,
      createdAt: now.toISOString(), nextAttemptAt: now.toISOString(),
    };
    try {
      const [created] = await db.insert(collectorJobs).values(row).returning();
      res.status(202).json({ jobId: created.id, state: created.state, accepted: true });
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
      const existing = await db.select().from(collectorJobs).where(and(
        eq(collectorJobs.tenantId, req.user!.tenantId), eq(collectorJobs.idempotencyKey, key),
      )).then(rows => rows[0]);
      res.status(200).json({ jobId: existing.id, state: existing.state, accepted: false, reused: true });
    }
  });

  router.get('/collector-jobs', async (req: AuthenticatedRequest, res) => {
    const rows = await db.select().from(collectorJobs).where(
      eq(collectorJobs.tenantId, req.user!.tenantId),
    ).orderBy(desc(collectorJobs.createdAt)).limit(200);
    res.json(rows);
  });

  router.get('/collector-jobs/:id', async (req: AuthenticatedRequest, res) => {
    const row = await db.select().from(collectorJobs).where(and(
      eq(collectorJobs.id, req.params.id), eq(collectorJobs.tenantId, req.user!.tenantId),
    )).then(rows => rows[0]);
    if (!row) return res.status(404).json({ error: 'COLLECTOR_JOB_NOT_FOUND' });
    res.json(row);
  });

  router.get('/alert-subscriptions', async (req: AuthenticatedRequest, res) => {
    const rows = await db.select().from(alertSubscriptions).where(
      eq(alertSubscriptions.tenantId, req.user!.tenantId),
    ).orderBy(desc(alertSubscriptions.updatedAt));
    res.json(rows.map(row => ({ ...row, alertTypes: JSON.parse(row.alertTypes), enabled: row.enabled === 1 })));
  });

  router.get('/alert-subscriptions/:id', async (req: AuthenticatedRequest, res) => {
    const row = await db.select().from(alertSubscriptions).where(and(
      eq(alertSubscriptions.id, req.params.id),
      eq(alertSubscriptions.tenantId, req.user!.tenantId),
    )).then(rows => rows[0]);
    if (!row) return res.status(404).json({ error: 'ALERT_SUBSCRIPTION_NOT_FOUND' });
    res.json({ ...row, alertTypes: JSON.parse(row.alertTypes), enabled: row.enabled === 1 });
  });

  router.post('/alert-subscriptions', requireRole(['Technician']), async (req: AuthenticatedRequest, res) => {
    const body = parse(subscriptionCreateSchema, req.body, res);
    if (!body) return;
    if (body.passportId && !await ownedPassport(req.user!.tenantId, body.passportId)) {
      return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
    }
    const now = new Date().toISOString();
    const [created] = await db.insert(alertSubscriptions).values({
      id: `subscription-${crypto.randomUUID()}`, tenantId: req.user!.tenantId,
      clientId: body.clientId, assetId: body.assetId, passportId: body.passportId,
      collectorId: body.collectorId, minimumSeverity: body.minimumSeverity,
      deliveryChannel: body.deliveryChannel, alertTypes: JSON.stringify(body.alertTypes),
      enabled: body.enabled ? 1 : 0,
      destinationReference: req.user!.uid, createdBy: req.user!.uid, updatedBy: req.user!.uid,
      createdAt: now, updatedAt: now,
    }).returning();
    res.status(201).json({ ...created, alertTypes: JSON.parse(created.alertTypes), enabled: created.enabled === 1 });
  });

  router.patch('/alert-subscriptions/:id', requireRole(['Technician']), async (req: AuthenticatedRequest, res) => {
    const body = parse(subscriptionPatchSchema, req.body, res);
    if (!body) return;
    const update: Partial<typeof alertSubscriptions.$inferInsert> = {
      ...(body.clientId === undefined ? {} : { clientId: body.clientId }),
      ...(body.assetId === undefined ? {} : { assetId: body.assetId }),
      ...(body.passportId === undefined ? {} : { passportId: body.passportId }),
      ...(body.collectorId === undefined ? {} : { collectorId: body.collectorId }),
      ...(body.minimumSeverity === undefined ? {} : { minimumSeverity: body.minimumSeverity }),
      ...(body.deliveryChannel === undefined ? {} : { deliveryChannel: body.deliveryChannel }),
      ...(body.alertTypes ? { alertTypes: JSON.stringify(body.alertTypes) } : {}),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled ? 1 : 0 }),
      updatedBy: req.user!.uid, updatedAt: new Date().toISOString(),
    };
    const [updated] = await db.update(alertSubscriptions).set({ ...update }).where(and(
      eq(alertSubscriptions.id, req.params.id), eq(alertSubscriptions.tenantId, req.user!.tenantId),
    )).returning();
    if (!updated) return res.status(404).json({ error: 'ALERT_SUBSCRIPTION_NOT_FOUND' });
    res.json({ ...updated, alertTypes: JSON.parse(updated.alertTypes), enabled: updated.enabled === 1 });
  });

  router.delete('/alert-subscriptions/:id', requireRole(['Technician']), async (req: AuthenticatedRequest, res) => {
    const deleted = await db.delete(alertSubscriptions).where(and(
      eq(alertSubscriptions.id, req.params.id), eq(alertSubscriptions.tenantId, req.user!.tenantId),
    )).returning({ id: alertSubscriptions.id });
    if (!deleted[0]) return res.status(404).json({ error: 'ALERT_SUBSCRIPTION_NOT_FOUND' });
    res.status(204).send();
  });

  router.get('/notifications', async (req: AuthenticatedRequest, res) => {
    const rows = await db.select().from(inAppNotifications).where(
      eq(inAppNotifications.tenantId, req.user!.tenantId),
    ).orderBy(desc(inAppNotifications.createdAt)).limit(200);
    res.json(rows);
  });

  return router;
}
