import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Founder Mission Control maximum-upgrade contracts', () => {
  const dashboard = readFileSync(resolve(process.cwd(), 'src/components/FounderDashboardView.tsx'), 'utf8');
  const mission = readFileSync(resolve(process.cwd(), 'src/components/FounderMissionControl.tsx'), 'utf8');
  const data = readFileSync(resolve(process.cwd(), 'src/lib/founderData.ts'), 'utf8');
  const overview = readFileSync(resolve(process.cwd(), 'src/lib/server/founder/overview.ts'), 'utf8');

  it('uses the real mission control instead of fabricated NOW feed rows', () => {
    expect(dashboard).toContain('<FounderMissionControl />');
    expect(dashboard).not.toContain('Founder Command Center loaded');
    expect(mission).toContain('Persisted operational events');
  });

  it('sources recent activity from persisted operational tables', () => {
    expect(overview).toContain("'agent_jobs'::text AS source");
    expect(overview).toContain("'distribution_jobs'::text");
    expect(overview).toContain("'free_review_leads'::text");
    expect(overview).toContain("'users'::text");
    expect(overview).toContain("'registry_crawl_runs'::text");
    expect(overview).toContain('recentActivity');
  });

  it('exposes observed top pages without inventing missing traffic', () => {
    expect(overview).toContain('topPages: { path: string; views: number }[] | null');
    expect(data).toContain('topPages?: { path: string; views: number }[] | null');
    expect(mission).toContain('Top observed pages · 24h');
    expect(mission).toContain('Top-page traffic is not verified.');
  });

  it('refreshes founder telemetry every 15 seconds only while visible and prevents overlapping loads', () => {
    expect(data).toContain('AUTO_REFRESH_MS = 15_000');
    expect(data).toContain("document.visibilityState === 'visible'");
    expect(data).toContain('if (inflight) return inflight;');
    expect(data).toContain("document.addEventListener('visibilitychange'");
  });

  it('keeps unavailable values explicit', () => {
    expect(mission).toContain('NOT VERIFIED');
    expect(mission).toContain('UNKNOWN');
    expect(mission).not.toContain('Math.random');
  });
});
