import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import { Pool } from 'pg';
import { decryptCredential } from '../security/credential-vault.ts';
import { buildWebhookSignatureHeader } from '../security/webhook-signing.ts';
import { validateWebhookUrl } from '../security/webhook-url.ts';

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 6;
const MAX_BODY_BYTES = 64 * 1024;
const DISABLE_AFTER_FAILURES = 10;

function safeError(code: string, message: string) {
  return { code, message: message.slice(0, 500).replace(/https?:\/\/[^\s]+/gi, '[url]') };
}

function backoffSeconds(attempt: number) {
  return Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
}

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((n, octet) => (n * 256) + Number(octet), 0) >>> 0;
}

function blockedIpv4(ip: string) {
  const n = ipv4ToNumber(ip);
  return [
    ['10.0.0.0', '10.255.255.255'], ['100.64.0.0', '100.127.255.255'],
    ['127.0.0.0', '127.255.255.255'], ['169.254.0.0', '169.254.255.255'],
    ['172.16.0.0', '172.31.255.255'], ['192.0.0.0', '192.0.0.255'],
    ['192.0.2.0', '192.0.2.255'], ['192.168.0.0', '192.168.255.255'],
    ['198.18.0.0', '198.19.255.255'], ['198.51.100.0', '198.51.100.255'],
    ['203.0.113.0', '203.0.113.255'], ['224.0.0.0', '255.255.255.255'],
  ].some(([start, end]) => n >= ipv4ToNumber(start) && n <= ipv4ToNumber(end));
}

function blockedIpv6(ip: string) {
  const normalized = ip.toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::') return true;
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(normalized)) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    return net.isIP(mapped) === 4 && blockedIpv4(mapped);
  }
  return false;
}

function blockedAddress(address: string) {
  const family = net.isIP(address);
  return family === 4 ? blockedIpv4(address) : family === 6 ? blockedIpv6(address) : true;
}

async function resolvePublicHost(hostname: string) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => blockedAddress(record.address))) throw new Error('WEBHOOK_DNS_BLOCKED');
  // The selected address is pinned into the HTTPS connection below. This closes
  // the validation-to-connect DNS rebinding window: even if DNS changes after
  // this point, the socket cannot be redirected to the new address.
  return records[0];
}

function requestPinned(url: URL, ip: string, payload: string, headers: Record<string, string>): Promise<{ status: number; ms: number }> {
  if (blockedAddress(ip)) return Promise.reject(new Error('WEBHOOK_DNS_BLOCKED'));
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, ip, ip.includes(':') ? 6 : 4),
      timeout: DELIVERY_TIMEOUT_MS,
      headers: {
        ...headers,
        host: url.hostname,
        'content-length': Buffer.byteLength(payload).toString(),
      },
      maxRedirects: 0,
    } as any, response => {
      let size = 0;
      response.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > MAX_BODY_BYTES) response.destroy(new Error('WEBHOOK_RESPONSE_TOO_LARGE')); });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode || 0, ms: Date.now() - started }));
    });
    req.on('timeout', () => req.destroy(new Error('WEBHOOK_TIMEOUT')));
    req.on('error', reject);
    req.end(payload);
  });
}

