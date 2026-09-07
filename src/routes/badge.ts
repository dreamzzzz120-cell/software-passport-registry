import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { attachTenantScope } from '../middleware/tenant-scope.ts';
import { publicTrustResponse, verifyPublicPassportToken } from './public-connect.ts';

/**
 * PUBLIC BADGE DATA ENDPOINT
 * Authenticated: FALSE — authorised by the same HMAC-signed Passport token
 * that already gates /api/public/v1/passports/:id/trust/:token.
 *
 * Purpose: serves the minimal JSON payload public/badge.js needs to render an
 * embeddable badge on a third-party (MSP client) site.
 *
 * Why this is mounted ahead of the global cors() in server.ts:
 * the app-wide CORS policy is an origin allowlist with credentials: true, and
 * it denies every origin it does not know. A badge is embedded on domains we
 * do not control, so it needs Access-Control-Allow-Origin: * — which is only
 * safe because this router is read-only, sends no credentials, and returns
 * nothing a holder of the signed link could not already read. Do not add
 * anything mutating or cookie-reading here, and do not widen it to
 * slug-addressable lookups: unsigned public addressing is exactly what
 * public-connect.ts refuses with SIGNED_PASSPORT_LINK_REQUIRED.
 *
 * Honesty constraints (do not relax these):
 * - status comes only from publicTrustResponse(), the single derivation of
 *   VERIFIED / INVESTIGATE / AVOID / UNKNOWN. Never a certification word
 *   (SOC2 / ISO / GDPR), and never re-derived locally.
 * - No score is published. The registry's scores are nullable by design and
 *   the public contract reports scoreStatus 'not_authoritatively_scored';
 *   a number on a badge would be read as an authoritative rating.
 * - No tenant data, no findings detail, no PII.
 */

// Passport ids are opaque application ids; this bounds the value before it
// reaches the token check or the database.
const PASSPORT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export function createBadgeRouter() {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  router.options('/v1/:passportId/:token', (_req, res) => {
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  });

  router.get('/v1/:passportId/:token', async (req, res) => {
    const passportId = req.params.passportId;

    // A bad id, a bad token and an unknown passport all answer 404 with the
    // same body, so an embedded badge cannot be used to probe which Passport
    // ids exist. Errors are never cached.
    const deny = () => {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'not_found' });
    };

    if (!PASSPORT_ID_PATTERN.test(passportId)) return deny();

    const payload = verifyPublicPassportToken(req.params.token, passportId);
    if (!payload || !payload.tenantId) return deny();
    const tenantId = payload.tenantId;

    try {
      // Tenant-scoped handle, exactly as the sibling public share routes do.
      // The raw db handle would read outside row-level security.
      const scopedDb = await attachTenantScope(tenantId, res);

      const passport = (await scopedDb.execute(sql`
        SELECT id, tenant_id, name, version, publisher, category
        FROM passports
        WHERE id = ${passportId}
          AND tenant_id = ${tenantId}
        LIMIT 1
      `) as any).rows?.[0];

      if (!passport) return deny();

      const trust = await publicTrustResponse(scopedDb, passport);

      // Badges do not need to be real-time; this also keeps a widely embedded
      // script from turning into sustained origin load.
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

      return res.json({
        schemaVersion: 'spr-badge-v1',
        name: trust.passport.name,
        status: trust.status,
        scoreStatus: trust.scoreStatus,
        evidenceCount: trust.evidence.count,
        independentSources: trust.evidence.independentSources
      });
    } catch (error) {
      console.error('Badge data route error:', error);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'temporarily_unavailable' });
    }
  });

  // Anything else under /badge answers JSON rather than falling through to the
  // SPA shell, which would hand badge.js an HTML document to parse as JSON.
  router.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'not_found' });
  });

  return router;
}
