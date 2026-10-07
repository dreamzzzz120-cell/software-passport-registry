import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(path.join(root, 'migrations/0136_supabase_runtime_policy_scope.sql'), 'utf8');

describe('Supabase runtime policy scope hardening', () => {
  it('removes PUBLIC tenant policies and recreates them only for the trusted app runtime', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS spr_tenant_isolation');
    expect(migration).toContain('TO spr_app_runtime');
    expect(migration).not.toMatch(/CREATE POLICY spr_tenant_isolation[\s\S]*? TO public/i);
    expect(migration).toContain("current_setting(''app.tenant_id'', true)");
  });

  it('revokes browser-role privileges on internal tenant tables', () => {
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated");
  });

  it('keeps no-policy internal tables explicitly fail-closed to Supabase client roles', () => {
    expect(migration).toContain('CREATE POLICY spr_deny_anon');
    expect(migration).toContain('CREATE POLICY spr_deny_authenticated');
    expect(migration).toContain('AS RESTRICTIVE');
    expect(migration).toContain('USING (false) WITH CHECK (false)');
  });

  it('does not touch worker or migration cross-tenant policies', () => {
    expect(migration).not.toContain('DROP POLICY IF EXISTS spr_worker_cross_tenant');
    expect(migration).not.toContain('DROP POLICY IF EXISTS spr_temporary_migration');
  });
});
