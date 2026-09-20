import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { describeOrigin } from '../src/lib/server/founder/agents';
import { relativeTime, summarize24h } from '../src/components/FounderAgentsPanel';

describe('Founder agents report', () => {
  it('explains why a job exists from its recorded origin, and admits when none was recorded', () => {
    expect(describeOrigin({ url: 'https://x', origin: { kind: 'discovery_sweep', query: 'msp ontario' } })).toContain('worker discovery sweep for query "msp ontario"');
    expect(describeOrigin({ origin: { kind: 'manual_discovery', query: 'q' } })).toContain('founder ran discovery');
    expect(describeOrigin({ origin: { kind: 'manual_research' } })).toContain('founder requested research');
    expect(describeOrigin({ origin: { kind: 'lead_sweep' } })).toContain('lead sweep');
    expect(describeOrigin({ origin: { kind: 'manual_qualify' } })).toContain('founder requested qualification');
    expect(describeOrigin({ url: 'https://x' })).toMatch(/origin not recorded/);
  });

  it('every control advertised by an agent targets a route that is registered in the API', async () => {
    const source = await readFile(new URL('../src/lib/server/founder/agents.ts', import.meta.url), 'utf8');
    const advertised = [...new Set([...source.matchAll(/path: '(\/api\/founder\/[^']+)'/g)].map((m) => m[1]))];
    expect(advertised.length).toBeGreaterThan(0);
    const routeFiles = ['distribution.ts', 'distribution-growth.ts', 'founder-command-center.ts'];
    const registered = new Set<string>();
    for (const f of routeFiles) {
      const src = await readFile(new URL(`../src/routes/${f}`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/router\.(get|post|patch|delete)\('(\/founder\/[^']+)'/g)) registered.add(`/api${m[2]}`);
    }
    for (const path of advertised) expect(registered.has(path), `${path} is advertised but not registered`).toBe(true);
  });

  it('registers the agents route behind founder authorization and both rate limiters', async () => {
    const src = await readFile(new URL('../src/routes/founder-command-center.ts', import.meta.url), 'utf8');
    const line = src.split('\n').find((l) => l.includes("router.get('/founder/agents'"));
    expect(line).toBeDefined();
    for (const guard of ['founderReadLimiter', 'requireAuth', "requireRole('Owner')", 'requireFounder', 'rateLimiter']) expect(line).toContain(guard);
  });

  it('formats time and 24h summaries without inventing activity', () => {
    const now = Date.parse('2026-09-20T03:00:00Z');
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime('2026-09-20T02:59:30Z', now)).toBe('30s ago');
    expect(relativeTime('2026-09-20T01:00:00Z', now)).toBe('2h ago');
    expect(summarize24h({})).toBe('nothing in the last 24h');
    expect(summarize24h({ succeeded: 3, failed: 1, queued: 0 })).toBe('3 succeeded · 1 failed');
    expect(summarize24h({ 'repository_scan:Completed': 2 })).toBe('2 Completed');
  });
});

describe('Founder agents report — review follow-ups (2026-09-20)', () => {
  it('reports outreach on the kinds the worker actually runs, not only the legacy prepare_outreach', async () => {
    const src = await readFile(new URL('../src/lib/server/founder/agents.ts', import.meta.url), 'utf8');
    expect(src).toContain("distributionKindReport(['send_outreach', 'followup_outreach', 'prepare_outreach'])");
  });

  it('the worker discovery sweep records its origin and query on every research job it queues', async () => {
    const worker = await readFile(new URL('../src/workers/distribution-worker.ts', import.meta.url), 'utf8');
    expect(worker).toContain("enqueueDistributionJob(pool,'research_url',{url:candidate.url,origin:{kind:'discovery_sweep',query}})");
  });

  it('worker last-seen counts settled jobs (workers null locked_by when a job settles)', async () => {
    const overview = await readFile(new URL('../src/lib/server/founder/overview.ts', import.meta.url), 'utf8');
    expect(overview).toContain("FROM agent_jobs WHERE status IN ('Running','Completed','Failed')");
    expect(overview).not.toContain('WHERE locked_by IS NOT NULL');
  });

  it('the discovery/outreach toggles read the no-settings-row default as enabled', async () => {
    const panel = await readFile(new URL('../src/components/FounderAgentsPanel.tsx', import.meta.url), 'utf8');
    expect(panel).toContain(".startsWith('true')");
    const agents = await readFile(new URL('../src/lib/server/founder/agents.ts', import.meta.url), 'utf8');
    expect(agents).toContain("'true (no settings row yet; worker default)'");
  });
});
