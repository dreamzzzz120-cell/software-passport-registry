import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../src/routes/founder-command-center.ts', import.meta.url), 'utf8');

describe('founder traffic classification contract', () => {
  it('does not represent anonymous session identifiers as known people', () => {
    expect(route).toContain("visitorMeasurement: 'anonymous_session_ids_not_unique_humans'");
    expect(route).toContain('sessions24h: row.users24h');
    expect(route).toContain('sessions7d: row.users7d');
  });

  it('only labels supported founder-test and automated signals, leaving others unknown', () => {
    expect(route).toContain("WHEN source = 'founder-test' THEN 'founder_test'");
    expect(route).toContain("THEN 'automated'");
    expect(route).toContain("ELSE 'unknown'");
    expect(route).toContain('classificationMethod:');
  });

  it('keeps site-wide analytics founder restricted', () => {
    expect(route).toContain("router.get('/founder/traffic', founderReadLimiter, requireAuth, requireRole('Owner'), requireFounder");
  });
});
