BEGIN;

-- 0112: backfill the living registry from already-observed public Free Reviews.
-- These rows are derived only from completed SPR scans; no vendor metadata or
-- trust claims are introduced. Unknown popularity is NULL, never fabricated as 0.

ALTER TABLE public.software_registry_identities
  ALTER COLUMN stars DROP NOT NULL,
  ALTER COLUMN stars DROP DEFAULT;
UPDATE public.software_registry_identities SET stars = NULL WHERE stars = 0;

WITH latest AS (
  SELECT DISTINCT ON (lower(s.repository_owner), lower(s.repository_name))
    s.repository_owner AS owner, s.repository_name AS repository, j.passport_id,
    s.resolved_commit_sha AS commit_sha, s.acquired_at, s.default_branch
  FROM agent_jobs j
  JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
  WHERE j.tenant_id = 'tenant-free-review-system' AND j.job_type = 'repository_scan' AND j.status = 'Completed'
    AND EXISTS (SELECT 1 FROM agent_jobs sj WHERE sj.tenant_id = j.tenant_id AND sj.passport_id = j.passport_id
      AND sj.job_type = 'repository_security_scan' AND sj.status = 'Completed')
  ORDER BY lower(s.repository_owner), lower(s.repository_name), s.acquired_at DESC NULLS LAST, j.created_at DESC
)
INSERT INTO software_registry_identities
  (id, provider, canonical_key, canonical_name, repository_owner, repository_name, canonical_url,
   first_observed_at, last_observed_at, latest_commit_sha, default_branch, next_refresh_at, observation_count, updated_at)
SELECT
  'reg_' || md5('github:' || lower(owner) || '/' || lower(repository)), 'github',
  'github:' || lower(owner) || '/' || lower(repository), owner || '/' || repository,
  owner, repository, 'https://github.com/' || owner || '/' || repository,
  COALESCE(acquired_at, CURRENT_TIMESTAMP), COALESCE(acquired_at, CURRENT_TIMESTAMP),
  commit_sha, default_branch, COALESCE(acquired_at, CURRENT_TIMESTAMP) + INTERVAL '30 days', 1, CURRENT_TIMESTAMP
FROM latest
ON CONFLICT (provider, canonical_key) DO UPDATE SET
  canonical_name=EXCLUDED.canonical_name, repository_owner=EXCLUDED.repository_owner,
  repository_name=EXCLUDED.repository_name, canonical_url=EXCLUDED.canonical_url,
  last_observed_at=GREATEST(software_registry_identities.last_observed_at, EXCLUDED.last_observed_at),
  latest_commit_sha=EXCLUDED.latest_commit_sha, default_branch=EXCLUDED.default_branch,
  next_refresh_at=COALESCE(software_registry_identities.next_refresh_at, EXCLUDED.next_refresh_at),
  observation_count=GREATEST(software_registry_identities.observation_count, EXCLUDED.observation_count),
  updated_at=CURRENT_TIMESTAMP;

WITH latest AS (
  SELECT DISTINCT ON (lower(s.repository_owner), lower(s.repository_name))
    s.repository_owner AS owner, s.repository_name AS repository, j.passport_id,
    s.resolved_commit_sha AS commit_sha, s.acquired_at, s.default_branch
  FROM agent_jobs j
  JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
  WHERE j.tenant_id = 'tenant-free-review-system' AND j.job_type = 'repository_scan' AND j.status = 'Completed'
    AND EXISTS (SELECT 1 FROM agent_jobs sj WHERE sj.tenant_id = j.tenant_id AND sj.passport_id = j.passport_id
      AND sj.job_type = 'repository_security_scan' AND sj.status = 'Completed')
  ORDER BY lower(s.repository_owner), lower(s.repository_name), s.acquired_at DESC NULLS LAST, j.created_at DESC
)
INSERT INTO software_registry_observations
  (id, identity_id, source_type, source_locator, observed_at, commit_sha, payload_hash, outcome, evidence)
SELECT
  'regobs_' || md5('spr-free-review:' || passport_id),
  'reg_' || md5('github:' || lower(owner) || '/' || lower(repository)),
  'spr-free-review', 'https://github.com/' || owner || '/' || repository,
  COALESCE(acquired_at, CURRENT_TIMESTAMP), commit_sha,
  md5('spr-free-review:' || passport_id || ':' || COALESCE(commit_sha, 'unknown')),
  'observed',
  jsonb_build_object('passportId', passport_id, 'commitSha', commit_sha, 'defaultBranch', default_branch,
                     'observedAt', COALESCE(acquired_at, CURRENT_TIMESTAMP))
FROM latest
ON CONFLICT (id) DO NOTHING;

UPDATE software_registry_identities r
SET observation_count=q.observation_count, updated_at=CURRENT_TIMESTAMP
FROM (SELECT identity_id, count(*)::int AS observation_count FROM software_registry_observations GROUP BY identity_id) q
WHERE r.id=q.identity_id;

INSERT INTO registry_ingestion_items
  (id, provider, repository_owner, repository_name, canonical_url, status, identity_id, canonical_key,
   discovered_at, last_observed_at, next_refresh_at, quality_status, refresh_reason, observation_count, updated_at)
SELECT
  'reging_' || r.id, r.provider, r.repository_owner, r.repository_name, r.canonical_url, 'observed',
  r.id, r.canonical_key, r.first_observed_at, r.last_observed_at, r.next_refresh_at, 'partial',
  'backfilled_from_completed_scan', r.observation_count, CURRENT_TIMESTAMP
FROM software_registry_identities r
WHERE r.provider='github' AND r.repository_owner IS NOT NULL AND r.repository_name IS NOT NULL
ON CONFLICT (provider, repository_owner, repository_name) DO UPDATE SET
  identity_id=EXCLUDED.identity_id, canonical_key=EXCLUDED.canonical_key,
  last_observed_at=GREATEST(registry_ingestion_items.last_observed_at, EXCLUDED.last_observed_at),
  next_refresh_at=COALESCE(registry_ingestion_items.next_refresh_at, EXCLUDED.next_refresh_at),
  observation_count=GREATEST(registry_ingestion_items.observation_count, EXCLUDED.observation_count),
  updated_at=CURRENT_TIMESTAMP;

COMMIT;
