BEGIN;

-- Defense in depth: application tenant filters remain mandatory, but the database
-- must also reject cross-tenant resource references if an API path is ever missed.
-- Fail the migration if existing data already violates the intended ownership model.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM monitoring_configurations mc
    LEFT JOIN clients c ON c.id = mc.client_id
    LEFT JOIN passports p ON p.id = mc.passport_id
    WHERE c.id IS NULL
       OR c.tenant_id <> mc.tenant_id
       OR p.id IS NULL
       OR p.tenant_id <> mc.tenant_id
       OR (p.client_id IS NOT NULL AND p.client_id <> mc.client_id)
  ) THEN
    RAISE EXCEPTION 'tenant integrity violation in monitoring_configurations';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM alert_subscriptions s
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN passports p ON p.id = s.passport_id
    WHERE (s.client_id IS NOT NULL AND (c.id IS NULL OR c.tenant_id <> s.tenant_id))
       OR (s.passport_id IS NOT NULL AND (p.id IS NULL OR p.tenant_id <> s.tenant_id))
       OR (s.client_id IS NOT NULL AND s.passport_id IS NOT NULL
           AND p.client_id IS NOT NULL AND p.client_id <> s.client_id)
  ) THEN
    RAISE EXCEPTION 'tenant integrity violation in alert_subscriptions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM collector_jobs j
    LEFT JOIN monitoring_configurations mc ON mc.id = j.monitoring_configuration_id
    LEFT JOIN clients c ON c.id = j.client_id
    LEFT JOIN passports p ON p.id = j.passport_id
    WHERE (j.monitoring_configuration_id IS NOT NULL
           AND (mc.id IS NULL OR mc.tenant_id <> j.tenant_id))
       OR c.id IS NULL OR c.tenant_id <> j.tenant_id
       OR p.id IS NULL OR p.tenant_id <> j.tenant_id
       OR (p.client_id IS NOT NULL AND p.client_id <> j.client_id)
  ) THEN
    RAISE EXCEPTION 'tenant integrity violation in collector_jobs';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION spr_enforce_tenant_resource_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'monitoring_configurations' THEN
    IF NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'client does not belong to monitoring configuration tenant';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM passports p
      WHERE p.id = NEW.passport_id
        AND p.tenant_id = NEW.tenant_id
        AND (p.client_id IS NULL OR p.client_id = NEW.client_id)
    ) THEN
      RAISE EXCEPTION 'passport does not belong to monitoring configuration tenant/client';
    END IF;

  ELSIF TG_TABLE_NAME = 'collector_jobs' THEN
    IF NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'client does not belong to collector job tenant';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM passports p
      WHERE p.id = NEW.passport_id
        AND p.tenant_id = NEW.tenant_id
        AND (p.client_id IS NULL OR p.client_id = NEW.client_id)
    ) THEN
      RAISE EXCEPTION 'passport does not belong to collector job tenant/client';
    END IF;
    IF NEW.monitoring_configuration_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM monitoring_configurations mc
      WHERE mc.id = NEW.monitoring_configuration_id
        AND mc.tenant_id = NEW.tenant_id
        AND mc.client_id = NEW.client_id
        AND mc.passport_id = NEW.passport_id
    ) THEN
      RAISE EXCEPTION 'monitoring configuration does not match collector job tenant/client/passport';
    END IF;

  ELSIF TG_TABLE_NAME = 'collector_results' THEN
    IF NOT EXISTS (
      SELECT 1 FROM collector_jobs j
      WHERE j.id = NEW.job_id AND j.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'collector result job does not belong to tenant';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'client does not belong to collector result tenant';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM passports p
      WHERE p.id = NEW.passport_id
        AND p.tenant_id = NEW.tenant_id
        AND (p.client_id IS NULL OR p.client_id = NEW.client_id)
    ) THEN
      RAISE EXCEPTION 'passport does not belong to collector result tenant/client';
    END IF;

  ELSIF TG_TABLE_NAME = 'alert_subscriptions' THEN
    IF NEW.client_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM clients c WHERE c.id = NEW.client_id AND c.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'subscription client does not belong to tenant';
    END IF;
    IF NEW.passport_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM passports p
      WHERE p.id = NEW.passport_id
        AND p.tenant_id = NEW.tenant_id
        AND (NEW.client_id IS NULL OR p.client_id IS NULL OR p.client_id = NEW.client_id)
    ) THEN
      RAISE EXCEPTION 'subscription passport does not belong to tenant/client';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spr_monitoring_tenant_integrity ON monitoring_configurations;
CREATE TRIGGER spr_monitoring_tenant_integrity
BEFORE INSERT OR UPDATE ON monitoring_configurations
FOR EACH ROW EXECUTE FUNCTION spr_enforce_tenant_resource_integrity();

DROP TRIGGER IF EXISTS spr_collector_job_tenant_integrity ON collector_jobs;
CREATE TRIGGER spr_collector_job_tenant_integrity
BEFORE INSERT OR UPDATE ON collector_jobs
FOR EACH ROW EXECUTE FUNCTION spr_enforce_tenant_resource_integrity();

DROP TRIGGER IF EXISTS spr_collector_result_tenant_integrity ON collector_results;
CREATE TRIGGER spr_collector_result_tenant_integrity
BEFORE INSERT OR UPDATE ON collector_results
FOR EACH ROW EXECUTE FUNCTION spr_enforce_tenant_resource_integrity();

DROP TRIGGER IF EXISTS spr_alert_subscription_tenant_integrity ON alert_subscriptions;
CREATE TRIGGER spr_alert_subscription_tenant_integrity
BEFORE INSERT OR UPDATE ON alert_subscriptions
FOR EACH ROW EXECUTE FUNCTION spr_enforce_tenant_resource_integrity();

COMMIT;
