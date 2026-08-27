import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { calculateAndPersistPassportScore } from './scoring-engine.ts';

export type ControlStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type Severity = 'informational' | 'low' | 'medium' | 'high' | 'critical';
export type ControlObservation = { provider:string; controlId:string; title:string; status:ControlStatus; severity:Severity; subject:string; observedAt:string; sourceUrl:string; verificationMethod:string; value:unknown; limitation?:string; evidenceId?:string; hash?:string };
export type FindingStatus = 'OPEN'|'UNKNOWN'|'RESOLVED';
export type Finding = { id:string; tenantId:string; passportId:string; clientId:string; assetId:string; controlId:string; title:string; severity:Severity; status:FindingStatus; description:string; remediation:string; evidenceIds:string[]; fingerprint:string; policyVersion:string };

const POLICY_VERSION='spr.findings.v2', SCORE_VERSION='spr.score.v2', CONFIDENCE_VERSION='spr.confidence.v2', MAX_VALUE_BYTES=1_500_000;
function canonical(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;return`{${Object.keys(value as Record<string,unknown>).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;}
function sha256(value:unknown):string{return crypto.createHash('sha256').update(canonical(value),'utf8').digest('hex');}
function newId(prefix:string):string{return`${prefix}_${crypto.randomUUID().replaceAll('-','')}`;}
function findingId(fingerprint:string):string{return`finding_${fingerprint.slice(0,40)}`;}
function evidenceId(observation:ControlObservation,tenantId:string,passportId:string):string{return`evidence_${sha256({tenantId,passportId,provider:observation.provider,controlId:observation.controlId,subject:observation.subject,sourceUrl:observation.sourceUrl,observedAt:observation.observedAt,verificationMethod:observation.verificationMethod,value:observation.value,status:observation.status,limitation:observation.limitation??null}).slice(0,40)}`;}
function freshnessMultiplier(observedAt:string,now=Date.now()):number{const ageHours=Math.max(0,(now-new Date(observedAt).getTime())/3600000);if(!Number.isFinite(ageHours))return 0;if(ageHours<=24)return 1;if(ageHours<=72)return .95;if(ageHours<=168)return .85;if(ageHours<=720)return .7;return .5;}
function semanticSignals(f:Finding):Set<string>{const text=`${f.controlId} ${f.title} ${f.description}`.toLowerCase(),s=new Set<string>();if(/mfa|multi.?factor|authentication/.test(text))s.add('mfa');if(/internet|external|public|exposed|exposure|publicly.?accessible/.test(text))s.add('exposure');if(/privileged|admin|administrator|owner|root/.test(text))s.add('privilege');if(/vulnerab|cve|security.?alert|critical.?alert/.test(text))s.add('vulnerability');if(/encryption|encrypt|kms|key.?management/.test(text))s.add('encryption');if(/logging|audit.?log|activity.?log|cloudtrail|monitoring/.test(text))s.add('logging');return s;}

// The SPR Connect webhook delivery pipeline (spr_webhook_deliveries + the
// worker in src/workers/webhook-worker.ts) is fully built and already
// running, but nothing ever enqueues a delivery — customers can register a
// webhook and it will simply never fire. This is the single call site that
// closes that loop: every tenant-visible trust-loop event enqueues a
// delivery for each of that tenant's active webhooks subscribed to it.
// Best-effort: a delivery-enqueue failure must never fail the authoritative
// write it is reporting on.
async function notifyWebhooks(tenantId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const webhooks = (await db.execute(sql`SELECT id FROM spr_webhooks WHERE tenant_id=${tenantId} AND active=true AND events::jsonb @> ${JSON.stringify([eventType])}::jsonb`) as any).rows ?? [];
    if (!webhooks.length) return;
    const now = new Date().toISOString();
    for (const webhook of webhooks as Array<{ id: string }>) {
      const eventId = newId('evt');
      const idempotencyKey = crypto.createHash('sha256').update(`${tenantId}:${webhook.id}:${eventId}`).digest('hex');
      await db.execute(sql`INSERT INTO spr_webhook_deliveries (id,tenant_id,webhook_id,event_id,event_type,payload,idempotency_key,attempt_number,status,next_attempt_at,created_at) VALUES (${newId('whdelivery')},${tenantId},${webhook.id},${eventId},${eventType},${JSON.stringify(payload)},${idempotencyKey},1,'queued',${now},${now}) ON CONFLICT (tenant_id,webhook_id,idempotency_key) DO NOTHING`);
    }
  } catch (error) {
    console.error('[Webhook] failed to enqueue delivery', { tenantId, eventType, error });
  }
}

export function observationsToFindings(input:{tenantId:string;passportId:string;clientId:string;assetId:string;observations:ControlObservation[]}):Finding[]{return input.observations.map(o=>{const fingerprint=sha256({tenantId:input.tenantId,passportId:input.passportId,provider:o.provider,controlId:o.controlId,subject:o.subject});const status:FindingStatus=o.status==='FAIL'?'OPEN':o.status==='UNKNOWN'?'UNKNOWN':'RESOLVED';return{id:findingId(fingerprint),tenantId:input.tenantId,passportId:input.passportId,clientId:input.clientId,assetId:input.assetId,controlId:o.controlId,title:o.title,severity:o.status==='PASS'?'informational':o.severity,status,description:o.status==='FAIL'?`${o.title} failed based on authoritative provider evidence.`:o.status==='UNKNOWN'?`${o.title} is UNKNOWN because authoritative evidence was unavailable or insufficient; SPR does not infer a pass.`:`${o.title} passed based on authoritative provider evidence.`,remediation:o.status==='FAIL'?`Remediate ${o.controlId}, recollect the underlying source, and independently verify the new observation before closure.`:'',evidenceIds:o.evidenceId?[o.evidenceId]:[],fingerprint,policyVersion:POLICY_VERSION};});}

export function correlateFindings(findings:Finding[]):Finding[]{const open=findings.filter(f=>f.status==='OPEN'),bySignal=new Map<string,Finding[]>();for(const f of open)for(const signal of semanticSignals(f)){const list=bySignal.get(signal)??[];list.push(f);bySignal.set(signal,list);}const mfa=bySignal.get('mfa')??[],exposure=bySignal.get('exposure')??[],privilege=bySignal.get('privilege')??[],vulnerability=bySignal.get('vulnerability')??[];if(mfa.length&&exposure.length&&(privilege.length||vulnerability.length)){const contributors=[...mfa,...exposure,...privilege,...vulnerability],first=contributors[0],evidenceIds=[...new Set(contributors.flatMap(f=>f.evidenceIds))],fingerprint=sha256({tenantId:first.tenantId,passportId:first.passportId,controlId:'cross-source-privileged-exposure',contributors:contributors.map(f=>f.fingerprint).sort()});findings.push({...first,id:findingId(fingerprint),controlId:'cross-source-privileged-exposure',title:'Correlated privileged internet exposure without MFA',severity:'critical',status:'OPEN',description:'Independent evidence correlates external exposure, privileged access and missing MFA. The combined condition materially increases compromise impact and likelihood.',remediation:'Remove unnecessary external exposure or privileged access, enforce phishing-resistant MFA, then recollect every contributing source and independently verify resolution.',evidenceIds,fingerprint,policyVersion:POLICY_VERSION});}return[...new Map(findings.map(f=>[f.id,f])).values()];}

async function persistEvidence(input:{tenantId:string;passportId:string;clientId:string;assetId:string;observations:ControlObservation[];createdAt:string}):Promise<string[]>{const evidenceIds:string[]=[];for(const o of input.observations){const serialized=JSON.stringify(o.value);if(Buffer.byteLength(serialized,'utf8')>MAX_VALUE_BYTES)throw new Error('EVIDENCE_VALUE_TOO_LARGE');const id=o.evidenceId??evidenceId(o,input.tenantId,input.passportId),hash=o.hash??sha256({tenantId:input.tenantId,passportId:input.passportId,provider:o.provider,controlId:o.controlId,subject:o.subject,sourceUrl:o.sourceUrl,observedAt:o.observedAt,verificationMethod:o.verificationMethod,status:o.status,severity:o.severity,value:o.value,limitation:o.limitation??null});o.evidenceId=id;o.hash=hash;evidenceIds.push(id);await db.execute(sql`INSERT INTO evidence_ledger (id,tenant_id,passport_id,client_id,asset_id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,value,evidence_hash,limitation,created_at) VALUES (${id},${input.tenantId},${input.passportId},${input.clientId},${input.assetId},${o.provider},${o.controlId},${o.subject},${o.sourceUrl},${o.observedAt},${o.verificationMethod},${o.status},${o.severity},${serialized},${hash},${o.limitation??null},${input.createdAt}) ON CONFLICT (id) DO NOTHING`);}return evidenceIds;}
async function persistFindings(findings:Finding[],now:string):Promise<Array<{finding:Finding;wasNew:boolean}>>{const results:Array<{finding:Finding;wasNew:boolean}>=[];for(const f of findings){const row=(await db.execute(sql`INSERT INTO trust_findings (id,tenant_id,passport_id,client_id,asset_id,control_id,title,severity,status,description,remediation,evidence_ids,fingerprint,policy_version,created_at,updated_at) VALUES (${f.id},${f.tenantId},${f.passportId},${f.clientId},${f.assetId},${f.controlId},${f.title},${f.severity},${f.status},${f.description},${f.remediation},${JSON.stringify(f.evidenceIds)},${f.fingerprint},${f.policyVersion},${now},${now}) ON CONFLICT (tenant_id,fingerprint) DO UPDATE SET status=EXCLUDED.status,severity=EXCLUDED.severity,description=EXCLUDED.description,remediation=EXCLUDED.remediation,evidence_ids=EXCLUDED.evidence_ids,policy_version=EXCLUDED.policy_version,updated_at=EXCLUDED.updated_at,resolved_at=CASE WHEN EXCLUDED.status='RESOLVED' THEN CURRENT_TIMESTAMP ELSE NULL END RETURNING (xmax=0) AS inserted`) as any).rows?.[0];results.push({finding:f,wasNew:Boolean(row?.inserted)});}return results;}

export async function persistTrustLoop(input:{tenantId:string;passportId:string;clientId:string;assetId:string;observations:ControlObservation[];generationReason?:string;actorType?:string;collectorVersionMap?:Record<string,string>}){
  if(!input.tenantId||!input.passportId||!input.clientId||!input.assetId)throw new Error('TRUST_LOOP_SCOPE_REQUIRED');
  if(!input.observations.length)throw new Error('TRUST_LOOP_REQUIRES_OBSERVATIONS');
  const now=new Date().toISOString();
  const evidenceIds=await persistEvidence({...input,createdAt:now});
  const findings=correlateFindings(observationsToFindings(input));
  const findingResults=await persistFindings(findings,now);
  for(const result of findingResults)if(result.wasNew&&result.finding.status==='OPEN')await notifyWebhooks(input.tenantId,'risk.created',{findingId:result.finding.id,passportId:input.passportId,controlId:result.finding.controlId,severity:result.finding.severity,title:result.finding.title});
  const known=input.observations.filter(o=>o.status!=='UNKNOWN').length;
  const unknown=input.observations.length-known;
  const completeness=Math.round(known/input.observations.length*10000);
  const freshEvidence=input.observations.reduce((sum,o)=>sum+freshnessMultiplier(o.observedAt),0)/input.observations.length;
  const open=findings.filter(f=>f.status==='OPEN');

  // This layer collects observations and correlates findings, but it does
  // NOT calculate the passport's score itself -- that would reintroduce a
  // second competing formula. It normalizes into the shared canonical shape
  // and calls the single scoring engine (src/trust/scoring-engine.ts) that
  // src/utils/scanner.ts also calls. Trust-loop findings aren't tagged with
  // a security/compliance/vendor dimension the way scanFindings rows are --
  // every semantic signal correlateFindings() looks for (MFA, exposure,
  // privilege, encryption, logging) is a security-control concept, so these
  // findings are scored against the security dimension. This also fixes the
  // original bug where security/compliance/overall were all written as the
  // exact same number: complianceScore now reflects "no compliance-specific
  // findings were correlated from this evidence" rather than a copy of
  // whatever the security penalty happened to be.
  const canonicalResult=await calculateAndPersistPassportScore(input.tenantId,input.passportId,{
    findings:open.map(f=>({severity:f.severity,category:'security',open:true})),
    evidence:{totalUnits:input.observations.length,knownUnits:known,freshness:freshEvidence},
  });
  const score=canonicalResult.overallScore??0;
  // trust_observations/timeline/webhooks have always expressed confidence in
  // basis points (0-10000); the canonical engine returns a 0-100 percentage,
  // so it's converted once here rather than changing that external contract.
  const confidence=Math.round((canonicalResult.confidenceScore??0)*100);

  const previous=await db.execute(sql`SELECT id,observation_version,canonical_payload_hash FROM trust_observations WHERE tenant_id=${input.tenantId} AND passport_id=${input.passportId} ORDER BY observation_version DESC LIMIT 1`),previousRow=(previous as any).rows?.[0],version=Number(previousRow?.observation_version??0)+1,payload={schemaVersion:'spr.passport.v2',scoreVersion:SCORE_VERSION,confidenceVersion:CONFIDENCE_VERSION,generatedAt:now,evidenceIds,findingIds:findings.map(f=>f.id).sort(),completenessBasisPoints:completeness,confidenceBasisPoints:confidence,score,open:open.length,unknown,limitations:input.observations.filter(o=>o.limitation).map(o=>({controlId:o.controlId,limitation:o.limitation}))},canonicalPayloadHash=sha256({previousHash:previousRow?.canonical_payload_hash??null,payload}),observationId=newId('trustobs');
  await db.execute(sql`INSERT INTO trust_observations (id,tenant_id,passport_id,client_id,asset_id,schema_version,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,scoring_policy_version,confidence_policy_version,completeness_basis_points,confidence_basis_points,known_dimension_count,unknown_dimension_count,stale_dimension_count,expired_dimension_count,canonical_payload_hash,immutable_payload,generation_reason,generated_by_actor_type,collector_version_map,partially_known_dimension_count,unavailable_dimension_count,open_finding_count,persisted_finding_count,idempotency_key,created_at) VALUES (${observationId},${input.tenantId},${input.passportId},${input.clientId},${input.assetId},'spr.passport.v2',${version},${now},${previousRow?.id??null},${JSON.stringify(evidenceIds)},${JSON.stringify(findings.map(f=>f.id))},${SCORE_VERSION},${CONFIDENCE_VERSION},${completeness},${confidence},${known},${unknown},0,0,${canonicalPayloadHash},${JSON.stringify(payload)},${input.generationReason??'evidence_change'},${input.actorType??'worker'},${JSON.stringify(input.collectorVersionMap??{})},0,${unknown},${open.length},${findings.length},${`${input.tenantId}:${input.passportId}:${canonicalPayloadHash}`},${now}) ON CONFLICT (tenant_id,idempotency_key) DO NOTHING`);
  const passportRows=await db.execute(sql`SELECT timeline FROM passports WHERE id=${input.passportId} AND tenant_id=${input.tenantId} LIMIT 1`),passport=(passportRows as any).rows?.[0];
  let timeline:unknown[]=[];
  try{timeline=Array.isArray(passport?.timeline)?passport.timeline:JSON.parse(passport?.timeline??'[]');}catch{timeline=[];}
  timeline.push({at:now,type:'trust_snapshot',observationId,version,score,confidence,completeness});
  timeline=timeline.slice(-500);
  await db.execute(sql`UPDATE passports SET evidence=${JSON.stringify(evidenceIds)},vulnerabilities=${JSON.stringify(findings.filter(f=>f.status==='OPEN'))},timeline=${JSON.stringify(timeline)} WHERE id=${input.passportId} AND tenant_id=${input.tenantId}`);
  const webhookPayload={passportId:input.passportId,observationId,version,score,confidence,completeness,openFindingCount:open.length};
  await notifyWebhooks(input.tenantId,'evidence.updated',webhookPayload);
  await notifyWebhooks(input.tenantId,'trust.changed',webhookPayload);
  await notifyWebhooks(input.tenantId,'passport.updated',webhookPayload);
  return{observationId,version,score,confidence,completeness,findings,evidenceIds,payloadHash:canonicalPayloadHash};
}

export async function verifyRemediation(input:{tenantId:string;findingId:string;observationIds:string[];evidenceIds:string[];actorId?:string}){const findingRows=await db.execute(sql`SELECT id,status,evidence_ids,passport_id FROM trust_findings WHERE id=${input.findingId} AND tenant_id=${input.tenantId} LIMIT 1`),finding=(findingRows as any).rows?.[0];if(!finding)throw new Error('FINDING_NOT_FOUND');const evidenceIds=[...new Set(input.evidenceIds)],observationIds=[...new Set(input.observationIds)];if(!evidenceIds.length||!observationIds.length)throw new Error('VERIFICATION_REQUIRES_NEW_EVIDENCE');const evidenceRows=await db.execute(sql`SELECT id,observed_at,status,evidence_hash,control_id FROM evidence_ledger WHERE tenant_id=${input.tenantId} AND passport_id=${finding.passport_id} AND id = ANY(${evidenceIds})`),observationRows=await db.execute(sql`SELECT id,generated_at,evidence_ids FROM trust_observations WHERE tenant_id=${input.tenantId} AND passport_id=${finding.passport_id} AND id = ANY(${observationIds})`),evidence=(evidenceRows as any).rows??[],observations=(observationRows as any).rows??[];if(evidence.length!==evidenceIds.length||observations.length!==observationIds.length)throw new Error('VERIFICATION_EVIDENCE_NOT_OWNED');if(evidence.some((row:any)=>row.status!=='PASS'))throw new Error('VERIFICATION_REQUIRES_PASS_EVIDENCE');const priorEvidenceIds:string[]=(()=>{try{return JSON.parse(finding.evidence_ids??'[]');}catch{return[];}})(),priorRows=priorEvidenceIds.length?await db.execute(sql`SELECT MAX(observed_at) AS latest_prior FROM evidence_ledger WHERE tenant_id=${input.tenantId} AND passport_id=${finding.passport_id} AND id = ANY(${priorEvidenceIds})`):null,latestPrior=(priorRows as any)?.rows?.[0]?.latest_prior;if(latestPrior&&evidence.some((row:any)=>new Date(row.observed_at).getTime()<=new Date(latestPrior).getTime()))throw new Error('VERIFICATION_REQUIRES_NEWER_EVIDENCE');const observationEvidence=new Set(observations.flatMap((row:any)=>{try{return JSON.parse(row.evidence_ids??'[]');}catch{return[];}}));if(evidenceIds.some(e=>!observationEvidence.has(e)))throw new Error('VERIFICATION_EVIDENCE_NOT_LINKED_TO_OBSERVATION');const verificationId=newId('verify');await db.execute(sql`INSERT INTO remediation_verification_ledger (id,tenant_id,finding_id,status,prior_evidence_ids,verification_evidence_ids,observation_ids,actor_id,created_at) VALUES (${verificationId},${input.tenantId},${input.findingId},'VERIFIED',${JSON.stringify(priorEvidenceIds)},${JSON.stringify(evidenceIds)},${JSON.stringify(observationIds)},${input.actorId??null},${new Date().toISOString()})`);await db.execute(sql`UPDATE trust_findings SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=${input.findingId} AND tenant_id=${input.tenantId}`);const verificationPayload={findingId:input.findingId,passportId:finding.passport_id,verificationId,evidenceIds,observationIds};await notifyWebhooks(input.tenantId,'risk.resolved',verificationPayload);await notifyWebhooks(input.tenantId,'verification.completed',verificationPayload);return{verificationId,findingId:input.findingId,status:'VERIFIED',evidenceIds,observationIds};}
