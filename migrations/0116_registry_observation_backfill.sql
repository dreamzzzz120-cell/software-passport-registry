BEGIN;

-- Restore the observation lineage for completed public Free Review scans.
-- Only acquired commits with a persisted passport and completed security scan qualify.
WITH latest AS (
  SELECT DISTINCT ON (lower(s.repository_owner), lower(s.repository_name))
    s.repository_owner AS owner, s.repository_name AS repository,
    s.resolved_commit_sha AS commit_sha, s.acquired_at, s.default_branch
  FROM agent_jobs j
  JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
  JOIN passports p ON p.id = j.passport_id AND p.tenant_id = j.tenant_id
  WHERE j.tenant_id = 'tenant-free-review-system'
    AND j.job_type = 'repository_scan' AND j.status = 'Completed'
    AND s.acquired_at IS NOT NULL AND s.resolved_commit_sha ~ '^[a-f0-9]{40}$'
    AND EXISTS (SELECT 1 FROM agent_jobs sj
      WHERE sj.tenant_id = j.tenant_id AND sj.passport_id = j.passport_id
        AND sj.job_type = 'repository_security_scan' AND sj.status = 'Completed')
  ORDER BY lower(s.repository_owner), lower(s.repository_name), s.acquired_at DESC, j.created_at DESC
)
INSERT INTO software_registry_identities
  (id, provider, canonical_key, canonical_name, repository_owner, repository_name, canonical_url,
   first_observed_at, last_observed_at, latest_commit_sha, default_branch, next_refresh_at, observation_count)
SELECT 'reg_' || md5('github:' || lower(owner) || '/' || lower(repository)),
  'github', 'github:' || lower(owner) || '/' || lower(repository),
  owner || '/' || repository, owner, repository,
  'https://github.com/' || owner || '/' || repository,
  acquired_at, acquired_at, commit_sha, default_branch, acquired_at + INTERVAL '30 days', 0
FROM latest
ON CONFLICT (provider, canonical_key) DO UPDATE SET
  last_observed_at = GREATEST(software_registry_identities.last_observed_at, EXCLUDED.last_observed_at),
  latest_commit_sha = CASE WHEN EXCLUDED.last_observed_at >= software_registry_identities.last_observed_at
    THEN EXCLUDED.latest_commit_sha ELSE software_registry_identities.latest_commit_sha END,
  updated_at = CURRENT_TIMESTAMP;

WITH completed AS (
  SELECT DISTINCT ON (j.passport_id, s.resolved_commit_sha)
    j.passport_id, s.repository_owner AS owner, s.repository_name AS repository,
    s.resolved_commit_sha AS commit_sha, s.acquired_at, s.default_branch
  FROM agent_jobs j
  JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
  JOIN passports p ON p.id = j.passport_id AND p.tenant_id = j.tenant_id
  WHERE j.tenant_id = 'tenant-free-review-system'
    AND j.job_type = 'repository_scan' AND j.status = 'Completed'
    AND s.acquired_at IS NOT NULL AND s.resolved_commit_sha ~ '^[a-f0-9]{40}$'
    AND EXISTS (SELECT 1 FROM agent_jobs sj
      WHERE sj.tenant_id = j.tenant_id AND sj.passport_id = j.passport_id
        AND sj.job_type = 'repository_security_scan' AND sj.status = 'Completed')
  ORDER BY j.passport_id, s.resolved_commit_sha, s.acquired_at DESC
)
INSERT INTO software_registry_observations
  (id, identity_id, source_type, source_locator, observed_at, commit_sha, payload_hash, outcome, evidence)
SELECT 'regobs_' || md5('spr-free-review:' || c.passport_id || ':' || c.commit_sha),
  r.id, 'spr-free-review', 'https://github.com/' || c.owner || '/' || c.repository,
  c.acquired_at, c.commit_sha,
  md5('spr-free-review:' || c.passport_id || ':' || c.commit_sha), 'observed',
  jsonb_build_object('passportId', c.passport_id, 'commitSha', c.commit_sha,
    'defaultBranch', c.default_branch, 'observedAt', c.acquired_at)
FROM completed c
JOIN software_registry_identities r ON r.provider = 'github'
  AND r.canonical_key = 'github:' || lower(c.owner) || '/' || lower(c.repository)
ON CONFLICT DO NOTHING;

UPDATE software_registry_identities r
SET observation_count = q.observation_count, updated_at = CURRENT_TIMESTAMP
FROM (SELECT identity_id, count(*)::int AS observation_count
      FROM software_registry_observations GROUP BY identity_id) q
WHERE r.id = q.identity_id AND r.observation_count IS DISTINCT FROM q.observation_count;

COMMIT;
