BEGIN;

-- Extends the deterministic-failure set from 0100. Observed in production on
-- 2026-09-18: a Free Review of a PRIVATE repository failed with
-- REPOSITORY_PRIVATE_REQUIRES_CREDENTIAL on attempt 1, was retried at 60s and
-- 120s with the identical result, and only settled to Failed after ~3.5
-- minutes -- during which the scan reported itself as scanning. Whether a
-- repository is private, or exists at all, does not change between retries
-- of the same submission, so both conditions are terminal on the first
-- attempt. The trigger keeps every worker path honest about this.
CREATE OR REPLACE FUNCTION spr_terminal_deterministic_scan_failure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Pending'
     AND NEW.error IN (
       'SBOM_INVALID',
       'SBOM_EMPTY',
       'SBOM_MALFORMED',
       'NO_SUPPORTED_MANIFESTS',
       'REPOSITORY_TOO_LARGE',
       'REPOSITORY_FILE_LIMIT_EXCEEDED',
       'REPOSITORY_PATH_INVALID',
       'REPOSITORY_PRIVATE_REQUIRES_CREDENTIAL',
       'REPOSITORY_NOT_FOUND'
     ) THEN
    NEW.status := 'Failed';
    NEW.progress := 100;
    NEW.next_attempt_at := NULL;
    NEW.completed_at := COALESCE(NEW.completed_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
