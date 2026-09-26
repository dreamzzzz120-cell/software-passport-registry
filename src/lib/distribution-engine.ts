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
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
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
    msp: /managed service provider|managed services|managed it\b|it services/.test(text),
    cybersecurity: /cybersecurity|cyber security|managed security|security operations|soc\b/.test(text),
    compliance: /compliance|vulnerability management|risk management|audit readiness|iso 27001|soc 2/.test(text),
    psa: /connectwise|autotask|datto|halo psa|kaseya/.test(text),
    multiClient: /clients|customers|managed endpoints|businesses we serve/.test(text),
  };
  const score = (signals.msp ? 30 : 0) + (signals.cybersecurity ? 20 : 0) + (signals.compliance ? 15 : 0) + (signals.psa ? 15 : 0) + (signals.multiClient ? 10 : 0) + (html.length > 0 ? 10 : 0);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { url: url.toString(), httpObserved: true, contentBytes: Buffer.byteLength(html, 'utf8'), title, publicRoleEmails: publicRoleEmails(html), signals, score, observedAt: new Date().toISOString() };
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
  await assertPublicResearchTarget(parsed);
  return enqueueDistributionJob(pool, 'research_url', origin ? { url: parsed.toString(), origin, rv: RESEARCH_VERSION } : { url: parsed.toString(), rv: RESEARCH_VERSION });
}

// v2: follows same-site redirects and, when the home page shows no public
// role address, checks the contact page -- where most MSPs publish info@ or
// sales@. v1 read only the home page and never followed redirects, so most
// researched MSPs yielded no contact. The sweep re-researches a v1 domain
// that found nothing exactly once (see knownResearchDomains).
export const RESEARCH_VERSION = 2;
const RESEARCH_UA = 'SPR-Distribution-Research/1.0 (+https://www.softwarepassportregistry.com)';
const MAX_REDIRECTS = 2;

function siteKey(host: string) { return host.toLowerCase().replace(/^www\./, ''); }

type FetchedPage = { url: URL; status: number; html: string | null };

async function fetchResearchPage(start: URL): Promise<FetchedPage> {
  let target = start;
  let lastStatus = 0;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicResearchTarget(target);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(target, { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': RESEARCH_UA } });
      lastStatus = response.status;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return { url: target, status: response.status, html: null };
        const next = new URL(location, target);
        // Only follow within the same site (apex <-> www, http -> https); a
        // redirect to another domain is not this business's page.
        if (!['http:', 'https:'].includes(next.protocol) || siteKey(next.hostname) !== siteKey(start.hostname)) return { url: target, status: response.status, html: null };
        target = next;
        continue;
      }
      return { url: target, status: response.status, html: await readBoundedBody(response) };
    } finally { clearTimeout(timeout); }
  }
  return { url: target, status: lastStatus, html: null };
}

export function contactPageCandidates(home: URL, html: string): URL[] {
  const out: URL[] = [];
  const seen = new Set<string>();
  const add = (u: URL) => { const k = u.origin + u.pathname.replace(/\/+$/, ''); if (!seen.has(k) && u.origin === home.origin && k !== home.origin) { seen.add(k); out.push(u); } };
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi)) {
    const href = m[1];
    if (!/contact/i.test(href)) continue;
    try { add(new URL(href, home)); } catch { /* bad href */ }
    if (out.length >= 1) break;
  }
  for (const path of ['/contact', '/contact-us']) add(new URL(path, home.origin));
  return out.slice(0, 2);
}

export async function researchUrl(url: string) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('DISTRIBUTION_URL_SCHEME_NOT_ALLOWED');
  const home = await fetchResearchPage(parsed);
  if (home.html === null) return { url: parsed.toString(), httpObserved: true, status: home.status, redirected: true, score: null, signals: null, observedAt: new Date().toISOString(), researchVersion: RESEARCH_VERSION };
  // `url` stays the URL that was queued: contacts are saved under it and the
  // send step looks them up by it. Recording the post-redirect URL there left
  // every redirecting site's contacts saved but never emailed.
  const result = { ...extractResearchSignals(parsed, home.html), status: home.status, researchVersion: RESEARCH_VERSION } as ReturnType<typeof extractResearchSignals> & { status: number; researchVersion: number; contactPage?: string; finalUrl?: string };
  if (home.url.toString() !== parsed.toString()) result.finalUrl = home.url.toString();
  if (result.publicRoleEmails.length === 0) {
    for (const candidate of contactPageCandidates(home.url, home.html)) {
      try {
        const page = await fetchResearchPage(candidate);
        if (page.html === null || page.status >= 400) continue;
        const emails = publicRoleEmails(page.html);
        if (emails.length) { result.publicRoleEmails = emails; result.contactPage = page.url.toString(); break; }
      } catch { /* a contact page that fails doesn't fail the research */ }
    }
  }
  return result;
}

export function calculateBackoff(attempt: number) { return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)); }
