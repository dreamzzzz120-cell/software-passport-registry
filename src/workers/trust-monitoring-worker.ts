import crypto from 'node:crypto';
import { Pool } from 'pg';
import { collectDeepProviderEvidence } from '../integrations/deep-collectors.ts';
import { collectGitHubDeepEvidence } from '../integrations/github-deep.ts';
import { decryptCredentials } from '../integrations/credential-vault.ts';
import { persistTrustLoop, verifyRemediation, ControlObservation } from '../trust/trust-loop.ts';
import { safeNetworkFetch } from '../utils/monitoring.ts';

const PROVIDERS=new Set(['github','gitlab','bitbucket','azure-devops','jira','confluence','slack','microsoft-365','aws','azure','google-cloud','connectwise','autotask','ninjaone','hudu']);
function id(p:string){return`${p}_${crypto.randomUUID().replaceAll('-','')}`;}
function pool(){return new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.SQL_HOST,user:process.env.SQL_USER,password:process.env.SQL_PASSWORD,database:process.env.SQL_DB_NAME});}

async function scheduleDue(p:Pool){
  const now=new Date().toISOString();
  const due=await p.query(`SELECT id,tenant_id,client_id,asset_id,passport_id,collector_id,subject_type,subject_identifier,credential_reference_id,schedule_seconds FROM monitoring_configurations WHERE enabled=1 AND next_scheduled_at::timestamptz <= CURRENT_TIMESTAMP ORDER BY next_scheduled_at::timestamptz FOR UPDATE SKIP LOCKED LIMIT 50`);
  for(const cfg of due.rows){
    const window=new Date().toISOString().slice(0,16);
    const key=`${cfg.id}:${window}`;
    await p.query(`INSERT INTO collector_jobs (id,tenant_id,client_id,asset_id,passport_id,monitoring_configuration_id,collector_id,collector_version,subject_type,subject_identifier,schedule_source,observation_window,idempotency_key,state,attempt_number,maximum_attempts,created_at,next_attempt_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'monitoring',$11,$12,'queued',0,3,$13,$13) ON CONFLICT (idempotency_key) DO NOTHING`,[id('collector-job'),cfg.tenant_id,cfg.client_id,cfg.asset_id,cfg.passport_id,cfg.id,cfg.collector_id,'deep-v2',cfg.subject_type,cfg.subject_identifier,window,key,now]);
    const next=new Date(Date.now()+Math.max(900,cfg.schedule_seconds)*1000).toISOString();
    await p.query(`UPDATE monitoring_configurations SET last_attempted_at=$2,next_scheduled_at=$3,updated_at=$2 WHERE id=$1`,[cfg.id,now,next]);
  }
  return due.rowCount;
}

