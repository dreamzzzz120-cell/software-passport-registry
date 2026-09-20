import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(path.resolve('migrations/0111_living_registry_integrity.sql'), 'utf8');
const crawler = fs.readFileSync(path.resolve('src/workers/registry-crawler-worker.ts'), 'utf8');
const route = fs.readFileSync(path.resolve('src/routes/software-registry.ts'), 'utf8');

describe('living registry hardening contract', () => {
  it('defines canonical identity, aliases, immutable observations and conflicts', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS software_registry_identities');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS software_registry_aliases');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS software_registry_observations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS software_registry_conflicts');
    expect(migration).toContain('REGISTRY_OBSERVATION_IMMUTABLE');
    expect(migration).toContain('software_registry_identity_repo_unique');
  });

  it('hardens global registry access without granting anonymous database access', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('spr_registry_app_read');
    expect(migration).toContain('spr_registry_worker_all');
    expect(migration).not.toContain('TO anon');
  });

  it('records discovery observations and refresh state instead of one-time imports', () => {
    expect(crawler).toContain('software_registry_identities');
    expect(crawler).toContain('software_registry_observations');
    expect(crawler).toContain('registry_ingestion_items');
    expect(crawler).toContain("next_refresh_at");
    expect(crawler).toContain("refresh_reason='scheduled_refresh'");
    expect(crawler).toContain("status IN ('Pending','Running')");
  });

  it('keeps the public registry grounded in completed real scans and exposes registry state', () => {
    expect(route).toContain("j.status = 'Completed'");
    expect(route).toContain("repository_security_scan");
    expect(route).toContain('software_registry_identities');
    expect(route).toContain('identityStatus');
    expect(route).toContain('lastObservedAt');
  });
});
