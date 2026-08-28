/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';

// Vendor Risk is MSP-internal supply-chain data (which vendors the MSP
// itself relies on), never something a 'Client'-role user -- who only ever
// sees their own scoped software/findings -- should be able to read.
const NOT_CLIENT_ROLE = ['Owner', 'Admin', 'Technician', 'Viewer'];

function newId(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }

const createVendorSchema = z.object({
  name: z.string().trim().min(1).max(255),
  category: z.string().trim().min(1).max(120).default('Software Publisher'),
  website: z.string().trim().max(2048).default(''),
  locations: z.string().trim().max(255).default(''),
}).strict();

// Matches the delta rule VendorsView.tsx's now-removed local-only handler
// used to apply client-side: a Passed audit is real, positive evidence
// (+3, small since a single pass shouldn't dominate the score); a Failed
// audit is a real, material finding (-10). 'Under Review' has no score
// impact -- it isn't evidence of anything yet.
const auditSchema = z.object({
  auditType: z.string().trim().min(1).max(255),
  status: z.enum(['Passed', 'Failed', 'Under Review']),
  details: z.string().trim().max(4000).default(''),
  auditor: z.string().trim().min(1).max(255),
  referenceHash: z.string().trim().max(255).default(''),
}).strict();

function riskTierFor(score: number): 'Low' | 'Medium' | 'High' {
  return score >= 88 ? 'Low' : score >= 75 ? 'Medium' : 'High';
}

function publicVendor(row: any) {
  return {
    id: row.id, name: row.name, category: row.category, website: row.website, locations: row.locations,
    reviewStatus: row.reviewStatus, riskTier: row.riskTier, reputationScore: row.reputationScore,
    overallTrustScore: row.overallTrustScore, activePassportsCount: row.activePassportsCount,
    securityIncidentsCount: row.securityIncidentsCount, lastAuditDate: row.lastAuditDate,
  };
}

function publicAudit(row: any) {
  return {
    id: row.id, date: new Date(row.createdAt).toISOString().split('T')[0], auditType: row.auditType,
    status: row.status, details: row.details, auditor: row.auditor, referenceHash: row.referenceHash,
  };
}

export function createVendorsRouter() {
  const router = Router();

  router.get('/', requireAuth, requireRole(NOT_CLIENT_ROLE), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const vendors = (await db.execute(sql`
        SELECT id, name, category, website, locations, review_status AS "reviewStatus", risk_tier AS "riskTier",
          reputation_score AS "reputationScore", overall_trust_score AS "overallTrustScore",
          active_passports_count AS "activePassportsCount", security_incidents_count AS "securityIncidentsCount",
          last_audit_date AS "lastAuditDate"
        FROM vendors WHERE tenant_id = ${tenantId} ORDER BY name
      `) as any).rows ?? [];
      if (!vendors.length) return res.json([]);
      const audits = (await db.execute(sql`
        SELECT id, vendor_id AS "vendorId", audit_type AS "auditType", status, details, auditor,
          reference_hash AS "referenceHash", created_at AS "createdAt"
        FROM vendor_audits WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
      `) as any).rows ?? [];
      const auditsByVendor = new Map<string, any[]>();
      for (const audit of audits) {
        const list = auditsByVendor.get(audit.vendorId) ?? [];
        list.push(publicAudit(audit));
        auditsByVendor.set(audit.vendorId, list);
      }
      res.json(vendors.map((v: any) => ({ ...publicVendor(v), auditHistory: auditsByVendor.get(v.id) ?? [] })));
    } catch (error) { next(error); }
  });

  router.post('/', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = createVendorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const id = newId('vendor');
      const row = (await db.execute(sql`
        INSERT INTO vendors (id, tenant_id, name, category, website, locations, created_by)
        VALUES (${id}, ${tenantId}, ${parsed.data.name}, ${parsed.data.category}, ${parsed.data.website}, ${parsed.data.locations}, ${req.user!.uid})
        RETURNING id, name, category, website, locations, review_status AS "reviewStatus", risk_tier AS "riskTier",
          reputation_score AS "reputationScore", overall_trust_score AS "overallTrustScore",
          active_passports_count AS "activePassportsCount", security_incidents_count AS "securityIncidentsCount",
          last_audit_date AS "lastAuditDate"
      `) as any).rows?.[0];
      res.status(201).json({ ...publicVendor(row), auditHistory: [] });
    } catch (error: any) {
      if (error?.code === '23505') return res.status(409).json({ error: 'VENDOR_NAME_ALREADY_EXISTS' });
      next(error);
    }
  });

  router.post('/:id/audits', requireAuth, requireRole(['Owner', 'Admin', 'Technician']), async (req: AuthenticatedRequest, res, next) => {
    const parsed = auditSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const vendorId = String(req.params.id);
      const vendor = (await db.execute(sql`
        SELECT id, reputation_score AS "reputationScore" FROM vendors WHERE id = ${vendorId} AND tenant_id = ${tenantId}
      `) as any).rows?.[0];
      if (!vendor) return res.status(404).json({ error: 'VENDOR_NOT_FOUND' });

      const delta = parsed.data.status === 'Passed' ? 3 : parsed.data.status === 'Failed' ? -10 : 0;
      const newScore = Math.min(100, Math.max(0, vendor.reputationScore + delta));
      const now = new Date().toISOString();
      const auditId = newId('vendoraudit');

      const auditRow = (await db.execute(sql`
        INSERT INTO vendor_audits (id, tenant_id, vendor_id, audit_type, status, details, auditor, reference_hash, created_by)
        VALUES (${auditId}, ${tenantId}, ${vendorId}, ${parsed.data.auditType}, ${parsed.data.status}, ${parsed.data.details}, ${parsed.data.auditor}, ${parsed.data.referenceHash}, ${req.user!.uid})
        RETURNING id, audit_type AS "auditType", status, details, auditor, reference_hash AS "referenceHash", created_at AS "createdAt"
      `) as any).rows?.[0];

      const updatedVendor = (await db.execute(sql`
        UPDATE vendors SET reputation_score = ${newScore}, overall_trust_score = ${newScore},
          risk_tier = ${riskTierFor(newScore)}, last_audit_date = ${now}, updated_at = ${now}
        WHERE id = ${vendorId} AND tenant_id = ${tenantId}
        RETURNING id, name, category, website, locations, review_status AS "reviewStatus", risk_tier AS "riskTier",
          reputation_score AS "reputationScore", overall_trust_score AS "overallTrustScore",
          active_passports_count AS "activePassportsCount", security_incidents_count AS "securityIncidentsCount",
          last_audit_date AS "lastAuditDate"
      `) as any).rows?.[0];

      res.status(201).json({ vendor: publicVendor(updatedVendor), audit: publicAudit(auditRow) });
    } catch (error) { next(error); }
  });

  return router;
}
