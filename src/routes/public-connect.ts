import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { config } from '../config.ts';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/security.ts';
import { attachTenantScope, ScopedDb } from '../middleware/tenant-scope.ts';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const REPORT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const REPORT_TYPES = ['executive', 'technical', 'msp', 'customer', 'compliance', 'vendor', 'auditor', 'evidence-ledger'];

function base64url(input: string | Buffer) { return Buffer.from(input).toString('base64url'); }
function signPublicPassportToken(passportId: string, tenantId: string, expiresAt: number) { if (!config.publicPassport.secret) throw new Error('Public Passport signing is not configured'); const payload = base64url(JSON.stringify({ v: 1, passportId, tenantId, exp: expiresAt })); const signature = crypto.createHmac('sha256', config.publicPassport.secret).update(payload).digest('base64url'); return `${payload}.${signature}`; }
export function verifyPublicPassportToken(token: string, passportId: string) { if (!config.publicPassport.secret) return null; const parts = token.split('.'); if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 4096) return null; const expected = crypto.createHmac('sha256', config.publicPassport.secret).update(parts[0]).digest(); let supplied: Buffer; try { supplied = Buffer.from(parts[1], 'base64url'); } catch { return null; } if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null; try { const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { v?: number; passportId?: string; tenantId?: string; exp?: number }; if (payload.v !== 1 || payload.passportId !== passportId || !payload.tenantId || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null; return payload; } catch { return null; } }

// Report share tokens are signed with the same secret but carry a distinct `kind`
// discriminator so a passport verification link can never be replayed against the
// report endpoint (or vice versa) even though both are bearer tokens on the same key.
function signPublicReportToken(passportId: string, tenantId: string, reportType: string, expiresAt: number) { if (!config.publicPassport.secret) throw new Error('Public Passport signing is not configured'); const payload = base64url(JSON.stringify({ v: 1, kind: 'report', passportId, tenantId, reportType, exp: expiresAt })); const signature = crypto.createHmac('sha256', config.publicPassport.secret).update(payload).digest('base64url'); return `${payload}.${signature}`; }
export function verifyPublicReportToken(token: string, passportId: string) { if (!config.publicPassport.secret) return null; const parts = token.split('.'); if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 4096) return null; const expected = crypto.createHmac('sha256', config.publicPassport.secret).update(parts[0]).digest(); let supplied: Buffer; try { supplied = Buffer.from(parts[1], 'base64url'); } catch { return null; } if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null; try { const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { v?: number; kind?: string; passportId?: string; tenantId?: string; reportType?: string; exp?: number }; if (payload.v !== 1 || payload.kind !== 'report' || payload.passportId !== passportId || !payload.tenantId || !payload.reportType || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null; return payload; } catch { return null; } }

// Free Review status tokens are signed with the same secret but carry their
// own `kind` discriminator, following the same reasoning as the report
// tokens above: an anonymous Free Review status link must never be
// interchangeable with a real tenant's passport/report share link, even
// though both are bearer tokens on the same HMAC key. Unlike the other two,
// this token does not carry a tenantId -- every Free Review passport
// belongs to the single fixed system tenant, which the server already knows.
export function signFreeReviewStatusToken(passportId: string, expiresAt: number) { if (!config.publicPassport.secret) throw new Error('Public Passport signing is not configured'); const payload = base64url(JSON.stringify({ v: 1, kind: 'free_review_status', passportId, exp: expiresAt })); const signature = crypto.createHmac('sha256', config.publicPassport.secret).update(payload).digest('base64url'); return `${payload}.${signature}`; }
export function verifyFreeReviewStatusToken(token: string, passportId: string) { if (!config.publicPassport.secret) return null; const parts = token.split('.'); if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 4096) return null; const expected = crypto.createHmac('sha256', config.publicPassport.secret).update(parts[0]).digest(); let supplied: Buffer; try { supplied = Buffer.from(parts[1], 'base64url'); } catch { return null; } if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null; try { const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { v?: number; kind?: string; passportId?: string; exp?: number }; if (payload.v !== 1 || payload.kind !== 'free_review_status' || payload.passportId !== passportId || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null; return payload; } catch { return null; } }

