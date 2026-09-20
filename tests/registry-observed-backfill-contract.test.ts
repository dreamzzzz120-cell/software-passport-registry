import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('registry observed backfill contract', () => {
  const sql = fs.readFileSync(path.resolve('migrations/0112_registry_observed_backfill.sql'), 'utf8');
  it('backfills only completed real Free Review observations', () => {
    expect(sql).toContain("j.job_type = 'repository_scan'");
    expect(sql).toContain("j.status = 'Completed'");
    expect(sql).toContain("repository_security_scan");
    expect(sql).toContain("'spr-free-review'");
  });
  it('does not fabricate unknown popularity', () => {
    expect(sql).toContain('ALTER COLUMN stars DROP NOT NULL');
    expect(sql).toContain('UPDATE public.software_registry_identities SET stars = NULL WHERE stars = 0');
  });
  it('creates durable identity, observation and ingestion links', () => {
    expect(sql).toContain('software_registry_identities');
    expect(sql).toContain('software_registry_observations');
    expect(sql).toContain('registry_ingestion_items');
    expect(sql).toContain('backfilled_from_completed_scan');
  });
});
