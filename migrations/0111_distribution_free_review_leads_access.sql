BEGIN;

-- Fix: spr_worker_runtime lacked INSERT grant on distribution_jobs table.
-- The distribution worker's sweepFreeReviewLeads function queried for leads
-- but failed silently when attempting to enqueue qualify_lead jobs because
-- the INSERT was not granted. This created a silent bottleneck: discovery
-- worked (queued research_url jobs) but lead qualification never happened.

-- Grant INSERT to worker runtime so it can enqueue distribution jobs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT INSERT ON distribution_jobs TO spr_worker_runtime;
  END IF;
END $$;

COMMIT;