export async function deliverWebhookOnce(pool: Pool, deliveryId: string) {
  const claimed = await pool.query(`
    UPDATE spr_webhook_deliveries d
    SET status = 'running', started_at = $2
    FROM spr_webhooks w
    WHERE d.id = $1 AND d.tenant_id = w.tenant_id AND d.webhook_id = w.id
      AND d.status = 'queued' AND d.next_attempt_at::timestamptz <= $2::timestamptz
      AND w.active = true AND w.secret_ciphertext IS NOT NULL
    RETURNING d.*, w.url, w.events, w.secret_ciphertext, w.secret_key_version, w.consecutive_failure_count
  `, [deliveryId, new Date().toISOString()]);
  const row: any = claimed.rows[0];
  if (!row) return false;

  try {
    const url = await validateWebhookUrl(row.url);
    // Re-resolve immediately before connecting and validate every answer. The
    // resulting address is then pinned, so DNS cannot change the destination
    // between validation and the actual socket connection.
    const resolved = await resolvePublicHost(url.hostname);
    const secret = decryptCredential<string>(row.secret_ciphertext, row.tenant_id, 'webhook');
    const payload = JSON.stringify({
      id: row.event_id,
      type: row.event_type,
      createdAt: row.created_at,
      data: row.payload ? JSON.parse(row.payload) : {},
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = buildWebhookSignatureHeader(secret, payload, timestamp);
    const result = await requestPinned(url, resolved.address, payload, {
      'content-type': 'application/json',
      'user-agent': 'SPR-Webhook/1.0',
      'x-spr-event-id': row.event_id,
      'x-spr-signature': signature,
      'x-spr-signature-version': 'v1',
    });

    if (result.status >= 200 && result.status < 300) {
      await pool.query(`UPDATE spr_webhook_deliveries SET status='succeeded', response_status=$2, response_ms=$3, completed_at=$4 WHERE id=$1 AND tenant_id=$5`, [deliveryId, result.status, result.ms, new Date().toISOString(), row.tenant_id]);
      await pool.query(`UPDATE spr_webhooks SET consecutive_failure_count=0 WHERE id=$1 AND tenant_id=$2 AND active=true`, [row.webhook_id, row.tenant_id]);
      return true;
    }

    const retryable = result.status === 408 || result.status === 409 || result.status === 425 || result.status === 429 || result.status >= 500;
    throw Object.assign(new Error(`HTTP_${result.status}`), { retryable });
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : 'WEBHOOK_DELIVERY_FAILED';
    const retryable = error instanceof Error && 'retryable' in error ? Boolean((error as any).retryable) : true;
    const nextAttempt = Number(row.attempt_number) + 1;
    const dead = !retryable || nextAttempt >= MAX_ATTEMPTS;
    const next = new Date(Date.now() + backoffSeconds(nextAttempt) * 1000).toISOString();
    const safe = safeError(code, error instanceof Error ? error.message : String(error));
    await pool.query(`
      UPDATE spr_webhook_deliveries
      SET status=$2, attempt_number=$3, safe_error_code=$4, safe_error_message=$5,
          next_attempt_at=$6, completed_at=CASE WHEN $2='dead_lettered' THEN $7 ELSE completed_at END
      WHERE id=$1 AND tenant_id=$8 AND status='running'
    `, [deliveryId, dead ? 'dead_lettered' : 'queued', nextAttempt, safe.code, safe.message, next, new Date().toISOString(), row.tenant_id]);
    const failure = await pool.query(`
      UPDATE spr_webhooks SET consecutive_failure_count=consecutive_failure_count+1,
        active=CASE WHEN consecutive_failure_count+1 >= $3 THEN false ELSE active END,
        disabled_at=CASE WHEN consecutive_failure_count+1 >= $3 THEN $4 ELSE disabled_at END
      WHERE id=$1 AND tenant_id=$2 AND active=true RETURNING consecutive_failure_count
    `, [row.webhook_id, row.tenant_id, DISABLE_AFTER_FAILURES, new Date().toISOString()]);
    if ((failure.rows[0]?.consecutive_failure_count || 0) >= DISABLE_AFTER_FAILURES) {
      console.warn('[Webhook] endpoint disabled after repeated failures', { webhookId: row.webhook_id, tenantId: row.tenant_id });
    }
    return true;
  }
}

export async function enqueueWebhookDelivery(pool: Pool, input: { tenantId: string; webhookId: string; eventId: string; eventType: string; payload: unknown }) {
  const idempotencyKey = crypto.createHash('sha256').update(`${input.tenantId}:${input.webhookId}:${input.eventId}`).digest('hex');
  await pool.query(`
    INSERT INTO spr_webhook_deliveries (id, tenant_id, webhook_id, event_id, event_type, payload, idempotency_key, attempt_number, status, next_attempt_at, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,1,'queued',$8,$8)
    ON CONFLICT (tenant_id, webhook_id, idempotency_key) DO NOTHING
  `, [`wh-delivery-${crypto.randomUUID()}`, input.tenantId, input.webhookId, input.eventId, input.eventType, JSON.stringify(input.payload ?? {}), idempotencyKey, new Date().toISOString()]);
}

export async function runWebhookWorkerLoop() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, host: process.env.DATABASE_URL ? undefined : process.env.SQL_HOST, user: process.env.DATABASE_URL ? undefined : process.env.SQL_USER, password: process.env.DATABASE_URL ? undefined : process.env.SQL_PASSWORD, database: process.env.DATABASE_URL ? undefined : process.env.SQL_DB_NAME });
  try {
    for (;;) {
      const due = await pool.query(`SELECT id FROM spr_webhook_deliveries WHERE status='queued' AND next_attempt_at::timestamptz <= CURRENT_TIMESTAMP ORDER BY next_attempt_at::timestamptz LIMIT 25`);
      if (!due.rows.length) { await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
      for (const row of due.rows) await deliverWebhookOnce(pool, row.id);
    }
  } finally { await pool.end(); }
}
