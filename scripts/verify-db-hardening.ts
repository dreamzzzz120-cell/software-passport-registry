import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const client = new Client({ connectionString, ssl: false });
await client.connect();

try {
  const migrations = await client.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
  const versions = migrations.rows.map(row => Number(row.version));
  const expected = Array.from({ length: 11 }, (_, index) => index);
  if (JSON.stringify(versions) !== JSON.stringify(expected)) {
    throw new Error(`Migration history mismatch: ${JSON.stringify(versions)}`);
  }

  const requiredTriggers = [
    'spr_trust_observation_integrity',
    'spr_trust_change_integrity',
    'spr_remediation_task_integrity',
    'spr_remediation_verification_integrity',
    'spr_webhook_delivery_ownership',
    'spr_enforce_webhook_secret_storage',
  ];
  const triggers = await client.query<{ tgname: string }>(`
    SELECT DISTINCT tgname
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname = ANY($1::text[])
  `, [requiredTriggers]);
  const triggerSet = new Set(triggers.rows.map(row => row.tgname));
  for (const name of requiredTriggers) if (!triggerSet.has(name)) throw new Error(`Missing trigger: ${name}`);

  const requiredConstraints = [
    'passports_client_fk',
    'monitoring_configurations_client_fk',
    'monitoring_configurations_passport_fk',
    'monitoring_configurations_credential_fk',
    'collector_jobs_client_fk',
    'collector_jobs_passport_fk',
    'collector_jobs_monitoring_fk',
    'trust_observations_passport_fk',
    'trust_observations_client_fk',
    'trust_observations_previous_fk',
    'trust_changes_observation_fk',
    'remediation_tasks_client_fk',
    'remediation_tasks_alert_fk',
    'remediation_verifications_task_fk',
    'remediation_verifications_alert_fk',
    'remediation_verifications_client_fk',
    'remediation_verifications_monitoring_fk',
    'remediation_verifications_job_fk',
    'remediation_verifications_observation_fk',
    'spr_webhook_deliveries_webhook_fk',
    'alerts_passport_fk',
    'alerts_observation_fk',
    'alerts_client_fk',
  ];
  const constraints = await client.query<{ conname: string }>(`
    SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])
  `, [requiredConstraints]);
  const constraintSet = new Set(constraints.rows.map(row => row.conname));
  for (const name of requiredConstraints) if (!constraintSet.has(name)) throw new Error(`Missing constraint: ${name}`);

  const indexes = await client.query<{ indexname: string }>(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND indexname IN ('trust_observations_tenant_passport_idempotency', 'trust_observation_changes_tenant_observation', 'remediation_tasks_tenant_alert', 'remediation_verifications_tenant_task')
  `);
  const indexSet = new Set(indexes.rows.map(row => row.indexname));
  for (const name of ['trust_observations_tenant_passport_idempotency', 'trust_observation_changes_tenant_observation', 'remediation_tasks_tenant_alert', 'remediation_verifications_tenant_task']) {
    if (!indexSet.has(name)) throw new Error(`Missing index: ${name}`);
  }

  const migrationRows = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM schema_migrations');
  if (Number(migrationRows.rows[0].count) !== 11) throw new Error('Unexpected migration count');

  console.log('DB HARDENING VERIFIED: migration history, integrity triggers, foreign keys, and required indexes are present.');
} finally {
  await client.end();
}
