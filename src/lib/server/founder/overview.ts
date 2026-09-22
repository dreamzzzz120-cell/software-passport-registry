/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — platform pulse and the 7-day acquisition funnel.
//
// Every value is a count or timestamp read from a table, or the result of
// the same three checks /ready performs. A query that fails leaves its
// field null so the UI renders "Not verified" instead of a false zero.
// The funnel is descriptive, not causal: it lines up what happened in the
// same seven days at each stage; it does not claim one stage produced the
// next.

import { sql } from 'drizzle-orm';
import { appPool, checkDatabaseHealth, db } from '../../../db/index.ts';
import { DISTRIBUTION_TENANT_ID } from '../../distribution-engine.ts';

export type FounderPulse = {
  database: { ok: boolean; latencyMs: number | null };
  tenantRls: boolean | null;
  runtimeRole: string | null;
  leastPrivilege: boolean | null;
  apiUptimeSeconds: number;
  worker: { lastSeenAt: string | null; lastSeenSource: string | null };
  scanQueue: { pending: number | null; running: number | null; failed24h: number | null };
  distributionQueue: { queued: number | null; running: number | null; deadLetter: number | null };
};

export type FounderFunnel = {
  windowDays: number;
  pageViews: number | null;
  visitors: number | null;
  freeReviewsCompleted: number | null;
  freeReviewsFailed: number | null;
  leads: number | null;
  leadsQualified: number | null;
  contacts: number | null;
  messagesSent: number | null;
  signups: number | null;
  organizations: number | null;
};

export type FounderTraffic = {
  activeEvents: number | null;
  activeSessions: number | null;
  visitors24h: number | null;
  pageViews24h: number | null;
  visitors7d: number | null;
  pageViews7d: number | null;
};

export type FounderOverview = { pulse: FounderPulse; funnel: FounderFunnel; traffic: FounderTraffic; generatedAt: string };

function rows(result: unknown): any[] { return ((result as any)?.rows ?? []) as any[]; }
function iso(value: unknown): string | null { if (!value) return null; const d = new Date(value as string); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }

// One query, one field: a failure anywhere must not blank the whole report.
async function count(query: ReturnType<typeof sql>): Promise<number | null> {
  try { const value = rows(await db.execute(query))[0]?.count; return value === undefined || value === null ? null : Number(value); }
  catch (err) { console.error('[FounderOverview] count failed:', err instanceof Error ? err.message : String(err)); return null; }
}

export async function founderPulse(): Promise<FounderPulse> {
  const database = await checkDatabaseHealth();
  let tenantRls: boolean | null = null;
  let runtimeRole: string | null = null;
  if (database.ok) {
    try { await db.execute(sql`SELECT spr_assert_tenant_rls()`); tenantRls = true; } catch { tenantRls = false; }
    try { runtimeRole = (await appPool.query('SELECT current_user AS role')).rows?.[0]?.role ?? null; } catch { runtimeRole = null; }
  }
  // "Last seen" is the newest row any worker loop touched. It is evidence of
  // the worker having done something at that time, not a heartbeat. Workers
  // null locked_by when a job settles, so this looks at status, not the lock.
  let lastSeenAt: string | null = null; let lastSeenSource: string | null = null;
  try {
    const seen = rows(await db.execute(sql`
      SELECT source, seen FROM (
        SELECT 'agent_jobs' AS source, MAX(updated_at) AS seen FROM agent_jobs WHERE status IN ('Running','Completed','Failed')
        UNION ALL SELECT 'distribution_jobs', MAX(updated_at) FROM distribution_jobs WHERE status IN ('running','succeeded','failed','dead_letter')
        UNION ALL SELECT 'registry_crawl_runs', MAX(COALESCE(finished_at, started_at)) FROM registry_crawl_runs
      ) s WHERE seen IS NOT NULL ORDER BY seen DESC LIMIT 1`));
    if (seen[0]) { lastSeenAt = iso(seen[0].seen); lastSeenSource = String(seen[0].source); }
  } catch (err) { console.error('[FounderOverview] worker last-seen failed:', err instanceof Error ? err.message : String(err)); }
  return {
    database: { ok: database.ok, latencyMs: database.ok ? database.latencyMs : null },
    tenantRls, runtimeRole, leastPrivilege: runtimeRole === null ? null : runtimeRole === 'spr_app_runtime',
    apiUptimeSeconds: Math.round(process.uptime()),
    worker: { lastSeenAt, lastSeenSource },
    scanQueue: {
      pending: await count(sql`SELECT COUNT(*)::int AS count FROM agent_jobs WHERE status='Pending'`),
      running: await count(sql`SELECT COUNT(*)::int AS count FROM agent_jobs WHERE status='Running'`),
      failed24h: await count(sql`SELECT COUNT(*)::int AS count FROM agent_jobs WHERE status='Failed' AND updated_at > NOW() - INTERVAL '24 hours'`),
    },
    distributionQueue: {
      queued: await count(sql`SELECT COUNT(*)::int AS count FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND status='queued'`),
      running: await count(sql`SELECT COUNT(*)::int AS count FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND status='running'`),
      deadLetter: await count(sql`SELECT COUNT(*)::int AS count FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND status='dead_letter'`),
    },
  };
}

