import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { createWorkerPool } from './worker-db.ts';
import { calculateBackoff, researchUrl, DISTRIBUTION_TENANT_ID, enqueueDistributionJob, enqueueResearchUrl } from '../lib/distribution-engine.ts';
import { ingestResearchResult, ingestQualifiedLead, sendInitial, sendDueFollowups, autonomousOutreachEnabled, verifyOutreachSender } from '../lib/distribution-outreach.ts';
import { buildMspDiscoveryQueries, canonicalizeDomain, dedupeDiscoveryResults, resolveDiscoveryProvider, type DiscoveryResult } from '../lib/distribution-discovery.ts';
import { backfillResearchShadowMissions, recordResearchShadowMission } from '../lib/q-legion-shadow.ts';
import { DistributionDeferredError } from '../lib/distribution-send-reservation.ts';

const POLL_MS = Math.max(250, Number.parseInt(process.env.DISTRIBUTION_POLL_MS ?? '1000', 10) || 1000);
const CONCURRENCY = Math.max(1, Math.min(50, Number.parseInt(process.env.DISTRIBUTION_CONCURRENCY ?? '10', 10) || 10));
const LEAD_SWEEP_MS = Math.max(60_000, Number.parseInt(process.env.DISTRIBUTION_LEAD_SWEEP_MS ?? '300000', 10) || 300_000);
const FOLLOWUP_SWEEP_MS = Math.max(60_000, Number.parseInt(process.env.DISTRIBUTION_FOLLOWUP_SWEEP_MS ?? '300000', 10) || 300_000);
const DISCOVERY_SWEEP_MS = Math.max(300_000, Number.parseInt(process.env.DISTRIBUTION_DISCOVERY_SWEEP_MS ?? '86400000', 10) || 86_400_000); // daily: business-search APIs bill per query and MSP lists change slowly
const WORKER_ID = `distribution-${os.hostname()}-${process.pid}`;

async function notifySlack(message: string) {
  const webhook = process.env.DISTRIBUTION_SLACK_WEBHOOK_URL?.trim(); if (!webhook) return;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5_000);
  try { await fetch(webhook, { method:'POST', signal:controller.signal, headers:{'content-type':'application/json'}, body:JSON.stringify({text:message.slice(0,3_000)}) }); }
  catch(error){console.error('[Distribution] Slack alert failed:',error instanceof Error?error.message:String(error));} finally{clearTimeout(timeout);}
}

async function campaignControls(pool: ReturnType<typeof createWorkerPool>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`,[DISTRIBUTION_TENANT_ID]);
    const result = await client.query(`SELECT discovery_enabled,outreach_enabled FROM distribution_campaign_settings WHERE tenant_id=$1 LIMIT 1`,[DISTRIBUTION_TENANT_ID]);
    await client.query('COMMIT');
    const row=result.rows?.[0];
    return { discoveryEnabled: row?.discovery_enabled !== false, outreachEnabled: row?.outreach_enabled !== false };
  } catch(error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { client.release(); }
}

async function claimJob(pool: ReturnType<typeof createWorkerPool>) { const client=await pool.connect(); try { await client.query('BEGIN'); await client.query(`SELECT set_config('app.tenant_id',$1,true)`,[DISTRIBUTION_TENANT_ID]); const result=await client.query(`SELECT id,kind,payload,attempts,max_attempts FROM distribution_jobs WHERE status='queued' AND available_at<=CURRENT_TIMESTAMP ORDER BY available_at ASC,created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`); const job=result.rows[0]; if(!job){await client.query('ROLLBACK');return null;} const attempts=Number(job.attempts)+1; await client.query(`UPDATE distribution_jobs SET status='running',attempts=$2,locked_at=CURRENT_TIMESTAMP,locked_by=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[job.id,attempts,WORKER_ID]); await client.query('COMMIT'); return {...job,attempts}; } catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;} finally{client.release();} }

