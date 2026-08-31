import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('remediation-tasks route: every frontend call has a real, tenant-scoped, role-gated backend route', () => {
  const source = () => read('src/routes/remediation-tasks.ts');

  it('implements every route MSPCommandCenter.tsx actually calls', () => {
    const s = source();
    expect(s).toContain("router.get('/'");
    expect(s).toContain("router.post('/'");
    expect(s).toContain("router.get('/:id'");
    expect(s).toContain("router.patch('/:id'");
    expect(s).toContain("makeTransitionRoute(router, 'start', 'OPEN', 'IN_PROGRESS'");
    expect(s).toContain("makeTransitionRoute(router, 'ready-for-verification', 'IN_PROGRESS', 'READY_FOR_VERIFICATION'");
    expect(s).toContain("router.post('/:id/verify'");
    expect(s).toContain("router.get('/:id/verification'");
  });

  it('is mounted in server.ts behind requireAuth, not a second auth mechanism', () => {
    const s = read('server.ts');
    expect(s).toContain("app.use('/api/remediation-tasks', requireAuth, createRemediationTasksRouter());");
  });

  it('gates every mutating action to staff roles, never trusting the frontend to hide the button', () => {
    const s = source();
    expect(s).toContain("router.post('/', requireRole(STAFF_ROLES as unknown as string[])");
    expect(s).toContain("requireRole(STAFF_ROLES as unknown as string[]), async (req: AuthenticatedRequest, res, next) => {\n    try {\n      const db = req.db!;\n      const tenantId = req.user!.tenantId;\n      const clientScope = clientScopeOf(req);\n      const current = await loadTask");
    expect(s).toContain("router.post('/:id/verify', requireRole(STAFF_ROLES as unknown as string[])");
    expect(s).toContain("router.patch('/:id', requireRole(['Owner', 'Admin'])");
  });

  it('PATCH can never set status -- a client cannot reach a terminal state by editing the task directly', () => {
    const s = source();
    const patchSchemaSource = s.slice(s.indexOf('const patchSchema'), s.indexOf('const verifySchema'));
    expect(patchSchemaSource).not.toContain('status:');
  });

  it('every transition has exactly one legal starting status, enforced before any write happens', () => {
    const s = source();
    expect(s).toContain('if (current.status !== fromStatus) {');
    expect(s).toContain("return res.status(409).json({ error: 'INVALID_TRANSITION'");
  });

  it('verify requires READY_FOR_VERIFICATION and rejects a duplicate/out-of-order request deterministically', () => {
    const s = source();
    expect(s).toContain("if (task.status !== 'READY_FOR_VERIFICATION') {");
    expect(s).toContain("return res.status(409).json({ error: 'INVALID_TRANSITION', from: task.status, requestedTransition: 'verify'");
  });

  it('verify validates the monitoring configuration belongs to this tenant and is enabled before queueing anything', () => {
    const s = source();
    expect(s).toContain('FROM monitoring_configurations WHERE id = ${parsed.data.monitoringConfigurationId} AND tenant_id = ${tenantId} AND enabled = 1');
    expect(s).toContain("if (!configuration) return res.status(404).json({ error: 'MONITORING_CONFIGURATION_NOT_FOUND' });");
  });

  it('queues a real collector_jobs row reusing the exact idempotency-key scheme monitoring-configurations/:id/run uses, never a fabricated job id', () => {
    const s = source();
    expect(s).toContain('collectorJobKey({');
    expect(s).toContain('INSERT INTO collector_jobs');
    expect(s).toContain("if (error?.code !== '23505' && error?.cause?.code !== '23505') throw error;");
  });

  it('list, get, create, and every transition scope every query by tenant_id (and client_id for Client-role callers)', () => {
    const s = source();
    expect(s).toContain('WHERE tenant_id = ${tenantId} AND (${clientScope}::text IS NULL OR client_id = ${clientScope})');
    expect(s).toContain('WHERE id = ${taskId} AND tenant_id = ${tenantId} AND (${clientScope}::text IS NULL OR client_id = ${clientScope})');
  });

  it('records an immutable transition row and an audit entry for every state change', () => {
    const s = source();
    expect(s).toContain('async function recordTransition(');
    expect(s).toContain('INSERT INTO remediation_task_transitions');
    expect(s).toContain('await appendAuditEntry(db,');
  });

  it('creation is idempotent per finding -- a duplicate POST returns the existing task instead of a second one', () => {
    const s = source();
    expect(s).toContain("status NOT IN ('CLOSED', 'CANCELLED')");
    expect(s).toContain('if (existing) return res.status(200).json(toTaskJson(existing));');
  });
});

