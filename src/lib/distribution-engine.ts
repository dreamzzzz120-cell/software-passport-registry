import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export const DISTRIBUTION_TENANT_ID = 'tenant-free-review-system';
export type DistributionJobKind = 'research_url' | 'qualify_lead' | 'prepare_outreach';

const MAX_PAYLOAD_BYTES = 32_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 256_000;

function assertPayload(payload: Record<string, unknown>) {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('DISTRIBUTION_PAYLOAD_TOO_LARGE');
}

function assertPublicResearchTarget(parsed: URL) {
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1') throw new Error('DISTRIBUTION_PRIVATE_TARGET_BLOCKED');
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) throw new Error('DISTRIBUTION_PRIVATE_TARGET_BLOCKED');
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) throw new Error('DISTRIBUTION_PRIVATE_TARGET_BLOCKED');
}

export async function enqueueDistributionJob(pool: Pool, kind: DistributionJobKind, payload: Record<string, unknown>) {
  assertPayload(payload);
  const id = `dist_${randomUUID().replace(/-/g, '')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [DISTRIBUTION_TENANT_ID]);
    await client.query(
      `INSERT INTO distribution_jobs (id, tenant_id, kind, payload) VALUES ($1, $2, $3, $4::jsonb)`,
      [id, DISTRIBUTION_TENANT_ID, kind, JSON.stringify(payload)],
    );
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueResearchUrl(pool: Pool, url: string) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DISTRIBUTION_URL_SCHEME_NOT_ALLOWED');
  assertPublicResearchTarget(parsed);
  return enqueueDistributionJob(pool, 'research_url', { url: parsed.toString() });
}

async function readBoundedBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('DISTRIBUTION_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function extractResearchSignals(url: URL, html: string) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100_000).toLowerCase();
  const signals = {
    msp: /managed service provider|managed services|managed it\b|it services/.test(text),
    cybersecurity: /cybersecurity|cyber security|managed security|security operations|soc\b/.test(text),
    compliance: /compliance|vulnerability management|risk management|audit readiness|iso 27001|soc 2/.test(text),
    psa: /connectwise|autotask|datto|halo psa|kaseya/.test(text),
    multiClient: /clients|customers|managed endpoints|businesses we serve/.test(text),
  };
  const score = (signals.msp ? 30 : 0) + (signals.cybersecurity ? 20 : 0) + (signals.compliance ? 15 : 0) + (signals.psa ? 15 : 0) + (signals.multiClient ? 10 : 0) + (html.length > 0 ? 10 : 0);
  return { url: url.toString(), httpObserved: true, contentBytes: Buffer.byteLength(html, 'utf8'), signals, score, observedAt: new Date().toISOString() };
}

export async function researchUrl(url: string) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DISTRIBUTION_URL_SCHEME_NOT_ALLOWED');
  assertPublicResearchTarget(parsed);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'SPR-Distribution-Research/1.0 (+https://www.softwarepassportregistry.com)' },
    });
    if (response.status >= 300 && response.status < 400) return { url: parsed.toString(), httpObserved: true, status: response.status, redirected: true, score: null, signals: null, observedAt: new Date().toISOString() };
    const html = await readBoundedBody(response);
    return { ...extractResearchSignals(parsed, html), status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

export function calculateBackoff(attempt: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}
