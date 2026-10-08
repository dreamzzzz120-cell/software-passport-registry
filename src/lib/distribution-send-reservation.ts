import { createHash } from 'node:crypto';
import { EmailProviderError } from './branded-email.ts';

type Client = { query: (text: string, params?: any[]) => Promise<any>; release: () => void };
type Pool = { connect: () => Promise<Client> };
export class DistributionDeferredError extends Error {
  constructor(message: string, public readonly delayMs = 300_000) { super(message); }
}

export type SendReservation = {
  id: string;
  kind: 'initial' | 'followup';
  sequence: number;
  followupDelayDays: number;
  maxFollowups: number;
};

async function transaction<T>(pool: Pool, tenantId: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

const STOPPED_STAGES = new Set(['replied','demo','checkout','pilot','customer','lost']);

async function lockedContact(client: Client, tenantId: string, contactId: string) {
  const result = await client.query(`SELECT *, next_followup_at <= CURRENT_TIMESTAMP AS followup_due FROM distribution_contacts WHERE id=$1 AND tenant_id=$2 LIMIT 1 FOR UPDATE`, [contactId, tenantId]);
  const contact = result.rows?.[0];
  if (!contact || contact.status !== 'active' || STOPPED_STAGES.has(contact.pipeline_stage)) throw new Error('DISTRIBUTION_CONTACT_NOT_ACTIVE');
  return contact;
}

/**
 * All initial/follow-up sends share the campaign-row lock for capacity
 * reservation. The external call cannot roll back that reservation. Unknown
 * outcomes are held indefinitely, including past provider key expiration.
 */
export async function withReservedOutreach<T>(
  pool: Pool, tenantId: string, contactId: string, kind: SendReservation['kind'],
  options: {
    environmentLimit: number;
    intervalMs: number;
    gate: (client: Client, contact: any) => Promise<void>;
    send: (client: Client, contact: any, reservation: SendReservation, markProviderAttempt: () => void) => Promise<T>;
  },
): Promise<T> {
  const reservation = await transaction(pool, tenantId, async (client) => {
    // Shared across processes/replicas. Always settings before contact to
    // avoid a reservation/delivery lock-order deadlock.
    const settingsResult = await client.query(`SELECT *,
      EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-last_send_reserved_at))*1000 AS since_last_ms
      FROM distribution_campaign_settings WHERE tenant_id=$1 FOR UPDATE`, [tenantId]);
    const settings = settingsResult.rows?.[0];
    if (!settings || settings.outreach_enabled !== true) throw new DistributionDeferredError('DISTRIBUTION_OUTREACH_PAUSED');
    const contact = await lockedContact(client, tenantId, contactId);
    await options.gate(client, contact);
    const prior = await client.query(`SELECT 1 FROM distribution_messages WHERE tenant_id=$1 AND contact_id=$2 AND kind='initial' AND status='sent' LIMIT 1`, [tenantId, contactId]);
    if (kind === 'initial' && prior.rows.length) throw new Error('DISTRIBUTION_INITIAL_ALREADY_SENT');
    if (kind === 'followup' && (!prior.rows.length || !contact.followup_due || Number(contact.followup_count) >= Number(settings.max_followups))) throw new Error('DISTRIBUTION_FOLLOWUP_NOT_DUE');
    const sequence = kind === 'initial' ? 0 : Number(contact.followup_count) + 1;
    const id = `ds_${createHash('sha256').update(JSON.stringify([tenantId, contactId, kind, sequence])).digest('hex')}`;
    const existing = await client.query(`SELECT status,retry_at > CURRENT_TIMESTAMP AS cooling_down FROM distribution_send_attempts WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (existing.rows[0] && existing.rows[0].status !== 'retryable') throw new Error('DISTRIBUTION_SEND_ALREADY_RESERVED');
    if (existing.rows[0]?.cooling_down) throw new DistributionDeferredError('DISTRIBUTION_PROVIDER_RETRY_WAIT', 60_000);

    const count = await client.query(`SELECT (
      (SELECT COUNT(*) FROM distribution_messages WHERE tenant_id=$1 AND status='sent'
        AND COALESCE(sent_at,created_at) >= date_trunc('day',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) +
      (SELECT COUNT(*) FROM distribution_send_attempts WHERE tenant_id=$1 AND status IN ('reserved','unknown'))
    )::int AS used`, [tenantId]);
    const cap = Math.min(options.environmentLimit, Number(settings.daily_send_cap));
    if (!Number.isInteger(cap) || cap < 1 || Number(count.rows[0]?.used ?? 0) >= cap) throw new DistributionDeferredError('DISTRIBUTION_DAILY_SEND_LIMIT_REACHED');
    if (settings.since_last_ms !== null && Number(settings.since_last_ms) < options.intervalMs) throw new DistributionDeferredError('DISTRIBUTION_PROVIDER_PACING', options.intervalMs);

    await client.query(`INSERT INTO distribution_send_attempts (id,tenant_id,contact_id,kind,sequence,status)
      VALUES ($1,$2,$3,$4,$5,'reserved') ON CONFLICT (id) DO UPDATE
      SET status='reserved',reserved_at=CURRENT_TIMESTAMP,retry_at=NULL,error=NULL,updated_at=CURRENT_TIMESTAMP`, [id,tenantId,contactId,kind,sequence]);
    await client.query(`UPDATE distribution_campaign_settings SET last_send_reserved_at=CURRENT_TIMESTAMP WHERE tenant_id=$1`, [tenantId]);
    return { id, kind, sequence, followupDelayDays: Number(settings.followup_delay_days), maxFollowups: Number(settings.max_followups) };
  });

  let providerAttempted = false;
  try {
    return await transaction(pool, tenantId, async (client) => {
      // Pause and unsubscribe that committed before dispatch are observed.
      // A concurrent unsubscribe waits behind this contact lock and prevents
      // subsequent sends; it cannot retract an already-dispatched email.
      const settings = await client.query(`SELECT outreach_enabled FROM distribution_campaign_settings WHERE tenant_id=$1 FOR SHARE`, [tenantId]);
      if (settings.rows?.[0]?.outreach_enabled !== true) throw new DistributionDeferredError('DISTRIBUTION_OUTREACH_PAUSED');
      const contact = await lockedContact(client, tenantId, contactId);
      await options.gate(client, contact);
      if (kind === 'followup' && (!contact.followup_due || Number(contact.followup_count) + 1 !== reservation.sequence)) throw new Error('DISTRIBUTION_FOLLOWUP_NOT_DUE');
      const result = await options.send(client, contact, reservation, () => { providerAttempted = true; });
      await client.query(`UPDATE distribution_send_attempts SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2`, [reservation.id,tenantId]);
      return result;
    });
  } catch (error) {
    // Only a definite rate-limit rejection is retried automatically. Timeouts,
    // 5xx, malformed success, commit failures and abandoned reservations stay
    // blocked for provider/ledger reconciliation, never replayed blindly.
    const retryable = (!providerAttempted && error instanceof DistributionDeferredError)
      || (providerAttempted && error instanceof EmailProviderError && error.status === 429);
    const status = retryable ? 'retryable' : providerAttempted ? 'unknown' : 'blocked';
    await transaction(pool, tenantId, async (client) => {
      await client.query(`UPDATE distribution_send_attempts SET status=$3,error=$4,
        retry_at=CASE WHEN $3='retryable' THEN CURRENT_TIMESTAMP+INTERVAL '60 seconds' ELSE NULL END,
        updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2 AND status='reserved'`,
      [reservation.id,tenantId,status,error instanceof Error ? error.message.slice(0,2000) : String(error).slice(0,2000)]);
    }).catch(() => undefined); // Durable 'reserved' still blocks if DB is down.
    if (retryable) throw new DistributionDeferredError('DISTRIBUTION_PROVIDER_RETRY_WAIT',60_000);
    throw error;
  }
}
