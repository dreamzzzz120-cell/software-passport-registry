import { createClient } from '@supabase/supabase-js';
import { createWorkerPool } from './worker-db.ts';

const INTAKE_BUCKET = process.env.SPR_INTAKE_BUCKET?.trim() || 'spr-intake';

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

export async function runRetentionWorkerOnce(): Promise<void> {
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
  } finally { await pool.end(); }
}

export async function runRetentionWorkerLoop(): Promise<void> {
  const pollMs = Number(process.env.RETENTION_POLL_MS || 86400000);
  for (;;) {
    await runRetentionWorkerOnce();
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
