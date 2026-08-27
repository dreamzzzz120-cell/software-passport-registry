BEGIN;

-- Same bug class as 0023 (passports.overall_score) and the confidence half of
-- 0024's trust_report_snapshots fix, found in a third location this pass:
-- src/trust/trust-loop.ts:persistTrustLoop wrote
--   const score = canonicalResult.overallScore ?? 0;
--   const confidence = Math.round((canonicalResult.confidenceScore ?? 0) * 100);
-- calculateCanonicalScores returns overallScore/confidenceScore as null when
-- zero evidence units are actually known (totalUnits===0 || knownUnits===0)
-- -- a real, current-day case, since an observation batch can be entirely
-- UNKNOWN-status controls. The ?? 0 silently turned that "no measurement"
-- state into a fabricated score/confidence of zero inside:
--   - trust_observations.confidence_basis_points (this column)
--   - trust_observations.immutable_payload (the JSON `score` field)
--   - passports.timeline (JSON snapshot entries)
--   - outgoing webhooks (evidence.updated / trust.changed / passport.updated)
-- trust_observations is an append-only, immutable audit ledger and the
-- source for change detection/monitoring, so this is not cosmetic: a
-- monitoring diff between two observations could read a real change from
-- unknown->measured as if the passport had "improved" from a fabricated 0.
--
-- completeness_basis_points is NOT touched here: unlike confidence, it is
-- computed directly from known/total observation counts in persistTrustLoop
-- itself (never from calculateCanonicalScores), and persistTrustLoop
-- requires at least one observation, so it is always a real, non-fabricated
-- percentage -- same reasoning as 0024's completeness carve-out.

ALTER TABLE trust_observations ALTER COLUMN confidence_basis_points DROP NOT NULL;
ALTER TABLE trust_observations ALTER COLUMN confidence_basis_points DROP DEFAULT;

-- Backfill: there is no way to tell, after the fact, whether an existing
-- row's confidence_basis_points=0 was a real measurement or this bug, so
-- existing rows are left untouched (same conservative stance as 0024).
-- Only observations generated after this migration get real null-preserving
-- values.

COMMIT;
