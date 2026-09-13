import os from 'node:os';
import { createWorkerPool } from './worker-db.ts';
import { calculateBackoff, researchUrl, DISTRIBUTION_TENANT_ID, enqueueDistributionJob } from '../lib/distribution-engine.ts';

const POLL_MS = Math.max(250, Number.parseInt(process.env.DISTRIBUTION_POLL_MS ?? '1000', 10) || 1000);
const CONCURRENCY = Math.max(1, Math.min(50, Number.parseInt(process.env.DISTRIBUTION_CONCURRENCY ?? '10', 10) || 10));
const LEAD_SWEEP_MS = Math.max(60_000, Number.parseInt(process.env.DISTRIBUTION_LEAD_SWEEP_MS ?? '300000', 10) || 300_000);
const WORKER_ID = `distribution-${os.hostname()}-${process.pid}`;

async function notifySlack(message: string) {
  const webhook = process.env.DISTRIBUTION_SLACK_WEBHOOK_URL?.trim();
  if (!webhook) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(webhook, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: message.slice(0, 3_000) }) });
  } catch (error) {
    console.error('[Distribution] Slack alert failed:', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

async function claimJob(pool: ReturnType<typeof createWorkerPool>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [DISTRIBUTION_TENANT_ID]);
    const result = await client.query(`SELECT id, kind, payload, attempts, max_attempts FROM distribution_jobs WHERE status = 'queued' AND available_at <= CURRENT_TIMESTAMP ORDER BY available_at ASC, created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`);
    const job = result.rows[0];
    if (!job) {
      await client.query('ROLLBACK');
      return null;
    }
    const attempts = Number(job.attempts) + 1;
    await client.query(`UPDATE distribution_jobs SET status = 'running', attempts = $2, locked_at = CURRENT_TIMESTAMP, locked_by = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id, attempts, WORKER_ID]);
    await client.query('COMMIT');
    return { ...job, attempts };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function updateJob(pool: ReturnType<typeof createWorkerPool>, jobId: string, values: { status: string; result?: unknown; error?: string; delayMs?: number }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [DISTRIBUTION_TENANT_ID]);
    if (values.status === 'succeeded') {
      await client.query(`UPDATE distribution_jobs SET status = 'succeeded', result = $2::jsonb, last_error = NULL, locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'running'`, [jobId, JSON.stringify(values.result ?? null)]);
    } else {
      await client.query(`UPDATE distribution_jobs SET status = $2, available_at = CASE WHEN $2 = 'queued' THEN CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond') ELSE available_at END, last_error = $4, locked_at = NULL, locked_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'running'`, [jobId, values.status, values.delayMs ?? 0, values.error ?? null]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finishJob(pool: ReturnType<typeof createWorkerPool>, jobId: string, result: unknown) {
  await updateJob(pool, jobId, { status: 'succeeded', result });
  if (result && typeof result === 'object' && 'score' in result && Number((result as { score?: unknown }).score) >= 70) {
    const lead = result as { score: number; company?: string; url?: string };
    await notifySlack(`SPR distribution: high-priority opportunity observed (score ${lead.score}).${lead.company ? ` Company: ${lead.company}.` : ''}${lead.url ? ` Source: ${lead.url}.` : ''} Review the evidence before contacting.`);
  }
}

async function failJob(pool: ReturnType<typeof createWorkerPool>, job: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.max_attempts;
  await updateJob(pool, job.id, { status: dead ? 'dead_letter' : 'queued', delayMs: calculateBackoff(job.attempts), error: message.slice(0, 2000) });
  if (dead) await notifySlack(`SPR distribution: job ${job.id} moved to dead-letter after ${job.attempts} attempts. Error: ${message.slice(0, 500)}`);
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
      await finishJob(pool, job.id, { leadId: payload.leadId, company: company || null, score, businessEmail, observedAt: new Date().toISOString() });
    } else if (job.kind === 'prepare_outreach') {
      await finishJob(pool, job.id, { status: 'prepared_only', observedAt: new Date().toISOString() });
    } else {
      throw new Error(`DISTRIBUTION_UNKNOWN_JOB_KIND:${job.kind}`);
    }
  } catch (error) {
    await failJob(pool, job, error);
  }
  return true;
}

async function sweepFreeReviewLeads(pool: ReturnType<typeof createWorkerPool>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [DISTRIBUTION_TENANT_ID]);
    const result = await client.query(`SELECT l.id, l.name, l.email, l.company FROM free_review_leads l WHERE l.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM distribution_jobs j WHERE j.tenant_id = $1 AND j.kind = 'qualify_lead' AND j.payload->>'leadId' = l.id AND j.status IN ('queued','running','succeeded')) ORDER BY l.created_at ASC LIMIT 100`, [DISTRIBUTION_TENANT_ID]);
    await client.query('COMMIT');
    for (const lead of result.rows) await enqueueDistributionJob(pool, 'qualify_lead', { leadId: lead.id, name: lead.name, email: lead.email, company: lead.company ?? '' });
    return result.rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function runDistributionWorkerLoop() {
  const pool = createWorkerPool();
  let nextLeadSweep = 0;
  try {
    while (true) {
      const now = Date.now();
      if (now >= nextLeadSweep) {
        try {
          const count = await sweepFreeReviewLeads(pool);
          if (count > 0) console.info(`[Distribution] queued ${count} Free Review lead qualification jobs`);
        } catch (error) {
          console.error('[Distribution] lead sweep failed:', error instanceof Error ? error.message : String(error));
        }
        nextLeadSweep = now + LEAD_SWEEP_MS;
      }
      const batch = await Promise.all(Array.from({ length: CONCURRENCY }, () => processJob(pool)));
      if (!batch.some(Boolean)) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } finally {
    await pool.end();
  }
}
