import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('AEO growth engine contracts', () => {
  it('keeps AEO founder-only and tenant-scoped', () => {
    const source = read('src/routes/distribution-growth.ts');
    expect(source).toContain('/founder/distribution/aeo');
    expect(source).toContain('distribution_aeo_queries');
    expect(source).toContain("const founderOnly = [requireAuth, requireRole('Owner'), requireFounder]");
    expect(source).toContain('DISTRIBUTION_TENANT_ID');
  });

  it('stores observed citation metrics separately from trust evidence', () => {
    const migration = read('migrations/0118_aeo_growth_engine.sql');
    expect(migration).toContain('observed_mentions');
    expect(migration).toContain('observed_citations');
    expect(migration).toContain("status IN ('backlog','published','monitoring','retired')");
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('publishes machine-readable product boundaries without fabricated claims', () => {
    const llms = read('public/llms.txt');
    expect(llms).toContain('Missing evidence is UNKNOWN');
    expect(llms).toContain('does not manufacture certainty');
    expect(llms).not.toMatch(/SOC 2 certified|ISO 27001 certified|guaranteed safe/i);
  });

  it('surfaces AEO in the founder growth UI', () => {
    const ui = read('src/components/FounderGrowthHub.tsx');
    expect(ui).toContain('Answer Engine Optimization');
    expect(ui).toContain('AI mentions');
    expect(ui).toContain('AI citations');
  });
});
