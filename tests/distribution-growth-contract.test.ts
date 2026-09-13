import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('distribution growth production contracts', () => {
  it('keeps growth API founder-only and tenant-scoped', () => {
    const source = read('src/routes/distribution-growth.ts');
    expect(source).toContain("const founderOnly = [requireAuth, requireRole('Owner'), requireFounder]");
    expect(source).toContain('DISTRIBUTION_TENANT_ID');
    expect(source).toContain("/founder/distribution/contacts/:contactId/stage");
    expect(source).toContain("/founder/distribution/campaign");
  });

  it('keeps followups disabled after response/conversion stages', () => {
    const migration = read('migrations/0093_distribution_followup_stage_guard.sql');
    for (const stage of ['replied','demo','pilot','customer','lost']) expect(migration).toContain(`'${stage}'`);
    expect(migration).toContain('NEW.next_followup_at := NULL');
  });

  it('keeps outreach controls distinct from trust scoring', () => {
    const ui = read('src/components/FounderGrowthHub.tsx');
    expect(ui).toContain('does not change trust scores');
    expect(ui).toContain('Pause outreach');
    expect(ui).toContain('/api/founder/distribution/growth');
  });
});
