BEGIN;

-- Durable progress metadata for the async scan UX. The API returns this state
-- while the worker performs slow repository/provider work in the background.
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS current_stage text NOT NULL DEFAULT 'queued';
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS current_stage_index integer NOT NULL DEFAULT 1 CHECK (current_stage_index BETWEEN 1 AND 21);
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS total_stages integer NOT NULL DEFAULT 21 CHECK (total_stages = 21);

CREATE INDEX IF NOT EXISTS agent_jobs_tenant_status_created_idx
  ON agent_jobs (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_jobs_pending_claim_idx
  ON agent_jobs (status, next_attempt_at, created_at)
  WHERE status = 'Pending';

-- Repository workers already persist durable source milestones. Turn those
-- milestones into user-visible progress without putting another synchronous
-- network call on the request path.
CREATE OR REPLACE FUNCTION spr_sync_repository_scan_progress()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stage_index integer := 1;
  stage_name text := 'queued';
BEGIN
  IF NEW.requested_ref IS NOT NULL AND NEW.resolved_commit_sha IS NULL THEN
    stage_index := 5; stage_name := 'Resolving repository reference';
  ELSIF NEW.resolved_commit_sha IS NOT NULL AND NEW.acquired_at IS NULL THEN
    stage_index := 6; stage_name := 'Acquiring repository';
  ELSIF NEW.acquired_at IS NOT NULL AND NEW.manifest_paths IS NULL THEN
    stage_index := 8; stage_name := 'Inspecting repository';
  ELSIF NEW.manifest_paths IS NOT NULL AND NEW.raw_sbom_hash IS NULL THEN
    stage_index := 10; stage_name := 'Generating software inventory';
  ELSIF NEW.raw_sbom_hash IS NOT NULL AND NEW.sbom_document IS NULL THEN
    stage_index := 11; stage_name := 'Generating SBOM';
  ELSIF NEW.sbom_document IS NOT NULL AND NEW.normalized_components IS NULL THEN
    stage_index := 12; stage_name := 'Normalizing dependencies';
  ELSIF NEW.normalized_components IS NOT NULL AND NEW.final_findings_hash IS NULL THEN
    stage_index := 15; stage_name := 'Querying vulnerability intelligence';
  ELSIF NEW.final_findings_hash IS NOT NULL THEN
    stage_index := 20; stage_name := 'Finalizing evidence';
  END IF;

  UPDATE agent_jobs
     SET current_stage = stage_name,
         current_stage_index = GREATEST(current_stage_index, stage_index),
         progress = GREATEST(progress, LEAST(99, ROUND(stage_index * 100.0 / 21)::integer)),
         updated_at = NOW()
   WHERE id = NEW.job_id
     AND tenant_id = NEW.tenant_id
     AND status IN ('Pending','Running');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_repository_scan_progress ON repository_scan_sources;
CREATE TRIGGER spr_repository_scan_progress
AFTER INSERT OR UPDATE OF requested_ref, resolved_commit_sha, acquired_at, manifest_paths,
  raw_sbom_hash, sbom_document, normalized_components, final_findings_hash
ON repository_scan_sources
FOR EACH ROW EXECUTE FUNCTION spr_sync_repository_scan_progress();

-- Completion is still owned by the worker. This trigger only creates durable
-- outbox records after the job reaches Completed; email delivery remains fully
-- asynchronous and therefore can never add latency to the scan request.
CREATE OR REPLACE FUNCTION spr_enqueue_scan_completion_notifications()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  recipient record;
  passport_name text;
  subject text;
  body text;
BEGIN
  IF OLD.status IS DISTINCT FROM 'Completed' AND NEW.status = 'Completed' THEN
    SELECT name INTO passport_name
      FROM passports
     WHERE id = NEW.passport_id AND tenant_id = NEW.tenant_id
     LIMIT 1;

    subject := 'SPR Software Passport ready';
    body := 'Your Software Passport scan is complete.' || E'\n\n' ||
            'Passport: ' || COALESCE(passport_name, NEW.passport_id) || E'\n' ||
            'Job: ' || NEW.id || E'\n' ||
            'Status: Completed' || E'\n\n' ||
            'Open SPR to review the evidence and findings.';

    FOR recipient IN
      SELECT uid, email
        FROM users
       WHERE tenant_id = NEW.tenant_id
         AND role IN ('Owner','Admin')
         AND email IS NOT NULL
         AND length(trim(email)) > 3
    LOOP
      INSERT INTO notification_outbox
        (id, tenant_id, channel, destination, subject, body, status, available_at, created_at)
      VALUES
        ('scan-complete-' || NEW.id || '-' || md5(recipient.uid),
         NEW.tenant_id, 'email', trim(recipient.email), subject, body,
         'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_scan_completion_notifications ON agent_jobs;
CREATE TRIGGER spr_scan_completion_notifications
AFTER UPDATE OF status ON agent_jobs
FOR EACH ROW EXECUTE FUNCTION spr_enqueue_scan_completion_notifications();

COMMIT;
