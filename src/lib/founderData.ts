/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — one loader shared by the overview and agents
// panels, so a Refresh anywhere re-reads everything once and every panel
// shows the same snapshot. Each source loads independently: a failure in
// one leaves that field null and the others intact.

import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiClient';
import type { AgentReport } from '../components/FounderAgentsPanel';

export type Connection = { key: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; lastChecked: string };
export type ConnectionGuide = { key: string; name: string; purpose: string; probe: string; statusMeaning: Record<Connection['status'], string>; configuredAt: string; steps: string[]; settings: { name: string; secret: boolean; set: boolean; purpose: string; whereToGet: string }[] };
export type CommandCenter = { connections: Connection[]; connectionGuides: Record<string, ConnectionGuide>; businessMetrics: { organizationCount: number | null; userCount: number | null; mrrCents: number | null; stripeCustomerCount: number | null; activeSubscriptionCount: number | null; successfulPaymentCount30d: number | null; successfulPaymentAmount30dCents: number | null; ciStatus: string }; generatedAt: string };
export type FounderActivity = { id: string; category: 'agent_job' | 'distribution_job' | 'lead' | 'signup' | 'crawler'; label: string; state: string | null; occurredAt: string; source: string };
export type Overview = {
  pulse: { database: { ok: boolean; latencyMs: number | null }; tenantRls: boolean | null; runtimeRole: string | null; leastPrivilege: boolean | null; apiUptimeSeconds: number; worker: { lastSeenAt: string | null; lastSeenSource: string | null }; scanQueue: { pending: number | null; running: number | null; failed24h: number | null }; distributionQueue: { queued: number | null; running: number | null; deadLetter: number | null } };
  funnel: { windowDays: number; pageViews: number | null; visitors: number | null; freeReviewsCompleted: number | null; freeReviewsFailed: number | null; leads: number | null; leadsQualified: number | null; contacts: number | null; messagesSent: number | null; signups: number | null; organizations: number | null };
  traffic: { activeEvents: number | null; activeSessions: number | null; visitors24h: number | null; pageViews24h: number | null; visitors7d: number | null; pageViews7d: number | null; topPages: { path: string; views: number }[] | null };
  recentActivity: FounderActivity[] | null;
  generatedAt: string;
};
export type FounderData = { overview: Overview | null; commandCenter: CommandCenter | null; agents: AgentReport[] | null; errors: string[]; loadedAt: string | null; loading: boolean };

const EMPTY: FounderData = { overview: null, commandCenter: null, agents: null, errors: [], loadedAt: null, loading: false };
let current: FounderData = EMPTY;
let inflight: Promise<void> | null = null;
const listeners = new Set<(d: FounderData) => void>();
const AUTO_REFRESH_MS = 15_000;
let autoRefreshTimer: number | null = null;
let visibilityBound = false;
function emit() { for (const l of listeners) l(current); }
function onVisibilityChange() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') void loadFounderData(true);
}
function startAutoRefresh() {
  if (typeof window === 'undefined' || autoRefreshTimer) return;
  autoRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void loadFounderData(true);
  }, AUTO_REFRESH_MS);
  if (!visibilityBound) { document.addEventListener('visibilitychange', onVisibilityChange); visibilityBound = true; }
}
function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  if (visibilityBound && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', onVisibilityChange); visibilityBound = false; }
}

async function getJson<T>(path: string, errors: string[]): Promise<T | null> {
  try {
    const res = await apiFetch(path);
    if (!res.ok) { errors.push(`${path} → HTTP ${res.status}`); return null; }
    return (await res.json()) as T;
  } catch (e) { errors.push(`${path} → ${e instanceof Error ? e.message : 'request failed'}`); return null; }
}

export function loadFounderData(force = false): Promise<void> {
  if (inflight) return inflight;
  const loadedMs = current.loadedAt ? new Date(current.loadedAt).getTime() : 0;
  if (!force && loadedMs && Number.isFinite(loadedMs) && Date.now() - loadedMs < 5_000) return Promise.resolve();
  current = { ...current, loading: true }; emit();
  inflight = (async () => {
    const errors: string[] = [];
    const [overview, commandCenter, agentsPayload] = await Promise.all([
      getJson<Overview>('/api/founder/overview', errors),
      getJson<CommandCenter>('/api/founder/command-center', errors),
      getJson<{ agents: AgentReport[] }>('/api/founder/agents', errors),
    ]);
    current = { overview, commandCenter, agents: agentsPayload?.agents ?? null, errors, loadedAt: new Date().toISOString(), loading: false };
    emit();
  })().finally(() => { inflight = null; });
  return inflight;
}

export function useFounderData(): FounderData & { refresh: () => Promise<void> } {
  const [data, setData] = useState<FounderData>(current);
  useEffect(() => {
    listeners.add(setData);
    startAutoRefresh();
    if (!current.loadedAt && !inflight) void loadFounderData();
    return () => { listeners.delete(setData); if (listeners.size === 0) stopAutoRefresh(); };
  }, []);
  return { ...data, refresh: () => loadFounderData(true) };
}

