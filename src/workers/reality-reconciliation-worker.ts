import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createWorkerPool } from './worker-db.ts';

type State = 'HEALTHY' | 'DEGRADING' | 'FAILED' | 'UNKNOWN';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Transition = 'NONE' | 'OPENED' | 'UPDATED' | 'PROVEN_FIXED';
type ObservationResult = {
  contractId: string;
  state: State;
  transition: Transition;
  observationId: string | null;
  incidentId: string | null;
  diagnostic?: Record<string, unknown>;
  receiptId?: string;
};

function safeDiagnostic(contractId: string, observed: Record<string, unknown>) {
  const allow = (keys: string[]) => Object.fromEntries(keys.filter((key) => key in observed).map((key) => [key, observed[key]]));
  switch (contractId) {
    case 'database_reachable': return allow(['reachable', 'latencyMs']);
    case 'worker_queue_flow': return allow(['stalePending', 'staleRunning', 'oldestPending']);
    case 'scan_terminality': return allow(['active', 'staleActive']);
    case 'registry_freshness': return allow(['enabled', 'runObserved', 'lastStartedAt', 'lastFinishedAt', 'ageHours']);
    case 'reconciler_self_watch': return allow(['priorObservation', 'lastObservationAt', 'ageMinutes']);
    case 'worker_runtime_identity': return allow(['role', 'tls']);
    case 'tenant_isolation_integrity': return allow(['assertion']);
    case 'auth_backend_reachable': return allow(['configured', 'status']);
    case 'billing_backend_reachable': return allow(['configured', 'activeSubscriptions', 'status']);
    case 'intake_storage_readiness': return allow(['configured', 'pendingItems', 'recentFailures']);
    case 'sbom_evidence_completeness': return allow(['completedScans', 'scansWithSbom', 'missingSbom']);
    case 'report_delivery_flow': return allow(['enabledSchedules', 'overdueSchedules', 'erroredSchedules']);
    case 'integration_delivery_health': return allow(['enabledConfigurations', 'repeatedFailures']);
    case 'malware_coverage': return allow(['recentScans', 'malwareEvidence']);
    case 'public_deployment_ready': return allow(['configured', 'status', 'https']);
    case 'backup_restore_evidence': return allow(['configured', 'verifiedAt', 'ageHours']);
    default: return {};
  }
}

type ProbeResult = {
  state: State;
  observed: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
  explanation: string;
  severity: Severity;
  impact?: Record<string, unknown>;
  rootCause?: string | null;
  rootCauseState?: 'PROVEN' | 'SUPPORTED' | 'UNKNOWN';
};

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '')}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const intervalMs = () => Math.max(60_000, Number.parseInt(process.env.REALITY_RECONCILIATION_INTERVAL_MS ?? '300000', 10) || 300000);


type RepairResult = { attempted: number; requeued?: number; failed?: number; scanRequeued?: number; scanFailed?: number };

async function setIncidentRepairState(pool: Pool, incidentId: string, status: 'REPAIRING' | 'VERIFYING' | 'INVESTIGATING', action: string) {
  await pool.query('UPDATE reality_incidents SET status=$2, repair_action=$3, last_seen_at=now() WHERE id=$1', [incidentId, status, action]);
}

