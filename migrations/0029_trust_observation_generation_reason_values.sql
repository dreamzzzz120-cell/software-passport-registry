BEGIN;

-- Real production bug, found via live testing: trust_observations_generation_reason_check
-- only allowed ('manual','scheduled_refresh','evidence_change','finding_change',
-- 'collector_recovery','system'), but the two real call sites that actually
-- write trust_observations use values outside that list --
--   src/routes/trust-loop.ts:  generationReason: 'provider_collection'   (manual UI-triggered collection)
--   src/workers/trust-monitoring-worker.ts: generationReason: 'scheduled_collection' (background monitoring)
-- Combined with the ON CONFLICT column-list mismatch (0028) and the missing
-- NULL-client guard in the observation-integrity trigger (0028), this was
-- the third of three independent, stacked bugs that together meant
-- trust_observations had never accepted a single successful insert in
-- production, from either real code path that writes to it.
--
-- Confirmed directly against production (23514 check-constraint violation
-- -> success once 'provider_collection' was added).

ALTER TABLE trust_observations DROP CONSTRAINT trust_observations_generation_reason_check;
ALTER TABLE trust_observations ADD CONSTRAINT trust_observations_generation_reason_check
  CHECK (generation_reason = ANY (ARRAY[
    'manual', 'scheduled_refresh', 'evidence_change', 'finding_change',
    'collector_recovery', 'system', 'provider_collection', 'scheduled_collection'
  ]::text[]));

COMMIT;
