BEGIN;

-- Scoring integrity fix. Two independent pipelines (src/utils/scanner.ts and
-- src/trust/trust-loop.ts) wrote passports.overall_score/security_score/
-- compliance_score with different formulas, and a passport with almost no
-- evidence could still receive overall_score=100 from trust-loop.ts (no
-- observations => no open findings => risk penalty 0 => score 100), while a
-- never-scanned passport sat at the old NOT NULL DEFAULT 0. Both are the
-- same real state -- "we don't have enough evidence to judge this software"
-- -- rendered as opposite-looking numbers. See src/trust/scoring-engine.ts
-- for the single canonical calculation that replaces both formulas.
--
-- This migration makes "no legitimate score yet" representable as NULL
-- instead of a fabricated 0 or 100, and adds explicit confidence/
-- completeness/verification-status columns so a score is never displayed
-- without how much evidence backs it.

ALTER TABLE passports ALTER COLUMN overall_score DROP NOT NULL;
ALTER TABLE passports ALTER COLUMN overall_score DROP DEFAULT;
ALTER TABLE passports ALTER COLUMN security_score DROP NOT NULL;
ALTER TABLE passports ALTER COLUMN security_score DROP DEFAULT;
ALTER TABLE passports ALTER COLUMN compliance_score DROP NOT NULL;
ALTER TABLE passports ALTER COLUMN compliance_score DROP DEFAULT;
ALTER TABLE passports ALTER COLUMN vendor_reputation_score DROP NOT NULL;
ALTER TABLE passports ALTER COLUMN vendor_reputation_score DROP DEFAULT;

ALTER TABLE passports ADD COLUMN IF NOT EXISTS confidence_score integer;
ALTER TABLE passports ADD COLUMN IF NOT EXISTS evidence_completeness integer;
ALTER TABLE passports ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','partial','verified'));

-- Backfill, existing data only -- the runtime engine above governs every
-- score written from this point forward.
--
-- A passport with no evidence anywhere (empty `evidence` column and no rows
-- in any of the four tables real evidence/findings can live in) never had a
-- legitimate score to begin with; its old 0 (or trust-loop's optimistic 100)
-- is discarded rather than preserved, because keeping it would be exactly
-- the "unknown looks like a real measurement" bug this migration exists to
-- fix.
UPDATE passports p
SET overall_score = NULL,
    security_score = NULL,
    compliance_score = NULL,
    vendor_reputation_score = NULL,
    confidence_score = NULL,
    evidence_completeness = 0,
    verification_status = 'unverified'
WHERE (p.evidence IS NULL OR p.evidence = '[]' OR p.evidence = '')
  AND NOT EXISTS (SELECT 1 FROM evidence_items ei WHERE ei.asset_id = p.id AND ei.tenant_id = p.tenant_id)
  AND NOT EXISTS (SELECT 1 FROM evidence_ledger el WHERE el.passport_id = p.id AND el.tenant_id = p.tenant_id)
  AND NOT EXISTS (SELECT 1 FROM scan_findings sf WHERE sf.asset_id = p.id AND sf.tenant_id = p.tenant_id)
  AND NOT EXISTS (SELECT 1 FROM trust_observations tro WHERE tro.passport_id = p.id AND tro.tenant_id = p.tenant_id);

-- A passport that does have evidence keeps its existing score untouched
-- (nothing here overwrites or reinterprets a real historical measurement).
-- It is marked 'partial' rather than 'verified' because historical
-- completeness/confidence were never tracked before this migration --
-- claiming full verification now would fabricate a figure nobody computed.
UPDATE passports p
SET verification_status = 'partial'
WHERE p.verification_status = 'unverified'
  AND (
    (p.evidence IS NOT NULL AND p.evidence <> '[]' AND p.evidence <> '')
    OR EXISTS (SELECT 1 FROM evidence_items ei WHERE ei.asset_id = p.id AND ei.tenant_id = p.tenant_id)
    OR EXISTS (SELECT 1 FROM evidence_ledger el WHERE el.passport_id = p.id AND el.tenant_id = p.tenant_id)
    OR EXISTS (SELECT 1 FROM scan_findings sf WHERE sf.asset_id = p.id AND sf.tenant_id = p.tenant_id)
    OR EXISTS (SELECT 1 FROM trust_observations tro WHERE tro.passport_id = p.id AND tro.tenant_id = p.tenant_id)
  );

COMMIT;