async function repairStaleQueue(pool: Pool): Promise<RepairResult> {
  const client = await pool.connect();
  let requeued = 0;
  let failed = 0;
  let scanRequeued = 0;
  let scanFailed = 0;
  try {
    await client.query('BEGIN');
    const rows = (await client.query(`
      SELECT id, tenant_id, scan_id, attempt_count, max_attempts
        FROM agent_jobs
       WHERE status='Running'
         AND updated_at < now() - interval '30 minutes'
         AND (locked_at IS NULL OR locked_at < now() - interval '30 minutes')
       ORDER BY updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 25
    `)).rows as Array<{ id: string; tenant_id: string; scan_id: string | null; attempt_count: number; max_attempts: number }>;

    for (const row of rows) {
      const retry = Number(row.attempt_count) < Number(row.max_attempts);
      const nextStatus = retry ? 'Pending' : 'Failed';
      await client.query(`
        UPDATE agent_jobs
           SET status=$2,
               progress=CASE WHEN $2='Failed' THEN 100 ELSE progress END,
               error=CASE WHEN $2='Failed' THEN COALESCE(error,'REALITY_RECONCILIATION_LEASE_EXPIRED') ELSE NULL END,
               next_attempt_at=CASE WHEN $2='Pending' THEN now() ELSE next_attempt_at END,
               locked_at=NULL,
               locked_by=NULL,
               completed_at=CASE WHEN $2='Failed' THEN COALESCE(completed_at,now()) ELSE completed_at END,
               updated_at=now()
         WHERE id=$1 AND tenant_id=$3 AND status='Running'
      `, [row.id, nextStatus, row.tenant_id]);
      if (retry) requeued += 1;
      else failed += 1;

      if (row.scan_id) {
        const scan = await client.query(`
          UPDATE scans
             SET status=$2,
                 updated_at=now(),
                 completed_at=CASE WHEN $2='Failed' THEN COALESCE(completed_at,now()) ELSE completed_at END,
                 error_state=CASE WHEN $2='Failed' THEN 'failed' ELSE NULL END,
                 error_code=CASE WHEN $2='Failed' THEN 'WORKER_LEASE_EXPIRED' ELSE NULL END
           WHERE id=$1
             AND tenant_id=$3
             AND status IN ('Queued','Scanning')
        `, [row.scan_id, retry ? 'Queued' : 'Failed', row.tenant_id]);
        if ((scan.rowCount ?? 0) > 0) {
          if (retry) scanRequeued += 1;
          else scanFailed += 1;
        }
      }
    }
    await client.query('COMMIT');
    return { attempted: rows.length, requeued, failed, scanRequeued, scanFailed };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function repairOrphanedScans(pool: Pool): Promise<RepairResult> {
  const result = await pool.query(`
    WITH stale AS (
      SELECT s.id, s.tenant_id
        FROM scans s
       WHERE s.status IN ('Queued','Scanning')
         AND s.updated_at < now() - interval '30 minutes'
         AND NOT EXISTS (
           SELECT 1
             FROM agent_jobs j
            WHERE j.scan_id=s.id
              AND j.tenant_id=s.tenant_id
              AND j.status IN ('Pending','Running')
         )
       ORDER BY s.updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 25
    )
    UPDATE scans s
       SET status='Failed',
           completed_at=COALESCE(s.completed_at,now()),
           updated_at=now(),
           error_state='failed',
           error_code=COALESCE(s.error_code,'STALE_SCAN_NO_ACTIVE_JOB')
      FROM stale
     WHERE s.id=stale.id AND s.tenant_id=stale.tenant_id
    RETURNING s.id
  `);
  return { attempted: result.rowCount ?? 0, scanFailed: result.rowCount ?? 0 };
}

async function contract(pool: Pool, contractId: string) {
  return (await pool.query('SELECT id, component, expected, repair_class FROM reality_contracts WHERE id=$1 AND enabled=TRUE', [contractId])).rows[0] as
    | { id: string; component: string; expected: Record<string, unknown>; repair_class: number }
    | undefined;
}

async function observe(pool: Pool, contractId: string, result: ProbeResult): Promise<ObservationResult> {
  let transition: Transition = 'NONE';
  const c = await contract(pool, contractId);
  if (!c) return { contractId, state: result.state, transition: 'NONE' as const, observationId: null, incidentId: null, diagnostic: safeDiagnostic(contractId, result.observed) };

  const observationId = id('obs');
  await pool.query(
    'INSERT INTO reality_observations (id,contract_id,state,observed,evidence,explanation) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)',
    [observationId, contractId, result.state, JSON.stringify(result.observed), JSON.stringify(result.evidence), result.explanation],
  );

  const open = (await pool.query(
    "SELECT * FROM reality_incidents WHERE contract_id=$1 AND status NOT IN ('PROVEN_FIXED','FAILED') ORDER BY first_detected_at ASC LIMIT 1",
    [contractId],
  )).rows[0];

  if (result.state === 'HEALTHY') {
    if (!open) return { contractId, state: result.state, transition, observationId, incidentId: null, diagnostic: safeDiagnostic(contractId, result.observed) };
    const receiptId = id('receipt');
    await pool.query('BEGIN');
    try {
      await pool.query(
        "UPDATE reality_incidents SET status='PROVEN_FIXED', last_seen_at=now(), resolved_at=now(), observed=$2::jsonb WHERE id=$1",
        [open.id, JSON.stringify(result.observed)],
      );
      await pool.query(
        "INSERT INTO reality_repair_receipts (id,incident_id,authority_class,before_state,evidence,cause,impact,repair,verification,after_state,result) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,'PROVEN_FIXED')",
        [
          receiptId,
          open.id,
          open.repair_class,
          JSON.stringify(open.observed ?? {}),
          JSON.stringify(result.evidence),
          open.root_cause,
          JSON.stringify(open.impact ?? {}),
          open.repair_action || 'Observed recovery; no unproven mutation was claimed.',
          JSON.stringify({ replayedContract: contractId, state: result.state, observationId }),
          JSON.stringify(result.observed),
        ],
      );
      await pool.query('COMMIT');
      transition = 'PROVEN_FIXED';
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    return { contractId, state: result.state, transition, observationId, incidentId: open.id, diagnostic: safeDiagnostic(contractId, result.observed), receiptId };
  }

  if (open) {
    await pool.query(
      'UPDATE reality_incidents SET severity=$2,status=$3,observed=$4::jsonb,evidence=$5::jsonb,root_cause_state=$6,root_cause=$7,impact=$8::jsonb,last_seen_at=now() WHERE id=$1',
      [
        open.id,
        result.severity,
        result.state === 'UNKNOWN' ? 'UNKNOWN' : 'INVESTIGATING',
        JSON.stringify(result.observed),
        JSON.stringify(result.evidence),
        result.rootCauseState ?? 'UNKNOWN',
        result.rootCause ?? null,
        JSON.stringify(result.impact ?? {}),
      ],
    );
    transition = 'UPDATED';
    return { contractId, state: result.state, transition, observationId, incidentId: open.id, diagnostic: safeDiagnostic(contractId, result.observed) };
  }

  const incidentId = id('inc');
  await pool.query(
    'INSERT INTO reality_incidents (id,contract_id,component,severity,status,expected,observed,evidence,root_cause_state,root_cause,impact,repair_class) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12)',
    [
      incidentId,
      contractId,
      c.component,
      result.severity,
      result.state === 'UNKNOWN' ? 'UNKNOWN' : 'INVESTIGATING',
      JSON.stringify(c.expected ?? {}),
      JSON.stringify(result.observed),
      JSON.stringify(result.evidence),
      result.rootCauseState ?? 'UNKNOWN',
      result.rootCause ?? null,
      JSON.stringify(result.impact ?? {}),
      c.repair_class,
    ],
  );
  transition = 'OPENED';
  return { contractId, state: result.state, transition, observationId, incidentId, diagnostic: safeDiagnostic(contractId, result.observed) };
}

async function probeDatabase(pool: Pool): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const row = (await pool.query('SELECT current_user AS role, now() AS observed_at')).rows[0];
    return {
      state: 'HEALTHY',
      observed: { reachable: true, latencyMs: Date.now() - started, role: row?.role ?? null },
      evidence: [{ source: 'postgres', observedAt: row?.observed_at ?? new Date().toISOString() }],
      explanation: 'Postgres accepted a real query.',
      severity: 'CRITICAL',
    };
  } catch (error) {
    return {
      state: 'FAILED',
      observed: { reachable: false, latencyMs: Date.now() - started },
      evidence: [{ source: 'postgres', error: error instanceof Error ? error.message : String(error) }],
      explanation: 'Postgres did not accept the reconciliation query.',
      severity: 'CRITICAL',
      rootCauseState: 'SUPPORTED',
      rootCause: 'Database query failed from the worker runtime.',
      impact: { evidenceWrites: 'at risk', workerJobs: 'at risk', launchTickets: 'may become stale' },
    };
  }
}

async function probeQueue(pool: Pool): Promise<ProbeResult> {
  try {
    const row = (await pool.query(`
      SELECT
        count(*) FILTER (WHERE status='Pending' AND updated_at < now() - interval '10 minutes')::int AS stale_pending,
        count(*) FILTER (WHERE status='Running' AND updated_at < now() - interval '30 minutes')::int AS stale_running,
        min(created_at) FILTER (WHERE status='Pending') AS oldest_pending
      FROM agent_jobs
    `)).rows[0] ?? {};
    const stalePending = Number(row.stale_pending ?? 0);
    const staleRunning = Number(row.stale_running ?? 0);
    const state: State = staleRunning > 0 ? 'FAILED' : stalePending > 0 ? 'DEGRADING' : 'HEALTHY';
    return {
      state,
      observed: { stalePending, staleRunning, oldestPending: row.oldest_pending ?? null },
      evidence: [{ source: 'agent_jobs', query: 'stale queue age thresholds' }],
      explanation: state === 'HEALTHY' ? 'No queued or running jobs exceeded the contract age.' : `${stalePending} queued and ${staleRunning} running jobs exceeded the contract age.`,
      severity: staleRunning > 0 ? 'HIGH' : 'MEDIUM',
      rootCauseState: state === 'HEALTHY' ? 'UNKNOWN' : 'UNKNOWN',
      impact: state === 'HEALTHY' ? {} : { scans: 'delayed', evidenceFreshness: 'degrading', launchTickets: 'may become stale' },
    };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'agent_jobs', error: error instanceof Error ? error.message : String(error) }], explanation: 'Queue state could not be observed.', severity: 'HIGH' };
  }
}

