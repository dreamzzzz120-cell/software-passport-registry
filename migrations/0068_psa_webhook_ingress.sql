BEGIN;

-- Inbound PSA/RMM webhook endpoints are tenant-owned opaque handles. Secrets are
-- encrypted at rest by the application credential vault; only the SHA-256 hash
-- is kept here for audit/integrity checks.
CREATE TABLE IF NOT EXISTS psa_webhook_endpoints (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('connectwise','autotask','ninjaone')),
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  secret_ciphertext text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at timestamptz
);

CREATE INDEX IF NOT EXISTS psa_webhook_endpoints_tenant_provider
  ON psa_webhook_endpoints (tenant_id, provider, active);

CREATE TABLE IF NOT EXISTS psa_webhook_events (
  id text PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES psa_webhook_endpoints(id),
  tenant_id text NOT NULL,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  ticket_id text,
  event_type text NOT NULL DEFAULT 'unknown',
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at timestamptz,
  processing_error text,
  UNIQUE (endpoint_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS psa_webhook_events_tenant_ticket
  ON psa_webhook_events (tenant_id, provider, ticket_id, received_at DESC);

ALTER TABLE scan_findings
  ADD COLUMN IF NOT EXISTS psa_provider text;

ALTER TABLE scan_findings
  DROP CONSTRAINT IF EXISTS scan_findings_psa_provider_check;
ALTER TABLE scan_findings
  ADD CONSTRAINT scan_findings_psa_provider_check
  CHECK (psa_provider IS NULL OR psa_provider IN ('connectwise','autotask','ninjaone'));

-- The same ticket number can exist in different PSA products, so the provider
-- is part of the identity. This replaces the broader 0067 uniqueness rule.
DROP INDEX IF EXISTS idx_scan_findings_psa_ticket;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_findings_psa_ticket_provider
  ON scan_findings (tenant_id, psa_provider, psa_ticket_id)
  WHERE psa_ticket_id IS NOT NULL AND psa_provider IS NOT NULL;

COMMIT;
