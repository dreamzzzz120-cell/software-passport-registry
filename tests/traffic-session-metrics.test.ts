import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const trafficRoute = readFileSync(new URL('../src/routes/traffic.ts', import.meta.url), 'utf8');

describe('founder traffic metric definitions', () => {
  it('labels distinct session IDs as sessions, not confirmed human users', () => {
    expect(trafficRoute).toContain("AS sessions_24h");
    expect(trafficRoute).toContain("AS sessions_7d");
    expect(trafficRoute).toContain("measurement: 'anonymous_sessions_not_unique_people'");
  });
  it('keeps legacy API keys while clients migrate', () => {
    expect(trafficRoute).toContain("AS users_24h");
    expect(trafficRoute).toContain("AS users_7d");
  });
});