async function probeScans(pool: Pool): Promise<ProbeResult> {
  try {
    const row = (await pool.query(`
      SELECT
        count(*) FILTER (WHERE status IN ('Queued','Scanning') AND updated_at < now() - interval '30 minutes')::int AS stale_active,
        count(*) FILTER (WHERE status IN ('Queued','Scanning'))::int AS active
      FROM scans
    `)).rows[0] ?? {};
    const stale = Number(row.stale_active ?? 0);
    return {
      state: stale > 0 ? 'FAILED' : 'HEALTHY',
      observed: { active: Number(row.active ?? 0), staleActive: stale },
      evidence: [{ source: 'scans', thresholdMinutes: 30 }],
      explanation: stale > 0 ? `${stale} active scans have not reached a terminal state within 30 minutes.` : 'Active scans are within the progress contract.',
      severity: 'HIGH',
      rootCauseState: stale > 0 ? 'UNKNOWN' : 'UNKNOWN',
      impact: stale > 0 ? { evidence: 'incomplete', launchTickets: 'stale or incomplete' } : {},
    };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'scans', error: error instanceof Error ? error.message : String(error) }], explanation: 'Scan progress could not be observed.', severity: 'HIGH' };
  }
}

async function probeRegistry(pool: Pool): Promise<ProbeResult> {
  if (process.env.REGISTRY_CRAWLER_ENABLED === 'false') {
    return { state: 'UNKNOWN', observed: { enabled: false }, evidence: [{ source: 'environment', key: 'REGISTRY_CRAWLER_ENABLED' }], explanation: 'Registry crawler is disabled; freshness is intentionally unknown.', severity: 'LOW' };
  }
  try {
    const row = (await pool.query('SELECT started_at, finished_at, error FROM registry_crawl_runs ORDER BY started_at DESC LIMIT 1')).rows[0];
    if (!row) return { state: 'UNKNOWN', observed: { runObserved: false }, evidence: [{ source: 'registry_crawl_runs' }], explanation: 'No registry crawl run has been observed yet.', severity: 'MEDIUM' };
    const ageHours = (Date.now() - new Date(row.started_at).getTime()) / 3_600_000;
    const state: State = row.error ? 'DEGRADING' : ageHours >= 24 ? 'DEGRADING' : 'HEALTHY';
    return {
      state,
      observed: { lastStartedAt: row.started_at, lastFinishedAt: row.finished_at, ageHours: Math.round(ageHours * 10) / 10, lastError: row.error ?? null },
      evidence: [{ source: 'registry_crawl_runs' }],
      explanation: state === 'HEALTHY' ? 'Registry crawler produced a recent run.' : 'Registry crawler freshness or last-run result is outside contract.',
      severity: 'MEDIUM',
      impact: state === 'HEALTHY' ? {} : { registryFreshness: 'degrading' },
    };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'registry_crawl_runs', error: error instanceof Error ? error.message : String(error) }], explanation: 'Registry freshness could not be observed.', severity: 'MEDIUM' };
  }
}


