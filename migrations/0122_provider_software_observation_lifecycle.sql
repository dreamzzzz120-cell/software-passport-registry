BEGIN;

ALTER TABLE provider_software_observations
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE','ABSENT')),
  ADD COLUMN IF NOT EXISTS last_seen_run_id text,
  ADD COLUMN IF NOT EXISTS absent_since timestamp;

UPDATE provider_software_observations
   SET last_seen_run_id = collection_run_id
 WHERE last_seen_run_id IS NULL AND collection_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS provider_software_observations_lifecycle_idx
  ON provider_software_observations (tenant_id, provider_customer_id, lifecycle_status);

CREATE OR REPLACE FUNCTION reconcile_provider_software_inventory_lifecycle(
  p_run_id text,
  p_tenant_id text
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  run_provider text;
  run_customer_id text;
  run_completed_at timestamp;
  changed_count integer := 0;
BEGIN
  SELECT provider, provider_customer_id, completed_at
    INTO run_provider, run_customer_id, run_completed_at
    FROM provider_software_inventory_runs
   WHERE id = p_run_id AND tenant_id = p_tenant_id AND status = 'COMPLETE';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOFTWARE_LIFECYCLE_REQUIRES_COMPLETE_RUN';
  END IF;

  UPDATE provider_software_observations
     SET lifecycle_status = 'ACTIVE',
         absent_since = NULL,
         last_seen_run_id = p_run_id
   WHERE tenant_id = p_tenant_id
     AND provider = run_provider
     AND provider_customer_id = run_customer_id
     AND (collection_run_id = p_run_id OR last_seen_run_id = p_run_id);

  UPDATE provider_software_observations previous
     SET lifecycle_status = 'ABSENT',
         absent_since = COALESCE(previous.absent_since, run_completed_at)
   WHERE previous.tenant_id = p_tenant_id
     AND previous.provider = run_provider
     AND previous.provider_customer_id = run_customer_id
     AND previous.lifecycle_status = 'ACTIVE'
     AND previous.collection_run_id IS DISTINCT FROM p_run_id
     AND NOT EXISTS (
       SELECT 1
         FROM provider_software_observations current
        WHERE current.tenant_id = p_tenant_id
          AND current.provider = run_provider
          AND current.provider_customer_id = run_customer_id
          AND (current.collection_run_id = p_run_id OR current.last_seen_run_id = p_run_id)
          AND current.external_device_id = previous.external_device_id
          AND current.observation_hash = previous.observation_hash
     );

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count;
END;
$$;

COMMIT;