export async function founderFunnel(windowDays = 7): Promise<FounderFunnel> {
  const since = sql`NOW() - (${windowDays} * INTERVAL '1 day')`;
  return {
    windowDays,
    pageViews: await count(sql`SELECT COUNT(*)::int AS count FROM traffic_events WHERE occurred_at > ${since}`),
    visitors: await count(sql`SELECT COUNT(DISTINCT session_id)::int AS count FROM traffic_events WHERE occurred_at > ${since}`),
    freeReviewsCompleted: await count(sql`SELECT COUNT(*)::int AS count FROM agent_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND job_type='repository_scan' AND status='Completed' AND completed_at > ${since}`),
    freeReviewsFailed: await count(sql`SELECT COUNT(*)::int AS count FROM agent_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND job_type='repository_scan' AND status='Failed' AND updated_at > ${since}`),
    leads: await count(sql`SELECT COUNT(*)::int AS count FROM free_review_leads WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND created_at > ${since}`),
    leadsQualified: await count(sql`SELECT COUNT(*)::int AS count FROM distribution_jobs WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND kind='qualify_lead' AND status='succeeded' AND updated_at > ${since}`),
    contacts: await count(sql`SELECT COUNT(*)::int AS count FROM distribution_contacts WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND created_at > ${since}`),
    messagesSent: await count(sql`SELECT COUNT(*)::int AS count FROM distribution_messages WHERE tenant_id=${DISTRIBUTION_TENANT_ID} AND status='sent' AND sent_at > ${since}`),
    signups: await count(sql`SELECT COUNT(*)::int AS count FROM users WHERE created_at > ${since}`),
    organizations: await count(sql`SELECT COUNT(*)::int AS count FROM organizations WHERE created_at > ${since}`),
  };
}

export async function founderOverview(): Promise<FounderOverview> {
  const [pulse, funnel] = await Promise.all([founderPulse(), founderFunnel()]);
  const [trafficResult] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 minutes')::int AS active_events,
        COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '30 minutes')::int AS active_sessions,
        COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS visitors_24h,
        COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS pageviews_24h,
        COUNT(DISTINCT session_id) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')::int AS visitors_7d,
        COUNT(*) FILTER (WHERE occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')::int AS pageviews_7d
      FROM traffic_events
    `).catch((err) => { console.error('[FounderOverview] traffic summary failed:', err instanceof Error ? err.message : String(err)); return null; }),
  ]);
  const trafficRow = rows(trafficResult)[0];
  return {
    pulse,
    funnel,
    traffic: {
      activeEvents: trafficRow?.active_events == null ? null : Number(trafficRow.active_events),
      activeSessions: trafficRow?.active_sessions == null ? null : Number(trafficRow.active_sessions),
      visitors24h: trafficRow?.visitors_24h == null ? null : Number(trafficRow.visitors_24h),
      pageViews24h: trafficRow?.pageviews_24h == null ? null : Number(trafficRow.pageviews_24h),
      visitors7d: trafficRow?.visitors_7d == null ? null : Number(trafficRow.visitors_7d),
      pageViews7d: trafficRow?.pageviews_7d == null ? null : Number(trafficRow.pageviews_7d),
    },
    generatedAt: new Date().toISOString(),
  };
}