async function probeWorkerRuntimeIdentity(pool: Pool): Promise<ProbeResult> {
  try {
    const row = (await pool.query("SELECT current_user AS role, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls")).rows[0] ?? {};
    const role = String(row.role ?? '');
    const tls = row.tls === true;
    const healthy = role === 'spr_worker_runtime' && tls;
    return {
      state: healthy ? 'HEALTHY' : 'FAILED',
      observed: { role, tls },
      evidence: [{ source: 'postgres-session' }],
      explanation: healthy ? 'Worker is connected as the least-privileged runtime role over TLS.' : 'Worker runtime identity or transport does not match the least-privilege contract.',
      severity: 'CRITICAL',
      rootCauseState: healthy ? 'UNKNOWN' : 'PROVEN',
      rootCause: healthy ? null : role !== 'spr_worker_runtime' ? 'Worker is not using spr_worker_runtime.' : 'Worker database transport is not using TLS.',
      impact: healthy ? {} : { tenantIsolation: 'at risk', databasePrivilege: 'at risk' },
    };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'postgres-session', error: error instanceof Error ? error.message : String(error) }], explanation: 'Worker runtime identity could not be observed.', severity: 'CRITICAL' };
  }
}

async function probeTenantIsolation(pool: Pool): Promise<ProbeResult> {
  try {
    await pool.query('SELECT spr_assert_tenant_rls()');
    return { state: 'HEALTHY', observed: { assertion: true }, evidence: [{ source: 'spr_assert_tenant_rls' }], explanation: 'The database tenant-isolation invariant assertion passed.', severity: 'CRITICAL' };
  } catch (error) {
    return {
      state: 'FAILED',
      observed: { assertion: false },
      evidence: [{ source: 'spr_assert_tenant_rls', error: error instanceof Error ? error.message : String(error) }],
      explanation: 'The database tenant-isolation invariant assertion failed.',
      severity: 'CRITICAL',
      rootCauseState: 'SUPPORTED',
      rootCause: 'RLS assertion did not succeed from the worker runtime.',
      impact: { tenantIsolation: 'unproven', crossTenantExposure: 'must be treated as possible until disproven' },
    };
  }
}

async function probeAuthBackend(): Promise<ProbeResult> {
  const base = process.env.SUPABASE_URL?.trim();
  if (!base) return { state: 'UNKNOWN', observed: { configured: false }, evidence: [{ source: 'environment', key: 'SUPABASE_URL' }], explanation: 'Authentication backend URL is not configured in this runtime, so live auth health is unknown.', severity: 'HIGH' };
  try {
    const response = await fetch(new URL('/auth/v1/health', base), { signal: AbortSignal.timeout(10_000) });
    return {
      state: response.ok ? 'HEALTHY' : 'FAILED',
      observed: { configured: true, status: response.status },
      evidence: [{ source: 'supabase-auth-health', origin: new URL(base).origin }],
      explanation: response.ok ? 'Authentication backend answered a live health request.' : 'Authentication backend health request returned a non-success status.',
      severity: 'HIGH',
      rootCauseState: response.ok ? 'UNKNOWN' : 'SUPPORTED',
      rootCause: response.ok ? null : 'Configured authentication backend did not return a successful health response.',
      impact: response.ok ? {} : { authentication: 'unavailable or degraded' },
    };
  } catch (error) {
    return { state: 'FAILED', observed: { configured: true }, evidence: [{ source: 'supabase-auth-health', error: error instanceof Error ? error.message : String(error) }], explanation: 'Authentication backend could not be reached.', severity: 'HIGH', rootCauseState: 'SUPPORTED', rootCause: 'Authentication health request failed.', impact: { authentication: 'unavailable or degraded' } };
  }
}

