import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p:string) => fs.readFileSync(path.join(root,p),'utf8');

describe('growth platform contracts', () => {
  it('adds attribution and conversion events without touching trust evidence', () => {
    const migration=read('migrations/0119_growth_platform.sql');
    for (const field of ['event_name','source','medium','campaign','referral_code']) expect(migration).toContain(field);
    for (const table of ['growth_referral_links','growth_experiments','growth_registry_claims','growth_content_opportunities']) expect(migration).toContain(table);
    expect(migration).not.toMatch(/trust_score|overall_score|verification_status/);
  });

  it('keeps growth tables RLS scoped', () => {
    const migration=read('migrations/0119_growth_platform.sql');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("current_setting(''app.tenant_id'', true)");
  });

  it('supports funnel and attribution in traffic API', () => {
    const route=read('src/routes/traffic.ts');
    expect(route).toContain('eventName');
    expect(route).toContain('referralCode');
    expect(route).toContain('growth/funnel');
  });

  it('shows acquisition metrics in founder growth hub', () => {
    const ui=read('src/components/FounderGrowthHub.tsx');
    expect(ui).toContain('Acquisition funnel');
    expect(ui).toContain('Referral visits');
    expect(ui).toContain('Registry claims');
  });
});
