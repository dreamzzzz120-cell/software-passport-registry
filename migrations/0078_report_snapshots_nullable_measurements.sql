BEGIN;

-- buildAndPersistReport deliberately keeps score, confidence and completeness
-- NULL when the passport has no measurement (deriveReportRiskFields: "null
-- stays null, never coalesced to 0"). The snapshot table contradicted that
-- with NOT NULL constraints, so persisting a report for any unverified
-- passport threw, and the Reports page failed for every newly registered
-- passport. Observed 2026-09-11 on the founder tenant's first repository
-- passport. NULL in these columns means "not measured", which is the truth.
ALTER TABLE trust_report_snapshots ALTER COLUMN score DROP NOT NULL;
ALTER TABLE trust_report_snapshots ALTER COLUMN confidence_basis_points DROP NOT NULL;
ALTER TABLE trust_report_snapshots ALTER COLUMN completeness_basis_points DROP NOT NULL;

COMMIT;
