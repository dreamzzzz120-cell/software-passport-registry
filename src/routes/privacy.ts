/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';

// Privacy Management (Governance & Compliance Increment A) is MSP-internal
// program documentation (what personal information the MSP's own systems
// hold, DSAR intake/processing, PIAs) -- never Client-readable, matching
// every other governance module (Vendor Risk, Governance Tier-1, Savings).
const NOT_CLIENT_ROLE = ['Owner', 'Admin', 'Technician', 'Viewer'];
const WRITE_ROLE = ['Owner', 'Admin'];
const PROCESS_ROLE = ['Owner', 'Admin', 'Technician'];

function newId(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

const inventorySchema = z.object({
  clientId: z.string().trim().min(1).max(120).nullable().optional(),
  informationType: z.string().trim().min(1).max(255),
  category: z.string().trim().max(120).default(''),
  source: z.string().trim().max(500).default(''),
  purpose: z.string().trim().max(2000).default(''),
  useDescription: z.string().trim().max(2000).default(''),
  disclosureRecipients: z.string().trim().max(2000).default(''),
  geography: z.string().trim().max(255).default(''),
  retention: z.string().trim().max(500).default(''),
  disposal: z.string().trim().max(500).default(''),
  accessRoles: z.string().trim().max(500).default(''),
  ownerName: z.string().trim().max(255).default(''),
}).strict();

const inventoryPatchSchema = inventorySchema.partial();

const requestSchema = z.object({
  clientId: z.string().trim().min(1).max(120).nullable().optional(),
  requestorName: z.string().trim().min(1).max(255),
  requestorEmail: z.string().trim().max(255).default(''),
  requestType: z.enum(['ACCESS', 'CORRECTION', 'DELETION', 'PORTABILITY', 'OBJECTION', 'OTHER']),
  scope: z.string().trim().max(2000).default(''),
}).strict();

const requestPatchSchema = z.object({
  status: z.enum(['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'WITHDRAWN']),
  response: z.string().trim().max(4000).optional(),
  evidenceIds: z.array(z.string()).optional(),
}).strict();

const piaSchema = z.object({
  clientId: z.string().trim().min(1).max(120).nullable().optional(),
  processingDescription: z.string().trim().max(4000).default(''),
  personalInformationDescription: z.string().trim().max(4000).default(''),
  purpose: z.string().trim().max(2000).default(''),
  risks: z.string().trim().max(4000).default(''),
  safeguards: z.string().trim().max(4000).default(''),
  residualRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
}).strict();

const piaDecisionSchema = z.object({
  reviewerName: z.string().trim().min(1).max(255),
  decision: z.enum(['APPROVED', 'REQUIRES_CHANGES', 'REJECTED']),
}).strict();

function publicInventoryRow(row: any) {
  return {
    id: row.id, clientId: row.clientId, informationType: row.informationType, category: row.category, source: row.source,
    purpose: row.purpose, useDescription: row.useDescription, disclosureRecipients: row.disclosureRecipients,
    geography: row.geography, retention: row.retention, disposal: row.disposal, accessRoles: row.accessRoles,
    ownerName: row.ownerName, createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function publicRequestRow(row: any) {
  return {
    id: row.id, clientId: row.clientId, requestorName: row.requestorName, requestorEmail: row.requestorEmail,
    requestType: row.requestType, scope: row.scope, receivedAt: row.receivedAt, status: row.status, response: row.response,
    evidenceIds: JSON.parse(row.evidenceIds || '[]'), completedAt: row.completedAt,
    createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function publicPiaRow(row: any) {
  return {
    id: row.id, clientId: row.clientId, processingDescription: row.processingDescription,
    personalInformationDescription: row.personalInformationDescription, purpose: row.purpose, risks: row.risks,
    safeguards: row.safeguards, residualRisk: row.residualRisk, relatedIncidentId: row.relatedIncidentId,
    reviewerName: row.reviewerName, decision: row.decision, decidedAt: row.decidedAt,
    createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export function createPrivacyRouter() {
  const router = Router();

  // ---- Personal Information Inventory -------------------------------------
  router.get('/inventory', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`
        SELECT id, client_id AS "clientId", information_type AS "informationType", category, source, purpose,
          use_description AS "useDescription", disclosure_recipients AS "disclosureRecipients", geography, retention,
          disposal, access_roles AS "accessRoles", owner_name AS "ownerName",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM privacy_information_inventory WHERE tenant_id = ${req.user!.tenantId} ORDER BY updated_at DESC
      `) as any).rows ?? [];
      res.json(rows.map(publicInventoryRow));
    } catch (error) { next(error); }
  });

  router.post('/inventory', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = inventorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, id = newId('privacy_info'), b = parsed.data;
      const row = (await db.execute(sql`
        INSERT INTO privacy_information_inventory (id, tenant_id, client_id, information_type, category, source, purpose, use_description, disclosure_recipients, geography, retention, disposal, access_roles, owner_name, created_by)
        VALUES (${id}, ${tenantId}, ${b.clientId ?? null}, ${b.informationType}, ${b.category}, ${b.source}, ${b.purpose}, ${b.useDescription}, ${b.disclosureRecipients}, ${b.geography}, ${b.retention}, ${b.disposal}, ${b.accessRoles}, ${b.ownerName}, ${req.user!.uid})
        RETURNING id, client_id AS "clientId", information_type AS "informationType", category, source, purpose,
          use_description AS "useDescription", disclosure_recipients AS "disclosureRecipients", geography, retention,
          disposal, access_roles AS "accessRoles", owner_name AS "ownerName",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'privacy.inventory.created', actor: req.user!.uid, payload: { id, informationType: b.informationType } });
      res.status(201).json(publicInventoryRow(row));
    } catch (error) { next(error); }
  });

  router.patch('/inventory/:id', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = inventoryPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, p = parsed.data;
      const before = (await db.execute(sql`SELECT * FROM privacy_information_inventory WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!before) return res.status(404).json({ error: 'INVENTORY_ITEM_NOT_FOUND' });
      const row = (await db.execute(sql`
        UPDATE privacy_information_inventory SET
          information_type = ${p.informationType ?? before.information_type}, category = ${p.category ?? before.category},
          source = ${p.source ?? before.source}, purpose = ${p.purpose ?? before.purpose},
          use_description = ${p.useDescription ?? before.use_description}, disclosure_recipients = ${p.disclosureRecipients ?? before.disclosure_recipients},
          geography = ${p.geography ?? before.geography}, retention = ${p.retention ?? before.retention}, disposal = ${p.disposal ?? before.disposal},
          access_roles = ${p.accessRoles ?? before.access_roles}, owner_name = ${p.ownerName ?? before.owner_name}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING id, client_id AS "clientId", information_type AS "informationType", category, source, purpose,
          use_description AS "useDescription", disclosure_recipients AS "disclosureRecipients", geography, retention,
          disposal, access_roles AS "accessRoles", owner_name AS "ownerName",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'privacy.inventory.updated', actor: req.user!.uid, payload: { id: req.params.id } });
      res.json(publicInventoryRow(row));
    } catch (error) { next(error); }
  });

  // ---- Privacy Requests (DSAR intake/processing) --------------------------
  router.get('/requests', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
      const rows = (await req.db!.execute(sql`
        SELECT id, client_id AS "clientId", requestor_name AS "requestorName", requestor_email AS "requestorEmail",
          request_type AS "requestType", scope, received_at AS "receivedAt", status, response,
          evidence_ids AS "evidenceIds", completed_at AS "completedAt",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM privacy_requests WHERE tenant_id = ${req.user!.tenantId} AND (${statusFilter}::text IS NULL OR status = ${statusFilter})
        ORDER BY received_at DESC
      `) as any).rows ?? [];
      res.json(rows.map(publicRequestRow));
    } catch (error) { next(error); }
  });

  router.post('/requests', requireAuth, requireRole(PROCESS_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, id = newId('privacy_req'), b = parsed.data;
      const row = (await db.execute(sql`
        INSERT INTO privacy_requests (id, tenant_id, client_id, requestor_name, requestor_email, request_type, scope, created_by)
        VALUES (${id}, ${tenantId}, ${b.clientId ?? null}, ${b.requestorName}, ${b.requestorEmail}, ${b.requestType}, ${b.scope}, ${req.user!.uid})
        RETURNING id, client_id AS "clientId", requestor_name AS "requestorName", requestor_email AS "requestorEmail",
          request_type AS "requestType", scope, received_at AS "receivedAt", status, response,
          evidence_ids AS "evidenceIds", completed_at AS "completedAt",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'privacy.request.received', actor: req.user!.uid, payload: { id, requestType: b.requestType } });
      res.status(201).json(publicRequestRow(row));
    } catch (error) { next(error); }
  });

  router.patch('/requests/:id', requireAuth, requireRole(PROCESS_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = requestPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, p = parsed.data;
      const before = (await db.execute(sql`SELECT * FROM privacy_requests WHERE id = ${req.params.id} AND tenant_id = ${tenantId}`) as any).rows?.[0];
      if (!before) return res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
      const completedAt = p.status === 'COMPLETED' ? new Date().toISOString() : before.completed_at;
      const row = (await db.execute(sql`
        UPDATE privacy_requests SET
          status = ${p.status}, response = ${p.response ?? before.response},
          evidence_ids = ${p.evidenceIds ? JSON.stringify(p.evidenceIds) : before.evidence_ids},
          completed_at = ${completedAt},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING id, client_id AS "clientId", requestor_name AS "requestorName", requestor_email AS "requestorEmail",
          request_type AS "requestType", scope, received_at AS "receivedAt", status, response,
          evidence_ids AS "evidenceIds", completed_at AS "completedAt",
          created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'privacy.request.updated', actor: req.user!.uid, payload: { id: req.params.id, previousStatus: before.status, newStatus: p.status } });
      res.json(publicRequestRow(row));
    } catch (error: any) {
      // "Completion" (a real, meaningful state transition) requires the
      // actual completion fact recorded together -- DB CHECK constraint.
      if (error?.code === '23514' || error?.cause?.code === '23514') return res.status(400).json({ error: 'COMPLETION_REQUIRES_COMPLETED_AT' });
      next(error);
    }
  });

  // ---- Privacy Impact Assessments -----------------------------------------
  router.get('/pias', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`
        SELECT id, client_id AS "clientId", processing_description AS "processingDescription",
          personal_information_description AS "personalInformationDescription", purpose, risks, safeguards,
          residual_risk AS "residualRisk", related_incident_id AS "relatedIncidentId", reviewer_name AS "reviewerName",
          decision, decided_at AS "decidedAt", created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM privacy_impact_assessments WHERE tenant_id = ${req.user!.tenantId} ORDER BY updated_at DESC
      `) as any).rows ?? [];
      res.json(rows.map(publicPiaRow));
    } catch (error) { next(error); }
  });

  router.post('/pias', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = piaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, id = newId('pia'), b = parsed.data;
      const row = (await db.execute(sql`
        INSERT INTO privacy_impact_assessments (id, tenant_id, client_id, processing_description, personal_information_description, purpose, risks, safeguards, residual_risk, created_by)
        VALUES (${id}, ${tenantId}, ${b.clientId ?? null}, ${b.processingDescription}, ${b.personalInformationDescription}, ${b.purpose}, ${b.risks}, ${b.safeguards}, ${b.residualRisk ?? null}, ${req.user!.uid})
        RETURNING id, client_id AS "clientId", processing_description AS "processingDescription",
          personal_information_description AS "personalInformationDescription", purpose, risks, safeguards,
          residual_risk AS "residualRisk", related_incident_id AS "relatedIncidentId", reviewer_name AS "reviewerName",
          decision, decided_at AS "decidedAt", created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
      `) as any).rows?.[0];
      await appendAuditEntry(db, { tenantId, action: 'privacy.pia.created', actor: req.user!.uid, payload: { id } });
      res.status(201).json(publicPiaRow(row));
    } catch (error) { next(error); }
  });

  // A PIA decision is a distinct, explicit action -- matching the policy-
  // approval pattern in Governance Tier-1 -- never a side effect of an
  // ordinary field edit, and the DB CHECK independently requires a named
  // reviewer + timestamp whenever decision leaves PENDING.
  router.post('/pias/:id/decide', requireAuth, requireRole(WRITE_ROLE), async (req: AuthenticatedRequest, res, next) => {
    const parsed = piaDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!, tenantId = req.user!.tenantId, d = parsed.data;
      const row = (await db.execute(sql`
        UPDATE privacy_impact_assessments SET decision = ${d.decision}, reviewer_name = ${d.reviewerName}, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${req.params.id} AND tenant_id = ${tenantId}
        RETURNING id, decision, reviewer_name AS "reviewerName", decided_at AS "decidedAt"
      `) as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'PIA_NOT_FOUND' });
      await appendAuditEntry(db, { tenantId, action: 'privacy.pia.decided', actor: req.user!.uid, payload: { id: req.params.id, decision: d.decision, reviewerName: d.reviewerName } });
      res.json(row);
    } catch (error) { next(error); }
  });

  return router;
}
