import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { requireAuth, requireRole } from '../middleware/security.ts';

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
      console.error('[SPR] traffic event failed', { error: error instanceof Error ? error.message : String(error), ipHash });
      return res.status(202).json({ accepted: false });
    }
  });

  router.get('/summary', requireAuth, requireRole(['Owner', 'Admin']), async (_req, res) => {
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
