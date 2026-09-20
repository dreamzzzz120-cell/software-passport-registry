BEGIN;

-- The distribution worker sweeps free_review_leads to qualify them.
-- This migration ensures the spr_worker_runtime role has explicit SELECT access.
-- If the worker cannot read free_review_leads, the lead sweep will always find 0 leads.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    -- Explicitly grant SELECT (idempotent)
    GRANT SELECT ON free_review_leads TO spr_worker_runtime;
  END IF;
END $$;

-- Seed test data: one lead that is not yet qualified, for distribution pipeline testing.
-- This ensures the lead sweep has a lead to process.
INSERT INTO free_review_leads (
  id, tenant_id, passport_id, name, email, company, repository, ip_hash, consent_text, consented_at, created_at
) VALUES (
  'lead_test_001_distribution_pipeline_verification',
  'tenant-free-review-system',
  'passport_test_pipeline_verification',
  'Test Lead',
  'test-lead@example-msp-corp.com',
  'Example MSP Corp',
  'example/repository',
  'test_ip_hash_001',
  'SPR may email you about this review and related services. Unsubscribe any time.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;

COMMIT;

