import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { appPool } from '../db/index.ts';
import { DISTRIBUTION_TENANT_ID } from '../lib/distribution-engine.ts';

// Resend/Svix signs "id.timestamp.raw-body"; verify before parsing the event.
// The inbound email body is never fetched or handed to an agent. A verified
// webhook only pauses further outreach for an already-contacted address.
export function verifyResendInbound(payload: Buffer, headers: Record<string, string | string[] | undefined>, secret: string, nowMs = Date.now()): boolean {
  try {
    const id = headers['svix-id'];
    const timestamp = headers['svix-timestamp'];
    const signature = headers['svix-signature'];
    if (typeof id !== 'string' || !/^[\w-]{6,200}$/.test(id)
      || typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp)
      || typeof signature !== 'string') return false;
    if (Math.abs(nowMs - Number(timestamp) * 1000) > 300_000) return false;
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    if (key.length < 16) return false;
    const expected = createHmac('sha256', key).update(id + '.' + timestamp + '.' + payload.toString('utf8')).digest();
    return signature.split(' ').some((part) => {
      if (!part.startsWith('v1,')) return false;
      const given = Buffer.from(part.slice(3), 'base64');
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  } catch { return false; }
}

export function inboundReplySender(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  // No free-text email content is trusted. Only exact email address format
  // is accepted; name-formatted From addresses require separate review.
  const rawFrom = typeof row.from === 'string' ? row.from.trim().toLowerCase() : '';
  const from = rawFrom.includes('<') && rawFrom.endsWith('>') ? rawFrom.slice(rawFrom.lastIndexOf('<') + 1, -1) : rawFrom;
  const to = Array.isArray(row.to) ? row.to : typeof row.to === 'string' ? [row.to] : [];
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(from)) return null;
  const receivingAddress = (process.env.DISTRIBUTION_INBOUND_ADDRESS || 'replies@replies.softwarepassportregistry.com').trim().toLowerCase();
  if (!to.some((item) => typeof item === 'string' && item.trim().toLowerCase() === receivingAddress)) return null;
  return from;
}

export function createResendInboundRouter() {
  const router = Router();
  router.post('/', async (req: Request, res) => {
    const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim();
    if (!secret) return res.status(503).json({ error: 'INBOUND_WEBHOOK_UNCONFIGURED' });
    if (!Buffer.isBuffer(req.body) || !verifyResendInbound(req.body, req.headers, secret)) {
      return res.status(401).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
    }
    let event: any;
    try { event = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(400).json({ error: 'INVALID_EVENT' }); }
    if (event?.type !== 'email.received') return res.status(200).json({ accepted: true, ignored: true });
    const from = inboundReplySender(event.data);
    if (!from) return res.status(200).json({ accepted: true, ignored: true });
    const client = await appPool.connect().catch(() => null);
    if (!client) return res.status(503).json({ error: 'DB_UNAVAILABLE' });
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [DISTRIBUTION_TENANT_ID]);
      const outcome = await client.query(`
        UPDATE distribution_contacts c
           SET pipeline_stage='replied', replied_at=CURRENT_TIMESTAMP,
               next_followup_at=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE c.tenant_id=$1 AND lower(c.email)=$2
           AND c.status='active' AND c.replied_at IS NULL
           AND c.pipeline_stage IN ('contacted','qualified')
           AND EXISTS (
             SELECT 1 FROM distribution_messages m
             WHERE m.tenant_id=c.tenant_id AND m.contact_id=c.id
               AND m.kind='initial' AND m.status='sent'
           )
         RETURNING c.id`, [DISTRIBUTION_TENANT_ID, from]);
      await client.query('COMMIT');
      // Never disclose which addresses are in the CRM.
      console.info('[DistributionInbound] authenticated inbound signal', { matched: outcome.rowCount ?? 0 });
      return res.status(200).json({ accepted: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[DistributionInbound] processing failed', error instanceof Error ? error.message : String(error));
      return res.status(503).json({ error: 'INBOUND_PROCESSING_FAILED' });
    } finally { client.release(); }
  });
  return router;
}
