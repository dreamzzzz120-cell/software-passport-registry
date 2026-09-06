-- 0071: Vendor reputation_score / overall_trust_score must never claim
-- evidence that doesn't exist. Every new vendor previously defaulted to 70/100
-- on both columns -- a specific, quantified "Fair" trust rating asserted
-- before a single audit was ever lodged for that vendor, directly
-- contradicting this codebase's own stated rule that an audit in
-- 'Under Review' status "has no score impact -- it isn't evidence of
-- anything yet" (src/routes/vendors.ts). No agent or schema default creates
-- trust; evidence creates trust.
--
-- Fix: drop the fabricated default going forward, make both columns
-- nullable, and backfill only vendors that are provably untouched by any
-- real evidence -- exactly 70 on both columns AND zero rows in
-- vendor_audits. Any vendor with real audit history is left exactly as-is:
-- recomputing its historical score from a different assumed baseline is a
-- separate policy decision, not a schema fix, and is not made here.

BEGIN;

ALTER TABLE vendors ALTER COLUMN reputation_score DROP DEFAULT;
ALTER TABLE vendors ALTER COLUMN reputation_score DROP NOT NULL;
ALTER TABLE vendors ALTER COLUMN overall_trust_score DROP DEFAULT;
ALTER TABLE vendors ALTER COLUMN overall_trust_score DROP NOT NULL;

UPDATE vendors
SET reputation_score = NULL, overall_trust_score = NULL
WHERE reputation_score = 70
  AND overall_trust_score = 70
  AND NOT EXISTS (SELECT 1 FROM vendor_audits WHERE vendor_audits.vendor_id = vendors.id);

COMMIT;