async function claim(p:Pool){const c=await p.connect();try{await c.query('BEGIN');const r=await c.query(`WITH candidate AS (SELECT id FROM collector_jobs WHERE state IN ('queued','failed') AND next_attempt_at::timestamptz <= CURRENT_TIMESTAMP AND attempt_number < maximum_attempts ORDER BY created_at::timestamptz FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE collector_jobs j SET state='running',lease_owner=$1,lease_expires_at=(CURRENT_TIMESTAMP+INTERVAL '5 minutes')::text,heartbeat_at=CURRENT_TIMESTAMP::text,started_at=COALESCE(started_at,CURRENT_TIMESTAMP::text),attempt_number=attempt_number+1 FROM candidate WHERE j.id=candidate.id RETURNING j.*`,[process.pid.toString()]);await c.query('COMMIT');return r.rows[0]||null;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function credentials(p:Pool,job:any){if(!job.monitoring_configuration_id)return{};const r=await p.query(`SELECT credential_reference_id FROM monitoring_configurations WHERE id=$1 AND tenant_id=$2 LIMIT 1`,[job.monitoring_configuration_id,job.tenant_id]);const ref=r.rows[0]?.credential_reference_id;if(!ref)return{};const x=await p.query(`SELECT encrypted_payload FROM credential_references WHERE id=$1 AND tenant_id=$2 AND state='active' LIMIT 1`,[ref,job.tenant_id]);if(!x.rows[0])throw new Error('CREDENTIAL_REFERENCE_NOT_FOUND');await p.query(`UPDATE credential_references SET last_used_at=CURRENT_TIMESTAMP::text WHERE id=$1 AND tenant_id=$2`,[ref,job.tenant_id]);return decryptCredentials(x.rows[0].encrypted_payload) as Record<string,string>;}
async function networkObservation(job:any):Promise<ControlObservation>{const url=job.subject_identifier;try{const r=await safeNetworkFetch(url,{timeoutMs:15000,maxBytes:1048576,maxRedirects:3});return{provider:'network',controlId:job.collector_id,title:`${job.collector_id} endpoint observation`,severity:'medium',subject:url,sourceUrl:r.finalUrl,observedAt:new Date().toISOString(),verificationMethod:`SPR ${job.collector_id} collector`,value:{status:r.response.status,contentType:r.response.headers.get('content-type')||null},status:r.response.ok?'PASS':'FAIL'};}catch(e:any){return{provider:'network',controlId:job.collector_id,title:`${job.collector_id} endpoint observation`,severity:'medium',subject:url,sourceUrl:url,observedAt:new Date().toISOString(),verificationMethod:`SPR ${job.collector_id} collector`,value:{error:e?.message||'NETWORK_COLLECTION_FAILED'},status:'UNKNOWN',limitation:'Network collection failed; SPR does not infer a pass or failure.'};}}
async function execute(p:Pool,job:any){const c=await credentials(p,job);if(PROVIDERS.has(job.collector_id))return job.collector_id==='github'?collectGitHubDeepEvidence(c):collectDeepProviderEvidence(job.collector_id,c);if(['tls','domain_dns','uptime'].includes(job.collector_id))return[await networkObservation(job)];if(job.collector_id==='repository'||job.collector_id==='dependency'||job.collector_id==='release'){const token=c.accessToken||c.token;if(!token)throw new Error('CREDENTIAL_MISSING_ACCESS_TOKEN');const repo=job.subject_identifier;const api=`https://api.github.com/repos/${repo}`;const h={accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'x-github-api-version':'2026-03-10'};const r=await fetch(api,{headers:h});if(!r.ok)throw new Error(`GITHUB_HTTP_${r.status}`);const body=await r.json();return[{provider:'github',controlId:job.collector_id,title:`GitHub ${job.collector_id} observation`,severity:'medium',subject:repo,sourceUrl:api,observedAt:new Date().toISOString(),verificationMethod:`GitHub REST ${job.collector_id} collector`,value:body,status:'PASS'} as ControlObservation];}throw new Error('COLLECTOR_UNSUPPORTED');}
// A collector job queued by POST /api/remediation-tasks/:id/verify carries no
// marker of its own -- it is discovered here purely by matching
// trust_remediation_work_items.verification_job_id back to this job.id, so a
// job that scheduled monitoring queued on its own (not for any task) is a
// silent no-op below. Verification success is never assumed from the
// collector merely succeeding: it always re-runs the same evidence-linkage
// checks verifyRemediation enforces everywhere else (fresh PASS evidence,
// linked to a real observation), so a collector that runs cleanly but finds
// the underlying issue still present still fails verification honestly.
async function recordTaskTransition(p:Pool,tenantId:string,taskId:string,fromStatus:string,toStatus:string){await p.query(`INSERT INTO remediation_task_transitions (id,tenant_id,task_id,from_status,to_status,actor_id,occurred_at) VALUES ($1,$2,$3,$4,$5,NULL,$6)`,[id('remtxn'),tenantId,taskId,fromStatus,toStatus,new Date().toISOString()]);}
export async function resolveRemediationVerification(p:Pool,job:any,succeeded:boolean,result:{evidenceIds:string[]}|null,failureReason?:string){
  const taskRow=await p.query(`SELECT id,finding_id,status FROM trust_remediation_work_items WHERE tenant_id=$1 AND verification_job_id=$2 AND status IN ('VERIFICATION_QUEUED','VERIFYING') LIMIT 1`,[job.tenant_id,job.id]);
  const task=taskRow.rows[0];
  if(!task)return;
  if(!succeeded){
    await p.query(`UPDATE trust_remediation_work_items SET status='VERIFICATION_FAILED',verification_failure_reason=$2 WHERE id=$1`,[task.id,String(failureReason||'COLLECTOR_FAILED').slice(0,500)]);
    await recordTaskTransition(p,job.tenant_id,task.id,task.status,'VERIFICATION_FAILED');
    return;
  }
  await p.query(`UPDATE trust_remediation_work_items SET status='VERIFYING' WHERE id=$1`,[task.id]);
  await recordTaskTransition(p,job.tenant_id,task.id,task.status,'VERIFYING');
  try{
    const observationRow=await p.query(`SELECT id FROM trust_observations WHERE tenant_id=$1 AND passport_id=$2 ORDER BY observation_version DESC LIMIT 1`,[job.tenant_id,job.passport_id]);
    const observationId=observationRow.rows[0]?.id;
    if(!observationId)throw new Error('NO_OBSERVATION_PRODUCED');
    if(!result?.evidenceIds?.length)throw new Error('NO_EVIDENCE_PRODUCED');
    const verification=await verifyRemediation({tenantId:job.tenant_id,findingId:task.finding_id,evidenceIds:result.evidenceIds,observationIds:[observationId]});
    await p.query(`UPDATE trust_remediation_work_items SET status='VERIFIED',verified_at=$2,verification_result=$3 WHERE id=$1`,[task.id,new Date().toISOString(),JSON.stringify(verification)]);
    await recordTaskTransition(p,job.tenant_id,task.id,'VERIFYING','VERIFIED');
  }catch(verifyError:any){
    await p.query(`UPDATE trust_remediation_work_items SET status='VERIFICATION_FAILED',verification_failure_reason=$2 WHERE id=$1`,[task.id,String(verifyError?.message||verifyError).slice(0,500)]);
    await recordTaskTransition(p,job.tenant_id,task.id,'VERIFYING','VERIFICATION_FAILED');
  }
}
async function complete(p:Pool,job:any,observations:ControlObservation[]){const result=await persistTrustLoop({tenantId:job.tenant_id,passportId:job.passport_id,clientId:job.client_id,assetId:job.asset_id,observations,generationReason:'scheduled_collection',actorType:'worker',collectorVersionMap:{[job.collector_id]:job.collector_version}});const now=new Date().toISOString();await p.query(`UPDATE collector_jobs SET state='succeeded',safe_error_code=NULL,safe_error_message=NULL,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,completed_at=$2 WHERE id=$1`,[job.id,now]);await p.query(`UPDATE monitoring_configurations SET last_successful_at=$2,last_status=$3,failure_count=0,consecutive_failure_count=0,updated_at=$2 WHERE id=$1`,[job.monitoring_configuration_id,now,observations.some(o=>o.status==='FAIL')?'fail':'pass']);await p.query(`INSERT INTO collector_results (id,tenant_id,client_id,asset_id,passport_id,job_id,collector_id,collector_version,subject_type,subject_identifier,status,started_at,completed_at,evidence_ids,finding_ids,verification_methods,limitations) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'succeeded',$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING`,[id('collector-result'),job.tenant_id,job.client_id,job.asset_id,job.passport_id,job.id,job.collector_id,job.collector_version,job.subject_type,job.subject_identifier,job.started_at,now,JSON.stringify(result.evidenceIds),JSON.stringify(result.findings.map((f:any)=>f.id)),JSON.stringify(observations.map(o=>o.verificationMethod)),JSON.stringify(observations.map(o=>o.limitation).filter(Boolean))]);await resolveRemediationVerification(p,job,true,result);return result;}
async function fail(p:Pool,job:any,error:any){const now=new Date().toISOString(),terminal=job.attempt_number>=job.maximum_attempts;await p.query(`UPDATE collector_jobs SET state=$2,safe_error_code=$3,safe_error_message=$4,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,completed_at=CASE WHEN $2='dead_lettered' THEN $5 ELSE completed_at END,next_attempt_at=($5::timestamptz+make_interval(secs=>LEAST(3600,30*POWER(2,attempt_number))))::text WHERE id=$1`,[job.id,terminal?'dead_lettered':'failed','COLLECTOR_EXECUTION_FAILED',String(error?.message||error).slice(0,500),now]);await p.query(`UPDATE monitoring_configurations SET failure_count=failure_count+1,consecutive_failure_count=consecutive_failure_count+1,last_status='failed',updated_at=$2 WHERE id=$1`,[job.monitoring_configuration_id,now]).catch(()=>undefined);if(terminal)await resolveRemediationVerification(p,job,false,null,String(error?.message||error)).catch(e=>console.error('REMEDIATION_VERIFICATION_RESOLVE_FAILED',e));}

export async function runTrustMonitoringWorkerLoop(){const p=pool();let lastSchedule=0;for(;;){try{if(Date.now()-lastSchedule>=30000){await scheduleDue(p);lastSchedule=Date.now();}}catch(e){console.error('TRUST_SCHEDULER_ERROR',e);}const job=await claim(p);if(!job){await new Promise(r=>setTimeout(r,1500));continue;}try{const observations=await execute(p,job);await complete(p,job,observations);}catch(e){await fail(p,job,e);}}}