async function recoverStaleRunningJobs(pool: ReturnType<typeof createWorkerPool>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [DISTRIBUTION_TENANT_ID]);
    const result = await client.query(`
      UPDATE distribution_jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
          available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE CURRENT_TIMESTAMP END,
          last_error = COALESCE(last_error, 'Recovered stale running lease'),
          locked_at = NULL,
          locked_by = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id=$1 AND status='running'
        AND locked_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'
      RETURNING id,status,attempts,max_attempts
    `, [DISTRIBUTION_TENANT_ID]);
    await client.query('COMMIT');
    if (result.rowCount) console.warn(`[Distribution] recovered ${result.rowCount} stale running job(s)`);
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function deferWithoutAttempt(pool: ReturnType<typeof createWorkerPool>, jobId: string, reason: string, delayMs = 300_000) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [DISTRIBUTION_TENANT_ID]);
    await client.query(`
      UPDATE distribution_jobs
      SET status='queued', attempts=GREATEST(attempts-1,0),
          available_at=CURRENT_TIMESTAMP+($2*INTERVAL '1 millisecond'),
          last_error=$3, locked_at=NULL, locked_by=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND tenant_id=$4 AND status='running'
    `, [jobId, delayMs, reason.slice(0, 2000), DISTRIBUTION_TENANT_ID]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function updateJob(pool: ReturnType<typeof createWorkerPool>,jobId:string,values:{status:string;result?:unknown;error?:string;delayMs?:number}){const client=await pool.connect();try{await client.query('BEGIN');await client.query(`SELECT set_config('app.tenant_id',$1,true)`,[DISTRIBUTION_TENANT_ID]);if(values.status==='succeeded')await client.query(`UPDATE distribution_jobs SET status='succeeded',result=$2::jsonb,last_error=NULL,locked_at=NULL,locked_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='running'`,[jobId,JSON.stringify(values.result??null)]);else await client.query(`UPDATE distribution_jobs SET status=$2,available_at=CASE WHEN $2='queued' THEN CURRENT_TIMESTAMP+($3*INTERVAL '1 millisecond') ELSE available_at END,last_error=$4,locked_at=NULL,locked_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='running'`,[jobId,values.status,values.delayMs??0,values.error??null]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}}

async function finishJob(pool: ReturnType<typeof createWorkerPool>,jobId:string,result:unknown){await updateJob(pool,jobId,{status:'succeeded',result});if(result&&typeof result==='object'&&'score' in result&&Number((result as {score?:unknown}).score)>=70){const lead=result as {score:number;company?:string;url?:string};await notifySlack(`SPR distribution: high-priority opportunity observed (score ${lead.score}).${lead.company?` Company: ${lead.company}.`:''}${lead.url?` Source: ${lead.url}.`:''}`);}};
async function failJob(pool: ReturnType<typeof createWorkerPool>,job:any,error:unknown){const message=error instanceof Error?error.message:String(error);const dead=job.attempts>=job.max_attempts;await updateJob(pool,job.id,{status:dead?'dead_letter':'queued',delayMs:calculateBackoff(job.attempts),error:message.slice(0,2000)});if(dead)await notifySlack(`SPR distribution: job ${job.id} moved to dead-letter after ${job.attempts} attempts. Error: ${message.slice(0,500)}`);};

async function getContactIdsForSource(pool: ReturnType<typeof createWorkerPool>,sourceUrl:string){const client=await pool.connect();try{await client.query('BEGIN');await client.query(`SELECT set_config('app.tenant_id',$1,true)`,[DISTRIBUTION_TENANT_ID]);const result=await client.query(`SELECT id FROM distribution_contacts WHERE tenant_id=$1 AND source_url=$2 AND status='active' AND NOT EXISTS (SELECT 1 FROM distribution_messages m WHERE m.contact_id=distribution_contacts.id AND m.kind='initial' AND m.status='sent') LIMIT 25`,[DISTRIBUTION_TENANT_ID,sourceUrl]);await client.query('COMMIT');return result.rows.map((row:any)=>String(row.id));}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}}

async function processJob(pool: ReturnType<typeof createWorkerPool>){const job=await claimJob(pool);if(!job)return false;try{const payload=typeof job.payload==='string'?JSON.parse(job.payload):job.payload??{};if(job.kind==='research_url'){if(typeof payload.url!=='string')throw new Error('DISTRIBUTION_URL_REQUIRED');const result=await researchUrl(payload.url);const defaultBasis=process.env.DISTRIBUTION_DEFAULT_OUTREACH_BASIS??'legitimate_interest';const contactsQueued=await ingestResearchResult(result,defaultBasis);await finishJob(pool,job.id,{...result,contactsQueued});try{await recordResearchShadowMission(pool,job.id,result);}catch(error){console.error(`[Distribution] Q-LEGION shadow mission failed for ${job.id}:`,error instanceof Error?error.message:String(error));}if(autonomousOutreachEnabled()&&contactsQueued>0&&(await campaignControls(pool)).outreachEnabled)for(const contactId of await getContactIdsForSource(pool,payload.url))await enqueueDistributionJob(pool,'send_outreach',{contactId});}else if(job.kind==='qualify_lead'){const email=typeof payload.email==='string'?payload.email:'';const company=typeof payload.company==='string'?payload.company:'';const text=`${company} ${email}`.toLowerCase();const businessEmail=Boolean(email&&!['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','icloud.com','me.com','aol.com'].includes(email.split('@')[1]??''));const score=(businessEmail?25:0)+(company?10:0)+(/msp|managed|it services|cyber|security/.test(text)?35:0);const contact = await ingestQualifiedLead({ leadId: payload.leadId, email, company: company || null, url: typeof payload.url === 'string' ? payload.url : null, outreachBasis: typeof payload.outreachBasis === 'string' ? payload.outreachBasis : undefined, consentEvidenceUrl: typeof payload.consentEvidenceUrl === 'string' ? payload.consentEvidenceUrl : undefined }, score);await finishJob(pool,job.id,{leadId:payload.leadId,company:company||null,score,businessEmail,contact,observedAt:new Date().toISOString()});}else if(job.kind==='prepare_outreach')await finishJob(pool,job.id,{status:'prepared',observedAt:new Date().toISOString()});else if(job.kind==='send_outreach'){if(typeof payload.contactId!=='string')throw new Error('DISTRIBUTION_CONTACT_ID_REQUIRED');if(!(await campaignControls(pool)).outreachEnabled){await deferWithoutAttempt(pool,job.id,'DISTRIBUTION_OUTREACH_PAUSED');return true;}await finishJob(pool,job.id,await sendInitial(payload.contactId));}else if(job.kind==='followup_outreach'){if(!(await campaignControls(pool)).outreachEnabled){await deferWithoutAttempt(pool,job.id,'DISTRIBUTION_OUTREACH_PAUSED');return true;}await finishJob(pool,job.id,{sent:await sendDueFollowups(),observedAt:new Date().toISOString()});}else throw new Error(`DISTRIBUTION_UNKNOWN_JOB_KIND:${job.kind}`);console.info(`[Distribution] job ${job.kind} ${job.id} succeeded`);}catch(error){console.error(`[Distribution] job ${job.kind} ${job.id} failed:`,error instanceof Error?error.message:String(error));if(error instanceof DistributionDeferredError)await deferWithoutAttempt(pool,job.id,error.message,error.delayMs);else await failJob(pool,job,error);}return true;}

async function sweepFreeReviewLeads(pool: ReturnType<typeof createWorkerPool>){const client=await pool.connect();try{await client.query('BEGIN');await client.query(`SELECT set_config('app.tenant_id',$1,true)`,[DISTRIBUTION_TENANT_ID]);const result=await client.query(`SELECT l.id,l.name,l.email,l.company FROM free_review_leads l WHERE l.tenant_id=$1 AND NOT EXISTS (SELECT 1 FROM distribution_jobs j WHERE j.tenant_id=$1 AND j.kind='qualify_lead' AND j.payload->>'leadId'=l.id AND j.status IN ('queued','running','succeeded')) ORDER BY l.created_at ASC LIMIT 100`,[DISTRIBUTION_TENANT_ID]);await client.query('COMMIT');for(const lead of result.rows)await enqueueDistributionJob(pool,'qualify_lead',{leadId:lead.id,name:lead.name,email:lead.email,company:lead.company??'',origin:{kind:'lead_sweep'}});return result.rows.length;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}}

// Safety net for the send step: an active, researched contact that never got
// its first email (the research->send hand-off missed it, or outreach was
// paused when it was found) is queued once it's settled. Bounded to recent
// contacts so turning outreach on never mails an old backlog, and skipped when
// a send job for the contact is already queued or running.
export const UNSENT_CONTACT_SQL = `SELECT c.id FROM distribution_contacts c WHERE c.tenant_id=$1 AND c.status='active' AND c.source_url IS NOT NULL AND c.created_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes' AND c.created_at > CURRENT_TIMESTAMP - INTERVAL '14 days' AND NOT EXISTS (SELECT 1 FROM distribution_messages m WHERE m.contact_id=c.id AND m.kind='initial' AND m.status='sent') AND NOT EXISTS (SELECT 1 FROM distribution_send_attempts a WHERE a.tenant_id=$1 AND a.contact_id=c.id AND a.kind='initial' AND a.status IN ('reserved','unknown','blocked','sent')) AND NOT EXISTS (SELECT 1 FROM distribution_jobs j WHERE j.tenant_id=$1 AND j.kind='send_outreach' AND j.payload->>'contactId'=c.id AND j.status IN ('queued','running')) ORDER BY c.created_at ASC LIMIT 25`;
async function sweepUnsentContacts(pool: ReturnType<typeof createWorkerPool>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [DISTRIBUTION_TENANT_ID]);
    // Both worker loops run this sweep; the transaction-scoped lock makes the
    // select-then-queue atomic so a contact is never queued twice.
    const lock = await client.query(`SELECT pg_try_advisory_xact_lock(hashtext('spr-distribution-unsent-sweep')) AS ok`);
    if (!lock.rows?.[0]?.ok) { await client.query('ROLLBACK'); return 0; }
    const result = await client.query(UNSENT_CONTACT_SQL, [DISTRIBUTION_TENANT_ID]);
    for (const row of result.rows) {
      await client.query(`INSERT INTO distribution_jobs (id, tenant_id, kind, payload) VALUES ($1, $2, 'send_outreach', $3::jsonb)`, [`dist_${randomUUID().replace(/-/g, '')}`, DISTRIBUTION_TENANT_ID, JSON.stringify({ contactId: String(row.id), origin: { kind: 'unsent_sweep' } })]);
    }
    await client.query('COMMIT');
    return result.rows.length;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

async function knownResearchDomains(pool: ReturnType<typeof createWorkerPool>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [DISTRIBUTION_TENANT_ID]);
    // A domain counts as researched once v2 research (contact page + same-site
    // redirects) has actually RUN on it -- the result records the version that
    // processed it -- or once any research found a contact. Keyed on the result,
    // not the payload: during a rolling deploy the old worker can claim a job
    // queued by the new one and research it with the old logic. A job still
    // queued/running also counts, so a sweep never double-queues a domain.
    const result = await client.query(`SELECT DISTINCT payload->>'url' AS url FROM distribution_jobs WHERE tenant_id=$1 AND kind='research_url' AND payload ? 'url' AND (status IN ('queued','running') OR (result->>'researchVersion')::text = '2' OR (CASE WHEN jsonb_typeof(result->'publicRoleEmails') = 'array' THEN jsonb_array_length(result->'publicRoleEmails') ELSE 0 END) > 0)`, [DISTRIBUTION_TENANT_ID]);
    await client.query('COMMIT');
    const domains = new Set<string>();
    for (const row of result.rows) { try { domains.add(canonicalizeDomain(row.url)); } catch { /* malformed legacy row */ } }
    return domains;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function sweepDiscovery(pool: ReturnType<typeof createWorkerPool>) {
  if (process.env.DISTRIBUTION_AUTONOMOUS_DISCOVERY !== 'true') return 0;
  const controls = await campaignControls(pool);
  if (!controls.discoveryEnabled) return 0;
  const provider = resolveDiscoveryProvider();
  if (!provider) {
    console.warn('[Distribution] discovery skipped: no business-search provider configured (set GOOGLE_PLACES_API_KEY, BRAVE_SEARCH_API_KEY or DISTRIBUTION_DISCOVERY_PROVIDER_URL)');
    return 0;
  }
  const lease = await pool.connect();
  let locked = false;
  try {
    const lock = await lease.query(`SELECT pg_try_advisory_lock(hashtext('spr-distribution-discovery-sweep')) AS locked`);
    locked = lock.rows?.[0]?.locked === true;
    if (!locked) return 0;
  const configured = process.env.DISTRIBUTION_DISCOVERY_QUERIES?.split('\n').map((s) => s.trim()).filter(Boolean);
  const queries = (configured?.length ? configured : buildMspDiscoveryQueries()).slice(0, 100);
  // Every domain already researched, so a daily sweep only queues new businesses.
  const seen = await knownResearchDomains(pool);
  let queued = 0;
  const batches: Array<{ query: string; candidates: DiscoveryResult[] }> = [];
  if (provider.name === 'seed-list') {
    try { batches.push({ query: 'seed-list', candidates: await provider.discover('seed-list', 2000) }); }
    catch (error) { console.error('[Distribution] seed-list discovery failed:', error instanceof Error ? error.message : String(error)); }
  } else {
    for (const query of queries) {
      try { batches.push({ query, candidates: await provider.discover(query, 20) }); }
      catch (error) { console.error(`[Distribution] ${provider.name} failed for "${query}":`, error instanceof Error ? error.message : String(error)); }
    }
  }
  for (const batch of batches) {
    const query = batch.query;
    for (const candidate of dedupeDiscoveryResults(batch.candidates)) {
      const domain = canonicalizeDomain(candidate.url);
      if (seen.has(domain)) continue;
      seen.add(domain);
      try { await enqueueResearchUrl(pool, candidate.url, { kind: 'discovery_sweep', query }); queued++; }
      catch (error) { console.warn(`[Distribution] skipped ${candidate.url}:`, error instanceof Error ? error.message : String(error)); }
    }
  }
  return queued;
  } finally {
    let destroyLease = false;
    if (locked) {
      try { await lease.query(`SELECT pg_advisory_unlock(hashtext('spr-distribution-discovery-sweep'))`); }
      catch { destroyLease = true; }
    }
    lease.release(destroyLease);
  }
}

// Diagnostic gate: why email provider, discovery, and db controls are or are not active.
// Counts and flags only; no prospect data. providerConfigured = email provider ready for outreach.
function diagnosticGate(){return{autonomousOutreach:autonomousOutreachEnabled(),providerConfigured:Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()),autonomousDiscovery:process.env.DISTRIBUTION_AUTONOMOUS_DISCOVERY==='true',discoveryProvider:resolveDiscoveryProvider()?.name??null};};
export async function runDistributionWorkerLoop(){const pool=createWorkerPool();try{await recoverStaleRunningJobs(pool);}catch(error){console.error('[Distribution] stale-job recovery failed:',error instanceof Error?error.message:String(error));}try{const controls=await campaignControls(pool);console.info('[Distribution] gates:',JSON.stringify({...diagnosticGate(),dbOutreachEnabled:controls.outreachEnabled,dbDiscoveryEnabled:controls.discoveryEnabled,dailySendLimit:process.env.DISTRIBUTION_DAILY_SEND_LIMIT??'50 (default)'}));}catch(error){console.error('[Distribution] gate read failed:',error instanceof Error?error.message:String(error));}try{const verification=await verifyOutreachSender(pool);console.info('[Distribution] outreach sender verification:',JSON.stringify(verification));}catch(error){console.error('[Distribution] outreach sender verification failed:',error instanceof Error?error.message:String(error));}try{const shadow=await backfillResearchShadowMissions(pool,100);console.info('[Distribution] Q-LEGION shadow backfill:',JSON.stringify({attempted:shadow.attempted,created:shadow.created,failures:shadow.failures.length}));if(shadow.failures.length)console.warn('[Distribution] Q-LEGION shadow backfill failures:',JSON.stringify(shadow.failures.slice(0,10)));}catch(error){console.error('[Distribution] Q-LEGION shadow backfill failed:',error instanceof Error?error.message:String(error));}let nextLeadSweep=0;let nextFollowupSweep=0;let nextDiscoverySweep=0;try{while(true){const now=Date.now();if(now>=nextLeadSweep){try{const count=await sweepFreeReviewLeads(pool);console.info(`[Distribution] lead sweep: queued ${count} Free Review lead qualification jobs`);}catch(error){console.error('[Distribution] lead sweep failed:',error instanceof Error?error.message:String(error));}nextLeadSweep=now+LEAD_SWEEP_MS;}if(now>=nextDiscoverySweep){try{const count=await sweepDiscovery(pool);const gate=diagnosticGate();console.info(`[Distribution] discovery sweep: queued ${count} research jobs`,JSON.stringify({autonomousDiscovery:gate.autonomousDiscovery,discoveryProvider:gate.discoveryProvider}));}catch(error){console.error('[Distribution] discovery sweep failed:',error instanceof Error?error.message:String(error));}nextDiscoverySweep=now+DISCOVERY_SWEEP_MS;}if(autonomousOutreachEnabled()&&now>=nextFollowupSweep){try{if((await campaignControls(pool)).outreachEnabled){await enqueueDistributionJob(pool,'followup_outreach',{});const unsent=await sweepUnsentContacts(pool);if(unsent)console.info(`[Distribution] unsent sweep: queued ${unsent} first emails`);}}catch(error){console.error('[Distribution] follow-up scheduling failed:',error instanceof Error?error.message:String(error));}nextFollowupSweep=now+FOLLOWUP_SWEEP_MS;}const batch=await Promise.all(Array.from({length:CONCURRENCY},()=>processJob(pool)));if(!batch.some(Boolean))await new Promise(resolve=>setTimeout(resolve,POLL_MS));}}finally{await pool.end();}}

