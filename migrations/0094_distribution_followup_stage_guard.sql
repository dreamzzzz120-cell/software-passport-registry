BEGIN;

CREATE OR REPLACE FUNCTION spr_distribution_stage_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.pipeline_stage IN ('replied','demo','pilot','customer','lost') THEN
    NEW.next_followup_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS distribution_stage_guard ON distribution_contacts;
CREATE TRIGGER distribution_stage_guard
BEFORE INSERT OR UPDATE OF pipeline_stage ON distribution_contacts
FOR EACH ROW EXECUTE FUNCTION spr_distribution_stage_guard();

COMMIT;
