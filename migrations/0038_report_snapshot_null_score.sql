BEGIN;

-- Real production defect, found via live adversarial testing: GET
-- /trust-loop/reports/:passportId has always 500'd for any passport that
-- has never received a confidently computable score (score/confidence
-- legitimately null -- src/trust/scoring-engine.ts returns null for both
-- whenever totalUnits===0 or knownUnits===0, the same real, supported
-- state that migration 0026 already made trust_observations.
-- confidence_basis_points nullable for). trust_report_snapshots was never
-- given the same treatment: score and confidence_basis_points are still
-- NOT NULL, so the INSERT in buildAndPersistReport (which correctly stops
-- fabricating a 0, per an earlier fix this session) fails with a 23502
-- not-null violation instead. completeness_basis_points is left NOT NULL
-- -- it's always a real, computable number (0 when there's no evidence at
-- all), never legitimately absent, unlike score/confidence.
ALTER TABLE trust_report_snapshots ALTER COLUMN score DROP NOT NULL;
ALTER TABLE trust_report_snapshots ALTER COLUMN confidence_basis_points DROP NOT NULL;

COMMIT;
