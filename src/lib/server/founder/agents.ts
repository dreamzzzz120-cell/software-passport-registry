/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — per-agent activity reports.
//
// Every figure here is read from the tables the worker itself writes
// (distribution_jobs, distribution_messages, distribution_contacts,
// distribution_campaign_settings, distribution_sender_verifications,
// registry_crawl_runs, agent_jobs). Nothing is inferred from timers or
// assumed from configuration: an agent is "active" only when a row shows it
// working, and configuration that lives on the worker service and cannot be
// read from the API process is reported as exactly that.

import { sql } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import { DISTRIBUTION_TENANT_ID } from '../../distribution-engine.ts';
import { autonomousOutreachEnabled } from '../../distribution-outreach.ts';

export type AgentKey = 'discovery' | 'qualification' | 'outreach' | 'registry_crawler' | 'scan_engines';
export type AgentState = 'active' | 'idle' | 'disabled' | 'unknown';

export type AgentConfigItem = { label: string; value: string; source: string; control?: string };
export type AgentActivityRow = {
  id: string;
  at: string;
  kind: string;
  status: string;
  subject: string | null;
  why: string;
  outcome: string | null;
  error: string | null;
  attempts: number | null;
  workerId: string | null;
};
export type AgentControl = { id: string; label: string; description: string; method: 'POST' | 'PATCH'; path: string };
export type AgentReport = {
  key: AgentKey;
  name: string;
  purpose: string;
  howItDecides: string;
  dataSource: string;
  state: AgentState;
  stateReason: string;
  runningNow: number;
  last24h: Record<string, number>;
  lastCompletedAt: string | null;
  config: AgentConfigItem[];
  recent: AgentActivityRow[];
  controls: AgentControl[];
  generatedAt: string;
};

const RECENT_LIMIT = 25;

