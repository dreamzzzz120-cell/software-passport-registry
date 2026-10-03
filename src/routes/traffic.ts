import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { requireAuth, requireRole, requireFounder, rateLimiter } from '../middleware/security.ts';

const eventNames = ['page_view','free_review_started','free_review_completed','lead_captured','pricing_view','signup_started','signup_completed','pilot_started','customer_created','registry_claim_clicked','registry_share_clicked','referral_visit'] as const;
const eventSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
  path: z.string().min(1).max(500),
  referrer: z.string().max(1000).optional().nullable(),
  deviceType: z.enum(['mobile','tablet','desktop','unknown']).default('unknown'),
  eventName: z.enum(eventNames).default('page_view'),
  source: z.string().trim().max(120).optional().nullable(),
  medium: z.string().trim().max(120).optional().nullable(),
  campaign: z.string().trim().max(160).optional().nullable(),
  referralCode: z.string().trim().regex(/^[A-Za-z0-9_-]{1,80}$/).optional().nullable(),
});

function hashIp(value: string | undefined): string | null {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex');
}

// Vercel does not forward its x-vercel-ip-country header to an external
// rewrite target, so every event arrived with country=null. vercel.json
// captures the header in a rewrite rule and passes it as ?vc_country=. The
// header forms stay for direct or Cloudflare-fronted traffic. The value is the
// edge's IP geolocation (a two-letter code), used only for aggregate counts.
export function countryFromRequest(req: any): string | null {
  const candidates = [req.headers['x-vercel-ip-country'], req.headers['cf-ipcountry'], req.query?.vc_country];
  for (const value of candidates) if (typeof value === 'string' && /^[A-Z]{2}$/.test(value)) return value;
  return null;
}

export function createTrafficRouter() {
  const router = Router();

  router.post('/event', async (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_EVENT', message: 'Invalid traffic event.' } });
    const { sessionId, path, referrer, deviceType, eventName, source, medium, campaign, referralCode } = parsed.data;
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 1000) : null;
    const ipHash = hashIp(typeof req.ip === 'string' ? req.ip : undefined);
    try {
      await db.execute(sql`INSERT INTO traffic_events (id, session_id, path, referrer, user_agent, country, device_type, event_name, source, medium, campaign, referral_code)
        VALUES (${randomUUID()}, ${sessionId}, ${path}, ${referrer ?? null}, ${userAgent}, ${countryFromRequest(req)}, ${deviceType}, ${eventName}, ${source ?? null}, ${medium ?? null}, ${campaign ?? null}, ${referralCode ?? null})`);
      if (referralCode && eventName === 'referral_visit') {
        await db.execute(sql`UPDATE growth_referral_links SET visits = visits + 1, updated_at=CURRENT_TIMESTAMP WHERE code=${referralCode} AND active=true`);
      }
      if (eventName === 'registry_claim_clicked') {
        try {
          const url = new URL(path, 'https://www.softwarepassportregistry.com');
          const owner = (url.searchParams.get('owner') || '').slice(0,100);
          const repository = (url.searchParams.get('repo') || '').slice(0,100);
          if (owner && repository) {
            await db.execute(sql`INSERT INTO growth_registry_claims (id,tenant_id,repository_owner,repository_name,source,status,session_id)
              VALUES (${randomUUID()}, 'tenant-free-review-system', ${owner}, ${repository}, 'registry', 'clicked', ${sessionId})`);
          }
        } catch { /* malformed paths are already rejected by schema length; claim attribution is best-effort */ }
      }
      return res.status(202).json({ accepted: true });
    } catch (error) {
      // Drizzle's message is only the failed SQL and its params; the real
      // Postgres error (undefined_table, insufficient_privilege, an RLS
      // denial) lives on .cause. Logging only the message left this route
      // failing in production with nothing to diagnose it from, which defeats
      // the point of answering 5xx below.
      const cause = (error as { cause?: unknown })?.cause as
        | { code?: string; message?: string; detail?: string; table?: string }
        | undefined;
      console.error('[SPR] traffic event failed', {
        error: error instanceof Error ? error.message : String(error),
        causeCode: cause?.code ?? null,
        causeMessage: cause?.message ?? null,
        causeDetail: cause?.detail ?? null,
        causeTable: cause?.table ?? null,
        ipHash,
      });
      // Do not report a failed write as accepted. The client may be using
      // sendBeacon, so there is no response handler to recover a swallowed
      // failure; a 5xx keeps the contract truthful for fetch/probes and makes
      // production monitoring alertable instead of silently recording zero.
      return res.status(503).json({ error: { code: 'TRAFFIC_STORAGE_UNAVAILABLE', message: 'Traffic telemetry is temporarily unavailable.' } });
    }
  });

  router.get('/growth/funnel', requireAuth, requireRole(['Owner', 'Admin']), requireFounder, rateLimiter, async (_req, res) => {
    try {
      const funnel = await db.execute(sql`
        SELECT event_name AS "eventName", COUNT(*)::int AS events, COUNT(DISTINCT session_id)::int AS sessions
        FROM traffic_events
        WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        GROUP BY event_name ORDER BY events DESC
      `);
      const attribution = await db.execute(sql`
        SELECT COALESCE(source,'direct') AS source, COALESCE(medium,'unknown') AS medium,
               COALESCE(campaign,'') AS campaign, COUNT(DISTINCT session_id)::int AS sessions,
               COUNT(*) FILTER (WHERE event_name IN ('lead_captured','signup_completed','pilot_started','customer_created'))::int AS conversions
        FROM traffic_events
        WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        GROUP BY COALESCE(source,'direct'), COALESCE(medium,'unknown'), COALESCE(campaign,'')
        ORDER BY conversions DESC, sessions DESC LIMIT 50
      `);
      return res.json({ funnel: (funnel as any).rows ?? [], attribution: (attribution as any).rows ?? [], generatedAt: new Date().toISOString() });
    } catch (error) {
      return res.status(503).json({ error: { code: 'GROWTH_ANALYTICS_UNAVAILABLE', message: 'Growth analytics are temporarily unavailable.' } });
    }
  });

  // Site-wide traffic across every tenant's marketing pages is platform
  // business data, not this customer's data -- 'Owner' is a per-tenant role
  // (every paying MSP customer has one), so requireRole alone let any
  // customer's Owner/Admin pull cross-tenant analytics with no tenant filter
  // at all. requireFounder restricts this to the platform operator, matching
  // every other cross-tenant endpoint (/founder/overview, /founder/passports).
  router.get('/summary', requireAuth, requireRole(['Owner', 'Admin']), requireFounder, rateLimiter, async (_req, res) => {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 minutes')::int AS active_events,
        COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 minutes')::int AS active_sessions,
        COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS users_24h,
        COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS pageviews_24h,
        COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')::int AS users_7d,
        COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')::int AS pageviews_7d
      FROM traffic_events
    `);
    const topPages = await db.execute(sql`
      SELECT path, COUNT(*)::int AS views FROM traffic_events
      WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
      GROUP BY path ORDER BY views DESC LIMIT 20
    `);
    return res.json({ summary: (result as any).rows?.[0] ?? {}, topPages: (topPages as any).rows ?? [] });
  });

  return router;
}
