import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(root, 'migrations/0138_internal_rls_runtime_policies.sql'), 'utf8');

describe('internal RLS runtime policies', () => {
  it('gives growth_agents only trusted runtime policy coverage', () => {
    expect(sql).toContain('CREATE POLICY spr_internal_runtime_access');
    expect(sql).toContain('TO spr_app_runtime, spr_worker_runtime, spr_migration_runtime');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.growth_agents FROM anon');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.growth_agents FROM authenticated');
  });

  it('makes the FK backup migration-only', () => {
    expect(sql).toContain('CREATE POLICY spr_migration_runtime_access');
    expect(sql).toContain('TO spr_migration_runtime');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM spr_app_runtime');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM spr_worker_runtime');
  });
});
