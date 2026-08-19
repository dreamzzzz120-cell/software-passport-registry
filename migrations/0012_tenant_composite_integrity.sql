BEGIN;

-- Defense-in-depth tenant integrity. Plain foreign keys protect existence;
-- composite tenant+id keys additionally prevent a valid object from another
-- tenant being attached through an internal caller or compromised application path.
CREATE UNIQUE INDEX IF NOT EXISTS clients_tenant_id_unique ON clients (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS passports_tenant_id_unique ON passports (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS monitoring_tenant_id_unique ON monitoring_configurations (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS collector_jobs_tenant_id_unique ON collector_jobs (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS trust_observations_tenant_id_unique ON trust_observations (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS trust_changes_tenant_id_unique ON trust_observation_changes (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_tenant_id_unique ON alerts (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS remediation_tasks_tenant_id_unique ON remediation_tasks (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS remediation_verifications_tenant_id_unique ON remediation_verifications (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS alert_subscriptions_tenant_id_unique ON alert_subscriptions (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS spr_webhooks_tenant_id_unique ON spr_webhooks (tenant_id, id);

ALTER TABLE passports
  ADD CONSTRAINT passports_client_tenant_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id);

ALTER TABLE monitoring_configurations
  ADD CONSTRAINT monitoring_client_tenant_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id),
  ADD CONSTRAINT monitoring_passport_tenant_fk FOREIGN KEY (tenant_id, passport_id) REFERENCES passports(tenant_id, id);

ALTER TABLE collector_jobs
  ADD CONSTRAINT collector_job_client_tenant_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id),
  ADD CONSTRAINT collector_job_passport_tenant_fk FOREIGN KEY (tenant_id, passport_id) REFERENCES passports(tenant_id, id),
  ADD CONSTRAINT collector_job_monitoring_tenant_fk FOREIGN KEY (tenant_id, monitoring_configuration_id) REFERENCES monitoring_configurations(tenant_id, id);

ALTER TABLE trust_observations
  ADD CONSTRAINT trust_observation_passport_tenant_fk FOREIGN KEY (tenant_id, passport_id) REFERENCES passports(tenant_id, id),
  ADD CONSTRAINT trust_observation_client_tenant_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id);

ALTER TABLE trust_observation_changes
  ADD CONSTRAINT trust_change_passport_tenant_fk FOREIGN KEY (tenant_id, passport_id) REFERENCES passports(tenant_id, id),
  ADD CONSTRAINT trust_change_observation_tenant_fk FOREIGN KEY (tenant_id, observation_id) REFERENCES trust_observations(tenant_id, id);

ALTER TABLE remediation_tasks
  ADD CONSTRAINT remediation_task_client_tenant_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id),
  ADD CONSTRAINT remediation_task_alert_tenant_fk FOREIGN KEY (tenant_id, alert_id) REFERENCES alerts(tenant_id, id);

ALTER TABLE remediation_verifications
  ADD CONSTRAINT remediation_verification_task_tenant_fk FOREIGN KEY (tenant_id, task_id) REFERENCES remediation_tasks(tenant_id, id),
  ADD CONSTRAINT remediation_verification_alert_tenant_fk FOREIGN KEY (tenant_id, alert_id) REFERENCES alerts(tenant_id, id),
  ADD CONSTRAINT remediation_verification_client_tenant_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id),
  ADD CONSTRAINT remediation_verification_monitoring_tenant_fk FOREIGN KEY (tenant_id, monitoring_configuration_id) REFERENCES monitoring_configurations(tenant_id, id),
  ADD CONSTRAINT remediation_verification_job_tenant_fk FOREIGN KEY (tenant_id, collector_job_id) REFERENCES collector_jobs(tenant_id, id);

ALTER TABLE alert_subscriptions
  ADD CONSTRAINT alert_subscription_client_tenant_fk FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id),
  ADD CONSTRAINT alert_subscription_passport_tenant_fk FOREIGN KEY (tenant_id, passport_id) REFERENCES passports(tenant_id, id);

ALTER TABLE spr_webhook_deliveries
  ADD CONSTRAINT webhook_delivery_tenant_fk FOREIGN KEY (tenant_id, webhook_id) REFERENCES spr_webhooks(tenant_id, id);

COMMIT;
