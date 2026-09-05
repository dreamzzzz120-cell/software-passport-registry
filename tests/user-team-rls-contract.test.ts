import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'migrations/0065_user_role_visibility_rls.sql'),
  'utf8',
);

describe('team directory database authorization contract', () => {
  it('keeps low-privilege team visibility self-scoped while preserving operator access', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION spr_current_user_role()');
    expect(migration).toContain("spr_current_user_role() IN ('Owner', 'Admin', 'Operator')");
    expect(migration).toContain("OR id = NULLIF(current_setting('app.user_id', true), '')::integer");
    expect(migration).toContain("tenant_id = current_setting('app.tenant_id', true)");
    expect(migration).toContain('DROP POLICY IF EXISTS spr_tenant_isolation ON public.users');
    expect(migration).toContain('CREATE POLICY spr_tenant_isolation ON public.users');
  });

  it('does not grant the role lookup function to PUBLIC', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION spr_current_user_role() FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION spr_current_user_role() TO spr_app_runtime');
  });
});
