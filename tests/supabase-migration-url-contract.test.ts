import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Supabase migration connection contract', () => {
  it('prefers the dedicated Supabase migration URL for release migrations', () => {
    const source = readFileSync('scripts/migrate.ts', 'utf8');
    expect(source).toContain('process.env.SUPABASE_MIGRATION_DATABASE_URL');
    expect(source).toContain('|| process.env.DATABASE_URL');
  });

  it('uses the same privileged migration URL for runtime-role provisioning', () => {
    const source = readFileSync('scripts/provision-runtime-roles.ts', 'utf8');
    expect(source).toContain('process.env.SUPABASE_MIGRATION_DATABASE_URL');
    expect(source).toContain('|| process.env.DATABASE_URL');
  });
});
