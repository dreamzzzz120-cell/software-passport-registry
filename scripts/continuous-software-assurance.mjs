import pg from "pg";

const { Client } = pg;

const DATABASE_URL = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("CSA_RECONCILE_BLOCKED: APP_DATABASE_URL or DATABASE_URL is required");
  process.exit(2);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  const result = await client.query(`
    SELECT
      c.tenant_id,
      c.id AS client_id,
      c.name AS client_name,
      COUNT(DISTINCT p.id)::int AS passport_count,
      COUNT(DISTINCT CASE
        WHEN mc.enabled = 1 THEN mc.id
      END)::int AS enabled_monitor_count,
      COUNT(DISTINCT CASE
        WHEN mc.enabled = 1
         AND mc.last_successful_at IS NOT NULL
         AND mc.last_successful_at::timestamptz >= now() - make_interval(secs => mc.schedule_seconds * 2)
        THEN mc.id
      END)::int AS fresh_monitor_count,
      COUNT(DISTINCT CASE
        WHEN a.status = 'Active'
         AND a.severity IN ('critical','high')
        THEN a.id
      END)::int AS open_high_alert_count,
      COUNT(DISTINCT CASE
        WHEN p.verification_status = 'verified'
        THEN p.id
      END)::int AS verified_passport_count,
      MAX(to_timestamp(NULLIF(o.generated_at, '')::double precision)) AS latest_observation_at
    FROM public.clients c
    LEFT JOIN public.passports p
      ON p.client_id = c.id AND p.tenant_id = c.tenant_id
    LEFT JOIN public.monitoring_configurations mc
      ON mc.client_id = c.id AND mc.tenant_id = c.tenant_id
    LEFT JOIN public.alerts a
      ON a.client_id = c.id AND a.tenant_id = c.tenant_id
    LEFT JOIN public.trust_observations o
      ON o.client_id = c.id AND o.tenant_id = c.tenant_id
    GROUP BY c.tenant_id, c.id, c.name
    ORDER BY c.tenant_id, c.name
  `);

  const clients = result.rows.map((row) => {
    const monitored = Number(row.enabled_monitor_count) > 0;
    const fresh = Number(row.enabled_monitor_count) === Number(row.fresh_monitor_count);
    const assuranceState =
      !monitored ? "UNMONITORED" :
      !fresh ? "STALE" :
      Number(row.open_high_alert_count) > 0 ? "ACTION_REQUIRED" :
      Number(row.verified_passport_count) > 0 ? "ASSURANCE_ACTIVE" :
      "OBSERVED";

    return {
      tenantId: row.tenant_id,
      clientId: row.client_id,
      clientName: row.client_name,
      passportCount: Number(row.passport_count),
      enabledMonitorCount: Number(row.enabled_monitor_count),
      freshMonitorCount: Number(row.fresh_monitor_count),
      openHighAlertCount: Number(row.open_high_alert_count),
      verifiedPassportCount: Number(row.verified_passport_count),
      latestObservationAt: row.latest_observation_at,
      assuranceState,
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    service: "continuous-software-assurance",
    schema: "spr.csa.v1",
    mode: "read-only-reconciliation",
    clients,
    totals: {
      clients: clients.length,
      assuranceActive: clients.filter((c) => c.assuranceState === "ASSURANCE_ACTIVE").length,
      actionRequired: clients.filter((c) => c.assuranceState === "ACTION_REQUIRED").length,
      stale: clients.filter((c) => c.assuranceState === "STALE").length,
      unmonitored: clients.filter((c) => c.assuranceState === "UNMONITORED").length,
      observed: clients.filter((c) => c.assuranceState === "OBSERVED").length,
    },
  };

  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} finally {
  await client.end();
}
