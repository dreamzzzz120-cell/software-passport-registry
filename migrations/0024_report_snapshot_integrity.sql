BEGIN;

-- Report snapshot integrity fix, follow-up to 0023_passport_score_integrity.
-- src/routes/trust-loop.ts:buildAndPersistReport wrote
-- Number(passport.overall_score ?? 0) into trust_report_snapshots.score,
-- silently turning an unverified passport's null score into a permanent,
-- immutable "0" in report history -- even though the same row's own
-- `payload` JSON blob correctly recorded risk.overall as null. A report is
-- meant to be a durable, trustworthy record of what was actually known at
-- generation time; it must not contradict itself.
--
-- confidence_basis_points/completeness_basis_points are not touched here:
-- 0% completeness for zero evidence is a true, non-fabricated value (unlike
-- a "0" trust score, which implies a measurement that never happened).

ALTER TABLE trust_report_snapshots ALTER COLUMN score DROP NOT NULL;
ALTER TABLE trust_report_snapshots ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','partial','verified'));

-- Backfill existing snapshots. There is no way to tell, after the fact,
-- whether a stored `score = 0` was a real measurement or this bug -- so
-- existing rows are NOT rewritten to null (that would risk erasing a
-- legitimate historical 0, which this migration has no evidence either way
-- about). They are marked 'partial' rather than 'unverified' or 'verified':
-- the row exists with *some* score and completeness data, so it was not
-- nothing, but no historical row can now be proven to meet the 'verified'
-- completeness bar. New snapshots generated after this migration get their
-- real verification_status from the canonical passport state at generation
-- time; only pre-existing rows fall back to this conservative default.
UPDATE trust_report_snapshots SET verification_status = 'partial';

COMMIT;
