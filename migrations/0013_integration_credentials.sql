CREATE TABLE IF NOT EXISTS integration_credentials (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  provider text NOT NULL,
  encrypted_payload text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_tested_at timestamp,
  status text NOT NULL DEFAULT 'UNTESTED',
  UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS integration_credentials_tenant_idx
  ON integration_credentials (tenant_id);

CREATE INDEX IF NOT EXISTS integration_credentials_provider_idx
  ON integration_credentials (provider);
