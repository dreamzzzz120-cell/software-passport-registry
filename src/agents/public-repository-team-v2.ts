/** Autonomous public-repository ingestion team. Public data only; never contacts repo owners. */
import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.ts';
import { enqueueFreeReview, FREE_REVIEW_TENANT_ID } from '../routes/free-review-submit.ts';

const VERSION = 'public-repository-team/1.0.0';
const LANGUAGES = ['JavaScript','TypeScript','Python','Go','Java','Rust','C#','Ruby','PHP','Kotlin','Swift','C++','Scala','Dart','Elixir'];
const DEFAULT_QUERIES = [
  'stars:>={STAR} archived:false fork:false',
  'topics:security stars:>={STAR} archived:false fork:false',
  'topics:cybersecurity stars:>={STAR} archived:false fork:false',
  'topics:devtools stars:>={STAR} archived:false fork:false',
  'topics:ai stars:>={STAR} archived:false fork:false',
  'topics:opensource stars:>={STAR} archived:false fork:false',
];
const PER_PAGE = 100;
const DEFAULT_BATCH = 25;
const DEFAULT_REFRESH_HOURS = 168;
const MAX_PAGES = 10;

export type TeamCursor = { strategyIndex:number; queryIndex:number; page:number; languageIndex:number };
export type Candidate = { owner:string; repository:string; url:string; stars:number; language:string|null; licenseSpdx:string|null; defaultBranch:string|null; headSha:string|null; archived:boolean; fork:boolean };

const envInt = (name:string, fallback:number, max=Number.MAX_SAFE_INTEGER) => { const n=Number.parseInt(process.env[name]??'',10); return Number.isFinite(n)&&n>0?Math.min(n,max):fallback; };
const queries = () => { const star=envInt('REGISTRY_CRAWL_STAR_FLOOR',50,1_000_000); const configured=process.env.REGISTRY_CRAWL_QUERIES?.split('\n').map(x=>x.trim()).filter(Boolean); return (configured?.length?configured:DEFAULT_QUERIES).map(x=>x.replaceAll('{STAR}',String(star))); };
const ledgerId = (c:Candidate) => `reg_${crypto.createHash('sha256').update(`github:${c.owner.toLowerCase()}/${c.repository.toLowerCase()}`).digest('hex').slice(0,40)}`;
const repoUrl = (o:string,r:string) => `https://github.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}`;

export function normalizeCandidate(item:any):Candidate|null {
  const owner=String(item?.owner?.login??''); const repository=String(item?.name??'');
  if(!/^[A-Za-z0-9_.-]{1,100}$/.test(owner)||!/^[A-Za-z0-9_.-]{1,100}$/.test(repository)) return null;
  return { owner, repository, url:repoUrl(owner,repository), stars:Math.max(0,Number(item?.stargazers_count??0)||0), language:typeof item?.language==='string'?item.language.slice(0,80):null, licenseSpdx:typeof item?.license?.spdx_id==='string'&&item.license.spdx_id!=='NOASSERTION'?item.license.spdx_id.slice(0,100):null, defaultBranch:typeof item?.default_branch==='string'?item.default_branch.slice(0,255):null, headSha:typeof item?.pushed_at==='string'?item.pushed_at:null, archived:item?.archived===true, fork:item?.fork===true };
}

async function searchGithub(query:string,page:number,token:string){
  const u=new URL('https://api.github.com/search/repositories'); u.searchParams.set('q',query); u.searchParams.set('sort','stars'); u.searchParams.set('order','desc'); u.searchParams.set('per_page',String(PER_PAGE)); u.searchParams.set('page',String(page));
  const r=await fetch(u,{headers:{Accept:'application/vnd.github+json','User-Agent':'software-passport-registry-public-repository-team/1.0',...(token?{Authorization:`Bearer ${token}`}:{})}});
  if(r.status===403||r.status===429)return {rateLimited:true,items:[] as any[]}; if(!r.ok)throw new Error(`GITHUB_SEARCH_${r.status}`); const j:any=await r.json(); return {rateLimited:false,items:Array.isArray(j?.items)?j.items:[]};
}

async function tenant<T>(pool:Pool,fn:(client:PoolClient)=>Promise<T>):Promise<T>{ const c=await pool.connect(); try{await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[FREE_REVIEW_TENANT_ID]);const x=await fn(c);await c.query('COMMIT');return x;}catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}finally{c.release();} }

