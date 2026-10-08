import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const trafficRoute = readFileSync(new URL('../src/routes/traffic.ts', import.meta.url), 'utf8');

describe('traffic reporting SQL contract', () => {
  it('counts page views rather than all conversion and interaction events', () => {
    expect(trafficRoute).toContain("event_name = 'page_view' AND occurred_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'");
    expect(trafficRoute).toContain("event_name = 'page_view' AND occurred_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'");
    expect(trafficRoute).toContain("WHERE event_name = 'page_view' AND source IS DISTINCT FROM 'founder-test'");
  });

  it('excludes explicitly tagged founder diagnostics from summaries and funnel', () => {
    expect(trafficRoute.match(/source IS DISTINCT FROM 'founder-test'/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
