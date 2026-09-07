import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { requireAuth, requireRole, requireFounder, rateLimiter } from '../middleware/security.ts';

const eventSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
  path: z.string().min(1).max(500),
  referrer: z.string().max(1000).optional().nullable(),
  deviceType: z.enum(['mobile','tablet','desktop','unknown']).default('unknown'),
});

function hashIp(value: string | undefined): string | null {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex');
}

function countryFromRequest(req: any): string | null {
  const value = req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'];
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : null;
}

export function createTrafficRouter() {
  const router = Router();

  router.post('/event', async (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_EVENT', message: 'Invalid traffic event.' } });
    const { sessionId, path, referrer, deviceType } = parsed.data;
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 1000) : null;
    const ipHash = hashIp(typeof req.ip === 'string' ? req.ip : undefined);
    try {
      await db.execute(sql`INSERT INTO traffic_events (id, session_id, path, referrer, user_agent, country, device_type) VALUES (${randomUUID()}, ${sessionId}, ${path}, ${referrer ?? null}, ${userAgent}, ${countryFromRequest(req)}, ${deviceType})`);
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

  // Site-wide traffic across every tenant's marketing pages is platform
  // business data, not this customer's data -- 'Owner' is a per-tenant role
  // (every paying MSP customer has one), so requireRole alone let any
  // customer's Owner/Admin pull cross-tenant analytics with no tenant filter
  // at all. requireFounder restricts this to the platform operator, matching
  // every other cross-tenant endpoint (/founder/metrics, /founder/passports).
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