async function connection(pool:Pool){ return tenant(pool,async c=>{const x=(await c.query(`SELECT id FROM repository_connections WHERE tenant_id=$1 AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`,[FREE_REVIEW_TENANT_ID])).rows[0]; if(x?.id)return String(x.id);const id=`repo_public_${crypto.randomUUID().replaceAll('-','')}`;await c.query(`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES ($1,$2,'github','public-github','Autonomous public GitHub ingestion','public','Active')`,[id,FREE_REVIEW_TENANT_ID]);return id;}); }

async function refresh(pool:Pool,passportId:string,owner:string,repository:string,connectionId:string){ return tenant(pool,async c=>{const j1=`job_${crypto.randomUUID().replaceAll('-','')}`,j2=`job_${crypto.randomUUID().replaceAll('-','')}`,s1=`source_${crypto.randomUUID().replaceAll('-','')}`,s2=`source_${crypto.randomUUID().replaceAll('-','')}`;await c.query(`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES ($1,$2,'repository-scanner',$3,'repository_scan','Pending',0,NOW(),NOW(),NOW()),($4,$2,'security-scanner',$3,'repository_security_scan','Pending',0,NOW(),NOW(),NOW())`,[j1,FREE_REVIEW_TENANT_ID,passportId,j2]);await c.query(`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES ($1,$2,$3,$4,'github',$5,$6,NULL,'',NOW()),($7,$8,$3,$4,'github',$5,$6,NULL,'',NOW())`,[s1,j1,FREE_REVIEW_TENANT_ID,connectionId,owner,repository,s2,j2]);await c.query(`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES ($1,'repository-scanner','Public repository refresh queued by evidence-first ingestion team.','Info'),($2,'security-scanner','Public repository security refresh queued by ingestion team.','Info')`,[j1,j2]);return j1;}); }

async function upsert(pool:Pool,c:Candidate){ const id=ledgerId(c); return tenant(pool,async db=>{const old=(await db.query(`SELECT id,passport_id,status,next_refresh_at FROM registry_ingestion_items WHERE provider='github' AND lower(repository_owner)=lower($1) AND lower(repository_name)=lower($2) LIMIT 1`,[c.owner,c.repository])).rows[0];if(old){await db.query(`UPDATE registry_ingestion_items SET last_observed_at=CURRENT_TIMESTAMP,stars=$2,language=$3,license_spdx=$4,default_branch=$5,head_sha=$6,updated_at=CURRENT_TIMESTAMP,discovery_agent=$7 WHERE id=$1`,[old.id,c.stars,c.language,c.licenseSpdx,c.defaultBranch,c.headSha,VERSION]);return old;}await db.query(`INSERT INTO registry_ingestion_items (id,provider,repository_owner,repository_name,canonical_url,status,discovery_agent,identity_agent,quality_agent,next_refresh_at,default_branch,head_sha,stars,language,license_spdx) VALUES ($1,'github',$2,$3,$4,'discovered',$5,$5,$5,CURRENT_TIMESTAMP + ($6 * INTERVAL '1 hour'),$7,$8,$9,$10,$11)`,[id,c.owner,c.repository,c.url,VERSION,DEFAULT_REFRESH_HOURS,c.defaultBranch,c.headSha,c.stars,c.language,c.licenseSpdx]);return {id,passport_id:null,status:'discovered',next_refresh_at:new Date(0)};}); }

async function setStatus(pool:Pool,id:string,status:string,passportId?:string){await pool.query(`UPDATE registry_ingestion_items SET status=$2,passport_id=COALESCE($3,passport_id),updated_at=CURRENT_TIMESTAMP,last_success_at=CASE WHEN $2 IN ('queued','refresh_queued') THEN last_success_at ELSE CURRENT_TIMESTAMP END WHERE id=$1`,[id,status,passportId??null]);}

