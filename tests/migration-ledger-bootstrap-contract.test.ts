import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('migration ledger bootstrap', () => {
  it('reuses an existing schema_migrations table without requiring CREATE on public', () => {
    const source = readFileSync('scripts/migrate.ts', 'utf8');
    expect(source).toContain("to_regclass('public.schema_migrations')");
    expect(source).toContain("if (existing.rows[0]?.relation) return;");
    expect(source).not.toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
  });
});
