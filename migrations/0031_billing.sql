BEGIN;

-- Real billing backend (previously: `stripe` was a listed dependency,
-- STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET were configured, but the SDK was
-- never imported anywhere -- no checkout, no subscriptions, no webhook
-- handling, no entitlement tracking existed at all). This is the minimal
-- real schema for it: one subscription row per tenant, plus a webhook
-- event log for idempotency (Stripe redelivers events; the same event id
-- must never be applied twice).
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id text PRIMARY KEY,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text CHECK (plan IN ('starter', 'growth', 'enterprise')),
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  client_limit integer,
  current_period_end timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscriptions_stripe_customer_idx ON tenant_subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscriptions_stripe_subscription_idx ON tenant_subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- No tenant_id column -- a Stripe event is a fact about Stripe's own event
-- stream, not tenant-scoped data, and the webhook handler runs with the
-- owner DB connection (no per-request tenant context exists for a
-- server-to-server callback) the same way resolveAgentPassport does.
CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  EXECUTE 'ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_subscriptions' AND policyname = 'spr_tenant_isolation') THEN
    EXECUTE 'CREATE POLICY spr_tenant_isolation ON tenant_subscriptions USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_subscriptions TO spr_app_runtime;
    GRANT SELECT, INSERT ON billing_webhook_events TO spr_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_subscriptions TO spr_worker_runtime;
    GRANT SELECT, INSERT ON billing_webhook_events TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;
