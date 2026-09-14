import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('registry crawl state repair migration 0096', () => {
  it('restores strategy_index and query_index columns to registry_crawl_state', () => {
    const migration = read('migrations/0096_repair_registry_crawl_state_columns.sql');
    expect(migration).toContain('ALTER TABLE registry_crawl_state ADD COLUMN IF NOT EXISTS strategy_index');
    expect(migration).toContain('CHECK (strategy_index >= 0)');
    expect(migration).toContain('ALTER TABLE registry_crawl_state ADD COLUMN IF NOT EXISTS query_index');
    expect(migration).toContain('CHECK (query_index >= 0)');
  });

  it('is idempotent and uses IF NOT EXISTS guards', () => {
    const migration = read('migrations/0096_repair_registry_crawl_state_columns.sql');
    expect(migration).toContain('IF NOT EXISTS');
    const addColumnCount = (migration.match(/ADD COLUMN IF NOT EXISTS/g) || []).length;
    expect(addColumnCount).toBeGreaterThanOrEqual(5);
  });

  it('restores refreshed, quarantined, failed columns to registry_crawl_runs', () => {
    const migration = read('migrations/0096_repair_registry_crawl_state_columns.sql');
    expect(migration).toContain('ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS refreshed');
    expect(migration).toContain('ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS quarantined');
    expect(migration).toContain('ALTER TABLE registry_crawl_runs ADD COLUMN IF NOT EXISTS failed');
  });

  it('is wrapped in a transaction for atomicity', () => {
    const migration = read('migrations/0096_repair_registry_crawl_state_columns.sql');
    expect(migration).toMatch(/^BEGIN;/m);
    expect(migration).toMatch(/COMMIT;$/m);
  });

  it('does not modify 0091 and respects the ledger', () => {
    const migration0091 = read('migrations/0091_public_repository_agent_team.sql');
    const migration0096 = read('migrations/0096_repair_registry_crawl_state_columns.sql');
    expect(migration0091).not.toBe(migration0096);
    expect(migration0091).toContain('CREATE TABLE IF NOT EXISTS registry_ingestion_items');
  });
});
