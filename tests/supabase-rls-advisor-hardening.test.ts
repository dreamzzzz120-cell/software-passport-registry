import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Supabase RLS advisor hardening migration', () => {
  const sql = fs.readFileSync('migrations/0133_harden_supabase_rls_advisor.sql', 'utf8');

  it('narrows tenant policies from PUBLIC to the application runtime role', () => {
    expect(sql).toContain('ALTER POLICY spr_tenant_isolation');
    expect(sql).toContain('TO spr_app_runtime');
    expect(sql).toContain('provider_software_observations');
    expect(sql).toContain('growth_registry_claims');
  });

  it('keeps global growth metadata fail-closed to the application runtime', () => {
    expect(sql).toContain('spr_app_growth_agents_deny');
    expect(sql).toContain('FOR ALL TO spr_app_runtime');
    expect(sql).toContain('USING (false) WITH CHECK (false)');
  });

  it('keeps migration backup data available only through explicit runtime policies', () => {
    expect(sql).toContain('spr_migration_fk_backup_access');
    expect(sql).toContain('TO spr_migration_runtime');
    expect(sql).toContain('spr_worker_migration_backup_deny');
  });
});
