BEGIN;

-- The SPR "self passport" was a placeholder row inserted at boot with an
-- empty SBOM and the summary "Evidence collection is pending". Nothing ever
-- populated it, so any scan queued against it completed instantly having
-- examined zero components -- a "Completed, 100%" result with nothing behind
-- it. The founder dashboard now reads SPR's own passport from a real scan of
-- the repository instead (see /api/passports/self-passport), and this removes
-- the placeholder and every row that hung off it.
--
-- Children are removed generically: every table with a foreign key to
-- passports(id) has its rows for this passport deleted. Grandchildren (rows
-- that reference a child, e.g. collector_results -> collector_jobs) are
-- handled by repeating the pass until every delete succeeds; a delete blocked
-- by a foreign key is retried on the next pass once its dependants are gone.
-- Scope is exactly one passport id; nothing else is touched.
DO $$
DECLARE
  fk record;
  pass integer := 0;
  blocked integer;
BEGIN
  LOOP
    pass := pass + 1;
    blocked := 0;
    FOR fk IN
      SELECT c.conrelid::regclass AS child, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'passports'::regclass
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = %L', fk.child, fk.col, 'passport_spr_self');
      EXCEPTION WHEN foreign_key_violation THEN
        blocked := blocked + 1;
      END;
    END LOOP;
    -- agent_logs has no FK to passports; it hangs off agent_jobs by job_id.
    DELETE FROM agent_logs WHERE job_id IN (SELECT id FROM agent_jobs WHERE passport_id = 'passport_spr_self');
    DELETE FROM agent_jobs WHERE passport_id = 'passport_spr_self';
    EXIT WHEN blocked = 0 OR pass >= 6;
  END LOOP;
  IF blocked > 0 THEN
    RAISE EXCEPTION 'placeholder self passport still has % dependent table(s) after % passes', blocked, pass;
  END IF;
END $$;

DELETE FROM passports WHERE id = 'passport_spr_self';

-- Repository passports are inserted as a shell ("Queued for repository
-- acquisition; no evidence collected yet.") and the worker's upsert on
-- completion never refreshed ai_summary, so passports with a finished Syft +
-- OSV scan kept describing themselves as unscanned. The worker now updates the
-- summary on every completion; this brings already-completed rows in line
-- with the job that actually completed for them. Only rows with a Completed
-- repository_scan job are touched, and only the stale queued text is replaced.
UPDATE passports p
SET ai_summary = 'Repository acquired and SBOM generated. Trust assessment remains pending.'
WHERE p.category = 'Repository'
  AND p.ai_summary = 'Queued for repository acquisition; no evidence collected yet.'
  AND EXISTS (
    SELECT 1 FROM agent_jobs j
    WHERE j.passport_id = p.id AND j.tenant_id = p.tenant_id
      AND j.job_type = 'repository_scan' AND j.status = 'Completed'
  );

COMMIT;
