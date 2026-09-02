ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS generation_reason text NOT NULL DEFAULT 'manual'
  CHECK (generation_reason IN ('manual','scheduled_refresh','evidence_change','finding_change','collector_recovery','system'));
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS generated_by_actor_id text;
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS generated_by_actor_type text NOT NULL DEFAULT 'user'
  CHECK (generated_by_actor_type IN ('user','worker','system'));
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS collector_version_map text NOT NULL DEFAULT '{}';
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS partially_known_dimension_count integer NOT NULL DEFAULT 0 CHECK (partially_known_dimension_count >= 0);
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS unavailable_dimension_count integer NOT NULL DEFAULT 0 CHECK (unavailable_dimension_count >= 0);
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS open_finding_count integer NOT NULL DEFAULT 0 CHECK (open_finding_count >= 0);
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS persisted_finding_count integer NOT NULL DEFAULT 0 CHECK (persisted_finding_count >= 0);
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE trust_observations ADD COLUMN IF NOT EXISTS created_at text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS trust_observations_tenant_idempotency_unique
  ON trust_observations (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS trust_observations_tenant_generated
  ON trust_observations (tenant_id, generated_at DESC, id DESC);

ALTER TABLE trust_observation_changes ADD COLUMN IF NOT EXISTS dimension text;
ALTER TABLE trust_observation_changes ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'informational'
  CHECK (severity IN ('informational','low','medium','high','critical'));
ALTER TABLE trust_observation_changes ADD COLUMN IF NOT EXISTS previous_value text NOT NULL DEFAULT 'null';
ALTER TABLE trust_observation_changes ADD COLUMN IF NOT EXISTS current_value text NOT NULL DEFAULT 'null';
ALTER TABLE trust_observation_changes ADD COLUMN IF NOT EXISTS evidence_ids text NOT NULL DEFAULT '[]';
ALTER TABLE trust_observation_changes ADD COLUMN IF NOT EXISTS finding_ids text NOT NULL DEFAULT '[]';
ALTER TABLE trust_observation_changes ADD COLUMN IF NOT EXISTS materiality_policy_version text NOT NULL DEFAULT 'spr.materiality.v1';

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS asset_id text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_change_event_id text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS first_observation_id text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_by text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolved_by text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS evidence_ids text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS finding_ids text;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS updated_at text;
CREATE INDEX IF NOT EXISTS alerts_tenant_state ON alerts (tenant_id, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS alerts_tenant_severity ON alerts (tenant_id, severity, timestamp DESC);
CREATE INDEX IF NOT EXISTS alerts_tenant_client ON alerts (tenant_id, client_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS alerts_tenant_asset ON alerts (tenant_id, asset_id, timestamp DESC);

-- Rollback guidance: columns may be left in place safely. Drop only the new indexes and
-- columns after proving no deployed application version reads them. Never reset tables.
