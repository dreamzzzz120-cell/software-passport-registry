BEGIN;

ALTER TABLE provider_software_observations
  ADD COLUMN IF NOT EXISTS collection_run_id text;

CREATE INDEX IF NOT EXISTS provider_software_observations_run_idx
  ON provider_software_observations (tenant_id, collection_run_id);

CREATE OR REPLACE FUNCTION finalize_provider_software_inventory_run(
  p_run_id text,
  p_tenant_id text,
  p_status text,
  p_limitation_code text,
  p_limitation text,
  p_completed_at timestamp,
  p_observations jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  item jsonb;
  inserted_count integer := 0;
  row_count integer := 0;
  run_provider text;
  run_customer_id text;
BEGIN
  IF p_status NOT IN ('COMPLETE','PARTIAL','UNSUPPORTED') THEN
    RAISE EXCEPTION 'INVALID_SOFTWARE_INVENTORY_TERMINAL_STATUS';
  END IF;

  SELECT provider, provider_customer_id
    INTO run_provider, run_customer_id
    FROM provider_software_inventory_runs
   WHERE id = p_run_id AND tenant_id = p_tenant_id AND status = 'RUNNING'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOFTWARE_INVENTORY_RUN_NOT_RUNNING';
  END IF;

  IF jsonb_typeof(p_observations) <> 'array' THEN
    RAISE EXCEPTION 'SOFTWARE_OBSERVATIONS_NOT_ARRAY';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_observations)
  LOOP
    INSERT INTO provider_software_observations (
      id, tenant_id, provider, provider_customer_id, client_id,
      external_device_id, external_software_id, observed_name,
      observed_publisher, observed_version, observed_product_code,
      observed_package_id, canonical_name, canonical_publisher,
      canonical_version, normalization_disposition,
      normalization_confidence, passport_id, source_observed_at,
      collected_at, freshness_state, raw_observation,
      observation_hash, collection_run_id
    ) VALUES (
      item->>'id', p_tenant_id, run_provider, run_customer_id,
      NULLIF(item->>'clientId',''), item->>'externalDeviceId',
      NULLIF(item->>'externalSoftwareId',''), item->>'observedName',
      NULLIF(item->>'observedPublisher',''), NULLIF(item->>'observedVersion',''),
      NULLIF(item->>'observedProductCode',''), NULLIF(item->>'observedPackageId',''),
      item->>'canonicalName', NULLIF(item->>'canonicalPublisher',''),
      NULLIF(item->>'canonicalVersion',''), item->>'normalizationDisposition',
      (item->>'normalizationConfidence')::numeric, NULL,
      (item->>'sourceObservedAt')::timestamp, p_completed_at,
      item->>'freshnessState', item->'rawObservation',
      item->>'observationHash', p_run_id
    )
    ON CONFLICT (tenant_id, provider, provider_customer_id, external_device_id, observation_hash)
    DO NOTHING;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    inserted_count := inserted_count + row_count;
  END LOOP;

  UPDATE provider_software_inventory_runs
     SET status = p_status,
         observations_fetched = jsonb_array_length(p_observations),
         limitation_code = p_limitation_code,
         limitation = p_limitation,
         completed_at = p_completed_at
   WHERE id = p_run_id AND tenant_id = p_tenant_id AND status = 'RUNNING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOFTWARE_INVENTORY_RUN_FINALIZE_FAILED';
  END IF;

  RETURN inserted_count;
END;
$$;

COMMIT;
