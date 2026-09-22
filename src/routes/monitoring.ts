import crypto from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ScopedDb } from '../middleware/tenant-scope.ts';

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}
import {
  clients, collectorJobs, monitoringConfigurations,
  passports,
} from '../db/schema.ts';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { COLLECTORS, collectorJobKey, observationWindow } from '../utils/monitoring.ts';
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

async function ownedPassport(db: ScopedDb, tenantId: string, passportId: string) {
  return db.select({ id: passports.id }).from(passports).where(and(
    eq(passports.id, passportId), eq(passports.tenantId, tenantId),
  )).then(rows => rows[0] || null);
}

async function ownedClient(db: ScopedDb, tenantId: string, clientId: string) {
  return db.select({ id: clients.id }).from(clients).where(and(
    eq(clients.id, clientId), eq(clients.tenantId, tenantId),
  )).then(rows => rows[0] || null);
}

function clientScopeOf(req: AuthenticatedRequest) {
  return req.user!.role === 'Client' ? req.user!.clientId : null;
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
  // Monitoring is gated by the Active Passport entitlement (migration 0064,
  // enforced again below on create), not by an operator allowlist. The former
  // per-tenant env allowlist answered 404 for every tenant not hand-added to
  // a Railway variable, and the UI then told users to "ask an Owner to enable
  // it" although no Owner control existed.

  router.post('/assurance/clients/:clientId/enable', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res) => {
    const db = req.db!;
    const clientId = routeParam(req.params.clientId);
    const tenantId = req.user!.tenantId;
    const client = await db.select({ id: clients.id, domain: clients.domain, name: clients.name })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.tenantId, tenantId)))
      .then(rows => rows[0]);
    if (!client) return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });

    const passport = await db.select({ id: passports.id })
      .from(passports)
      .where(and(eq(passports.clientId, clientId), eq(passports.tenantId, tenantId)))
      .orderBy(desc(passports.releaseDate))
      .then(rows => rows[0]);
    if (!passport) return res.status(409).json({ error: 'PASSPORT_REQUIRED', message: 'Create or attach a software passport before enabling continuous assurance.' });

    const domain = client.domain.trim().replace(/^https?:\\/\\//i, '').replace(/\\/.*$/, '').toLowerCase();
    const now = new Date();
    const definitions = [
      { collectorId: 'uptime', subjectType: 'url', subjectIdentifier: `https://${domain}`, scheduleSeconds: 900 },
      { collectorId: 'tls', subjectType: 'hostname', subjectIdentifier: domain, scheduleSeconds: 3600 },
    ] as const;
    const created: unknown[] = [];
    for (const definition of definitions) {
      const existing = await db.select().from(monitoringConfigurations).where(and(
        eq(monitoringConfigurations.tenantId, tenantId),
        eq(monitoringConfigurations.clientId, clientId),
        eq(monitoringConfigurations.passportId, passport.id),
        eq(monitoringConfigurations.collectorId, definition.collectorId),
        eq(monitoringConfigurations.subjectIdentifier, definition.subjectIdentifier),
      )).then(rows => rows[0]);
      if (existing) {
        created.push(publicConfiguration(existing));
        continue;
      }
      const policy = COLLECTORS[definition.collectorId];
      const row: typeof monitoringConfigurations.$inferInsert = {
        id: `monitor-${crypto.randomUUID()}`,
        tenantId,
        clientId,
        assetId: `client-domain:${clientId}`,
        passportId: passport.id,
        collectorId: definition.collectorId,
        subjectType: definition.subjectType,
        subjectIdentifier: definition.subjectIdentifier,
        scheduleSeconds: definition.scheduleSeconds,
        enabled: 1,
        credentialReferenceId: null,
        nextScheduledAt: now.toISOString(),
        lastStatus: 'unknown',
        freshnessPolicyId: policy.freshnessPolicyId,
        confidencePolicyId: policy.confidencePolicyId,
        createdBy: req.user!.uid,
        updatedBy: req.user!.uid,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      const [inserted] = await db.insert(monitoringConfigurations).values(row).returning();
      created.push(publicConfiguration(inserted));
    }
    return res.status(200).json({
      client: { id: client.id, name: client.name, domain: client.domain },
      passportId: passport.id,
      assurance: { enabled: true, monitors: created },
    });
  });

  router.get('/collectors', (_req, res) => {
    res.json(Object.values(COLLECTORS));
  });

  router.get('/monitoring-configurations', async (req: AuthenticatedRequest, res) => {
    const db = req.db!;
    const clientScope = clientScopeOf(req);
    const conditions = [eq(monitoringConfigurations.tenantId, req.user!.tenantId)];
    if (clientScope) conditions.push(eq(monitoringConfigurations.clientId, clientScope));
    const rows = await db.select().from(monitoringConfigurations).where(and(...conditions))
      .orderBy(desc(monitoringConfigurations.updatedAt));
    res.json(rows.map(publicConfiguration));
  });

  router.get('/monitoring-configurations/:id', async (req: AuthenticatedRequest, res) => {
    const db = req.db!;
    const clientScope = clientScopeOf(req);
    const conditions = [
      eq(monitoringConfigurations.id, routeParam(req.params.id)),
      eq(monitoringConfigurations.tenantId, req.user!.tenantId),
    ];
    if (clientScope) conditions.push(eq(monitoringConfigurations.clientId, clientScope));
    const row = await db.select().from(monitoringConfigurations).where(and(...conditions)).then(rows => rows[0]);
    if (!row) return res.status(404).json({ error: 'MONITORING_CONFIGURATION_NOT_FOUND' });
    res.json(publicConfiguration(row));
  });

  router.post('/monitoring-configurations', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res) => {
    const db = req.db!;
    const body = parse(monitoringCreateSchema, req.body, res);
    if (!body) return;
    const definition = COLLECTORS[body.collectorId];
    if (!definition.supportedSubjectTypes.includes(body.subjectType)) {
      return res.status(400).json({ error: 'UNSUPPORTED_COLLECTOR_SUBJECT' });
    }
    if (body.scheduleSeconds < definition.minimumScheduleSeconds) {
      return res.status(400).json({ error: 'SCHEDULE_BELOW_COLLECTOR_MINIMUM' });
    }
    if (!await ownedPassport(db, req.user!.tenantId, body.passportId)) {
      return res.status(404).json({ error: 'PASSPORT_NOT_FOUND' });
    }
    if (!await ownedClient(db, req.user!.tenantId, body.clientId)) {
      return res.status(404).json({ error: 'CLIENT_NOT_FOUND' });
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
      // db.insert(...) wraps the real pg error in a DrizzleQueryError --
      // the actual code lives at error.cause.code, not error.code.
      if (error?.code === '23505' || error?.cause?.code === '23505') return res.status(409).json({ error: 'MONITORING_CONFIGURATION_EXISTS' });
      // The Active Passport entitlement guard (migration 0064) raises P0001 with
      // 'ACTIVE_PASSPORT_LIMIT_REACHED:<active>:<limit>'. Only 23505 was handled
      // here, so hitting the plan ceiling through the UI rethrew and the customer
      // saw a 500 -- a paying user told their own product was broken at the exact
      // moment it should have offered them a larger plan. Answered with the same
      // shape the capacity-limit routes return, so one client
      // interceptor covers both routes.
      const raised = String(error?.message ?? error?.cause?.message ?? '');
      const capacity = /ACTIVE_PASSPORT_LIMIT_REACHED:(\d+):(\d+)/.exec(raised);
      if (capacity) {
        return res.status(409).json({
          error: 'ACTIVE_PASSPORT_LIMIT_REACHED',
          billingUnit: 'active_passport',
          activePassports: Number(capacity[1]),
          includedActivePassports: Number(capacity[2]),
          upgradeRequired: true,
        });
      }
      throw error;
    }
  });

  router.patch('/monitoring-configurations/:id', requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res) => {
    const db = req.db!;
    const body = parse(monitoringPatchSchema, req.body, res);
    if (!body) return;
    const current = await db.select().from(monitoringConfigurations).where(and(
      eq(monitoringConfigurations.id, routeParam(req.params.id)),
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
      eq(monitoringConfigurations.id, routeParam(req.params.id)),
      eq(monitoringConfigurations.tenantId, req.user!.tenantId),
    )).returning();
    res.json(publicConfiguration(updated));
  });

  router.post('/monitoring-configurations/:id/run', requireRole(['Owner', 'Admin', 'Technician']), async (req: AuthenticatedRequest, res) => {
    const db = req.db!;
    const configuration = await db.select().from(monitoringConfigurations).where(and(
      eq(monitoringConfigurations.id, routeParam(req.params.id)),
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
      if (error?.code !== '23505' && error?.cause?.code !== '23505') throw error;
      const existing = await db.select().from(collectorJobs).where(and(
        eq(collectorJobs.tenantId, req.user!.tenantId), eq(collectorJobs.idempotencyKey, key),
      )).then(rows => rows[0]);
      res.status(200).json({ jobId: existing.id, state: existing.state, accepted: false, reused: true });
    }
  });

  router.get('/collector-jobs', async (req: AuthenticatedRequest, res) => {
    const db = req.db!;
    const clientScope = clientScopeOf(req);
    const conditions = [eq(collectorJobs.tenantId, req.user!.tenantId)];
    if (clientScope) conditions.push(eq(collectorJobs.clientId, clientScope));
    const rows = await db.select().from(collectorJobs).where(and(...conditions))
      .orderBy(desc(collectorJobs.createdAt)).limit(200);
    res.json(rows);
  });

  router.get('/collector-jobs/:id', async (req: AuthenticatedRequest, res) => {
    const db = req.db!;
    const clientScope = clientScopeOf(req);
    const conditions = [eq(collectorJobs.id, routeParam(req.params.id)), eq(collectorJobs.tenantId, req.user!.tenantId)];
    if (clientScope) conditions.push(eq(collectorJobs.clientId, clientScope));
    const row = await db.select().from(collectorJobs).where(and(...conditions)).then(rows => rows[0]);
    if (!row) return res.status(404).json({ error: 'COLLECTOR_JOB_NOT_FOUND' });
    res.json(row);
  });

  return router;
}
