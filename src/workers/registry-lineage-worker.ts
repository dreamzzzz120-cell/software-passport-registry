/** Reconcile completed public scans into the append-only registry lineage. */
import { createWorkerPool } from './worker-db.ts';

const latest = `
  SELECT DISTINCT ON (lower(s.repository_owner), lower(s.repository_name))
    s.repository_owner AS owner, s.repository_name AS repository, j.passport_id,
    s.resolved_commit_sha AS commit_sha, s.acquired_at, s.default_branch
  FROM agent_jobs j
  JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
  WHERE j.tenant_id = 'tenant-free-review-system'
    AND j.job_type = 'repository_scan' AND j.status = 'Completed'
    AND s.acquired_at IS NOT NULL
    AND s.resolved_commit_sha ~ '^[a-f0-9]{40}$'
    AND EXISTS (
      SELECT 1 FROM agent_jobs sj
      WHERE sj.tenant_id = j.tenant_id AND sj.passport_id = j.passport_id
        AND sj.job_type = 'repository_security_scan' AND sj.status = 'Completed'
    )
  ORDER BY lower(s.repository_owner), lower(s.repository_name),
    s.acquired_at DESC, j.created_at DESC
`;

export async function reconcileRegistryLineage(pool: { connect: () => Promise<any> }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Keep the IDs already assigned by the crawler or the original backfill.
    // The canonical key and case-insensitive repository index settle races.
    const identities = await client.query(`
      WITH latest AS (${latest})
      INSERT INTO software_registry_identities
        (id, provider, canonical_key, canonical_name, repository_owner, repository_name,
         canonical_url, first_observed_at, last_observed_at, latest_commit_sha,
         default_branch, next_refresh_at)
      SELECT 'reg_' || md5('github:' || lower(l.owner) || '/' || lower(l.repository)),
        'github', 'github:' || lower(l.owner) || '/' || lower(l.repository),
        l.owner || '/' || l.repository, l.owner, l.repository,
        'https://github.com/' || l.owner || '/' || l.repository,
        l.acquired_at, l.acquired_at, l.commit_sha, l.default_branch,
        l.acquired_at + interval '30 days'
      FROM latest l
      WHERE NOT EXISTS (
        SELECT 1 FROM software_registry_identities r
        WHERE r.provider = 'github' AND lower(r.repository_owner) = lower(l.owner)
          AND lower(r.repository_name) = lower(l.repository)
      )
      ON CONFLICT DO NOTHING
    `);
    // A scan observation identifies its actual passport, commit and acquisition
    // time. Existing identities may have a different ID convention, so join to
    // the stored ID instead of recomputing it.
    const observations = await client.query(`
      WITH latest AS (${latest})
      INSERT INTO software_registry_observations
        (id, identity_id, source_type, source_locator, observed_at, commit_sha,
         payload_hash, outcome, evidence)
      SELECT 'regobs_' || md5('spr-free-review:' || l.passport_id || ':' || l.commit_sha || ':' || l.acquired_at::text),
        r.id, 'spr-free-review', 'https://github.com/' || l.owner || '/' || l.repository,
        l.acquired_at, l.commit_sha,
        md5('spr-free-review:' || l.passport_id || ':' || l.commit_sha || ':' || l.acquired_at::text),
        'observed',
        jsonb_build_object('passportId', l.passport_id, 'commitSha', l.commit_sha,
          'defaultBranch', l.default_branch, 'observedAt', l.acquired_at)
      FROM latest l
      JOIN software_registry_identities r ON r.provider = 'github'
        AND lower(r.repository_owner) = lower(l.owner)
        AND lower(r.repository_name) = lower(l.repository)
      WHERE NOT EXISTS (
        SELECT 1 FROM software_registry_observations o
        WHERE o.identity_id = r.id AND o.source_type = 'spr-free-review'
          AND o.evidence->>'passportId' = l.passport_id
          AND o.commit_sha = l.commit_sha AND o.observed_at = l.acquired_at
      )
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      UPDATE software_registry_identities r
      SET observation_count = q.n,
          last_observed_at = GREATEST(r.last_observed_at, q.latest),
          next_refresh_at = GREATEST(COALESCE(r.next_refresh_at, q.latest + interval '30 days'),
                                    q.latest + interval '30 days'),
          updated_at = CURRENT_TIMESTAMP
      FROM (
        SELECT identity_id, count(*)::int AS n, max(observed_at) AS latest
        FROM software_registry_observations GROUP BY identity_id
      ) q
      WHERE r.id = q.identity_id
        AND (r.observation_count IS DISTINCT FROM q.n OR r.last_observed_at < q.latest
          OR r.next_refresh_at IS NULL OR r.next_refresh_at < q.latest + interval '30 days')
    `);
    await client.query(`
      UPDATE registry_ingestion_items i
      SET identity_id = r.id, canonical_key = r.canonical_key, updated_at = CURRENT_TIMESTAMP
      FROM software_registry_identities r
      WHERE i.provider = 'github' AND r.provider = 'github'
        AND lower(i.repository_owner) = lower(r.repository_owner)
        AND lower(i.repository_name) = lower(r.repository_name)
        AND i.identity_id IS DISTINCT FROM r.id
    `);
    await client.query('COMMIT');
    return { identities: identities.rowCount ?? 0, observations: observations.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function runRegistryLineageLoop(): Promise<void> {
  const pool = createWorkerPool();
  try {
    const result = await reconcileRegistryLineage(pool);
    if (result.identities || result.observations) console.info('[RegistryLineage]', result);
  } finally {
    await pool.end();
  }
  await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
}
