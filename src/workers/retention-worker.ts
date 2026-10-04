import { createClient } from '@supabase/supabase-js';
import { createWorkerPool } from './worker-db.ts';

const INTAKE_BUCKET = process.env.SPR_INTAKE_BUCKET?.trim() || 'spr-intake';
const FREE_REVIEW_TENANT_ID = 'tenant-free-review-system';

function positiveIntEnv(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
}

const INVENTORY_RETENTION_BATCH = positiveIntEnv('SCAN_FILE_INVENTORY_RETENTION_BATCH', 5_000, 100, 50_000);
const FREE_REVIEW_INVENTORY_HOURS = positiveIntEnv('FREE_REVIEW_INVENTORY_RETENTION_HOURS', 24, 2, 24 * 30);
const RETENTION_POLL_MS = positiveIntEnv('RETENTION_POLL_MS', 60 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);

function intakeStorage() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function purgeExpiredAnonymousIntake(pool: ReturnType<typeof createWorkerPool>): Promise<number> {
  const expired = await pool.query(`SELECT id FROM intake_sessions WHERE tenant_id IS NULL AND status='OPEN' AND expires_at < CURRENT_TIMESTAMP ORDER BY expires_at ASC LIMIT 100`);
  if (expired.rows.length === 0) return 0;
  const storage = intakeStorage();
  if (!storage) {
    console.info('[Retention] intake storage not configured; skipping anonymous intake object purge');
    return 0;
  }
  let purged = 0;
  for (const session of expired.rows) {
    const items = await pool.query(`SELECT id, storage_bucket, storage_path FROM intake_items WHERE session_id=$1 AND tenant_id IS NULL AND status IN ('AWAITING_UPLOAD','UPLOADED')`, [session.id]);
    for (const item of items.rows) {
      const removed = await storage.storage.from(item.storage_bucket || INTAKE_BUCKET).remove([item.storage_path]);
      if (removed.error) throw new Error(`INTAKE_STORAGE_PURGE_FAILED:${removed.error.message}`);
    }
    await pool.query(`UPDATE intake_items SET status='PURGED' WHERE session_id=$1 AND tenant_id IS NULL AND status IN ('AWAITING_UPLOAD','UPLOADED')`, [session.id]);
    await pool.query(`UPDATE intake_sessions SET status='EXPIRED' WHERE id=$1 AND tenant_id IS NULL AND status='OPEN' AND expires_at < CURRENT_TIMESTAMP`, [session.id]);
    purged++;
  }
  return purged;
}

/**
 * scan_file_inventory is derived scan detail, not the evidence ledger.
 *
 * Keep it bounded independently from evidence/findings/passports:
 * - anonymous Free Review inventory expires quickly because its signed result URL
 *   is short lived and every review otherwise creates a new permanent passport;
 * - tenant inventory follows that tenant's explicit evidence_days policy;
 * - missing tenant policy means retain indefinitely (same fail-safe as object_files);
 * - deletion is batched so retention cannot create a giant transaction/WAL spike.
 *
 * scan_coverage, scans, findings, evidence_items and passports are intentionally
 * untouched. They remain the durable record of what the scan established.
 */
export async function purgeExpiredScanFileInventory(
  pool: ReturnType<typeof createWorkerPool>,
): Promise<{ deleted: number; remaining: number; inventoryBytes: number; databaseBytes: number }> {
  const removed = await pool.query(
    `WITH candidates AS (
       SELECT i.id
       FROM scan_file_inventory i
       WHERE
         (
           i.tenant_id = $1
           AND i.updated_at < CURRENT_TIMESTAMP - ($2::text || ' hours')::interval
         )
         OR
         (
           i.tenant_id <> $1
           AND EXISTS (
             SELECT 1
             FROM retention_policies r
             WHERE r.tenant_id = i.tenant_id
               AND i.updated_at < CURRENT_TIMESTAMP - (r.evidence_days || ' days')::interval
           )
         )
       LIMIT $3
     )
     DELETE FROM scan_file_inventory i
     USING candidates c
     WHERE i.id = c.id
     RETURNING i.id`,
    [FREE_REVIEW_TENANT_ID, FREE_REVIEW_INVENTORY_HOURS, INVENTORY_RETENTION_BATCH],
  );

  const stats = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM scan_file_inventory) AS remaining,
       pg_total_relation_size('public.scan_file_inventory')::bigint AS inventory_bytes,
       pg_database_size(current_database())::bigint AS database_bytes`,
  );
  const row = stats.rows[0] || {};
  const result = {
    deleted: removed.rowCount || 0,
    remaining: Number(row.remaining || 0),
    inventoryBytes: Number(row.inventory_bytes || 0),
    databaseBytes: Number(row.database_bytes || 0),
  };
  console.info('[Retention] scan file inventory capacity', JSON.stringify(result));
  return result;
}

export async function runRetentionWorkerLoop(): Promise<void> {
  const pool = createWorkerPool();
  try {
    await pool.query(`DELETE FROM notification_outbox n USING retention_policies r WHERE n.tenant_id=r.tenant_id AND n.created_at < CURRENT_TIMESTAMP - (r.notification_days || ' days')::interval`);
    await pool.query(`DELETE FROM billing_audit_events b USING retention_policies r WHERE b.tenant_id=r.tenant_id AND b.created_at < CURRENT_TIMESTAMP - (r.audit_days || ' days')::interval`);
    // Missing retention policy means retain indefinitely. Never interpret a
    // missing evidence_days value as zero days, which would delete every
    // active object for an otherwise valid tenant on the next worker pass.
    await pool.query(`UPDATE object_files o SET status='DELETED', deleted_at=CURRENT_TIMESTAMP WHERE o.status='ACTIVE' AND EXISTS (SELECT 1 FROM retention_policies r WHERE r.tenant_id=o.tenant_id AND o.created_at < CURRENT_TIMESTAMP - (r.evidence_days || ' days')::interval)`);
    // Public contact-form messages are not tenant data: the /data-retention/
    // page commits to deleting them after 12 months, and this is where that
    // happens.
    await pool.query(`DELETE FROM contact_inquiries WHERE created_at < CURRENT_TIMESTAMP - interval '365 days'`);
    await purgeExpiredAnonymousIntake(pool);
    await purgeExpiredScanFileInventory(pool);
  } finally { await pool.end(); }
  await new Promise(resolve => setTimeout(resolve, RETENTION_POLL_MS));
}
