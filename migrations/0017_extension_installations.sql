-- SPDX-License-Identifier: Apache-2.0
-- Persist first-party extension installations per tenant.
BEGIN;

CREATE TABLE IF NOT EXISTS extension_installations (
  tenant_id text NOT NULL,
  extension_id text NOT NULL,
  installed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, extension_id)
);

CREATE INDEX IF NOT EXISTS extension_installations_tenant_installed
  ON extension_installations (tenant_id, installed_at DESC);

COMMIT;
