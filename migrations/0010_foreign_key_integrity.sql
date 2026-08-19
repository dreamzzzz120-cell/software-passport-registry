BEGIN;

-- Foreign keys are intentionally restrictive: tenant offboarding deletes dependents
-- first, while direct accidental deletion of authoritative parents is rejected.
ALTER TABLE monitoring_configurations
  ADD CONSTRAINT monitoring_configurations_client_fk FOREIGN KEY (client_id) REFERENCES clients(id),
  ADD CONSTRAINT monitoring_configurations_passport_fk FOREIGN KEY (passport_id) REFERENCES passports(id);

ALTER TABLE collector_jobs
  ADD CONSTRAINT collector_jobs_client_fk FOREIGN KEY (client_id) REFERENCES clients(id),
  ADD CONSTRAINT collector_jobs_passport_fk FOREIGN KEY (passport_id) REFERENCES passports(id),
  ADD CONSTRAINT collector_jobs_monitoring_fk FOREIGN KEY (monitoring_configuration_id) REFERENCES monitoring_configurations(id);

ALTER TABLE collector_results
  ADD CONSTRAINT collector_results_job_fk FOREIGN KEY (job_id) REFERENCES collector_jobs(id),
  ADD CONSTRAINT collector_results_client_fk FOREIGN KEY (client_id) REFERENCES clients(id),
  ADD CONSTRAINT collector_results_passport_fk FOREIGN KEY (passport_id) REFERENCES passports(id);

ALTER TABLE trust_observations
  ADD CONSTRAINT trust_observations_passport_fk FOREIGN KEY (passport_id) REFERENCES passports(id),
  ADD CONSTRAINT trust_observations_client_fk FOREIGN KEY (client_id) REFERENCES clients(id),
  ADD CONSTRAINT trust_observations_previous_fk FOREIGN KEY (previous_observation_id) REFERENCES trust_observations(id);

ALTER TABLE trust_observation_changes
  ADD CONSTRAINT trust_changes_passport_fk FOREIGN KEY (passport_id) REFERENCES passports(id),
  ADD CONSTRAINT trust_changes_observation_fk FOREIGN KEY (observation_id) REFERENCES trust_observations(id),
  ADD CONSTRAINT trust_changes_previous_fk FOREIGN KEY (previous_observation_id) REFERENCES trust_observations(id);

ALTER TABLE remediation_tasks
  ADD CONSTRAINT remediation_tasks_client_fk FOREIGN KEY (client_id) REFERENCES clients(id),
  ADD CONSTRAINT remediation_tasks_alert_fk FOREIGN KEY (alert_id) REFERENCES alerts(id);

ALTER TABLE remediation_verifications
  ADD CONSTRAINT remediation_verifications_task_fk FOREIGN KEY (task_id) REFERENCES remediation_tasks(id),
  ADD CONSTRAINT remediation_verifications_alert_fk FOREIGN KEY (alert_id) REFERENCES alerts(id),
  ADD CONSTRAINT remediation_verifications_client_fk FOREIGN KEY (client_id) REFERENCES clients(id),
  ADD CONSTRAINT remediation_verifications_monitoring_fk FOREIGN KEY (monitoring_configuration_id) REFERENCES monitoring_configurations(id),
  ADD CONSTRAINT remediation_verifications_job_fk FOREIGN KEY (collector_job_id) REFERENCES collector_jobs(id),
  ADD CONSTRAINT remediation_verifications_observation_fk FOREIGN KEY (observation_id) REFERENCES trust_observations(id);

ALTER TABLE spr_webhook_deliveries
  ADD CONSTRAINT spr_webhook_deliveries_webhook_fk FOREIGN KEY (webhook_id) REFERENCES spr_webhooks(id);

ALTER TABLE alerts
  ADD CONSTRAINT alerts_passport_fk FOREIGN KEY (passport_id) REFERENCES passports(id),
  ADD CONSTRAINT alerts_observation_fk FOREIGN KEY (observation_id) REFERENCES trust_observations(id),
  ADD CONSTRAINT alerts_client_fk FOREIGN KEY (client_id) REFERENCES clients(id);

COMMIT;
