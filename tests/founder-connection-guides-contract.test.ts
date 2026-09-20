import { describe, expect, it } from 'vitest';
import { connectionGuides } from '../src/lib/server/founder/connection-guides';
import { buildAgentBrief } from '../src/components/FounderConnectionDetail';

describe('Founder Command Center connection guides', () => {
  it('describes every connection the route reports, under the same key', async () => {
    const guides = connectionGuides();
    const source = await (await import('node:fs/promises')).readFile(new URL('../src/lib/server/founder/connections.ts', import.meta.url), 'utf8');
    const probeKeys = [...new Set([...source.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]))];
    expect(probeKeys.sort()).toEqual(Object.keys(guides).sort());
    for (const guide of Object.values(guides)) {
      expect(guide.settings.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThan(0);
      for (const status of ['ok', 'error', 'not_configured'] as const) expect(guide.statusMeaning[status].length).toBeGreaterThan(20);
    }
  });

  it('never labels the auth connection as Firebase', () => {
    const names = Object.values(connectionGuides()).map((g) => g.name);
    expect(names).toContain('Supabase Auth');
    expect(names.join(' ')).not.toMatch(/firebase/i);
  });

  it('reports setting presence as booleans only, never values', () => {
    for (const guide of Object.values(connectionGuides())) {
      for (const setting of guide.settings) expect(typeof setting.set).toBe('boolean');
      // Real key shapes, not the prefixes the instructions mention.
      expect(JSON.stringify(guide)).not.toMatch(/sk_live_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{20,}.[A-Za-z0-9_-]{20,}/);
    }
  });

  it('builds an agent brief that names the observed status and every missing setting', () => {
    const guide = connectionGuides().vercel;
    const stubbed = { ...guide, settings: guide.settings.map((s) => ({ ...s, set: s.name !== 'VERCEL_API_TOKEN' })) };
    const brief = buildAgentBrief({ key: 'vercel', name: 'Vercel', status: 'not_configured', detail: 'Vercel connection is not configured', lastChecked: '2026-09-19T00:00:00.000Z' }, stubbed);
    expect(brief).toContain('status=not_configured');
    expect(brief).toContain('Settings missing: VERCEL_API_TOKEN');
    expect(brief).toContain('VERCEL_PROJECT_ID, VERCEL_TEAM_ID');
    expect(brief).toContain('do not report success from configuration alone');
  });
});
