import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { computeAttention, minutesSince } from '../src/lib/founderData';

const healthyOverview = {
  pulse: { database: { ok: true, latencyMs: 3 }, tenantRls: true, runtimeRole: 'spr_app_runtime', leastPrivilege: true, apiUptimeSeconds: 100, worker: { lastSeenAt: new Date(Date.now() - 60000).toISOString(), lastSeenSource: 'agent_jobs' }, scanQueue: { pending: 0, running: 1, failed24h: 0 }, distributionQueue: { queued: 0, running: 0, deadLetter: 0 } },
  funnel: { windowDays: 7, pageViews: 1, visitors: 1, freeReviewsCompleted: 1, freeReviewsFailed: 0, leads: 0, leadsQualified: 0, contacts: 0, messagesSent: 0, signups: 0, organizations: 0 },
  traffic: { activeEvents: 0, activeSessions: 0, visitors24h: 1, pageViews24h: 1, visitors7d: 1, pageViews7d: 1 },
  generatedAt: new Date().toISOString(),
};
const okCommandCenter = { connections: [{ key: 'railway', name: 'Railway', status: 'ok' as const, detail: '5 services reachable', lastChecked: '' }], connectionGuides: {}, businessMetrics: { organizationCount: 1, userCount: 1, mrrCents: 0, stripeCustomerCount: 0, activeSubscriptionCount: 0, successfulPaymentCount30d: 0, successfulPaymentAmount30dCents: 0, ciStatus: 'ok' }, generatedAt: '' };
const agent = (over: Partial<any>): any => ({ key: 'discovery', name: 'Discovery agent', purpose: '', howItDecides: '', dataSource: '', state: 'active', stateReason: '', runningNow: 0, last24h: {}, lastCompletedAt: null, config: [], recent: [], controls: [], generatedAt: '', ...over });

describe('Founder "needs attention" rules', () => {
  it('flags nothing when every observed signal is healthy', () => {
    expect(computeAttention({ overview: healthyOverview, commandCenter: okCommandCenter, agents: [agent({})] })).toEqual([]);
  });

  it('ranks a failed RLS assertion and a wrong database role as critical, with the evidence named', () => {
    const items = computeAttention({ overview: { ...healthyOverview, pulse: { ...healthyOverview.pulse, tenantRls: false, runtimeRole: 'postgres', leastPrivilege: false } }, commandCenter: okCommandCenter, agents: [] });
    expect(items[0].severity).toBe('critical');
    expect(items.map((i) => i.title)).toEqual(expect.arrayContaining([expect.stringMatching(/row-level security/), expect.stringMatching(/"postgres" instead of spr_app_runtime/)]));
    for (const i of items) expect(i.evidence.length).toBeGreaterThan(5);
  });

  it('reports stale job activity with outstanding work, and missing worker evidence separately', () => {
    const stale = computeAttention({ overview: { ...healthyOverview, pulse: { ...healthyOverview.pulse, worker: { lastSeenAt: new Date(Date.now() - 45 * 60000).toISOString(), lastSeenSource: 'distribution_jobs' } } }, commandCenter: okCommandCenter, agents: [] });
    expect(stale.map((i) => i.title)).toContainEqual(expect.stringMatching(/Last worker job activity: 4[45] minutes ago/));
    expect(stale[0].severity).toBe('warning');
    expect(stale[0].evidence).toContain('not a worker heartbeat');
    const never = computeAttention({ overview: { ...healthyOverview, pulse: { ...healthyOverview.pulse, worker: { lastSeenAt: null, lastSeenSource: null } } }, commandCenter: okCommandCenter, agents: [] });
    expect(never.map((i) => i.title)).toContain('No evidence of the worker ever running');
  });

  it('keeps idle activity informational and unknown queue state explicit', () => {
    const now = Date.now();
    const pulse = { ...healthyOverview.pulse, worker: { lastSeenAt: new Date(now - 272 * 60000).toISOString(), lastSeenSource: 'agent_jobs' }, scanQueue: { pending: 0, running: 0, failed24h: 0 } };
    const idle = computeAttention({ overview: { ...healthyOverview, pulse }, commandCenter: okCommandCenter, agents: [] }, now);
    expect(idle[0].severity).toBe('info');
    expect(idle[0].evidence).toContain('no outstanding work observed');
    const unknown = computeAttention({ overview: { ...healthyOverview, pulse: { ...pulse, scanQueue: { pending: null, running: null, failed24h: null } } }, commandCenter: okCommandCenter, agents: [] }, now);
    expect(unknown[0].severity).toBe('warning');
    expect(unknown[0].evidence).toContain('queue state is UNKNOWN');
  });

  it('surfaces broken and unconfigured connections, disabled agents, failed jobs and an unverified sender', () => {
    const items = computeAttention({
      overview: healthyOverview,
      commandCenter: { ...okCommandCenter, connections: [{ key: 'vercel', name: 'Vercel', status: 'error', detail: 'provider returned HTTP 403', lastChecked: '' }, { key: 'github_ci', name: 'GitHub CI', status: 'not_configured', detail: 'GitHub CI connection is not configured', lastChecked: '' }], businessMetrics: { ...okCommandCenter.businessMetrics, ciStatus: 'error' } },
      agents: [agent({ key: 'outreach', name: 'Outreach agent', state: 'disabled', stateReason: 'outreach_enabled is false', last24h: { failed: 2 }, config: [{ label: 'Sender verification', value: 'no verification recorded — the worker will not send', source: 'distribution_sender_verifications' }] })],
    });
    const titles = items.map((i) => i.title);
    expect(titles).toContain('Vercel connection error');
    expect(titles).toContain('GitHub CI not connected');
    expect(titles).toContain('Latest GitHub Actions run did not succeed');
    expect(titles).toContain('Outreach agent is disabled');
    expect(titles).toContain('Outreach agent: 2 failed jobs in 24h');
    expect(titles).toContain('Outreach sender address has no verification on record');
    const order = items.map((i) => i.severity);
    expect(order).toEqual([...order].sort((a, b) => ({ critical: 0, warning: 1, info: 2 })[a] - ({ critical: 0, warning: 1, info: 2 })[b]));
  });

  it('never reports a missing value as zero', () => {
    const items = computeAttention({ overview: { ...healthyOverview, pulse: { ...healthyOverview.pulse, scanQueue: { pending: null, running: null, failed24h: null }, distributionQueue: { queued: null, running: null, deadLetter: null } } }, commandCenter: okCommandCenter, agents: [] });
    expect(items.map((i) => i.title).join(' ')).not.toMatch(/0 scan|0 distribution/);
    expect(minutesSince(null)).toBeNull();
  });

  it('removed the tiles that had no data behind them', async () => {
    const view = await readFile(new URL('../src/components/FounderDashboardView.tsx', import.meta.url), 'utf8');
    for (const dead of ['Autonomy Score', 'Capital Protected', 'Point-of-Trust', 'Access Level', 'Sovereign']) expect(view).not.toContain(dead);
  });
});