async function probeBilling(pool: Pool): Promise<ProbeResult> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  let activeSubscriptions = 0;
  try {
    activeSubscriptions = Number((await pool.query("SELECT count(*)::int AS count FROM tenant_subscriptions WHERE lower(coalesce(status,'')) IN ('active','trialing')")).rows[0]?.count ?? 0);
  } catch {}
  if (!secret) {
    const state: State = activeSubscriptions > 0 ? 'FAILED' : 'UNKNOWN';
    return { state, observed: { configured: false, activeSubscriptions }, evidence: [{ source: 'tenant_subscriptions' }, { source: 'environment', key: 'STRIPE_SECRET_KEY' }], explanation: activeSubscriptions > 0 ? 'Active subscriptions exist but Stripe is not configured in the worker runtime.' : 'No live Stripe configuration is visible and no active subscription requires it here.', severity: activeSubscriptions > 0 ? 'CRITICAL' : 'MEDIUM', rootCauseState: activeSubscriptions > 0 ? 'PROVEN' : 'UNKNOWN', rootCause: activeSubscriptions > 0 ? 'Stripe secret is unavailable while active subscriptions exist.' : null, impact: activeSubscriptions > 0 ? { billing: 'cannot be reconciled' } : {} };
  }
  try {
    const response = await fetch('https://api.stripe.com/v1/account', { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) });
    return { state: response.ok ? 'HEALTHY' : 'FAILED', observed: { configured: true, activeSubscriptions, status: response.status }, evidence: [{ source: 'stripe-account-api' }], explanation: response.ok ? 'Stripe accepted a live authenticated account request.' : 'Stripe rejected the live account request.', severity: 'CRITICAL', rootCauseState: response.ok ? 'UNKNOWN' : 'SUPPORTED', rootCause: response.ok ? null : 'Stripe credentials or connectivity failed live verification.', impact: response.ok ? {} : { checkout: 'at risk', entitlements: 'at risk', webhooks: 'at risk' } };
  } catch (error) {
    return { state: 'FAILED', observed: { configured: true, activeSubscriptions }, evidence: [{ source: 'stripe-account-api', error: error instanceof Error ? error.message : String(error) }], explanation: 'Stripe could not be reached for live verification.', severity: 'CRITICAL', rootCauseState: 'SUPPORTED', rootCause: 'Stripe live verification failed.', impact: { billing: 'at risk' } };
  }
}

async function probeIntakeStorage(pool: Pool): Promise<ProbeResult> {
  const configured = Boolean(process.env.SPR_ARTIFACT_BROKER_URL?.trim() && process.env.SPR_ARTIFACT_BROKER_TOKEN?.trim());
  try {
    const row = (await pool.query(`
      SELECT
        count(*) FILTER (WHERE status IN ('QUEUED','PROCESSING','UPLOADED'))::int AS pending_items,
        count(*) FILTER (WHERE status='FAILED' AND created_at > now() - interval '24 hours')::int AS recent_failures
      FROM intake_items
    `)).rows[0] ?? {};
    const pendingItems = Number(row.pending_items ?? 0);
    const recentFailures = Number(row.recent_failures ?? 0);
    const state: State = !configured && pendingItems > 0 ? 'FAILED' : configured && recentFailures > 0 ? 'DEGRADING' : configured ? 'HEALTHY' : 'UNKNOWN';
    return { state, observed: { configured, pendingItems, recentFailures }, evidence: [{ source: 'intake_items' }, { source: 'artifact-broker-config' }], explanation: state === 'HEALTHY' ? 'Intake storage is configured and no recent failed intake items were observed.' : state === 'FAILED' ? 'Intake work is waiting but storage broker configuration is unavailable.' : state === 'DEGRADING' ? 'Intake storage is configured but recent intake failures were observed.' : 'No storage broker is configured and no pending intake work proves it is currently required.', severity: state === 'FAILED' ? 'HIGH' : 'MEDIUM', rootCauseState: state === 'FAILED' ? 'PROVEN' : 'UNKNOWN', rootCause: state === 'FAILED' ? 'Artifact broker configuration is unavailable while intake work is pending.' : null, impact: state === 'HEALTHY' ? {} : { uploadScans: pendingItems > 0 ? 'blocked or at risk' : 'unproven' } };
  } catch (error) {
    return { state: 'UNKNOWN', observed: { configured }, evidence: [{ source: 'intake_items', error: error instanceof Error ? error.message : String(error) }], explanation: 'Intake storage readiness could not be fully observed.', severity: 'HIGH' };
  }
}