// --- Needs attention -----------------------------------------------------
// Deterministic rules over observed state. Each item names the evidence it
// was derived from, so the list can be checked against the panels below it.
export type AttentionItem = { severity: 'critical' | 'warning' | 'info'; title: string; evidence: string; anchor: string };

export function minutesSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.round((now - t) / 60000) : null;
}

export function computeAttention(data: { overview: Overview | null; commandCenter: CommandCenter | null; agents: AgentReport[] | null }, now = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const p = data.overview?.pulse;
  if (p) {
    if (!p.database.ok) items.push({ severity: 'critical', title: 'Database unreachable from the API', evidence: 'checkDatabaseHealth failed', anchor: '#founder-pulse' });
    if (p.tenantRls === false) items.push({ severity: 'critical', title: 'Tenant row-level security check failed', evidence: 'spr_assert_tenant_rls() raised', anchor: '#founder-pulse' });
    if (p.leastPrivilege === false) items.push({ severity: 'critical', title: `API is connecting as "${p.runtimeRole}" instead of spr_app_runtime`, evidence: 'SELECT current_user on the app pool', anchor: '#founder-pulse' });
    const mins = minutesSince(p.worker.lastSeenAt, now);
    if (mins === null) items.push({ severity: 'warning', title: 'No evidence of the worker ever running', evidence: 'no rows in agent_jobs, distribution_jobs or registry_crawl_runs carry a worker mark', anchor: '#founder-pulse' });
    else if (mins > 30) items.push({ severity: 'warning', title: `Worker last touched a job ${mins} minutes ago`, evidence: `newest worker-written row: ${p.worker.lastSeenSource}`, anchor: '#founder-pulse' });
    if ((p.scanQueue.pending ?? 0) > 25) items.push({ severity: 'warning', title: `${p.scanQueue.pending} scans waiting in the queue`, evidence: 'agent_jobs status=Pending', anchor: '#founder-agents' });
    if ((p.scanQueue.failed24h ?? 0) > 0) items.push({ severity: 'info', title: `${p.scanQueue.failed24h} scan job${p.scanQueue.failed24h === 1 ? '' : 's'} failed in the last 24h`, evidence: 'agent_jobs status=Failed, updated_at within 24h', anchor: '#founder-agents' });
    if ((p.distributionQueue.deadLetter ?? 0) > 0) items.push({ severity: 'warning', title: `${p.distributionQueue.deadLetter} distribution job${p.distributionQueue.deadLetter === 1 ? '' : 's'} dead-lettered`, evidence: 'distribution_jobs status=dead_letter (exhausted retries)', anchor: '#founder-agents' });
    if (p.database.ok && (p.database.latencyMs ?? 0) > 250) items.push({ severity: 'info', title: `Database round-trip is ${p.database.latencyMs} ms`, evidence: 'checkDatabaseHealth latency', anchor: '#founder-pulse' });
  }
  for (const c of data.commandCenter?.connections ?? []) {
    if (c.status === 'error') items.push({ severity: 'warning', title: `${c.name} connection error`, evidence: c.detail, anchor: '#founder-connections' });
    else if (c.status === 'not_configured') items.push({ severity: 'info', title: `${c.name} not connected`, evidence: c.detail, anchor: '#founder-connections' });
  }
  const ci = data.commandCenter?.businessMetrics.ciStatus;
  if (ci === 'error') items.push({ severity: 'warning', title: 'Latest GitHub Actions run did not succeed', evidence: 'GitHub CI connection reports the newest workflow run as not successful', anchor: '#founder-connections' });
  for (const a of data.agents ?? []) {
    if (a.state === 'disabled') items.push({ severity: 'info', title: `${a.name} is disabled`, evidence: a.stateReason, anchor: '#founder-agents' });
    if (a.state === 'unknown') items.push({ severity: 'warning', title: `${a.name} report unavailable`, evidence: a.stateReason, anchor: '#founder-agents' });
    const failed = (a.last24h.failed ?? 0) + (a.last24h.dead_letter ?? 0);
    if (failed > 0) items.push({ severity: failed >= 5 ? 'warning' : 'info', title: `${a.name}: ${failed} failed job${failed === 1 ? '' : 's'} in 24h`, evidence: 'distribution_jobs status failed/dead_letter within 24h', anchor: '#founder-agents' });
    const sender = a.config.find((c) => c.label === 'Sender verification');
    if (a.key === 'outreach' && sender && sender.value.startsWith('no verification')) items.push({ severity: 'warning', title: 'Outreach sender address has no verification on record', evidence: sender.source, anchor: '#founder-agents' });
  }
  const rank = { critical: 0, warning: 1, info: 2 };
  return items.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