export async function runPublicRepositoryAgentTeamOnce(pool:Pool){
  const q=queries(); const token=process.env.GITHUB_TOKEN?.trim()??''; const batch=envInt('REGISTRY_CRAWL_BATCH',DEFAULT_BATCH,500); const state=(await pool.query(`SELECT strategy_index AS "strategyIndex",query_index AS "queryIndex",page,language_index AS "languageIndex" FROM registry_crawl_state WHERE id='default'`)).rows[0] as TeamCursor|undefined; const cur=state??{strategyIndex:0,queryIndex:0,page:1,languageIndex:0}; const run=`crawl_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; const out={discovered:0,queued:0,refreshed:0,quarantined:0,failed:0}; await pool.query(`INSERT INTO registry_crawl_runs (id,started_at) VALUES ($1,CURRENT_TIMESTAMP)`,[run]);
  try{const backlog=Number((await pool.query(`SELECT count(*)::int n FROM agent_jobs WHERE tenant_id=$1 AND job_type IN ('repository_scan','repository_security_scan') AND status IN ('Pending','Running')`,[FREE_REVIEW_TENANT_ID])).rows[0]?.n??0);const maxBacklog=envInt('REGISTRY_CRAWL_MAX_BACKLOG',50,5000);if(backlog>maxBacklog)return out;const query=`${q[cur.queryIndex]??q[0]} language:${JSON.stringify(LANGUAGES[cur.languageIndex]??LANGUAGES[0])}`;const found=await searchGithub(query,cur.page,token);if(found.rateLimited)return out;const conn=await connection(pool);for(const raw of found.items){if(out.queued>=batch)break;out.discovered++;const c=normalizeCandidate(raw);if(!c||c.archived||c.fork){out.quarantined++;continue;}try{const row=await upsert(pool,c);const due=!row.next_refresh_at||new Date(row.next_refresh_at).getTime()<=Date.now();if(!row.passport_id){const db=drizzle(pool,{schema});const x=await enqueueFreeReview(db as any,{owner:c.owner,repository:c.repository,ref:null,ipHash:`registry-team:${run}`});await setStatus(pool,row.id,'queued',x.passportId);out.queued++;}else if(due){await refresh(pool,String(row.passport_id),c.owner,c.repository,conn);await pool.query(`UPDATE registry_ingestion_items SET status='refresh_queued',evidence_agent=$2,verification_agent=$2,next_refresh_at=CURRENT_TIMESTAMP + ($3 * INTERVAL '1 hour'),updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[row.id,VERSION,envInt('REGISTRY_CRAWL_REFRESH_HOURS',DEFAULT_REFRESH_HOURS,8760)]);out.refreshed++;}}catch(e){out.failed++;await setStatus(pool,row.id,'failed').catch(()=>undefined);console.error('[PublicRepositoryTeam] item failed',c.url,e instanceof Error?e.message:String(e));}}
    const nextQuery=cur.queryIndex+1<q.length?cur.queryIndex+1:0;const nextStrategy=cur.queryIndex+1<q.length?cur.strategyIndex:cur.strategyIndex+1;const nextPage=found.items.length>=PER_PAGE&&cur.page<MAX_PAGES?cur.page+1:1;const next={strategyIndex:nextStrategy,queryIndex:found.items.length>=PER_PAGE&&cur.page<MAX_PAGES?cur.queryIndex:nextQuery,page:found.items.length>=PER_PAGE&&cur.page<MAX_PAGES?nextPage:1,languageIndex:(found.items.length>=PER_PAGE&&cur.page<MAX_PAGES)?cur.languageIndex:(cur.languageIndex+1)%LANGUAGES.length};await pool.query(`INSERT INTO registry_crawl_state (id,strategy_index,query_index,page,language_index,updated_at) VALUES ('default',$1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET strategy_index=EXCLUDED.strategy_index,query_index=EXCLUDED.query_index,page=EXCLUDED.page,language_index=EXCLUDED.language_index,updated_at=EXCLUDED.updated_at`,[next.strategyIndex,next.queryIndex,next.page,next.languageIndex]);
  }finally{await pool.query(`UPDATE registry_crawl_runs SET finished_at=CURRENT_TIMESTAMP,discovered=$2,enqueued=$3,skipped=0,refreshed=$4,quarantined=$5,failed=$6 WHERE id=$1`,[run,out.discovered,out.queued,out.refreshed,out.quarantined,out.failed]).catch(()=>undefined);}return out;
}

export async function runPublicRepositoryAgentTeamLoop(){const interval=envInt('REGISTRY_CRAWL_INTERVAL_MS',60*60*1000,7*24*60*60*1000);if(process.env.REGISTRY_CRAWLER_ENABLED==='false'){await new Promise(r=>setTimeout(r,interval));return;}const pool=(await import('../workers/worker-db.ts')).createWorkerPool();try{const result=await runPublicRepositoryAgentTeamOnce(pool);if(result.discovered||result.queued||result.refreshed||result.quarantined||result.failed)console.info('[PublicRepositoryTeam]',result);}catch(e){console.error('[PublicRepositoryTeam] sweep failed',e instanceof Error?e.message:String(e));}finally{await pool.end();}await new Promise(r=>setTimeout(r,interval));}
