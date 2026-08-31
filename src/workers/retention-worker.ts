import { createWorkerPool } from './worker-db.ts';

export async function runRetentionWorkerLoop(): Promise<void> {
  const pool = createWorkerPool();
  try {
    await pool.query(`DELETE FROM notification_outbox n USING retention_policies r WHERE n.tenant_id=r.tenant_id AND n.created_at < CURRENT_TIMESTAMP - make_interval(days => r.notification_days::double precision)`);
    await pool.query(`DELETE FROM billing_audit_events b USING retention_policies r WHERE b.tenant_id=r.tenant_id AND b.created_at < CURRENT_TIMESTAMP - make_interval(days => r.audit_days::double precision)`);
    await pool.query(`UPDATE object_files o SET status='DELETED', deleted_at=CURRENT_TIMESTAMP WHERE o.status='ACTIVE' AND o.created_at < CURRENT_TIMESTAMP - make_interval(days => COALESCE((SELECT r.evidence_days FROM retention_policies r WHERE r.tenant_id=o.tenant_id LIMIT 1), 0)::double precision)`);
  } finally { await pool.end(); }
  await new Promise(resolve => setTimeout(resolve, Number(process.env.RETENTION_POLL_MS || 86400000)));
}