function rows(result: unknown): any[] { return ((result as any)?.rows ?? []) as any[]; }
function iso(value: unknown): string | null { if (!value) return null; const d = new Date(value as string); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
function trunc(value: unknown, max = 160): string | null { if (value === null || value === undefined) return null; const s = typeof value === 'string' ? value : JSON.stringify(value); return s.length > max ? `${s.slice(0, max)}…` : s; }

export function describeOrigin(payload: any): string {
  const origin = payload?.origin;
  if (!origin || typeof origin !== 'object') return 'origin not recorded (job predates origin tracking)';
  switch (origin.kind) {
    case 'discovery_sweep': return origin.query ? `worker discovery sweep for query "${origin.query}"` : 'worker discovery sweep';
    case 'manual_discovery': return origin.query ? `founder ran discovery for query "${origin.query}"` : 'founder ran discovery';
    case 'manual_research': return 'founder requested research of this URL';
    case 'manual_research_batch': return 'founder requested research of a URL batch';
    case 'lead_sweep': return 'worker lead sweep: a Free Review lead had no qualification job yet';
    case 'manual_qualify': return 'founder requested qualification of this lead';
    default: return `origin: ${String(origin.kind)}`;
  }
}

function distributionSubject(kind: string, payload: any, result: any): string | null {
  if (kind === 'research_url') return typeof payload?.url === 'string' ? payload.url : null;
  if (kind === 'qualify_lead') return [payload?.company, payload?.email].filter((v) => typeof v === 'string' && v.trim()).join(' · ') || (typeof payload?.leadId === 'string' ? payload.leadId : null);
  if (kind === 'prepare_outreach' || kind === 'send_outreach' || kind === 'followup_outreach') return typeof payload?.email === 'string' ? payload.email : typeof payload?.contactId === 'string' ? payload.contactId : null;
  return typeof result?.company === 'string' ? result.company : null;
}

function distributionOutcome(kind: string, status: string, result: any): string | null {
  if (status !== 'succeeded' || !result || typeof result !== 'object') return null;
  if (kind === 'research_url') {
    const parts: string[] = [];
    if (typeof result.score === 'number') parts.push(`score ${result.score}`);
    if (typeof result.company === 'string' && result.company) parts.push(result.company);
    if (result.redirected) parts.push('redirected');
    if (typeof result.status === 'number') parts.push(`HTTP ${result.status}`);
    return parts.join(' · ') || 'observed';
  }
  if (kind === 'qualify_lead') return typeof result.score === 'number' ? `score ${result.score}${result.businessEmail === false ? ' · not a business email' : ''}` : 'qualified';
  if (kind === 'prepare_outreach' || kind === 'send_outreach' || kind === 'followup_outreach') return typeof result.messageId === 'string' ? `message ${result.messageId}` : typeof result.skipped === 'string' ? `skipped: ${result.skipped}` : kind === 'followup_outreach' ? 'follow-up sent' : 'sent';
  return trunc(result, 120);
}

type DistributionKind = 'research_url' | 'qualify_lead' | 'prepare_outreach' | 'send_outreach' | 'followup_outreach';

async function distributionKindReport(kinds: DistributionKind | DistributionKind[]) {
  const kindList = Array.isArray(kinds) ? kinds : [kinds];
  const kindFilter = sql.join(kindList.map((k) => sql`${k}`), sql`, `);
  const counts = rows(await db.execute(sql`SELECT status, COUNT(*)::int AS count FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND kind IN (${kindFilter}) AND updated_at > NOW() - INTERVAL '24 hours' GROUP BY status`));
  const last24h: Record<string, number> = {};
  for (const r of counts) last24h[String(r.status)] = Number(r.count);
  const running = rows(await db.execute(sql`SELECT COUNT(*)::int AS count FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND kind IN (${kindFilter}) AND status='running'`))[0]?.count ?? 0;
  const lastCompleted = rows(await db.execute(sql`SELECT updated_at FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND kind IN (${kindFilter}) AND status='succeeded' ORDER BY updated_at DESC LIMIT 1`))[0]?.updated_at ?? null;
  const recentRows = rows(await db.execute(sql`SELECT id, kind, status, payload, result, last_error, attempts, locked_by, locked_at, created_at, updated_at FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND kind IN (${kindFilter}) ORDER BY updated_at DESC LIMIT ${RECENT_LIMIT}`));
  const recent: AgentActivityRow[] = recentRows.map((r) => {
    const payload = r.payload && typeof r.payload === 'object' ? r.payload : {};
    const result = r.result && typeof r.result === 'object' ? r.result : null;
    return {
      id: String(r.id), at: iso(r.updated_at) ?? iso(r.created_at) ?? new Date(0).toISOString(), kind: String(r.kind), status: String(r.status),
      subject: distributionSubject(String(r.kind), payload, result), why: describeOrigin(payload), outcome: distributionOutcome(String(r.kind), String(r.status), result),
      error: trunc(r.last_error), attempts: typeof r.attempts === 'number' ? r.attempts : Number(r.attempts ?? 0), workerId: r.locked_by ? String(r.locked_by) : null,
    };
  });
  return { last24h, runningNow: Number(running), lastCompletedAt: iso(lastCompleted), recent };
}

async function campaignSettings() {
  return rows(await db.execute(sql`SELECT discovery_enabled AS "discoveryEnabled", outreach_enabled AS "outreachEnabled", daily_send_cap AS "dailySendCap", followup_delay_days AS "followupDelayDays", max_followups AS "maxFollowups", demo_url AS "demoUrl", updated_at AS "updatedAt" FROM distribution_campaign_settings WHERE tenant_id=${DISTRIBUTION_TENANT_ID} LIMIT 1`))[0] ?? null;
}

function stateFromActivity(enabledInDb: boolean | null, runningNow: number, last24h: Record<string, number>, disabledReason: string): { state: AgentState; stateReason: string } {
  if (enabledInDb === false) return { state: 'disabled', stateReason: disabledReason };
  if (runningNow > 0) return { state: 'active', stateReason: `${runningNow} job${runningNow === 1 ? '' : 's'} running right now` };
  const total = Object.values(last24h).reduce((a, b) => a + b, 0);
  if (total > 0) return { state: 'active', stateReason: `${total} job${total === 1 ? '' : 's'} touched in the last 24 hours, none running at this moment` };
  return { state: 'idle', stateReason: 'no jobs touched in the last 24 hours' };
}

const WORKER_ENV_NOTE = 'set on the worker service; not readable from the API process';

export async function discoveryAgent(): Promise<AgentReport> {
  const settings = await campaignSettings();
  const report = await distributionKindReport('research_url');
  const sweepJobs24h = rows(await db.execute(sql`SELECT COUNT(*)::int AS count FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND kind='research_url' AND payload->'origin'->>'kind'='discovery_sweep' AND created_at > NOW() - INTERVAL '24 hours'`))[0]?.count ?? 0;
  const { state, stateReason } = stateFromActivity(settings ? Boolean(settings.discoveryEnabled) : null, report.runningNow, report.last24h, 'discovery_enabled is false in distribution_campaign_settings; the worker skips discovery sweeps');
  return {
    key: 'discovery', name: 'Discovery agent',
    purpose: 'Finds candidate MSP / IT-services companies to approach. Each candidate URL becomes a research_url job; the worker fetches the public site and extracts observable signals (company name, role emails, services) into a heuristic score. Nothing is contacted at this stage.',
    howItDecides: 'Two sources create research jobs: the worker\'s hourly discovery sweep (only when DISTRIBUTION_AUTONOMOUS_DISCOVERY=true and a business-search provider is set on the worker: GOOGLE_PLACES_API_KEY, BRAVE_SEARCH_API_KEY or DISTRIBUTION_DISCOVERY_PROVIDER_URL) and a founder running discovery or research from this page. Each job records which of these created it. A job is retried with backoff up to its max_attempts, then dead-lettered.',
    dataSource: 'distribution_jobs (kind research_url), distribution_campaign_settings',
    state, stateReason, runningNow: report.runningNow, last24h: report.last24h, lastCompletedAt: report.lastCompletedAt,
    config: [
      { label: 'Discovery enabled (database gate)', value: settings ? String(Boolean(settings.discoveryEnabled)) : 'true (no settings row yet; worker default)', source: 'distribution_campaign_settings.discovery_enabled', control: 'campaign' },
      { label: 'Autonomous discovery sweep', value: process.env.DISTRIBUTION_AUTONOMOUS_DISCOVERY === undefined ? WORKER_ENV_NOTE : String(process.env.DISTRIBUTION_AUTONOMOUS_DISCOVERY === 'true'), source: 'DISTRIBUTION_AUTONOMOUS_DISCOVERY' },
      { label: 'Discovery provider URL', value: process.env.DISTRIBUTION_DISCOVERY_PROVIDER_URL === undefined ? WORKER_ENV_NOTE : (process.env.DISTRIBUTION_DISCOVERY_PROVIDER_URL.trim() ? 'set' : 'empty'), source: 'DISTRIBUTION_DISCOVERY_PROVIDER_URL' },
      { label: 'Jobs created by sweeps, last 24h', value: String(Number(sweepJobs24h)), source: 'distribution_jobs.payload.origin' },
    ],
    recent: report.recent,
    controls: [
      { id: 'campaign', label: 'Enable / disable discovery', description: 'Writes discovery_enabled in distribution_campaign_settings; the worker reads it before every sweep.', method: 'PATCH', path: '/api/founder/distribution/campaign' },
      { id: 'discovery_run', label: 'Run discovery now', description: 'Queries the configured discovery provider with a search phrase and queues one research job per result.', method: 'POST', path: '/api/founder/distribution/discovery/run' },
      { id: 'research', label: 'Research a URL', description: 'Queues one research job for a public company website.', method: 'POST', path: '/api/founder/distribution/research' },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function qualificationAgent(): Promise<AgentReport> {
  const report = await distributionKindReport('qualify_lead');
  const leads = rows(await db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last24h FROM free_review_leads WHERE tenant_id=${DISTRIBUTION_TENANT_ID}`))[0] ?? { total: 0, last24h: 0 };
  const unqualified = rows(await db.execute(sql`SELECT COUNT(*)::int AS count FROM free_review_leads l WHERE l.tenant_id=${DISTRIBUTION_TENANT_ID} AND NOT EXISTS (SELECT 1 FROM distribution_jobs j WHERE j.tenant_id=${DISTRIBUTION_TENANT_ID} AND j.kind='qualify_lead' AND j.payload->>'leadId'=l.id AND j.status IN ('queued','running','succeeded'))`))[0]?.count ?? 0;
  const { state, stateReason } = stateFromActivity(null, report.runningNow, report.last24h, '');
  return {
    key: 'qualification', name: 'Lead qualification agent',
    purpose: 'Scores every Free Review lead (someone who left an email to get a report) so the outreach agent only follows up with plausible MSP buyers. It checks the email domain and the company website for observable business signals.',
    howItDecides: 'Every 5 minutes the worker\'s lead sweep finds Free Review leads that have no qualification job yet and queues one each. A founder can also queue a specific lead from this page. The score is heuristic and stored with the job result; it is evidence to review, not a verdict.',
    dataSource: 'distribution_jobs (kind qualify_lead), free_review_leads',
    state, stateReason, runningNow: report.runningNow, last24h: report.last24h, lastCompletedAt: report.lastCompletedAt,
    config: [
      { label: 'Free Review leads in total', value: String(Number(leads.total ?? 0)), source: 'free_review_leads' },
      { label: 'New leads, last 24h', value: String(Number(leads.last24h ?? 0)), source: 'free_review_leads.created_at' },
      { label: 'Leads still without a qualification job', value: String(Number(unqualified)), source: 'free_review_leads minus distribution_jobs' },
      { label: 'Lead sweep interval', value: process.env.DISTRIBUTION_LEAD_SWEEP_MS === undefined ? `${WORKER_ENV_NOTE} (worker default 300000 ms)` : `${process.env.DISTRIBUTION_LEAD_SWEEP_MS} ms`, source: 'DISTRIBUTION_LEAD_SWEEP_MS' },
    ],
    recent: report.recent,
    controls: [
      { id: 'qualify_lead', label: 'Qualify a lead now', description: 'Queues a qualification job for one Free Review lead by its id (see the Leads panel).', method: 'POST', path: '/api/founder/distribution/qualify-lead' },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function outreachAgent(): Promise<AgentReport> {
  const settings = await campaignSettings();
  // The worker runs outreach as send_outreach and followup_outreach; prepare_outreach
  // is a legacy kind kept for old rows. Reporting only the legacy kind showed
  // "idle" while emails were being sent (review finding, 2026-09-20).
  const report = await distributionKindReport(['send_outreach', 'followup_outreach', 'prepare_outreach']);
  const messages = rows(await db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='sent')::int AS sent, COUNT(*) FILTER (WHERE status='failed')::int AS failed, COUNT(*) FILTER (WHERE status='sent' AND sent_at > NOW() - INTERVAL '24 hours')::int AS "sent24h", MAX(sent_at) AS "lastSentAt" FROM distribution_messages WHERE tenant_id=${DISTRIBUTION_TENANT_ID}`))[0] ?? {};
  const contacts = rows(await db.execute(sql`SELECT status, COUNT(*)::int AS count FROM distribution_contacts WHERE tenant_id=${DISTRIBUTION_TENANT_ID} GROUP BY status`));
  const verification = rows(await db.execute(sql`SELECT from_address AS "fromAddress", status, error, sent_at AS "sentAt" FROM distribution_sender_verifications ORDER BY sent_at DESC LIMIT 1`))[0] ?? null;
  const envEnabled = autonomousOutreachEnabled();
  const dbEnabled = settings ? Boolean(settings.outreachEnabled) : null;
  let state: AgentState; let stateReason: string;
  if (dbEnabled === false) { state = 'disabled'; stateReason = 'outreach_enabled is false in distribution_campaign_settings'; }
  else if (!envEnabled) { state = 'disabled'; stateReason = process.env.DISTRIBUTION_AUTONOMOUS_OUTREACH === 'true' ? 'DISTRIBUTION_AUTONOMOUS_OUTREACH is true but RESEND_API_KEY or EMAIL_FROM is missing, so no email can be sent' : 'DISTRIBUTION_AUTONOMOUS_OUTREACH is not "true" on the API service; the worker has its own copy of this variable'; }
  else if (Number(messages.sent ?? 0) === 0) { state = 'idle'; stateReason = report.runningNow > 0 || Object.values(report.last24h).some((value) => value > 0) ? 'job activity exists, but no outreach message has ever been sent' : 'no outreach message has ever been sent'; }
  else ({ state, stateReason } = stateFromActivity(true, report.runningNow, report.last24h, ''));
  const contactCounts = Object.fromEntries(contacts.map((c) => [String(c.status), Number(c.count)]));
  return {
    key: 'outreach', name: 'Outreach agent',
    purpose: 'Sends the first email and bounded follow-ups to contacts that have an outreach basis on record, through Resend, from EMAIL_FROM. Every message is stored with its provider id and status; unsubscribes suppress the contact.',
    howItDecides: 'A contact is only emailed when it has an outreach_basis, is active, the campaign\'s daily send cap has not been reached, and the sender address has a recorded verification. Follow-ups wait followup_delay_days and stop at max_followups. Both the database switch and DISTRIBUTION_AUTONOMOUS_OUTREACH must be on.',
    dataSource: 'distribution_jobs (kinds send_outreach, followup_outreach), distribution_messages, distribution_contacts, distribution_sender_verifications, distribution_campaign_settings',
    state, stateReason, runningNow: report.runningNow, last24h: report.last24h, lastCompletedAt: report.lastCompletedAt,
    config: [
      { label: 'Outreach enabled (database gate)', value: settings ? String(Boolean(settings.outreachEnabled)) : 'true (no settings row yet; worker default)', source: 'distribution_campaign_settings.outreach_enabled', control: 'campaign' },
      { label: 'Autonomous outreach (env gate)', value: String(envEnabled), source: 'DISTRIBUTION_AUTONOMOUS_OUTREACH + RESEND_API_KEY + EMAIL_FROM (API service copy)' },
      { label: 'Daily send cap', value: settings ? String(settings.dailySendCap) : 'default 50', source: 'distribution_campaign_settings.daily_send_cap', control: 'campaign' },
      { label: 'Follow-up delay / max follow-ups', value: settings ? `${settings.followupDelayDays} days / ${settings.maxFollowups}` : 'default 5 days / 2', source: 'distribution_campaign_settings', control: 'campaign' },
      { label: 'Messages sent (total / last 24h / failed)', value: `${Number(messages.sent ?? 0)} / ${Number(messages.sent24h ?? 0)} / ${Number(messages.failed ?? 0)}`, source: 'distribution_messages' },
      { label: 'Last message sent', value: iso(messages.lastSentAt) ?? 'never', source: 'distribution_messages.sent_at' },
      { label: 'Contacts by status', value: Object.keys(contactCounts).length ? Object.entries(contactCounts).map(([k, v]) => `${k} ${v}`).join(' · ') : 'none', source: 'distribution_contacts.status' },
      { label: 'Sender verification', value: verification ? `${verification.status} for ${verification.fromAddress}${verification.error ? ` (${trunc(verification.error, 80)})` : ''} at ${iso(verification.sentAt) ?? 'unknown time'}` : 'no verification recorded — the worker will not send', source: 'distribution_sender_verifications' },
    ],
    recent: report.recent,
    controls: [
      { id: 'campaign', label: 'Campaign settings', description: 'Enable/disable outreach, set the daily send cap, follow-up delay and maximum follow-ups.', method: 'PATCH', path: '/api/founder/distribution/campaign' },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function registryCrawlerAgent(): Promise<AgentReport> {
  const runs = rows(await db.execute(sql`SELECT id, started_at, finished_at, discovered, enqueued, skipped, error, note FROM registry_crawl_runs ORDER BY started_at DESC LIMIT ${RECENT_LIMIT}`));
  const counts = rows(await db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS failed, COUNT(*) FILTER (WHERE finished_at IS NULL)::int AS running, COALESCE(SUM(enqueued),0)::int AS enqueued FROM registry_crawl_runs WHERE started_at > NOW() - INTERVAL '24 hours'`))[0] ?? { total: 0, failed: 0, running: 0, enqueued: 0 };
  const crawlState = rows(await db.execute(sql`SELECT language_index AS "languageIndex", page, updated_at AS "updatedAt" FROM registry_crawl_state ORDER BY updated_at DESC LIMIT 1`))[0] ?? null;
  const publicPassports = rows(await db.execute(sql`SELECT COUNT(*)::int AS count FROM passports WHERE tenant_id=${DISTRIBUTION_TENANT_ID}`))[0]?.count ?? 0;
  const last24h = { runs: Number(counts.total ?? 0), failed: Number(counts.failed ?? 0), enqueued: Number(counts.enqueued ?? 0) };
  const runningNow = Number(counts.running ?? 0);
  const lastFinished = runs.find((r) => r.finished_at)?.finished_at ?? null;
  const { state, stateReason } = stateFromActivity(null, runningNow, { runs: last24h.runs }, '');
  const recent: AgentActivityRow[] = runs.map((r) => ({
    id: String(r.id), at: iso(r.finished_at) ?? iso(r.started_at) ?? new Date(0).toISOString(), kind: 'crawl_run',
    status: r.error ? 'failed' : r.finished_at ? 'succeeded' : 'running',
    subject: `discovered ${Number(r.discovered ?? 0)} · enqueued ${Number(r.enqueued ?? 0)} · skipped ${Number(r.skipped ?? 0)}`,
    why: 'scheduled crawl of public GitHub repositories above the star floor, to publish observed passports in the public registry',
    outcome: r.note ? trunc(r.note, 160) : null, error: trunc(r.error), attempts: null, workerId: null,
  }));
  return {
    key: 'registry_crawler', name: 'Registry crawler',
    purpose: 'Walks public GitHub repositories (by language and popularity), queues real scans for them, and publishes the results as observed passports in the public registry at /software. This is what gives SPR indexable public pages: SEO surface comes from real scans, not generated copy.',
    howItDecides: 'The worker crawls in pages per language, remembering its position in registry_crawl_state, and only enqueues repositories above REGISTRY_CRAWL_STAR_FLOOR that have not been scanned within REGISTRY_CRAWL_REFRESH_HOURS. Every run records what it discovered, enqueued and skipped, and any error.',
    dataSource: 'registry_crawl_runs, registry_crawl_state, passports (Free Review tenant)',
    state, stateReason, runningNow, last24h, lastCompletedAt: iso(lastFinished),
    config: [
      { label: 'Crawler enabled', value: process.env.REGISTRY_CRAWLER_ENABLED === undefined ? WORKER_ENV_NOTE : String(process.env.REGISTRY_CRAWLER_ENABLED !== 'false'), source: 'REGISTRY_CRAWLER_ENABLED' },
      { label: 'Crawl position', value: crawlState ? `language index ${crawlState.languageIndex}, page ${crawlState.page} (updated ${iso(crawlState.updatedAt) ?? 'unknown'})` : 'no crawl state yet', source: 'registry_crawl_state' },
      { label: 'Public passports published', value: String(Number(publicPassports)), source: 'passports (tenant-free-review-system)' },
      { label: 'Star floor / refresh hours / batch', value: [process.env.REGISTRY_CRAWL_STAR_FLOOR, process.env.REGISTRY_CRAWL_REFRESH_HOURS, process.env.REGISTRY_CRAWL_BATCH].every((v) => v === undefined) ? WORKER_ENV_NOTE : `${process.env.REGISTRY_CRAWL_STAR_FLOOR ?? '?'} / ${process.env.REGISTRY_CRAWL_REFRESH_HOURS ?? '?'} / ${process.env.REGISTRY_CRAWL_BATCH ?? '?'}`, source: 'REGISTRY_CRAWL_*' },
    ],
    recent,
    controls: [],
    generatedAt: new Date().toISOString(),
  };
}

export async function scanEnginesAgent(): Promise<AgentReport> {
  const counts = rows(await db.execute(sql`SELECT job_type, status, COUNT(*)::int AS count FROM agent_jobs WHERE updated_at > NOW() - INTERVAL '24 hours' GROUP BY job_type, status`));
  const last24h: Record<string, number> = {};
  for (const r of counts) last24h[`${r.job_type}:${r.status}`] = Number(r.count);
  const running = rows(await db.execute(sql`SELECT COUNT(*)::int AS count FROM agent_jobs WHERE status='Running'`))[0]?.count ?? 0;
  const pending = rows(await db.execute(sql`SELECT COUNT(*)::int AS count FROM agent_jobs WHERE status='Pending'`))[0]?.count ?? 0;
  const lastCompleted = rows(await db.execute(sql`SELECT completed_at FROM agent_jobs WHERE status='Completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1`))[0]?.completed_at ?? null;
  const recentRows = rows(await db.execute(sql`SELECT id, tenant_id, job_type, status, progress, error, attempt_count, locked_by, created_at, updated_at, completed_at FROM agent_jobs ORDER BY updated_at DESC LIMIT ${RECENT_LIMIT}`));
  const recent: AgentActivityRow[] = recentRows.map((r) => ({
    id: String(r.id), at: iso(r.updated_at) ?? new Date(0).toISOString(), kind: String(r.job_type), status: String(r.status),
    subject: `tenant ${String(r.tenant_id)}`,
    why: String(r.tenant_id) === DISTRIBUTION_TENANT_ID ? 'Free Review or registry crawl scan (public)' : 'customer-requested scan in their workspace',
    outcome: r.status === 'Completed' ? `completed${typeof r.progress === 'number' ? ` (${r.progress}%)` : ''}` : r.status === 'Running' ? `${Number(r.progress ?? 0)}%` : null,
    error: trunc(r.error), attempts: typeof r.attempt_count === 'number' ? r.attempt_count : Number(r.attempt_count ?? 0), workerId: r.locked_by ? String(r.locked_by) : null,
  }));
  const { state, stateReason } = stateFromActivity(null, Number(running), last24h, '');
  return {
    key: 'scan_engines', name: 'Scan engines',
    purpose: 'The repository scanner (GitHub acquisition, file inventory, Syft SBOM, OSV dependency vulnerabilities), the security scanner (secrets, licences, IaC) and the intake scanner (uploaded archives). Every scan for every tenant, including Free Review and the registry crawler, goes through these queues.',
    howItDecides: 'Jobs are claimed from agent_jobs by the worker\'s consumers (SCAN_QUEUE_CONSUMERS), retried on failure with backoff up to max_attempts, and settle as Completed or Failed with the reason recorded. Nothing is scored without evidence from a completed engine.',
    dataSource: 'agent_jobs (all tenants)',
    state, stateReason, runningNow: Number(running), last24h, lastCompletedAt: iso(lastCompleted),
    config: [
      { label: 'Queued (Pending) right now', value: String(Number(pending)), source: 'agent_jobs.status' },
      { label: 'Scan consumers', value: process.env.SCAN_QUEUE_CONSUMERS === undefined ? `${WORKER_ENV_NOTE} (worker default 2)` : process.env.SCAN_QUEUE_CONSUMERS, source: 'SCAN_QUEUE_CONSUMERS' },
    ],
    recent,
    controls: [],
    generatedAt: new Date().toISOString(),
  };
}

export async function allAgentReports(): Promise<AgentReport[]> {
  const results = await Promise.allSettled([discoveryAgent(), qualificationAgent(), outreachAgent(), registryCrawlerAgent(), scanEnginesAgent()]);
  const keys: AgentKey[] = ['discovery', 'qualification', 'outreach', 'registry_crawler', 'scan_engines'];
  const names = ['Discovery agent', 'Lead qualification agent', 'Outreach agent', 'Registry crawler', 'Scan engines'];
  return results.map((r, i) => r.status === 'fulfilled' ? r.value : ({
    key: keys[i], name: names[i], purpose: '', howItDecides: '', dataSource: '',
    state: 'unknown', stateReason: `report failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
    runningNow: 0, last24h: {}, lastCompletedAt: null, config: [], recent: [], controls: [], generatedAt: new Date().toISOString(),
  } satisfies AgentReport));
}
