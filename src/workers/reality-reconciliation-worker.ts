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
  ];
  const cycleId = id('cycle');
  const startedAt = Date.now();
  const results: ObservationResult[] = [];
  for (const [contractId, probe] of probes) {
    const initial = await probe(pool);
    let observed = await observe(pool, contractId, initial);
    const repairer = contractId === 'worker_queue_flow' ? repairStaleQueue : contractId === 'scan_terminality' ? repairOrphanedScans : null;
    if (initial.state === 'FAILED' && observed.incidentId && repairer) {
      const c = await contract(pool, contractId);
      if ((c?.repair_class ?? 0) >= 1) {
        try {
          await setIncidentRepairState(pool, observed.incidentId, 'REPAIRING', 'Bounded stale-state recovery using existing retry budget and lease ownership rules.');
          const repair = await repairer(pool);
          await setIncidentRepairState(pool, observed.incidentId, 'VERIFYING', `Bounded recovery attempted=${repair.attempted}; requeued=${repair.requeued ?? 0}; failed=${repair.failed ?? 0}; scanRequeued=${repair.scanRequeued ?? 0}; scanFailed=${repair.scanFailed ?? 0}.`);
          observed = await observe(pool, contractId, await probe(pool));
        } catch {
          await setIncidentRepairState(pool, observed.incidentId, 'INVESTIGATING', 'Bounded recovery attempt failed; incident remains open and no success is claimed.').catch(() => undefined);
        }
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
