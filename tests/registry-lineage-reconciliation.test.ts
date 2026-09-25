import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { reconcileRegistryLineage } from '../src/workers/registry-lineage-worker.ts';

describe('completed public scan lineage', () => {
  it('links existing and new identities, then remains idempotent', async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE agent_jobs (id text, tenant_id text, passport_id text, job_type text, status text, created_at timestamptz);
      CREATE TABLE repository_scan_sources (job_id text, tenant_id text, repository_owner text, repository_name text, resolved_commit_sha text, acquired_at timestamptz, default_branch text);
      CREATE TABLE software_registry_identities (
        id text PRIMARY KEY, provider text NOT NULL, canonical_key text NOT NULL,
        canonical_name text, repository_owner text, repository_name text, canonical_url text,
        first_observed_at timestamptz DEFAULT now(), last_observed_at timestamptz DEFAULT now(),
        latest_commit_sha text, default_branch text, next_refresh_at timestamptz,
        observation_count integer DEFAULT 0, updated_at timestamptz DEFAULT now(),
        UNIQUE(provider, canonical_key)
      );
      CREATE UNIQUE INDEX repo_unique ON software_registry_identities(provider, lower(repository_owner), lower(repository_name));
      CREATE TABLE software_registry_observations (
        id text PRIMARY KEY, identity_id text REFERENCES software_registry_identities(id),
        source_type text, source_locator text, observed_at timestamptz, commit_sha text,
        payload_hash text, outcome text, evidence jsonb,
        UNIQUE(identity_id, source_type, source_locator, commit_sha, payload_hash)
      );
      CREATE TABLE registry_ingestion_items (provider text, repository_owner text, repository_name text,
        identity_id text, canonical_key text, updated_at timestamptz);
      INSERT INTO software_registry_identities (id,provider,canonical_key,repository_owner,repository_name)
        VALUES ('existing-sha-id','github','github:acme/one','Acme','One');
      INSERT INTO registry_ingestion_items (provider,repository_owner,repository_name)
        VALUES ('github','Acme','One');
      INSERT INTO agent_jobs VALUES
        ('j1','tenant-free-review-system','p1','repository_scan','Completed','2026-09-25'),
        ('s1','tenant-free-review-system','p1','repository_security_scan','Completed','2026-09-25'),
        ('j2','tenant-free-review-system','p2','repository_scan','Completed','2026-09-25'),
        ('s2','tenant-free-review-system','p2','repository_security_scan','Completed','2026-09-25');
      INSERT INTO repository_scan_sources VALUES
        ('j1','tenant-free-review-system','Acme','One',repeat('a',40),'2026-09-25T10:00:00Z','main'),
        ('j2','tenant-free-review-system','Acme','Two',repeat('b',40),'2026-09-25T11:00:00Z','main');
    `);
    const pool = { connect: async () => ({ query: async (q: string) => { const result = await db.query(q); return { ...result, rowCount: result.affectedRows }; }, release: () => undefined }) };
    try {
      expect(await reconcileRegistryLineage(pool)).toEqual({ identities: 1, observations: 2 });
      expect(await reconcileRegistryLineage(pool)).toEqual({ identities: 0, observations: 0 });
      const identities = (await db.query('SELECT id, observation_count FROM software_registry_identities ORDER BY id')).rows as any[];
      expect(identities).toHaveLength(2);
      expect(identities.find(row => row.id === 'existing-sha-id')?.observation_count).toBe(1);
      expect((await db.query('SELECT identity_id FROM software_registry_observations WHERE evidence->>\'passportId\'=\'p1\'')).rows[0]).toMatchObject({ identity_id: 'existing-sha-id' });
      expect((await db.query('SELECT identity_id FROM registry_ingestion_items')).rows[0]).toMatchObject({ identity_id: 'existing-sha-id' });
    } finally { await db.close(); }
  });
});
