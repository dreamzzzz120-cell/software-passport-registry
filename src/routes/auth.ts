/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../db/schema.ts';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/security.ts';
import { adminAuth, setUserCustomClaims } from '../lib/firebase-admin.ts';
import { appendAuditEntry, verifyAuditChain } from '../security/audit-log.ts';
import { describeUserAgent, sessionFingerprint } from '../security/session-tracking.ts';
import { offboardTenantData } from '../db/sync.ts';

const INVITABLE_ROLES = ['Admin', 'Technician', 'Viewer', 'Client'] as const;
const inviteSchema = z.object({ email: z.string().trim().email().max(255), role: z.enum(INVITABLE_ROLES) }).strict();
const roleUpdateSchema = z.object({ role: z.enum(INVITABLE_ROLES) }).strict();
const profileUpdateSchema = z.object({
  displayName: z.string().trim().max(200).optional(),
  roleTitle: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
}).strict();
const revokeSessionSchema = z.object({ sessionId: z.string().trim().min(1).max(200) }).strict();
// 300KB base64 comfortably fits a small compressed logo (PNG/JPEG at
// reasonable dimensions) while keeping a single UPDATE well under any
// practical row-size or request-body concern.
const brandingSchema = z.object({
  companyName: z.string().trim().max(200).nullable().optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'brandColor must be a #rrggbb hex color').nullable().optional(),
  logoDataUrl: z.string().trim().max(300_000).regex(/^data:image\/(png|jpeg|jpg|svg\+xml|webp);base64,/, 'logoDataUrl must be a base64 image data URL').nullable().optional(),
}).strict();