async function probeSbomEvidence(pool: Pool): Promise<ProbeResult> {
  try {
    const row = (await pool.query(`
      WITH recent AS (
        SELECT id, scan_id FROM agent_jobs
         WHERE job_type='repository_security_scan'
           AND status='Completed'
           AND completed_at > now() - interval '24 hours'
      )
      SELECT
        count(*)::int AS completed_scans,
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM evidence_items e
             WHERE e.scan_id=recent.scan_id
               AND e.name='Syft CycloneDX SBOM summary'
          )
        )::int AS scans_with_sbom
      FROM recent
    `)).rows[0] ?? {};
    const completedScans = Number(row.completed_scans ?? 0);
    const scansWithSbom = Number(row.scans_with_sbom ?? 0);
    const missingSbom = Math.max(0, completedScans - scansWithSbom);
    const state: State = completedScans === 0 ? 'UNKNOWN' : missingSbom === 0 ? 'HEALTHY' : 'DEGRADING';
    return { state, observed: { completedScans, scansWithSbom, missingSbom }, evidence: [{ source: 'agent_jobs+evidence_items', windowHours: 24 }], explanation: completedScans === 0 ? 'No recent completed repository security scan exists to prove SBOM persistence.' : missingSbom === 0 ? 'Every recent completed repository security scan has SBOM evidence.' : `${missingSbom} recent completed repository security scan(s) have no SBOM evidence record.`, severity: missingSbom > 0 ? 'HIGH' : 'MEDIUM', impact: missingSbom > 0 ? { vulnerabilityCoverage: 'incomplete', launchTickets: 'may omit dependency evidence' } : {} };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'agent_jobs+evidence_items', error: error instanceof Error ? error.message : String(error) }], explanation: 'SBOM evidence completeness could not be observed.', severity: 'HIGH' };
  }
}

async function probeReportDelivery(pool: Pool): Promise<ProbeResult> {
  try {
    const row = (await pool.query(`
      SELECT
        count(*) FILTER (WHERE enabled=true)::int AS enabled_schedules,
        count(*) FILTER (WHERE enabled=true AND next_run_at < now() - interval '15 minutes')::int AS overdue_schedules,
        count(*) FILTER (WHERE enabled=true AND last_error IS NOT NULL AND length(trim(last_error))>0)::int AS errored_schedules
      FROM report_schedules
    `)).rows[0] ?? {};
    const enabledSchedules = Number(row.enabled_schedules ?? 0);
    const overdueSchedules = Number(row.overdue_schedules ?? 0);
    const erroredSchedules = Number(row.errored_schedules ?? 0);
    const state: State = enabledSchedules === 0 ? 'UNKNOWN' : overdueSchedules > 0 ? 'FAILED' : erroredSchedules > 0 ? 'DEGRADING' : 'HEALTHY';
    return { state, observed: { enabledSchedules, overdueSchedules, erroredSchedules }, evidence: [{ source: 'report_schedules' }], explanation: enabledSchedules === 0 ? 'No enabled report schedule exists to prove delivery flow.' : overdueSchedules > 0 ? 'One or more enabled report schedules are materially overdue.' : erroredSchedules > 0 ? 'Report schedules are running but one or more retain an error.' : 'Enabled report schedules are current and have no recorded errors.', severity: overdueSchedules > 0 ? 'HIGH' : 'MEDIUM', impact: state === 'HEALTHY' ? {} : { clientReports: state === 'UNKNOWN' ? 'unproven' : 'delayed or failed' } };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'report_schedules', error: error instanceof Error ? error.message : String(error) }], explanation: 'Report delivery state could not be observed.', severity: 'MEDIUM' };
  }
}

async function probeIntegrations(pool: Pool): Promise<ProbeResult> {
  try {
    const row = (await pool.query(`
      SELECT
        count(*) FILTER (WHERE enabled=1)::int AS enabled_configurations,
        count(*) FILTER (WHERE enabled=1 AND consecutive_failure_count >= 3)::int AS repeated_failures
      FROM monitoring_configurations
    `)).rows[0] ?? {};
    const enabledConfigurations = Number(row.enabled_configurations ?? 0);
    const repeatedFailures = Number(row.repeated_failures ?? 0);
    const state: State = enabledConfigurations === 0 ? 'UNKNOWN' : repeatedFailures > 0 ? 'DEGRADING' : 'HEALTHY';
    return { state, observed: { enabledConfigurations, repeatedFailures }, evidence: [{ source: 'monitoring_configurations' }], explanation: enabledConfigurations === 0 ? 'No enabled monitoring integration exists to prove external collection health.' : repeatedFailures > 0 ? `${repeatedFailures} enabled monitoring configuration(s) have repeated failures.` : 'Enabled monitoring integrations have not accumulated repeated failures.', severity: repeatedFailures > 0 ? 'HIGH' : 'MEDIUM', impact: repeatedFailures > 0 ? { evidenceFreshness: 'degrading', integrations: 'partial failure' } : {} };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'monitoring_configurations', error: error instanceof Error ? error.message : String(error) }], explanation: 'Integration health could not be observed.', severity: 'MEDIUM' };
  }
}

