BEGIN;

ALTER TABLE traffic_events
  ADD COLUMN IF NOT EXISTS event_name text NOT NULL DEFAULT 'page_view',
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS medium text,
  ADD COLUMN IF NOT EXISTS campaign text,
  ADD COLUMN IF NOT EXISTS referral_code text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='traffic_events_event_name_check') THEN
    ALTER TABLE traffic_events ADD CONSTRAINT traffic_events_event_name_check CHECK (event_name IN (
      'page_view','free_review_started','free_review_completed','lead_captured','pricing_view',
      'signup_started','signup_completed','pilot_started','customer_created',
      'registry_claim_clicked','registry_share_clicked','referral_visit'
    ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS traffic_events_event_idx ON traffic_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS traffic_events_attribution_idx ON traffic_events (source, medium, campaign, occurred_at DESC);

CREATE TABLE IF NOT EXISTS growth_referral_links (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system' CHECK (tenant_id='tenant-free-review-system'),
  code text NOT NULL,
  owner_type text NOT NULL DEFAULT 'founder',
  owner_label text NOT NULL,
  destination_path text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  visits integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS growth_experiments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system' CHECK (tenant_id='tenant-free-review-system'),
  name text NOT NULL,
  surface text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','completed')),
  variants text NOT NULL DEFAULT '[]',
  metric text NOT NULL,
  started_at timestamp,
  ended_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS growth_registry_claims (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system' CHECK (tenant_id='tenant-free-review-system'),
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  source text NOT NULL DEFAULT 'registry',
  status text NOT NULL DEFAULT 'clicked' CHECK (status IN ('clicked','review_started','lead_captured','claimed','customer','dismissed')),
  session_id text,
  lead_id text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS growth_registry_claims_repo_idx ON growth_registry_claims (lower(repository_owner), lower(repository_name), updated_at DESC);

CREATE TABLE IF NOT EXISTS growth_content_opportunities (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant-free-review-system' CHECK (tenant_id='tenant-free-review-system'),
  kind text NOT NULL CHECK (kind IN ('aeo','seo','faq','comparison','registry','case_study')),
  topic text NOT NULL,
  target_path text,
  source_evidence text NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','planned','published','monitoring','retired')),
  observed_impressions integer NOT NULL DEFAULT 0,
  observed_clicks integer NOT NULL DEFAULT 0,
  observed_conversions integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS growth_content_opportunity_topic_unique ON growth_content_opportunities (tenant_id, kind, lower(topic));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['growth_referral_links','growth_experiments','growth_registry_claims','growth_content_opportunities']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='spr_tenant_isolation') THEN
      EXECUTE format('CREATE POLICY spr_tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_app_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO spr_app_runtime', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='spr_worker_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO spr_worker_runtime', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
