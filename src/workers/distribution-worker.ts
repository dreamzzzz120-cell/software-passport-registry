import os from 'node:os';
import { createWorkerPool } from './worker-db.ts';
import { calculateBackoff, researchUrl, DISTRIBUTION_TENANT_ID } from '../lib/distribution-engine.ts';

const POLL_MS = Math.max(250, Number.parseInt(process.env.DISTRIBUTION_POLL_MS ?? '1000', 10) || 1000);
const CONCURRENCY = Math.max(1, Math.min(50, Number.parseInt(process.env.DISTRIBUTION_CONCURRENCY ?? '10', 10) || 10));
const WORKER_ID = `distribution-${os.hostname()}-${process.pid}`;

async function claimJob(pool: ReturnType<typeof createWorkerPool>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [DISTRIBUTION_TENANT_ID]);
    const result = await client.query(
      `SELECT id, kind, payload, attempts, max_attempts
       FROM distribution_jobs
       WHERE status = 'queued' AND available_at <= CURRENT_TIMESTAMP
       ORDER BY available_at ASC, created_at ASC
       FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const job = result.rows[0];
    if (!job) {
      await client.query('ROLLBACK');
      return null;
    }
    const attempts = Number(job.attempts) + 1;
    await client.query(
      `UPDATE distribution_jobs
       SET status = 'running', attempts = $2, locked_at = CURRENT_TIMESTAMP,
           locked_by = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [job.id, attempts, WORKER_ID],
    );
    await client.query('COMMIT');
    return { ...job, attempts };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finishJob(pool: ReturnType<typeof createWorkerPool>, jobId: string, result: unknown) {
  await pool.query(`SELECT set_config('app.tenant_id', $1, false)`, [DISTRIBUTION_TENANT_ID]);
  await pool.query(
    `UPDATE distribution_jobs
     SET status = 'succeeded', result = $2::jsonb, last_error = NULL,
         locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'running'`,
    [jobId, JSON.stringify(result)],
  );
}

async function failJob(pool: ReturnType<typeof createWorkerPool>, job: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.max_attempts;
  const delay = calculateBackoff(job.attempts);
  await pool.query(`SELECT set_config('app.tenant_id', $1, false)`, [DISTRIBUTION_TENANT_ID]);
  await pool.query(
    `UPDATE distribution_jobs
     SET status = $2, available_at = CASE WHEN $2 = 'queued' THEN CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond') ELSE available_at END,
         last_error = $4, locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'running'`,
    [job.id, dead ? 'dead_letter' : 'queued', delay, message.slice(0, 2000)],
  );
}

async function processJob(pool: ReturnType<typeof createWorkerPool>) {
  const job = await claimJob(pool);
  if (!job) return false;
  try {
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload ?? {};
    if (job.kind === 'research_url') {
      if (typeof payload.url !== 'string') throw new Error('DISTRIBUTION_URL_REQUIRED');
      await finishJob(pool, job.id, await researchUrl(payload.url));
    } else if (job.kind === 'qualify_lead') {
      const email = typeof payload.email === 'string' ? payload.email : '';
      const company = typeof payload.company === 'string' ? payload.company : '';
      const text = `${company} ${email}`.toLowerCase();
      const businessEmail = Boolean(email && !['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','aol.com'].includes(email.split('@')[1] ?? ''));
      const score = (businessEmail ? 25 : 0) + (company ? 10 : 0) + (/msp|managed|it services|cyber|security/.test(text) ? 35 : 0);
      await finishJob(pool, job.id, { score, businessEmail, observedAt: new Date().toISOString() });
    } else if (job.kind === 'prepare_outreach') {
      // Deliberately prepares rather than sends. Outbound delivery must be wired
      // to an approved provider with its own consent, rate and suppression rules.
      await finishJob(pool, job.id, { status: 'prepared_only', observedAt: new Date().toISOString() });
    } else {
      throw new Error(`DISTRIBUTION_UNKNOWN_JOB_KIND:${job.kind}`);
    }
  } catch (error) {
    await failJob(pool, job, error);
  }
  return true;
}

export async function runDistributionWorkerLoop() {
  const pool = createWorkerPool();
  try {
    while (true) {
      const batch = await Promise.all(Array.from({ length: CONCURRENCY }, () => processJob(pool)));
      if (!batch.some(Boolean)) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    await pool.end();
  }
}