export async function publicTrustResponse(scopedDb: ScopedDb, passport: any) {
  const findings = (await scopedDb.execute(sql`SELECT id,control_id,title,severity,status,updated_at,resolved_at FROM trust_findings WHERE tenant_id=${passport.tenant_id} AND passport_id=${passport.id} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC LIMIT 50`) as any).rows || [];
  const evidence = (await scopedDb.execute(sql`SELECT id,provider,control_id,subject,observed_at,verification_method,status,severity,evidence_hash,limitation FROM evidence_ledger WHERE tenant_id=${passport.tenant_id} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 100`) as any).rows || [];
  const observations = (await scopedDb.execute(sql`SELECT id,observation_version,generated_at,canonical_payload_hash,completeness_basis_points,open_finding_count,unknown_dimension_count FROM trust_observations WHERE tenant_id=${passport.tenant_id} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows || [];
  const latest = observations[0]; const openFindings = findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase())); const criticalOrHigh = openFindings.filter((f: any) => ['critical','high'].includes(String(f.severity).toLowerCase())); const completeness = latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000; const status = latest && evidence.length > 0 ? (criticalOrHigh.length > 0 ? 'AVOID' : openFindings.length > 0 ? 'INVESTIGATE' : 'VERIFIED') : 'UNKNOWN';
  return { schemaVersion: 'spr-public-passport-v1', status, passport: { id: passport.id, name: passport.name, version: passport.version, publisher: passport.publisher, category: passport.category }, scores: null, scoreStatus: 'not_authoritatively_scored', evidence: { count: evidence.length, completeness, latestObservationAt: latest?.generated_at ?? null, latestHash: latest?.canonical_payload_hash ?? null }, findings: { open: openFindings.length, criticalOrHigh: criticalOrHigh.length, items: findings }, verification: { observed: Boolean(latest), evidenceBacked: evidence.length > 0, generatedAt: latest?.generated_at ?? null }, sources: evidence.slice(0, 50).map((e: any) => ({ provider: e.provider, observedAt: e.observed_at, verificationMethod: e.verification_method, evidenceHash: e.evidence_hash, limitation: e.limitation })), policy: { rule: 'SPR reports observed evidence only; UNKNOWN means insufficient evidence and is not a trust approval.' } };
}

export async function resolveAgentPassport(reference: string) {
  let pathname = reference; try { if (/^https:\/\//i.test(reference)) { const url = new URL(reference); if (url.protocol !== 'https:') return null; pathname = url.pathname; } } catch { return null; }
  const match = /^\/api\/public\/v1\/passports\/([^/]+)\/trust\/([^/]+)$/.exec(pathname); if (!match) return null;
  const passportId = decodeURIComponent(match[1]); const token = decodeURIComponent(match[2]); const payload = verifyPublicPassportToken(token, passportId); if (!payload) return null;
  const passport = (await db.execute(sql`SELECT id,tenant_id,name,version,publisher,category FROM passports WHERE id=${passportId} AND tenant_id=${payload.tenantId} LIMIT 1`) as any).rows?.[0]; if (!passport) return null;
  // resolveAgentPassport is called from the MCP tool executor, which has no
  // per-request res to bind a tenant-scoped transaction's lifecycle to; it
  // already filters explicitly by tenant_id above, so the owner connection is
  // used here directly rather than opening a transaction with nothing to close it.
  return publicTrustResponse(db, passport);
}

export function createPublicConnectRouter() {
  const router = Router();
  router.post('/public/v1/passports/:id/token', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => { try { const db = req.db!; const passportId = req.params.id; const passport = (await db.execute(sql`SELECT id,tenant_id FROM passports WHERE id=${passportId} AND tenant_id=${req.user!.tenantId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ error: 'Passport not found' }); const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS; const token = signPublicPassportToken(passport.id, passport.tenant_id, expiresAt); const baseUrl = config.appUrl || ''; return res.status(201).json({ passportId: passport.id, token, expiresAt: new Date(expiresAt * 1000).toISOString(), verificationUrl: `${baseUrl}/api/public/v1/passports/${encodeURIComponent(passport.id)}/trust/${encodeURIComponent(token)}` }); } catch (error) { return next(error); } });
  router.get('/public/v1/passports/:id/trust/:token', async (req, res, next) => { try { const payload = verifyPublicPassportToken(req.params.token, req.params.id); if (!payload || !payload.tenantId) return res.status(401).json({ error: 'Invalid or expired Passport verification token' }); const scopedDb = await attachTenantScope(payload.tenantId, res); const passport = (await scopedDb.execute(sql`SELECT id,tenant_id,name,version,publisher,category FROM passports WHERE id=${req.params.id} AND tenant_id=${payload.tenantId} LIMIT 1`) as any).rows?.[0]; if (!passport) return res.status(404).json({ error: 'Passport not found' }); res.setHeader('cache-control', 'public, max-age=60, stale-while-revalidate=300'); res.setHeader('x-content-type-options', 'nosniff'); return res.json(await publicTrustResponse(scopedDb, passport)); } catch (error) { return next(error); } });
  router.get('/public/v1/passports/:id/trust', async (_req, res) => res.status(410).json({ error: 'Signed Passport verification link required', code: 'SIGNED_PASSPORT_LINK_REQUIRED' }));

  router.post('/public/v1/reports/:id/token', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const reportType = REPORT_TYPES.includes(String(req.body?.type)) ? String(req.body.type) : 'executive';
      const db = req.db!;
      const passportId = req.params.id;
      const passport = (await db.execute(sql`SELECT id,tenant_id FROM passports WHERE id=${passportId} AND tenant_id=${req.user!.tenantId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ error: 'Passport not found' });
      const expiresAt = Math.floor(Date.now() / 1000) + REPORT_TOKEN_TTL_SECONDS;
      const token = signPublicReportToken(passport.id, passport.tenant_id, reportType, expiresAt);
      const baseUrl = config.appUrl || '';
      return res.status(201).json({ passportId: passport.id, reportType, token, expiresAt: new Date(expiresAt * 1000).toISOString(), shareUrl: `${baseUrl}/api/public/v1/reports/${encodeURIComponent(passport.id)}/${encodeURIComponent(token)}` });
    } catch (error) { return next(error); }
  });

  router.get('/public/v1/reports/:id/:token', async (req, res, next) => {
    try {
      const payload = verifyPublicReportToken(req.params.token, req.params.id);
      if (!payload || !payload.tenantId) return res.status(401).json({ error: 'Invalid or expired report share link' });
      const scopedDb = await attachTenantScope(payload.tenantId, res);
      const passport = (await scopedDb.execute(sql`SELECT id,tenant_id,name,version,publisher,category FROM passports WHERE id=${req.params.id} AND tenant_id=${payload.tenantId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ error: 'Passport not found' });
      res.setHeader('cache-control', 'private, max-age=0, no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      const trust = await publicTrustResponse(scopedDb, passport);
      return res.json({ ...trust, reportType: payload.reportType });
    } catch (error) { return next(error); }
  });

  return router;
}