async function probeMalwareCoverage(pool: Pool): Promise<ProbeResult> {
  try {
    const row = (await pool.query(`
      SELECT
        (SELECT count(*)::int FROM scans WHERE NULLIF(timestamp,'')::timestamptz > now() - interval '24 hours' AND status='Completed') AS recent_scans,
        (SELECT count(*)::int FROM evidence_items WHERE NULLIF(timestamp,'')::timestamptz > now() - interval '24 hours' AND (lower(coalesce(engine_id,'')) LIKE '%malware%' OR lower(coalesce(engine_id,'')) LIKE '%clam%' OR lower(coalesce(name,'')) LIKE '%malware%')) AS malware_evidence
    `)).rows[0] ?? {};
    const recentScans = Number(row.recent_scans ?? 0);
    const malwareEvidence = Number(row.malware_evidence ?? 0);
    const state: State = recentScans === 0 ? 'UNKNOWN' : malwareEvidence > 0 ? 'HEALTHY' : 'UNKNOWN';
    return { state, observed: { recentScans, malwareEvidence }, evidence: [{ source: 'scans+evidence_items', windowHours: 24 }], explanation: recentScans === 0 ? 'No recent completed scan exists to test malware coverage.' : malwareEvidence > 0 ? 'Recent malware scan evidence is present.' : 'Recent scans exist but no malware-engine evidence is observable; SPR will not claim malware coverage.', severity: 'HIGH', impact: malwareEvidence > 0 ? {} : { malwareCoverage: 'unproven' } };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'scans+evidence_items', error: error instanceof Error ? error.message : String(error) }], explanation: 'Malware coverage could not be observed.', severity: 'HIGH' };
  }
}

function configuredPublicOrigin(): string | null {
  const explicit = process.env.APP_URL?.trim() || process.env.PUBLIC_APP_URL?.trim();
  if (explicit) {
    try { return new URL(explicit).origin; } catch { return null; }
  }
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return domain ? `https://${domain}` : null;
}