export function createAuthRouter() {
  const router = Router();

  // The Firebase ID token is the sole authentication authority. The database
  // record supplies the tenant/RBAC projection after token verification.
  router.get('/user/me', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const user = await db.select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        tenantId: users.tenantId,
        role: users.role,
        companyName: users.companyName,
        roleTitle: users.roleTitle,
        displayName: users.displayName,
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

  router.put('/user/profile', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const result = await db.execute(sql`
        UPDATE users SET
          display_name = COALESCE(${parsed.data.displayName ?? null}, display_name),
          role_title = COALESCE(${parsed.data.roleTitle ?? null}, role_title),
          company_name = COALESCE(${parsed.data.companyName ?? null}, company_name)
        WHERE uid = ${req.user!.uid} AND tenant_id = ${req.user!.tenantId}
        RETURNING id, email, display_name AS "displayName", role_title AS "roleTitle", company_name AS "companyName"
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'User account not found' });
      await appendAuditEntry(db, { tenantId: req.user!.tenantId, action: 'profile.updated', actor: req.user!.email, payload: { userId: req.user!.id } });
      return res.json(row);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/organization/team', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const result = await db.execute(sql`
        SELECT id, email, display_name AS "displayName", role, onboarded, created_at AS "createdAt"
        FROM users WHERE tenant_id = ${req.user!.tenantId} ORDER BY created_at ASC
      `);
      return res.json((result as any).rows ?? []);
    } catch (error) {
      return next(error);
    }
  });

  // Persistent white-label branding (migration 0030). This is display
  // packaging only -- it never touches scoring, evidence, or which report
  // data is included; ReportsView's white-label export already only uses a
  // client's real, already-loaded software inventory and scores.
  router.get('/organization/branding', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const result = await db.execute(sql`
        SELECT company_name AS "companyName", brand_color AS "brandColor", logo_data_url AS "logoDataUrl", updated_at AS "updatedAt"
        FROM tenant_branding WHERE tenant_id = ${req.user!.tenantId} LIMIT 1
      `);
      const row = (result as any).rows?.[0];
      return res.json(row ?? { companyName: null, brandColor: null, logoDataUrl: null, updatedAt: null });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/organization/branding', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const parsed = brandingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const tenantId = req.user!.tenantId;
      const result = await db.execute(sql`
        INSERT INTO tenant_branding (tenant_id, company_name, brand_color, logo_data_url, updated_at, updated_by)
        VALUES (${tenantId}, ${parsed.data.companyName ?? null}, ${parsed.data.brandColor ?? null}, ${parsed.data.logoDataUrl ?? null}, CURRENT_TIMESTAMP, ${req.user!.email})
        ON CONFLICT (tenant_id) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          brand_color = EXCLUDED.brand_color,
          logo_data_url = EXCLUDED.logo_data_url,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
        RETURNING company_name AS "companyName", brand_color AS "brandColor", logo_data_url AS "logoDataUrl", updated_at AS "updatedAt"
      `);
      await appendAuditEntry(db, { tenantId, action: 'branding.updated', actor: req.user!.email, payload: {} });
      return res.json((result as any).rows?.[0]);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/organization/invite', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const email = parsed.data.email.toLowerCase();

      const existing = await db.execute(sql`SELECT id FROM users WHERE tenant_id = ${req.user!.tenantId} AND lower(btrim(email)) = ${email} LIMIT 1`);
      if ((existing as any).rows?.length) return res.status(409).json({ error: 'This email is already a member of your workspace.' });

      let firebaseUser;
      try {
        firebaseUser = await adminAuth.getUserByEmail(email);
      } catch {
        firebaseUser = await adminAuth.createUser({ email, emailVerified: false });
      }

      const inserted = await db.execute(sql`
        INSERT INTO users (uid, email, tenant_id, role, invited_by, onboarded)
        VALUES (${firebaseUser.uid}, ${email}, ${req.user!.tenantId}, ${parsed.data.role}, ${req.user!.email}, 0)
        RETURNING id, email, role
      `);
      await setUserCustomClaims(firebaseUser.uid, { workspaceId: req.user!.tenantId, role: parsed.data.role });

      let inviteLink: string | null = null;
      try { inviteLink = await adminAuth.generatePasswordResetLink(email); } catch { inviteLink = null; }

      await appendAuditEntry(db, { tenantId: req.user!.tenantId, action: 'team.invited', actor: req.user!.email, payload: { invitedEmail: email, role: parsed.data.role } });
      return res.status(201).json({ ...(inserted as any).rows?.[0], inviteLink });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/organization/team/:userId/role', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const parsed = roleUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const targetId = Number(req.params.userId);
      if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user id' });

      const result = await db.execute(sql`
        UPDATE users SET role = ${parsed.data.role}
        WHERE id = ${targetId} AND tenant_id = ${req.user!.tenantId} AND role <> 'Owner'
        RETURNING id, uid, email, role
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Team member not found, or the Owner role cannot be changed here.' });
      await setUserCustomClaims(row.uid, { workspaceId: req.user!.tenantId, role: parsed.data.role });
      await appendAuditEntry(db, { tenantId: req.user!.tenantId, action: 'team.role_changed', actor: req.user!.email, payload: { targetUserId: targetId, newRole: parsed.data.role } });
      return res.json({ id: row.id, email: row.email, role: row.role });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/organization/team/:userId', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const targetId = Number(req.params.userId);
      if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user id' });

      const result = await db.execute(sql`
        DELETE FROM users WHERE id = ${targetId} AND tenant_id = ${req.user!.tenantId} AND role <> 'Owner'
        RETURNING id, uid, email
      `);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Team member not found, or the Owner cannot be removed.' });

      try { await adminAuth.updateUser(row.uid, { disabled: true }); await adminAuth.revokeRefreshTokens(row.uid); } catch { /* Firebase account may already be gone; DB removal already took effect. */ }
      await appendAuditEntry(db, { tenantId: req.user!.tenantId, action: 'team.removed', actor: req.user!.email, payload: { targetUserId: targetId, targetEmail: row.email } });
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auth/sessions', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const currentIp = req.ip || req.socket.remoteAddress || 'unknown';
      const currentUserAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : '';
      const currentFingerprint = sessionFingerprint(req.user!.uid, currentIp, currentUserAgent);

      const result = await db.execute(sql`
        SELECT id, session_fingerprint AS "sessionFingerprint", ip, user_agent AS "userAgent", last_seen_at AS "lastSeenAt"
        FROM user_sessions
        WHERE tenant_id = ${req.user!.tenantId} AND user_id = ${req.user!.id} AND revoked_at IS NULL
        ORDER BY last_seen_at DESC
      `);
      const rows = ((result as any).rows ?? []) as Array<{ id: string; sessionFingerprint: string; ip: string; userAgent: string; lastSeenAt: string }>;
      return res.json(rows.map(row => ({
        id: row.id,
        email: req.user!.email,
        current: row.sessionFingerprint === currentFingerprint,
        ip: row.ip,
        device: describeUserAgent(row.userAgent),
        location: 'Not geolocated',
        lastSeenAt: row.lastSeenAt,
      })));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/auth/sessions/revoke', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const parsed = revokeSessionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const currentIp = req.ip || req.socket.remoteAddress || 'unknown';
      const currentUserAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : '';
      const currentFingerprint = sessionFingerprint(req.user!.uid, currentIp, currentUserAgent);
      if (parsed.data.sessionId === `sess_${currentFingerprint}`) return res.status(400).json({ error: 'Cannot revoke the session you are currently using. Sign out instead.' });

      const result = await db.execute(sql`
        UPDATE user_sessions SET revoked_at = NOW()
        WHERE id = ${parsed.data.sessionId} AND tenant_id = ${req.user!.tenantId} AND user_id = ${req.user!.id} AND revoked_at IS NULL
        RETURNING id
      `);
      if (!((result as any).rows?.length)) return res.status(404).json({ error: 'Session not found' });
      await appendAuditEntry(db, { tenantId: req.user!.tenantId, action: 'session.revoked', actor: req.user!.email, payload: { sessionId: parsed.data.sessionId } });
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auth/login-history', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const result = await db.execute(sql`
        SELECT id, ip, user_agent AS "userAgent", status, occurred_at AS "occurredAt"
        FROM login_history WHERE tenant_id = ${req.user!.tenantId} AND user_id = ${req.user!.id}
        ORDER BY occurred_at DESC LIMIT 50
      `);
      const rows = ((result as any).rows ?? []) as Array<{ id: string; ip: string; userAgent: string; status: string; occurredAt: string }>;
      return res.json(rows.map(row => ({
        id: row.id,
        email: req.user!.email,
        status: row.status,
        action: 'Sign-in',
        timestamp: row.occurredAt,
        ip: row.ip,
        location: 'Not geolocated',
      })));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auth/audit-chain', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const beforeRaw = typeof req.query.before === 'string' ? Number(req.query.before) : null;
      const before = Number.isInteger(beforeRaw) && beforeRaw! > 0 ? beforeRaw : null;
      const result = before
        ? await db.execute(sql`
            SELECT id, action, timestamp, actor, payload, current_hash AS "currentHash", previous_hash AS "previousHash"
            FROM audit_trail WHERE tenant_id = ${req.user!.tenantId} AND id < ${before} ORDER BY id DESC LIMIT 50
          `)
        : await db.execute(sql`
        SELECT id, action, timestamp, actor, payload, current_hash AS "currentHash", previous_hash AS "previousHash"
        FROM audit_trail WHERE tenant_id = ${req.user!.tenantId} ORDER BY id DESC LIMIT 50
      `);
      const rows = ((result as any).rows ?? []) as Array<{ id: number; action: string; timestamp: string; actor: string; payload: string; currentHash: string; previousHash: string }>;
      return res.json(rows.map(row => ({
        id: row.id,
        action: row.action,
        timestamp: row.timestamp,
        actor: row.actor,
        payload: row.payload,
        hash: row.currentHash,
        currentHash: row.currentHash,
        previousHash: row.previousHash,
        block: { action: row.action, userEmail: row.actor.includes('@') ? row.actor : null },
      })));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/auth/audit-chain/verify', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      return res.json(await verifyAuditChain(db, req.user!.tenantId));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/tenant/offboard', requireAuth, requireRole('Owner'), async (req: AuthenticatedRequest, res, next) => {
    try {
      // Purges via the owner-role connection (not req.db): offboarding must be
      // able to see every table it enumerates from information_schema, and it
      // already scopes every DELETE to exactly this caller's own tenant_id.
      await offboardTenantData(req.user!.tenantId);
      return res.status(200).json({ message: 'Tenant data purged.' });
    } catch (error) {
      return next(error);
    }
  });

  // Owner-only founder metrics. Every value is either observed from tenant
  // data or explicitly reported as not verified; this endpoint never invents
  // production health, security, financial, or performance telemetry.
  router.get('/founder/metrics', requireAuth, requireRole('Owner'), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
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
      const db = req.db!;
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
      const db = req.db!;
      const result = await db.execute(sql`SELECT id, name, domain, industry, trust_score AS "trustScore", risk_level AS "riskLevel", avatar_color AS "avatarColor", subscription_tier AS "subscriptionTier", joined_date AS "joinedDate", team_count AS "teamCount", passport_count AS "passportCount", critical_risks_count AS "criticalRisksCount", compliance_progress AS "complianceProgress", software_inventory AS "softwareInventory", compliance_status AS "complianceStatus", team_members AS "teamMembers", activity_timeline AS "activityTimeline" FROM clients WHERE tenant_id=${req.user!.tenantId} ORDER BY joined_date DESC`);
      return res.json((result as any).rows || []);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/user/passports', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const result = await db.execute(sql`SELECT p.id, p.client_id AS "clientId", p.name, p.version, p.publisher, p.category, p.release_date AS "releaseDate", p.license_type AS "licenseType", p.sbom, COALESCE((SELECT json_agg(json_build_object('id', e.id, 'name', e.name, 'type', e.type, 'verified', e.verified, 'status', e.status, 'signer', e.signer, 'timestamp', e.timestamp, 'hash', e.hash, 'engineId', e.engine_id, 'verificationFailureReason', e.verification_failure_reason) ORDER BY e.timestamp DESC) FROM evidence_items e WHERE e.tenant_id=p.tenant_id AND e.asset_id=p.id), '[]'::json) AS evidence, COALESCE((SELECT json_agg(json_build_object('id', f.id, 'findingId', f.id, 'severity', f.severity, 'category', f.category, 'title', f.title, 'description', f.description, 'component', f.component, 'fixedVersion', f.fixed_version, 'status', f.status, 'detectedAt', f.detected_at, 'engineId', f.engine_id) ORDER BY f.detected_at DESC) FROM scan_findings f WHERE f.tenant_id=p.tenant_id AND f.asset_id=p.id), '[]'::json) AS vulnerabilities, p.timeline, NULL AS scores, 'not_authoritatively_scored' AS "scoreStatus" FROM passports p WHERE p.tenant_id=${req.user!.tenantId} ORDER BY p.name ASC`);
      return res.json((result as any).rows || []);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/user/extensions', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
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
      const db = req.db!;
      const result = await db.execute(sql`INSERT INTO extension_installations (tenant_id, extension_id, installed_at) VALUES (${req.user!.tenantId}, ${extensionId}, NOW()) ON CONFLICT (tenant_id, extension_id) DO UPDATE SET installed_at=NOW() RETURNING extension_id AS "extensionId", installed_at AS "installedAt"`);
      return res.status(201).json((result as any).rows?.[0]);
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/user/extensions/:extensionId', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
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
