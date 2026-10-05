BEGIN;

-- 0130: Durable tenant-scoped receipts for SPR Agent recommendations and confirmed actions.
-- Append-only audit evidence: what was proposed, who approved it, what route ran, and what outcome was observed.
-- Forward-reassert main's 0129 operational self-heal because an earlier preview build may have
-- recorded a different 0129 before main advanced. This is idempotent on clean databases and
-- repairs that migration-ledger collision if it happened.
UPDATE reality_contracts
   SET repair_class = 1,
       updated_at = now()
 WHERE id IN ('worker_queue_flow', 'scan_terminality');

UPDATE schema_migrations
   SET description = 'reality reconciliation self heal'
 WHERE version = '0129'
   AND description = 'agent interaction receipts';

CREATE TABLE IF NOT EXISTS agent_interaction_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  interaction_kind TEXT NOT NULL CHECK (interaction_kind IN ('recommendation','proposal','execution','failure')),
  intent TEXT NOT NULL,
  input_text TEXT,
  proposed_action_id TEXT,
  proposed_action_type TEXT,
  proposed_endpoint TEXT,
  proposed_method TEXT,
  observed_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmation JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  parent_receipt_id TEXT REFERENCES agent_interaction_receipts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_interaction_receipts_tenant_time
  ON agent_interaction_receipts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_interaction_receipts_action
  ON agent_interaction_receipts(tenant_id, proposed_action_id, created_at DESC);

ALTER TABLE agent_interaction_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_interaction_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spr_tenant_isolation ON agent_interaction_receipts;
CREATE POLICY spr_tenant_isolation ON agent_interaction_receipts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS spr_worker_cross_tenant ON agent_interaction_receipts;
CREATE POLICY spr_worker_cross_tenant ON agent_interaction_receipts
  FOR ALL TO spr_worker_runtime
  USING (current_user = 'spr_worker_runtime')
  WITH CHECK (current_user = 'spr_worker_runtime');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
    GRANT SELECT, INSERT ON agent_interaction_receipts TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
    GRANT SELECT, INSERT ON agent_interaction_receipts TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
