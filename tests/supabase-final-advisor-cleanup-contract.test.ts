import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(path.join(root, 'migrations/0137_remove_redundant_supabase_browser_deny_policies.sql'), 'utf8');

describe('final Supabase advisor cleanup', () => {
  it('removes browser-role RLS deny policies that create advisor false positives', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS spr_deny_anon');
    expect(migration).toContain('DROP POLICY IF EXISTS spr_deny_authenticated');
  });

  it('keeps browser roles fail-closed through privileges', () => {
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.growth_agents FROM anon');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.growth_agents FROM authenticated');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM anon');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.spr_migration_fk_backup FROM authenticated');
  });
});
