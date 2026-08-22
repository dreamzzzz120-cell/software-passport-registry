/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';

export function createAuthRouter() {
  const router = Router();

  // The Firebase ID token is the sole authentication authority. The database
  // record supplies the tenant/RBAC projection after token verification.
  router.get('/user/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = await db.select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        tenantId: users.tenantId,
        role: users.role,
        companyName: users.companyName,
        roleTitle: users.roleTitle,
        numTechnicians: users.numTechnicians,
        clientCount: users.clientCount,
        primaryUseCase: users.primaryUseCase,
        onboarded: users.onboarded,
        mfaEnabled: users.mfaEnabled,
        createdAt: users.createdAt,
      }).from(users).where(eq(users.uid, req.user!.uid)).then(rows => rows[0]);

      if (!user) return res.status(403).json({ error: 'User account is not provisioned' });
      return res.json({ ...user, emailVerified: req.user!.emailVerified });
    } catch (error) {
      return next(error);
    }
  });

  // Owner-only founder metrics. Every value is either observed from tenant
  // data or explicitly reported as not verified; this endpoint never invents
  // production health, security, financial, or performance telemetry.
  router.get('/founder/metrics', requireAuth, requireRole('Owner'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const counts = await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM clients WHERE tenant_id = ${req.user!.tenantId}) AS "clientCount",
          (SELECT COUNT(*)::int FROM passports WHERE tenant_id = ${req.user!.tenantId}) AS "passportCount",
          (SELECT COUNT(*)::int FROM scans WHERE tenant_id = ${req.user!.tenantId}) AS "scanCount"
      `);
      const row = (counts as any).rows?.[0] || {};
      return res.json({
        latency: 'Not verified',
        capitalProtected: 'Not verified',
        throughput: 'Not verified',
        mitigations: 'Not verified',
        overallScore: null,
        auditEvents: null,
        activeThreats: null,
        systemIntegrity: 'Not verified',
        observed: {
          clientCount: Number(row.clientCount || 0),
          passportCount: Number(row.passportCount || 0),
          scanCount: Number(row.scanCount || 0),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  // Owner-only self-passport retrieval. Absence of evidence is represented as
  // a 404 instead of a fabricated passport or trust score.
  router.get('/passports/self-passport', requireAuth, requireRole('Owner'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`
        SELECT
          id,
          name,
          version,
          publisher,
          release_date AS "releaseDate",
          evidence
        FROM passports
        WHERE tenant_id = ${req.user!.tenantId}
        ORDER BY release_date DESC NULLS LAST, id DESC
        LIMIT 1
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Self passport evidence not found', code: 'SELF_PASSPORT_NOT_FOUND' });
      return res.json({
        ...row,
        overallScore: null,
        healthStatus: 'Not verified',
        evidence: Array.isArray(row.evidence) ? row.evidence : [],
      });
    } catch (error) {
      return next(error);
    }
  });

  // Firebase-authenticated, tenant-scoped reads for the first-party SPA.
  // These are deliberately separate from /connect/v1, which is API-key based.
  router.get('/user/clients', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT id, name, domain, industry, trust_score AS "trustScore", risk_level AS "riskLevel", avatar_color AS "avatarColor", subscription_tier AS "subscriptionTier", joined_date AS "joinedDate", team_count AS "teamCount", passport_count AS "passportCount", critical_risks_count AS "criticalRisksCount", compliance_progress AS "complianceProgress", software_inventory AS "softwareInventory", compliance_status AS "complianceStatus", team_members AS "teamMembers", activity_timeline AS "activityTimeline" FROM clients WHERE tenant_id=${req.user!.tenantId} ORDER BY joined_date DESC`);
      return res.json((result as any).rows || []);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/user/passports', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT id, client_id AS "clientId", name, version, publisher, category, release_date AS "releaseDate", license_type AS "licenseType", sbom, evidence, vulnerabilities, timeline, NULL AS scores, 'not_authoritatively_scored' AS "scoreStatus" FROM passports WHERE tenant_id=${req.user!.tenantId} ORDER BY name ASC`);
      return res.json((result as any).rows || []);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/user/extensions', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await db.execute(sql`SELECT extension_id AS "extensionId", installed_at AS "installedAt" FROM extension_installations WHERE tenant_id=${req.user!.tenantId} ORDER BY installed_at DESC`);
      return res.json((result as any).rows || []);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/user/extensions/:extensionId', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const extensionId = String(req.params.extensionId || '').trim();
      if (!/^[A-Za-z0-9_.-]{1,120}$/.test(extensionId)) return res.status(400).json({ error: 'Invalid extension id' });
      const result = await db.execute(sql`INSERT INTO extension_installations (tenant_id, extension_id, installed_at) VALUES (${req.user!.tenantId}, ${extensionId}, NOW()) ON CONFLICT (tenant_id, extension_id) DO UPDATE SET installed_at=NOW() RETURNING extension_id AS "extensionId", installed_at AS "installedAt"`);
      return res.status(201).json((result as any).rows?.[0]);
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/user/extensions/:extensionId', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const extensionId = String(req.params.extensionId || '').trim();
      const result = await db.execute(sql`DELETE FROM extension_installations WHERE tenant_id=${req.user!.tenantId} AND extension_id=${extensionId} RETURNING extension_id`);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'Extension installation not found' });
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auth/verify-status', requireAuth, async (req: AuthenticatedRequest, res) => {
    return res.json({ verified: req.user!.emailVerified, emailVerified: req.user!.emailVerified });
  });

  return router;
}
