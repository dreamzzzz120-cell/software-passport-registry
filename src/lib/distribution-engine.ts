import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { Pool } from 'pg';

export const DISTRIBUTION_TENANT_ID = 'tenant-free-review-system';
export type DistributionJobKind = 'research_url' | 'qualify_lead' | 'prepare_outreach' | 'send_outreach' | 'followup_outreach';

const MAX_PAYLOAD_BYTES = 32_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 1_000_000;

function assertPayload(payload: Record<string, unknown>) {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('DISTRIBUTION_PAYLOAD_TOO_LARGE');
}

function isPrivateIp(address: string) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') || normalized.startsWith('ff');
  }
  return true;
}

async function assertPublicResearchTarget(parsed: URL) {
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('DISTRIBUTION_PRIVATE_TARGET_BLOCKED');
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('DISTRIBUTION_PRIVATE_TARGET_BLOCKED');
  if (!net.isIP(host)) {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error('DISTRIBUTION_PRIVATE_TARGET_BLOCKED');
  }
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
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('DISTRIBUTION_RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function publicRoleEmails(html: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/(?:mailto:)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    const email = String(match[1]).toLowerCase();
    const [local, domain] = email.split('@');
    if (!local || !domain || ['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','aol.com'].includes(domain)) continue;
    if (/^(info|sales|hello|contact|security|support|office|admin|marketing|business|partners|partnerships|service|services)$/.test(local)) found.add(email);
  }
  return [...found].slice(0, 5);
}

function extractResearchSignals(url: URL, html: string) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100_000).toLowerCase();
  const signals = {
    msp: /managed service provider|managed services|managed it\\b|it services/.test(text),
    cybersecurity: /cybersecurity|cyber security|managed security|security operations|soc\\b/.test(text),
    compliance: /compliance|vulnerability management|risk management|audit readiness|iso 27001|soc 2/.test(text),
    psa: /connectwise|autotask|datto|halo psa|kaseya/.test(text),
    multiClient: /clients|customers|managed endpoints|businesses we serve/.test(text),
    vendorRisk: /vendor risk|third[- ]party risk|supplier risk|software risk/.test(text),
    softwareSupplyChain: /software supply chain|software composition|sbom|software bill of materials|dependency risk/.test(text),
    procurement: /procurement|vendor assessment|due diligence|third[- ]party assessment/.test(text),
    vCiso: /vcio|vciso|virtual ciso|fractional ciso/.test(text),
  };
  const score = Math.min(100,
    (signals.msp ? 25 : 0) + (signals.cybersecurity ? 15 : 0) + (signals.compliance ? 12 : 0) +
    (signals.psa ? 10 : 0) + (signals.multiClient ? 8 : 0) + (signals.vendorRisk ? 10 : 0) +
    (signals.softwareSupplyChain ? 8 : 0) + (signals.procurement ? 7 : 0) + (signals.vCiso ? 5 : 0)
  );
  const fitReasons = [
    signals.msp && 'managed-services', signals.cybersecurity && 'cybersecurity', signals.compliance && 'compliance',
    signals.psa && 'PSA', signals.multiClient && 'multi-client', signals.vendorRisk && 'vendor-risk',
    signals.softwareSupplyChain && 'software-supply-chain', signals.procurement && 'procurement', signals.vCiso && 'vCISO',
  ].filter(Boolean);
  const recommendedOffer = signals.msp || signals.multiClient ? 'msp' : signals.vendorRisk || signals.procurement ? 'vendor-risk' : signals.softwareSupplyChain ? 'software-passport' : signals.compliance ? 'evidence-report' : 'free-review';
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { url: url.toString(), httpObserved: true, contentBytes: Buffer.byteLength(html, 'utf8'), title, publicRoleEmails: publicRoleEmails(html), signals, score, fitReasons, recommendedOffer, observedAt: new Date().toISOString() };
}

export async function enqueueDistributionJob(pool: Pool, kind: DistributionJobKind, payload: Record<string, unknown>) {
  assertPayload(payload);
  const id = `dist_${randomUUID().replace(/-/g, '')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [DISTRIBUTION_TENANT_ID]);
    await client.query(`INSERT INTO distribution_jobs (id, tenant_id, kind, payload) VALUES ($1, $2, $3, $4::jsonb)`, [id, DISTRIBUTION_TENANT_ID, kind, JSON.stringify(payload)]);
    await client.query('COMMIT');
    return id;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

// Why a job exists. Recorded in the payload so the Founder agents page can show
// the reason next to every job instead of inferring it; jobs created before
// this field are reported as "origin not recorded".
export type DistributionJobOrigin =
  | { kind: 'discovery_sweep'; query: string }
  | { kind: 'manual_discovery'; query: string }
  | { kind: 'manual_research' }
  | { kind: 'manual_research_batch' }
  | { kind: 'lead_sweep' }
  | { kind: 'manual_qualify' };

export async function enqueueResearchUrl(pool: Pool, url: string, origin?: DistributionJobOrigin) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DISTRIBUTION_URL_SCHEME_NOT_ALLOWED');
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') throw new Error('DISTRIBUTION_PORT_NOT_ALLOWED');
  if (parsed.hash) throw new Error('DISTRIBUTION_FRAGMENT_NOT_ALLOWED');
  await assertPublicResearchTarget(parsed);
  // Research is intentionally limited to public web targets. Never let the
  // discovery worker become a generic URL fetcher or SSRF primitive.
  if (parsed.username || parsed.password) throw new Error('DISTRIBUTION_CREDENTIALS_IN_URL_BLOCKED');
  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = new Set(['metadata.google.internal', 'metadata.google', 'instance-data']);
  if (blockedHosts.has(hostname)) throw new Error('DISTRIBUTION_METADATA_TARGET_BLOCKED');
  return enqueueDistributionJob(pool, 'research_url', origin ? { url: parsed.toString(), origin } : { url: parsed.toString() });
}

export async function researchUrl(url: string) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DISTRIBUTION_URL_SCHEME_NOT_ALLOWED');
  await assertPublicResearchTarget(parsed);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': 'SPR-Distribution-Research/1.0 (+https://www.softwarepassportregistry.com)' } });
    if (response.status >= 300 && response.status < 400) return { url: parsed.toString(), httpObserved: true, status: response.status, redirected: true, score: null, signals: null, observedAt: new Date().toISOString() };
    const html = await readBoundedBody(response);
    return { ...extractResearchSignals(parsed, html), status: response.status };
  } finally { clearTimeout(timeout); }
}

export function calculateBackoff(attempt: number) { return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)); }