async function probePublicDeployment(): Promise<ProbeResult> {
  const origin = configuredPublicOrigin();
  if (!origin) return { state: 'UNKNOWN', observed: { configured: false, https: false }, evidence: [{ source: 'environment', keys: ['APP_URL','PUBLIC_APP_URL','RAILWAY_PUBLIC_DOMAIN'] }], explanation: 'No public application origin is configured in the worker runtime.', severity: 'HIGH' };
  const https = origin.startsWith('https://');
  try {
    const response = await fetch(new URL('/ready', origin), { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const state: State = response.status === 200 && https ? 'HEALTHY' : 'FAILED';
    return { state, observed: { configured: true, status: response.status, https }, evidence: [{ source: 'public-ready', origin }], explanation: state === 'HEALTHY' ? 'Public DNS/TLS path resolved and /ready passed.' : 'Public deployment did not satisfy HTTPS and readiness together.', severity: 'CRITICAL', rootCauseState: state === 'HEALTHY' ? 'UNKNOWN' : 'SUPPORTED', rootCause: state === 'HEALTHY' ? null : 'Public origin readiness check failed.', impact: state === 'HEALTHY' ? {} : { publicApp: 'unready', customerJourneys: 'at risk' } };
  } catch (error) {
    return { state: 'FAILED', observed: { configured: true, https }, evidence: [{ source: 'public-ready', origin, error: error instanceof Error ? error.message : String(error) }], explanation: 'Public SPR origin could not be reached over its configured URL.', severity: 'CRITICAL', rootCauseState: 'SUPPORTED', rootCause: 'DNS, TLS, routing, or deployment connectivity failed.', impact: { publicApp: 'unreachable or unready' } };
  }
}

async function probeBackupEvidence(): Promise<ProbeResult> {
  const raw = process.env.DATABASE_BACKUP_VERIFIED_AT?.trim();
  if (!raw) return { state: 'UNKNOWN', observed: { configured: false }, evidence: [{ source: 'environment', key: 'DATABASE_BACKUP_VERIFIED_AT' }], explanation: 'No operator-verified backup/restore timestamp is recorded; backup recoverability remains unknown.', severity: 'CRITICAL', impact: { recoverability: 'unproven' } };
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return { state: 'UNKNOWN', observed: { configured: true, verifiedAt: raw }, evidence: [{ source: 'environment', key: 'DATABASE_BACKUP_VERIFIED_AT' }], explanation: 'Backup verification timestamp is present but invalid.', severity: 'CRITICAL' };
  const ageHours = (Date.now() - time) / 3_600_000;
  const healthy = ageHours <= 168;
  return { state: healthy ? 'HEALTHY' : 'DEGRADING', observed: { configured: true, verifiedAt: new Date(time).toISOString(), ageHours: Math.round(ageHours * 10) / 10 }, evidence: [{ source: 'operator-backup-proof' }], explanation: healthy ? 'A backup/restore verification timestamp exists within the last seven days.' : 'The last recorded backup/restore verification is older than seven days.', severity: 'CRITICAL', impact: healthy ? {} : { recoverability: 'stale proof' } };
}

async function probeSelf(pool: Pool): Promise<ProbeResult> {
  try {
    const row = (await pool.query("SELECT observed_at FROM reality_observations WHERE contract_id <> 'reconciler_self_watch' ORDER BY observed_at DESC LIMIT 1")).rows[0];
    if (!row) return { state: 'UNKNOWN', observed: { priorObservation: false }, evidence: [{ source: 'reality_observations' }], explanation: 'No prior reconciliation observation exists yet.', severity: 'HIGH' };
    const ageMinutes = (Date.now() - new Date(row.observed_at).getTime()) / 60_000;
    return {
      state: ageMinutes < 10 ? 'HEALTHY' : 'FAILED',
      observed: { lastObservationAt: row.observed_at, ageMinutes: Math.round(ageMinutes * 10) / 10 },
      evidence: [{ source: 'reality_observations' }],
      explanation: ageMinutes < 10 ? 'The reconciler is producing fresh observations.' : 'The watcher has stopped producing fresh observations.',
      severity: 'CRITICAL',
      rootCauseState: ageMinutes < 10 ? 'UNKNOWN' : 'SUPPORTED',
      rootCause: ageMinutes < 10 ? null : 'Reality observations are stale.',
      impact: ageMinutes < 10 ? {} : { observability: 'compromised' },
    };
  } catch (error) {
    return { state: 'UNKNOWN', observed: {}, evidence: [{ source: 'reality_observations', error: error instanceof Error ? error.message : String(error) }], explanation: 'The reconciler could not verify its own telemetry.', severity: 'CRITICAL' };
  }
}

export async function runRealityReconciliationCycle(pool: Pool) {
  const probes: Array<[string, (pool: Pool) => Promise<ProbeResult>]> = [
    ['database_reachable', probeDatabase],
    ['worker_queue_flow', probeQueue],
    ['scan_terminality', probeScans],
    ['registry_freshness', probeRegistry],
    ['worker_runtime_identity', probeWorkerRuntimeIdentity],
    ['tenant_isolation_integrity', probeTenantIsolation],
    ['auth_backend_reachable', async () => probeAuthBackend()],
    ['billing_backend_reachable', probeBilling],
    ['intake_storage_readiness', probeIntakeStorage],
    ['sbom_evidence_completeness', probeSbomEvidence],
    ['report_delivery_flow', probeReportDelivery],
    ['integration_delivery_health', probeIntegrations],
    ['malware_coverage', probeMalwareCoverage],
    ['public_deployment_ready', async () => probePublicDeployment()],
    ['backup_restore_evidence', async () => probeBackupEvidence()],
  ];
  const cycleId = id('cycle');
  const startedAt = Date.now();
  const results: ObservationResult[] = [];
  for (const [contractId, probe] of probes) {
    const initial = await probe(pool);
    let observed = await observe(pool, contractId, initial);
    const repairer = contractId === 'worker_queue_flow' ? repairStaleQueue : contractId === 'scan_terminality' ? repairOrphanedScans : null;
    if (initial.state === 'FAILED' && observed.incidentId && repairer) {
      const incidentId = observed.incidentId;
      const c = await contract(pool, contractId);
      if (c && c.repair_class >= 0 && c.repair_class <= 1) {
        try {
          await setIncidentRepairState(pool, incidentId, 'REPAIRING', 'Bounded stale-state recovery using existing retry budget and lease ownership rules.');
          const repair = await repairer(pool);
          await setIncidentRepairState(pool, incidentId, 'VERIFYING', `Bounded recovery attempted=${repair.attempted}; requeued=${repair.requeued ?? 0}; failed=${repair.failed ?? 0}; scanRequeued=${repair.scanRequeued ?? 0}; scanFailed=${repair.scanFailed ?? 0}.`);
          observed = await observe(pool, contractId, await probe(pool));
        } catch {
          await setIncidentRepairState(pool, incidentId, 'INVESTIGATING', 'Bounded recovery attempt failed; incident remains open and no success is claimed.').catch(() => undefined);
        }
      } else if (c && c.repair_class >= 2) {
        await setIncidentRepairState(
          pool,
          incidentId,
          'INVESTIGATING',
          c.repair_class === 2
            ? 'Repair requires explicit Owner approval; autonomous execution blocked by authority policy.'
            : 'Repair is Class 3 and may never execute autonomously; diagnosis only.',
        ).catch(() => undefined);
      }
    }
    results.push(observed);
  }
  results.push(await observe(pool, 'reconciler_self_watch', await probeSelf(pool)));
  const counts = results.reduce<Record<State, number>>((acc, item) => {
    acc[item.state] += 1;
    return acc;
  }, { HEALTHY: 0, DEGRADING: 0, FAILED: 0, UNKNOWN: 0 });
  console.log('[RealityReconciliation] cycle complete', JSON.stringify({
    cycleId,
    durationMs: Date.now() - startedAt,
    counts,
    transitions: results.filter((item) => item.transition !== 'NONE'),
    contracts: results.map((item) => ({ contractId: item.contractId, state: item.state, transition: item.transition, incidentId: item.incidentId ?? null, diagnostic: item.diagnostic ?? {} })),
  }));
}

export async function runRealityReconciliationLoop() {
  const pool = createWorkerPool();
  try {
    while (true) {
      try {
        await runRealityReconciliationCycle(pool);
      } catch (error) {
        console.error('[RealityReconciliation] cycle failed:', error instanceof Error ? error.message : String(error));
      }
      await sleep(intervalMs());
    }
  } finally {
    await pool.end();
  }
}
