BEGIN;

-- Reachability, VEX and the finding state machine.
--
-- A raw OSV hit is not a risk statement. Without a reachability verdict and a
-- VEX disposition, every transitively-pulled advisory reads as an actionable
-- vulnerability, which is what turns a Passport into noise an MSP technician
-- learns to close unread. These columns give a finding somewhere to record
-- whether the vulnerable code is actually reachable, what the supplier's or
-- analyst's VEX disposition is, and how far through the claim/verification
-- pipeline it has travelled.
--
-- Text columns with CHECK constraints rather than Postgres ENUM types,
-- deliberately: this schema is written and read by Drizzle's sql tag and by
-- plain node-postgres in the workers, and an ENUM would need a migration for
-- every new value while a CHECK reads identically to both and can be widened in
-- place. Every column is added with a default so existing rows stay valid.

ALTER TABLE scan_findings
  ADD COLUMN IF NOT EXISTS vex_status text NOT NULL DEFAULT 'under_investigation',
  ADD COLUMN IF NOT EXISTS reachability text NOT NULL DEFAULT 'not_analyzed',
  ADD COLUMN IF NOT EXISTS confidence double precision NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'detected',
  ADD COLUMN IF NOT EXISTS psa_ticket_id text,
  ADD COLUMN IF NOT EXISTS last_psa_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_claim_by text,
  ADD COLUMN IF NOT EXISTS human_claim_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

-- The vocabularies. Anything outside them is rejected at the boundary rather
-- than being stored and quietly mishandled by a reader that has never heard of
-- it. NOT_ANALYZED and UNKNOWN are distinct on purpose: "we did not look" and
-- "we looked and could not tell" are different statements to a buyer.
ALTER TABLE scan_findings
  DROP CONSTRAINT IF EXISTS scan_findings_vex_status_check;
ALTER TABLE scan_findings
  ADD CONSTRAINT scan_findings_vex_status_check
  CHECK (vex_status IN ('not_affected', 'affected', 'fixed', 'under_investigation'));

ALTER TABLE scan_findings
  DROP CONSTRAINT IF EXISTS scan_findings_reachability_check;
ALTER TABLE scan_findings
  ADD CONSTRAINT scan_findings_reachability_check
  CHECK (reachability IN ('reachable', 'unreachable', 'unknown', 'not_analyzed'));

ALTER TABLE scan_findings
  DROP CONSTRAINT IF EXISTS scan_findings_state_check;
ALTER TABLE scan_findings
  ADD CONSTRAINT scan_findings_state_check
  CHECK (state IN (
    'detected',
    'claimed_false_positive',
    'under_verification',
    'verified_not_affected',
    'risk_accepted',
    'remediated_claimed',
    'remediated_verified'
  ));

-- Confidence is a probability, not a score out of a hundred. Constraining it
-- here stops a caller storing 85 and every reader interpreting it as 8500%.
ALTER TABLE scan_findings
  DROP CONSTRAINT IF EXISTS scan_findings_confidence_check;
ALTER TABLE scan_findings
  ADD CONSTRAINT scan_findings_confidence_check
  CHECK (confidence >= 0 AND confidence <= 1);

-- A PSA ticket maps to at most one finding per tenant. Without this, a webhook
-- replay or a technician re-linking a ticket silently fans a single human claim
-- out across several findings.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_findings_psa_ticket
  ON scan_findings (tenant_id, psa_ticket_id)
  WHERE psa_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scan_findings_tenant_asset_state
  ON scan_findings (tenant_id, asset_id, state);

COMMIT;
