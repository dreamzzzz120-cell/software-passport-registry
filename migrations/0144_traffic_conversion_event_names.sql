BEGIN;

-- Keep the database event vocabulary aligned with the public ingestion API.
-- Preserve every historical event; widen the constraint for observed funnel events.
ALTER TABLE traffic_events DROP CONSTRAINT IF EXISTS traffic_events_event_name_check;
ALTER TABLE traffic_events ADD CONSTRAINT traffic_events_event_name_check CHECK (event_name IN (
  'page_view','free_review_started','free_review_completed','report_viewed','checkout_started',
  'lead_captured','pricing_view','signup_started','signup_completed','pilot_started',
  'customer_created','registry_claim_clicked','registry_share_clicked','referral_visit'
));

COMMIT;
