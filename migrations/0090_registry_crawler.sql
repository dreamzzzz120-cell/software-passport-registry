BEGIN;

-- Public registry crawler (src/workers/registry-crawler-worker.ts).
-- registry_crawl_state is the discovery cursor; registry_crawl_runs records
-- every pass with what actually happened. Neither table is tenant data:
-- the crawler feeds the system Free Review tenant through the ordinary
-- enqueue path, and these rows are operational telemetry read only by the
-- founder surface.
CREATE TABLE IF NOT EXISTS registry_crawl_state (
  id text PRIMARY KEY,
  language_index integer NOT NULL DEFAULT 0 CHECK (language_index >= 0),
  page integer NOT NULL DEFAULT 1 CHECK (page >= 1),
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registry_crawl_runs (
  id text PRIMARY KEY,
  started_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamp,
  discovered integer NOT NULL DEFAULT 0,
  enqueued integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  error text,
  note text
);
CREATE INDEX IF NOT EXISTS registry_crawl_runs_started_idx ON registry_crawl_runs (started_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_worker_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON registry_crawl_state, registry_crawl_runs TO spr_worker_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spr_app_runtime') THEN
    GRANT SELECT ON registry_crawl_state, registry_crawl_runs TO spr_app_runtime;
  END IF;
END $$;

COMMIT;
