import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Q-LEGION founder route and worker wiring', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/routes/q-legion.ts'), 'utf8');
  const worker = readFileSync(resolve(process.cwd(), 'src/workers/distribution-worker.ts'), 'utf8');
  const server = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
  const dashboard = readFileSync(resolve(process.cwd(), 'src/components/FounderDashboardView.tsx'), 'utf8');

  it('keeps Q-LEGION founder telemetry behind Owner + founder gates', () => {
    expect(route).toContain("requireRole('Owner')");
    expect(route).toContain('requireFounder');
    expect(route).toContain("mode: 'SHADOW'");
  });

  it('records shadow missions after successful research without controlling send authority', () => {
    expect(worker).toContain('recordResearchShadowMission');
    expect(worker).toContain('Q-LEGION shadow mission failed');
    expect(route).not.toContain('sendInitial(');
    expect(route).not.toContain('sendDueFollowups(');
  });

  it('mounts the route and surfaces the founder panel', () => {
    expect(server).toContain('createQLegionRouter');
    expect(dashboard).toContain('<FounderQLegionPanel />');
  });

  it('backfills only completed observed research that does not already have a mission', () => {
    const shadow = readFileSync(resolve(process.cwd(), 'src/lib/q-legion-shadow.ts'), 'utf8');
    expect(shadow).toContain('backfillResearchShadowMissions');
    expect(shadow).toContain("j.kind='research_url'");
    expect(shadow).toContain("j.status='succeeded'");
    expect(shadow).toContain("q.source_kind='distribution_research'");
    expect(shadow).toContain('q.source_id=j.id');
    expect(worker).toContain('Q-LEGION shadow backfill:');
  });

});
