import type { Pool } from 'pg';

async function sendEmail(destination: string, subject: string, body: string): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [destination], subject, text: body }) });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}:${payload?.message || 'request_failed'}`);
  return String(payload?.id || 'sent');
}

async function sendSms(destination: string, body: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim(); const token = process.env.TWILIO_AUTH_TOKEN?.trim(); const from = process.env.TWILIO_FROM?.trim();
  if (!sid || !token || !from) throw new Error('SMS_PROVIDER_NOT_CONFIGURED');
  const encoded = new URLSearchParams({ To: destination, From: from, Body: body });
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: encoded });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(`SMS_PROVIDER_${response.status}:${payload?.message || 'request_failed'}`);
  return String(payload?.sid || 'sent');
}

export async function runNotificationWorkerLoop(): Promise<void> {
  const poolUrl = (process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL)?.trim();
  if (!poolUrl && !process.env.SQL_HOST) throw new Error('NOTIFICATION_WORKER_DATABASE_NOT_CONFIGURED');
  const { createWorkerPool } = await import('./worker-db.ts');
  const pool: Pool = createWorkerPool();
  try {
    const result = await pool.query(`SELECT id, tenant_id, channel, destination, subject, body, attempts FROM notification_outbox WHERE status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP ORDER BY created_at ASC LIMIT 10`);
    for (const row of result.rows) {
      await pool.query(`UPDATE notification_outbox SET status='PROCESSING', attempts=attempts+1 WHERE id=$1 AND status='PENDING'`, [row.id]);
      try {
        const providerMessageId = row.channel === 'email'
          ? await sendEmail(row.destination, row.subject || 'SPR notification', row.body)
          : await sendSms(row.destination, row.body);
        await pool.query(`UPDATE notification_outbox SET status='SENT', provider_message_id=$2, sent_at=CURRENT_TIMESTAMP WHERE id=$1`, [row.id, providerMessageId]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const delaySeconds = Math.min(3600, 30 * Math.max(1, Number(row.attempts) + 1));
        await pool.query(`UPDATE notification_outbox SET status='PENDING', last_error=$2, available_at=CURRENT_TIMESTAMP + ($3 || ' seconds')::interval WHERE id=$1`, [row.id, message.slice(0, 1000), delaySeconds]);
        console.error('[NotificationWorker] delivery failed:', row.id, message);
      }
    }
  } finally { await pool.end(); }
  await new Promise(resolve => setTimeout(resolve, Number(process.env.NOTIFICATION_POLL_MS || 10000)));
}