describe('migration 0046 extends the real, already-used remediation table instead of a second schema', () => {
  const source = () => read('migrations/0046_remediation_task_verification.sql');

  it('widens the existing status CHECK to include the async verification states, not a new column/table', () => {
    const s = source();
    expect(s).toContain("CHECK (status IN ('OPEN','IN_PROGRESS','BLOCKED','READY_FOR_VERIFICATION','VERIFICATION_QUEUED','VERIFYING','VERIFIED','VERIFICATION_FAILED','CLOSED','CANCELLED'))");
  });

  it('adds verification tracking columns to trust_remediation_work_items', () => {
    const s = source();
    for (const column of ['title', 'started_at', 'ready_for_verification_at', 'verification_configuration_id', 'verification_job_id', 'verified_at', 'verification_result', 'verification_failure_reason']) {
      expect(s).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  it('constrains verification_configuration_id/verification_job_id to the same tenant as the task', () => {
    const s = source();
    expect(s).toContain('FOREIGN KEY (tenant_id, verification_configuration_id) REFERENCES monitoring_configurations(tenant_id, id)');
    expect(s).toContain('FOREIGN KEY (tenant_id, verification_job_id) REFERENCES collector_jobs(tenant_id, id)');
  });

  it('makes remediation_task_transitions append-only and tenant-isolated, mirroring remediation_notes', () => {
    const s = source();
    expect(s).toContain("RAISE EXCEPTION 'REMEDIATION_TASK_TRANSITION_IMMUTABLE'");
    expect(s).toContain('ENABLE ROW LEVEL SECURITY');
    expect(s).toContain("CREATE POLICY spr_tenant_isolation ON remediation_task_transitions");
  });
});

describe('trust-monitoring-worker resolves remediation verification through the real collector pipeline, never fabricating a result', () => {
  const source = () => read('src/workers/trust-monitoring-worker.ts');

  it('hooks both the success path and the terminal-failure path of the real job lifecycle', () => {
    const s = source();
    expect(s).toContain('await resolveRemediationVerification(p,job,true,result);return result;');
    expect(s).toContain('if(terminal)await resolveRemediationVerification(p,job,false,null,String(error?.message||error))');
  });

  it('a successful collector run still re-runs the real evidence-linkage check before marking VERIFIED -- success is never assumed from the job alone', () => {
    const s = source();
    expect(s).toContain('await verifyRemediation({tenantId:job.tenant_id,findingId:task.finding_id,evidenceIds:result.evidenceIds,observationIds:[observationId]})');
    expect(s).toContain("if(!observationId)throw new Error('NO_OBSERVATION_PRODUCED')");
    expect(s).toContain("if(!result?.evidenceIds?.length)throw new Error('NO_EVIDENCE_PRODUCED')");
  });

  it('only resolves jobs that are actually linked to a queued/verifying task, never touching an unrelated job', () => {
    const s = source();
    expect(s).toContain("verification_job_id=$2 AND status IN ('VERIFICATION_QUEUED','VERIFYING')");
    expect(s).toContain('if(!task)return;');
  });
});

// ---------------------------------------------------------------------------
// Live database behavior. Skipped (not failed) without DATABASE_URL, the same
// convention tests/security/rls-tenant-isolation.test.ts uses for anything
// that needs a real Postgres connection rather than being a pure unit test.
// ---------------------------------------------------------------------------
const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('remediation task lifecycle against a real database', () => {
  let pool: Pool;
  const stamp = Date.now();
  const TENANT_A = `remtask-tenant-a-${stamp}`;
  const TENANT_B = `remtask-tenant-b-${stamp}`;
  const CLIENT_A = `remtask-client-a-${stamp}`;
  const PASSPORT_A = `remtask-passport-a-${stamp}`;
  const FINDING_A = `remtask-finding-a-${stamp}`;
  const CONFIG_A = `remtask-config-a-${stamp}`;
  const CONFIG_B = `remtask-config-b-${stamp}`;
  let taskId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`
      INSERT INTO clients (id,tenant_id,name,domain,industry,joined_date)
      VALUES ($1,$2,'Remediation Task Test Client','remtask.test','Security','2026-01-01')
      ON CONFLICT (id) DO NOTHING
    `, [CLIENT_A, TENANT_A]);
    await pool.query(`
      INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,release_date,file_hash,license_type)
      VALUES ($1,$2,$3,'Remediation Task Test Passport','1.0.0','SPR Test','security','2026-01-01',$4,'MIT')
      ON CONFLICT (id) DO NOTHING
    `, [PASSPORT_A, TENANT_A, CLIENT_A, 'c'.repeat(64)]);
    await pool.query(`
      INSERT INTO trust_findings (id,tenant_id,passport_id,client_id,asset_id,control_id,title,severity,status,description,remediation,fingerprint,policy_version,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$3,'test-control','Remediation task test finding','high','OPEN','A test finding','Fix it','remtask-fp',$5,now()::text,now()::text)
      ON CONFLICT (id) DO NOTHING
    `, [FINDING_A, TENANT_A, PASSPORT_A, CLIENT_A, `remtask-fp-${stamp}`]);
    await pool.query(`
      INSERT INTO monitoring_configurations (id,tenant_id,client_id,asset_id,passport_id,collector_id,subject_type,subject_identifier,schedule_seconds,next_scheduled_at,freshness_policy_id,confidence_policy_id,created_by,updated_by,created_at,updated_at)
      VALUES ($1,$2,$3,$3,$4,'uptime','url','https://example.test',900,now()::text,'network.v1','observed.v1','test','test',now()::text,now()::text)
      ON CONFLICT (id) DO NOTHING
    `, [CONFIG_A, TENANT_A, CLIENT_A, PASSPORT_A]);
    await pool.query(`
      INSERT INTO monitoring_configurations (id,tenant_id,client_id,asset_id,passport_id,collector_id,subject_type,subject_identifier,schedule_seconds,next_scheduled_at,freshness_policy_id,confidence_policy_id,created_by,updated_by,created_at,updated_at)
      VALUES ($1,$2,$2,$2,$2,'uptime','url','https://example-b.test',900,now()::text,'network.v1','observed.v1','test','test',now()::text,now()::text)
      ON CONFLICT (id) DO NOTHING
    `, [CONFIG_B, TENANT_B]).catch(() => undefined);

    const created = await pool.query(`
      INSERT INTO trust_remediation_work_items (id,tenant_id,passport_id,finding_id,client_id,external_system,owner_id,status,title,remediation_plan,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,'SPR','test-uid','OPEN','Test task','Fix the finding',now()::text,now()::text)
      RETURNING id
    `, [`remtask-${stamp}`, TENANT_A, PASSPORT_A, FINDING_A, CLIENT_A]);
    taskId = created.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM remediation_task_transitions WHERE tenant_id = $1', [TENANT_A]).catch(() => undefined);
    await pool.query('DELETE FROM trust_remediation_work_items WHERE tenant_id = $1', [TENANT_A]).catch(() => undefined);
    await pool.query('DELETE FROM collector_jobs WHERE tenant_id IN ($1,$2)', [TENANT_A, TENANT_B]).catch(() => undefined);
    await pool.query('DELETE FROM monitoring_configurations WHERE tenant_id IN ($1,$2)', [TENANT_A, TENANT_B]).catch(() => undefined);
    await pool.query('DELETE FROM trust_findings WHERE tenant_id = $1', [TENANT_A]).catch(() => undefined);
    await pool.query('DELETE FROM passports WHERE tenant_id = $1', [TENANT_A]).catch(() => undefined);
    await pool.query('DELETE FROM clients WHERE tenant_id = $1', [TENANT_A]).catch(() => undefined);
    await pool.end();
  });

  it('rejects an invalid status value at the database layer, independent of any application check', async () => {
    await expect(
      pool.query(`UPDATE trust_remediation_work_items SET status = 'NOT_A_REAL_STATUS' WHERE id = $1`, [taskId])
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it('accepts every status in the real lifecycle, including the new async verification states', async () => {
    for (const status of ['IN_PROGRESS', 'READY_FOR_VERIFICATION', 'VERIFICATION_QUEUED', 'VERIFYING', 'VERIFICATION_FAILED', 'VERIFIED']) {
      await expect(pool.query(`UPDATE trust_remediation_work_items SET status = $2 WHERE id = $1`, [taskId, status])).resolves.toBeDefined();
    }
    await pool.query(`UPDATE trust_remediation_work_items SET status = 'OPEN' WHERE id = $1`, [taskId]);
  });

  it('rejects a verification_configuration_id or verification_job_id from a different tenant', async () => {
    await expect(
      pool.query(`UPDATE trust_remediation_work_items SET verification_configuration_id = $2 WHERE id = $1`, [taskId, CONFIG_B])
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('remediation_task_transitions rows can be inserted but never updated or deleted', async () => {
    const inserted = await pool.query(`
      INSERT INTO remediation_task_transitions (id, tenant_id, task_id, from_status, to_status, actor_id, occurred_at)
      VALUES ($1, $2, $3, 'OPEN', 'IN_PROGRESS', 'test-uid', now()::text) RETURNING id
    `, [`remtxn-${stamp}`, TENANT_A, taskId]);
    expect(inserted.rows[0].id).toBe(`remtxn-${stamp}`);
    await expect(
      pool.query(`UPDATE remediation_task_transitions SET to_status = 'TAMPERED' WHERE id = $1`, [`remtxn-${stamp}`])
    ).rejects.toThrow(/REMEDIATION_TASK_TRANSITION_IMMUTABLE/);
    await expect(
      pool.query(`DELETE FROM remediation_task_transitions WHERE id = $1`, [`remtxn-${stamp}`])
    ).rejects.toThrow(/REMEDIATION_TASK_TRANSITION_IMMUTABLE/);
  });

  it('a transition row cannot be forged against a task in another tenant', async () => {
    await expect(
      pool.query(`
        INSERT INTO remediation_task_transitions (id, tenant_id, task_id, from_status, to_status, actor_id, occurred_at)
        VALUES ($1, $2, $3, 'OPEN', 'IN_PROGRESS', 'test-uid', now()::text)
      `, [`remtxn-forged-${stamp}`, TENANT_B, taskId])
    ).rejects.toThrow(/does not belong to the referenced task/);
  });
});

describeIfDb('resolveRemediationVerification: the worker-side hook that turns a completed collector job into a real verification result', () => {
  let pool: Pool;
  const stamp = Date.now();
  const TENANT = `remverify-tenant-${stamp}`;
  const CLIENT = `remverify-client-${stamp}`;
  const PASSPORT = `remverify-passport-${stamp}`;
  const CONFIG = `remverify-config-${stamp}`;

  async function makeFinding(suffix: string) {
    const findingId = `remverify-finding-${suffix}-${stamp}`;
    await pool.query(`
      INSERT INTO trust_findings (id,tenant_id,passport_id,client_id,asset_id,control_id,title,severity,status,description,remediation,evidence_ids,fingerprint,policy_version,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$3,'test-control','f','high','OPEN','d','r','[]',$5,'v1',now()::text,now()::text)
    `, [findingId, TENANT, PASSPORT, CLIENT, `fp-${suffix}-${stamp}`]);
    return findingId;
  }

  async function makeTask(findingId: string, suffix: string, jobId: string) {
    const taskId = `remverify-task-${suffix}-${stamp}`;
    await pool.query(`
      INSERT INTO trust_remediation_work_items (id,tenant_id,passport_id,finding_id,client_id,external_system,status,title,remediation_plan,verification_configuration_id,verification_job_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,'SPR','VERIFICATION_QUEUED','t','r',$6,$7,now()::text,now()::text)
    `, [taskId, TENANT, PASSPORT, findingId, CLIENT, CONFIG, jobId]);
    return taskId;
  }

  async function makeJob(suffix: string) {
    const jobId = `remverify-job-${suffix}-${stamp}`;
    await pool.query(`
      INSERT INTO collector_jobs (id,tenant_id,client_id,asset_id,passport_id,monitoring_configuration_id,collector_id,collector_version,subject_type,subject_identifier,schedule_source,observation_window,idempotency_key,attempt_number,maximum_attempts,created_at,next_attempt_at)
      VALUES ($1,$2,$3,$3,$4,$5,'uptime','spr.uptime.v1','url','https://example.test','manual','w',$6,1,3,now()::text,now()::text)
    `, [jobId, TENANT, CLIENT, PASSPORT, CONFIG, `key-${suffix}-${stamp}`]);
    return { id: jobId, tenant_id: TENANT, client_id: CLIENT, passport_id: PASSPORT, monitoring_configuration_id: CONFIG };
  }

  async function makeObservationAndEvidence(evidenceStatus: 'PASS' | 'FAIL') {
    const evidenceId = `remverify-evidence-${evidenceStatus}-${stamp}`;
    await pool.query(`
      INSERT INTO evidence_ledger (id,tenant_id,passport_id,client_id,asset_id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,value,evidence_hash,created_at)
      VALUES ($1,$2,$3,$4,$3,'network','test-control','https://example.test','https://example.test',now()::text,'SPR test collector',$5,'medium','{}','hash-x',now()::text)
    `, [evidenceId, TENANT, PASSPORT, CLIENT, evidenceStatus]);
    await pool.query(`
      INSERT INTO trust_observations (id,tenant_id,passport_id,client_id,asset_id,schema_version,observation_version,generated_at,evidence_ids,finding_ids,scoring_policy_version,confidence_policy_version,completeness_basis_points,known_dimension_count,unknown_dimension_count,stale_dimension_count,expired_dimension_count,canonical_payload_hash,immutable_payload)
      VALUES ($1,$2,$3,$4,$3,'v1',1,now()::text,$5,'[]','v1','v1',10000,1,0,0,0,'hash','{}')
      ON CONFLICT (tenant_id, passport_id, observation_version) DO NOTHING
    `, [`remverify-obs-${stamp}`, TENANT, PASSPORT, CLIENT, JSON.stringify([evidenceId])]);
    return evidenceId;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`INSERT INTO clients (id,tenant_id,name,domain,industry,joined_date) VALUES ($1,$2,'c','remverify.test','Security','2026-01-01')`, [CLIENT, TENANT]);
    await pool.query(`INSERT INTO passports (id,tenant_id,client_id,name,version,publisher,category,release_date,file_hash,license_type) VALUES ($1,$2,$3,'p','1.0.0','SPR','security','2026-01-01',$4,'MIT')`, [PASSPORT, TENANT, CLIENT, 'd'.repeat(64)]);
    await pool.query(`
      INSERT INTO monitoring_configurations (id,tenant_id,client_id,asset_id,passport_id,collector_id,subject_type,subject_identifier,schedule_seconds,next_scheduled_at,freshness_policy_id,confidence_policy_id,created_by,updated_by,created_at,updated_at)
      VALUES ($1,$2,$3,$3,$4,'uptime','url','https://example.test',900,now()::text,'network.v1','observed.v1','test','test',now()::text,now()::text)
    `, [CONFIG, TENANT, CLIENT, PASSPORT]);
    await makeObservationAndEvidence('PASS');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM remediation_task_transitions WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM remediation_verification_ledger WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM trust_remediation_work_items WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM trust_observations WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM evidence_ledger WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM collector_jobs WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM trust_findings WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM monitoring_configurations WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM passports WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.query('DELETE FROM clients WHERE tenant_id = $1', [TENANT]).catch(() => undefined);
    await pool.end();
  });

  it('marks a task VERIFIED when the collector succeeds and produces real, fresh, PASS evidence', async () => {
    const { resolveRemediationVerification } = await import('../src/workers/trust-monitoring-worker.ts');
    const evidenceId = `remverify-evidence-PASS-${stamp}`;
    const findingId = await makeFinding('ok');
    const job = await makeJob('ok');
    const taskId = await makeTask(findingId, 'ok', job.id);

    await resolveRemediationVerification(pool as any, job, true, { evidenceIds: [evidenceId] });

    const task = (await pool.query('SELECT status, verified_at, verification_result FROM trust_remediation_work_items WHERE id = $1', [taskId])).rows[0];
    expect(task.status).toBe('VERIFIED');
    expect(task.verified_at).toBeTruthy();
    expect(JSON.parse(task.verification_result).status).toBe('VERIFIED');

    const transitions = (await pool.query(`SELECT to_status FROM remediation_task_transitions WHERE task_id = $1 ORDER BY occurred_at`, [taskId])).rows;
    expect(transitions.map((r: any) => r.to_status)).toEqual(['VERIFYING', 'VERIFIED']);
  });

  it('marks a task VERIFICATION_FAILED, never VERIFIED, when the collector job itself dead-letters', async () => {
    const { resolveRemediationVerification } = await import('../src/workers/trust-monitoring-worker.ts');
    const findingId = await makeFinding('jobfail');
    const job = await makeJob('jobfail');
    const taskId = await makeTask(findingId, 'jobfail', job.id);

    await resolveRemediationVerification(pool as any, job, false, null, 'COLLECTOR_EXECUTION_FAILED');

    const task = (await pool.query('SELECT status, verification_failure_reason, verified_at FROM trust_remediation_work_items WHERE id = $1', [taskId])).rows[0];
    expect(task.status).toBe('VERIFICATION_FAILED');
    expect(task.verification_failure_reason).toContain('COLLECTOR_EXECUTION_FAILED');
    expect(task.verified_at).toBeNull();
  });

  it('marks a task VERIFICATION_FAILED (not VERIFIED) when the collector succeeds but the evidence it produced is not a real PASS -- never fabricates success', async () => {
    const { resolveRemediationVerification } = await import('../src/workers/trust-monitoring-worker.ts');
    const failEvidenceId = await makeObservationAndEvidence('FAIL');
    const findingId = await makeFinding('badevidence');
    const job = await makeJob('badevidence');
    const taskId = await makeTask(findingId, 'badevidence', job.id);

    await resolveRemediationVerification(pool as any, job, true, { evidenceIds: [failEvidenceId] });

    const task = (await pool.query('SELECT status, verification_failure_reason FROM trust_remediation_work_items WHERE id = $1', [taskId])).rows[0];
    expect(task.status).toBe('VERIFICATION_FAILED');
    expect(task.verification_failure_reason).toBeTruthy();
  });

  it('is a no-op for a collector job that is not linked to any queued/verifying remediation task', async () => {
    const { resolveRemediationVerification } = await import('../src/workers/trust-monitoring-worker.ts');
    const unrelatedJob = await makeJob('unrelated');
    await expect(resolveRemediationVerification(pool as any, unrelatedJob, true, { evidenceIds: [] })).resolves.toBeUndefined();
  });

  it('resolving the same job twice does not re-verify or duplicate transitions -- the second call is a no-op once the task has left the queued/verifying states', async () => {
    const { resolveRemediationVerification } = await import('../src/workers/trust-monitoring-worker.ts');
    const evidenceId = `remverify-evidence-PASS-${stamp}`;
    const findingId = await makeFinding('duplicate');
    const job = await makeJob('duplicate');
    const taskId = await makeTask(findingId, 'duplicate', job.id);

    await resolveRemediationVerification(pool as any, job, true, { evidenceIds: [evidenceId] });
    await resolveRemediationVerification(pool as any, job, true, { evidenceIds: [evidenceId] });

    const transitions = (await pool.query(`SELECT to_status FROM remediation_task_transitions WHERE task_id = $1 ORDER BY occurred_at`, [taskId])).rows;
    expect(transitions.map((r: any) => r.to_status)).toEqual(['VERIFYING', 'VERIFIED']);
  });
});
