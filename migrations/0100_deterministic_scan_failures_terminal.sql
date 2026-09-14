-- Deterministic repository scan failures are terminal conditions.
-- Enforce this at the queue boundary so every worker path obeys the same rule,
-- including repository_scan jobs handled by the OSV worker.
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
       'REPOSITORY_PATH_INVALID'
     ) THEN
    NEW.status := 'Failed';
    NEW.progress := 100;
    NEW.next_attempt_at := NULL;
    NEW.completed_at := COALESCE(NEW.completed_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_jobs_deterministic_scan_failure_terminal ON agent_jobs;

CREATE TRIGGER agent_jobs_deterministic_scan_failure_terminal
BEFORE UPDATE OF status, error ON agent_jobs
FOR EACH ROW
EXECUTE FUNCTION spr_terminal_deterministic_scan_failure();
