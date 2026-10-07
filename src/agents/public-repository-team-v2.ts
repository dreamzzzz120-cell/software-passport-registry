/** Autonomous public-repository ingestion team. Public data only; never contacts repo owners. */
import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.ts';
import { enqueueFreeReview, FREE_REVIEW_TENANT_ID } from '../routes/free-review-submit.ts';

const VERSION = 'public-repository-team/1.2.0';
export const LANGUAGES = ['JavaScript','TypeScript','Python','Go','Java','Rust','C#','Ruby','PHP','Kotlin','Swift','C++','Scala','Dart','Elixir'];
// GitHub repository search: `topic:<name>` filters by topic name; `topics:<n>`
// is a numeric count qualifier, so `topics:security` is rejected with
// 422 '"security" is not a numeric value'. Every strategy below was verified
// against api.github.com (2026-09-14) for JavaScript, C# and C++.
export const DEFAULT_QUERIES = [
  'stars:>={STAR} archived:false fork:false',
  'topic:security stars:>={STAR} archived:false fork:false',
  'topic:cybersecurity stars:>={STAR} archived:false fork:false',
  'topic:devtools stars:>={STAR} archived:false fork:false',
  'topic:ai stars:>={STAR} archived:false fork:false',
  'topic:opensource stars:>={STAR} archived:false fork:false',
];
const PER_PAGE = 100;
const DEFAULT_BATCH = 25;
const DEFAULT_REFRESH_HOURS = 168;
const MAX_PAGES = 10;

export type TeamCursor = { strategyIndex:number; queryIndex:number; page:number; languageIndex:number };
export type Candidate = { owner:string; repository:string; url:string; stars:number; language:string|null; licenseSpdx:string|null; defaultBranch:string|null; pushedAt:string|null; archived:boolean; fork:boolean };
export type RepositoryReality = { commitSha:string|null; manifestPresent:boolean|null; treeComplete:boolean; treeEntries:number|null; checkedAt:string; sourceStatus:'verified'|'partial' };

type IngestionRow = { id:string; passport_id:string|null; status:string; next_refresh_at:Date|string|null };

const envInt = (name:string, fallback:number, max=Number.MAX_SAFE_INTEGER) => { const n=Number.parseInt(process.env[name]??'',10); return Number.isFinite(n)&&n>0?Math.min(n,max):fallback; };
const queries = () => { const star=envInt('REGISTRY_CRAWL_STAR_FLOOR',50,1_000_000); const configured=process.env.REGISTRY_CRAWL_QUERIES?.split('\n').map(x=>x.trim()).filter(Boolean); return (configured?.length?configured:DEFAULT_QUERIES).map(x=>normalizeSearchStrategy(x.replaceAll('{STAR}',String(star)))); };
const ledgerId = (c:Candidate) => `reging_${crypto.createHash('sha256').update(`github:${c.owner.toLowerCase()}/${c.repository.toLowerCase()}`).digest('hex').slice(0,40)}`;
const repoUrl = (o:string,r:string) => `https://github.com/${encodeURIComponent(o)}/${encodeURIComponent(r)}`;
// Language names that are plain identifiers (JavaScript, Go, Rust) pass
// through unchanged. Names with any other character (C#, C++, "Emacs Lisp")
// are quoted, which GitHub accepts for every language it knows; the value is
// then percent-encoded by URLSearchParams so '#' never becomes a URL fragment
// and '+' never decodes to a space.
export const githubLanguageQualifier = (language:string) => /^[A-Za-z0-9_.-]+$/.test(language) ? `language:${language}` : `language:"${language.replaceAll('"','')}"`;
// Rewrite the one qualifier mistake GitHub rejects deterministically:
// `topics:<name>` -> `topic:<name>`. Numeric forms (`topics:>3`) are valid and kept.
export const normalizeSearchStrategy = (strategy:string) => strategy.replace(/(^|\s)topics:(?![<>=]?\d)(\S+)/g, '$1topic:$2');
export const buildGithubSearchQuery = (strategy:string, language:string) => `${normalizeSearchStrategy(strategy)} ${githubLanguageQualifier(language)}`;
export function githubSearchUrl(query:string,page:number){ const u=new URL('https://api.github.com/search/repositories'); u.searchParams.set('q',query); u.searchParams.set('sort','stars'); u.searchParams.set('order','desc'); u.searchParams.set('per_page',String(PER_PAGE)); u.searchParams.set('page',String(page)); return u; }
export type SearchOutcome = 'ok'|'rate_limited'|'invalid_query'|'error';
export const classifyGithubSearchStatus = (status:number):SearchOutcome => status===200?'ok':(status===403||status===429)?'rate_limited':status===422?'invalid_query':'error';
// Cursor after a query is exhausted or rejected: next query, page 1, next
// language; strategy rolls over when the query list does. A page with a full
// result set stays on the same query/language and advances the page.
export function advanceCursor(cur:TeamCursor,itemCount:number,queryCount:number):TeamCursor{
  const morePages=itemCount>=PER_PAGE&&cur.page<MAX_PAGES;
  if(morePages)return {strategyIndex:cur.strategyIndex,queryIndex:cur.queryIndex,page:cur.page+1,languageIndex:cur.languageIndex};
  const rollover=cur.queryIndex+1>=queryCount;
  return {strategyIndex:rollover?cur.strategyIndex+1:cur.strategyIndex,queryIndex:rollover?0:cur.queryIndex+1,page:1,languageIndex:(cur.languageIndex+1)%LANGUAGES.length};
}

export function normalizeCandidate(item:any):Candidate|null {
  const owner=String(item?.owner?.login??''); const repository=String(item?.name??'');
  if(!/^[A-Za-z0-9_.-]{1,100}$/.test(owner)||!/^[A-Za-z0-9_.-]{1,100}$/.test(repository)) return null;
  return { owner, repository, url:repoUrl(owner,repository), stars:Math.max(0,Number(item?.stargazers_count??0)||0), language:typeof item?.language==='string'?item.language.slice(0,80):null, licenseSpdx:typeof item?.license?.spdx_id==='string'&&item.license.spdx_id!=='NOASSERTION'?item.license.spdx_id.slice(0,100):null, defaultBranch:typeof item?.default_branch==='string'?item.default_branch.slice(0,255):null, pushedAt:typeof item?.pushed_at==='string'?item.pushed_at:null, archived:item?.archived===true, fork:item?.fork===true };
}

type SearchResult = { outcome:SearchOutcome; items:any[]; reason?:string };
async function searchGithub(query:string,page:number,token:string):Promise<SearchResult>{
  const u=githubSearchUrl(query,page);
  const r=await fetch(u,{headers:{Accept:'application/vnd.github+json','User-Agent':'software-passport-registry-public-repository-team/1.0',...(token?{Authorization:`Bearer ${token}`}:{})}});
  const outcome=classifyGithubSearchStatus(r.status);
  if(outcome==='rate_limited')return {outcome,items:[]};
  if(outcome==='invalid_query'){ let reason=`GITHUB_SEARCH_422`; try{const j:any=await r.json(); const m=Array.isArray(j?.errors)?j.errors.map((e:any)=>String(e?.message??'')).filter(Boolean).join('; '):''; if(m)reason=`GITHUB_SEARCH_422: ${m}`;}catch{} return {outcome,items:[],reason}; }
  if(outcome==='error')throw new Error(`GITHUB_SEARCH_${r.status}`);
  const j:any=await r.json(); return {outcome,items:Array.isArray(j?.items)?j.items:[]};
}
// A repository search result does not imply the repo contains a dependency manifest.
// Inspect GitHub's recursive tree before scheduling costly scans. If GitHub cannot
// establish a complete tree, preserve the existing scan path rather than falsely
// claiming the repository has no supported manifest.
const SUPPORTED_MANIFESTS = new Set([
  'package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml',
  'requirements.txt','requirements-dev.txt','pyproject.toml','poetry.lock','Pipfile','Pipfile.lock',
  'pom.xml','build.gradle','build.gradle.kts','gradle.lockfile','packages.lock.json',
  'packages.config','go.mod','go.sum','Cargo.toml','Cargo.lock','Gemfile','Gemfile.lock',
  'composer.json','composer.lock',
]);
export function treeHasSupportedManifest(tree: Array<{path?:string;type?:string}>): boolean {
  return tree.some(item => item.type === 'blob' && typeof item.path === 'string' &&
    (SUPPORTED_MANIFESTS.has(item.path.split('/').at(-1) ?? '') || item.path.endsWith('.csproj')));
}
const githubHeaders = (token:string) => ({Accept:'application/vnd.github+json','User-Agent':'software-passport-registry-public-repository-team/1.1',...(token?{Authorization:`Bearer ${token}`}:{})});

export async function inspectRepositoryReality(c:Candidate,token:string):Promise<RepositoryReality>{
  const checkedAt=new Date().toISOString();
  if(!c.defaultBranch)return {commitSha:null,manifestPresent:null,treeComplete:false,treeEntries:null,checkedAt,sourceStatus:'partial'};
  const owner=encodeURIComponent(c.owner), repo=encodeURIComponent(c.repository), branch=encodeURIComponent(c.defaultBranch);
  const commitUrl=`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
  const treeUrl=new URL(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}`);
  treeUrl.searchParams.set('recursive','1');
  let commitSha:string|null=null, manifestPresent:boolean|null=null, treeComplete=false, treeEntries:number|null=null;
  try{
    const [commitResponse,treeResponse]=await Promise.all([
      fetch(commitUrl,{headers:githubHeaders(token)}),
      fetch(treeUrl,{headers:githubHeaders(token)}),
    ]);
    if(commitResponse.ok){
      const commit:any=await commitResponse.json();
      if(typeof commit?.sha==='string' && /^[a-f0-9]{40}$/i.test(commit.sha))commitSha=commit.sha.toLowerCase();
    }
    if(treeResponse.ok){
      const body:any=await treeResponse.json();
      if(Array.isArray(body?.tree)){
        treeEntries=body.tree.length;
        treeComplete=body?.truncated!==true;
        if(treeComplete)manifestPresent=treeHasSupportedManifest(body.tree);
      }
    }
  }catch{}
  return {commitSha,manifestPresent,treeComplete,treeEntries,checkedAt,sourceStatus:commitSha!==null&&manifestPresent!==null?'verified':'partial'};
}
async function saveCursor(pool:Pool,next:TeamCursor){ await pool.query(`INSERT INTO registry_crawl_state (id,strategy_index,query_index,page,language_index,updated_at) VALUES ('default',$1,$2,$3,$4,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET strategy_index=EXCLUDED.strategy_index,query_index=EXCLUDED.query_index,page=EXCLUDED.page,language_index=EXCLUDED.language_index,updated_at=CURRENT_TIMESTAMP`,[next.strategyIndex,next.queryIndex,next.page,next.languageIndex]); }

async function tenant<T>(pool:Pool,fn:(client:PoolClient)=>Promise<T>):Promise<T>{ const c=await pool.connect(); try{await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[FREE_REVIEW_TENANT_ID]);const x=await fn(c);await c.query('COMMIT');return x;}catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}finally{c.release();} }

async function connection(pool:Pool){ return tenant(pool,async c=>{const x=(await c.query(`SELECT id FROM repository_connections WHERE tenant_id=$1 AND provider='github' AND access_mode='public' AND status='Active' ORDER BY created_at ASC LIMIT 1`,[FREE_REVIEW_TENANT_ID])).rows[0]; if(x?.id)return String(x.id);const id=`repo_public_${crypto.randomUUID().replaceAll('-','')}`;await c.query(`INSERT INTO repository_connections (id,tenant_id,provider,installation_id,label,access_mode,status) VALUES ($1,$2,'github','public-github','Autonomous public GitHub ingestion','public','Active')`,[id,FREE_REVIEW_TENANT_ID]);return id;}); }

async function refresh(pool:Pool,passportId:string,owner:string,repository:string,connectionId:string){ return tenant(pool,async c=>{const j1=`job_${crypto.randomUUID().replaceAll('-','')}`,j2=`job_${crypto.randomUUID().replaceAll('-','')}`,s1=`source_${crypto.randomUUID().replaceAll('-','')}`,s2=`source_${crypto.randomUUID().replaceAll('-','')}`;await c.query(`INSERT INTO agent_jobs (id,tenant_id,agent_id,passport_id,job_type,status,progress,next_attempt_at,created_at,updated_at) VALUES ($1,$2,'repository-scanner',$3,'repository_scan','Pending',0,NOW(),NOW(),NOW()),($4,$2,'security-scanner',$3,'repository_security_scan','Pending',0,NOW(),NOW())`,[j1,FREE_REVIEW_TENANT_ID,passportId,j2]);await c.query(`INSERT INTO repository_scan_sources (id,job_id,tenant_id,connection_id,provider,repository_owner,repository_name,requested_ref,repository_subdirectory,created_at) VALUES ($1,$2,$3,$4,'github',$5,$6,NULL,'',NOW()),($7,$8,$3,$4,'github',$5,$6,NULL,'',NOW())`,[s1,j1,FREE_REVIEW_TENANT_ID,connectionId,owner,repository,s2,j2]);await c.query(`INSERT INTO agent_logs (job_id,agent_id,message,level) VALUES ($1,'repository-scanner','Public repository refresh queued by evidence-first ingestion team.','Info'),($2,'security-scanner','Public repository security refresh queued by ingestion team.','Info')`,[j1,j2]);return j1;}); }

function identityId(c:Candidate){return `reg_${crypto.createHash('sha256').update(`github:${c.owner.toLowerCase()}/${c.repository.toLowerCase()}`).digest('hex').slice(0,40)}`;}
function observationHash(c:Candidate,r:RepositoryReality){return crypto.createHash('sha256').update(JSON.stringify({provider:'github',owner:c.owner.toLowerCase(),repository:c.repository.toLowerCase(),commitSha:r.commitSha,stars:c.stars,language:c.language,licenseSpdx:c.licenseSpdx,defaultBranch:c.defaultBranch,manifestPresent:r.manifestPresent,treeComplete:r.treeComplete,treeEntries:r.treeEntries,pushedAt:c.pushedAt})).digest('hex');}
async function recordRegistryReality(pool:Pool,c:Candidate,r:RepositoryReality,run:string){
  return tenant(pool,async db=>{
    const proposedId=identityId(c), canonicalKey=`github:${c.owner.toLowerCase()}/${c.repository.toLowerCase()}`, oid=`regobs_${crypto.randomUUID().replaceAll('-','')}`;
    // Existing registry identities may predate the current SHA-256 id scheme
    // (for example rows backfilled with the earlier md5 id). When the unique
    // (provider, canonical_key) constraint wins, PostgreSQL keeps that existing
    // row id. Always use RETURNING id as the authoritative foreign key for the
    // observation instead of assuming proposedId was inserted.
    const identityRow=await db.query(`INSERT INTO software_registry_identities (id,provider,canonical_key,canonical_name,repository_owner,repository_name,canonical_url,identity_status,last_observed_at,latest_commit_sha,default_branch,stars,language,license_spdx,next_refresh_at,observation_count,updated_at) VALUES ($1,'github',$2,$3,$4,$5,$6,'observed',CURRENT_TIMESTAMP,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP + INTERVAL '7 days',1,CURRENT_TIMESTAMP) ON CONFLICT (provider,canonical_key) DO UPDATE SET canonical_name=EXCLUDED.canonical_name,repository_owner=EXCLUDED.repository_owner,repository_name=EXCLUDED.repository_name,canonical_url=EXCLUDED.canonical_url,last_observed_at=CURRENT_TIMESTAMP,latest_commit_sha=COALESCE(EXCLUDED.latest_commit_sha,software_registry_identities.latest_commit_sha),default_branch=COALESCE(EXCLUDED.default_branch,software_registry_identities.default_branch),stars=EXCLUDED.stars,language=EXCLUDED.language,license_spdx=EXCLUDED.license_spdx,next_refresh_at=EXCLUDED.next_refresh_at,observation_count=software_registry_identities.observation_count+1,updated_at=CURRENT_TIMESTAMP RETURNING id`,[proposedId,canonicalKey,`${c.owner}/${c.repository}`,c.owner,c.repository,c.url,r.commitSha,c.defaultBranch,c.stars,c.language,c.licenseSpdx]);
    const iid=String(identityRow.rows[0]?.id??'');
    if(!iid)throw new Error('REGISTRY_IDENTITY_UPSERT_RETURNED_NO_ID');
    await db.query(`INSERT INTO software_registry_observations (id,identity_id,source_type,source_locator,observed_at,commit_sha,payload_hash,outcome,evidence) VALUES ($1,$2,'github-reality',$3,CURRENT_TIMESTAMP,$4,$5,$6,$7::jsonb) ON CONFLICT (identity_id,source_type,source_locator,commit_sha,payload_hash) DO NOTHING`,[oid,iid,c.url,r.commitSha,observationHash(c,r),r.sourceStatus==='verified'?'verified':'partial',JSON.stringify({crawlerRunId:run,checkedAt:r.checkedAt,manifestPresent:r.manifestPresent,treeComplete:r.treeComplete,treeEntries:r.treeEntries,pushedAt:c.pushedAt,defaultBranch:c.defaultBranch,stars:c.stars,language:c.language,licenseSpdx:c.licenseSpdx,agent:VERSION})]);
    return iid;
  });
}

async function upsert(pool:Pool,c:Candidate,r:RepositoryReality,identity:string):Promise<IngestionRow>{ const id=ledgerId(c); return tenant(pool,async db=>{const old=(await db.query(`SELECT id,passport_id,status,next_refresh_at FROM registry_ingestion_items WHERE provider='github' AND lower(repository_owner)=lower($1) AND lower(repository_name)=lower($2) LIMIT 1`,[c.owner,c.repository])).rows[0] as IngestionRow|undefined;if(old){await db.query(`UPDATE registry_ingestion_items SET last_observed_at=CURRENT_TIMESTAMP,stars=$2,language=$3,license_spdx=$4,default_branch=$5,head_sha=COALESCE($6,head_sha),updated_at=CURRENT_TIMESTAMP,discovery_agent=$7,identity_id=COALESCE(identity_id,$8),canonical_key=COALESCE(canonical_key,$9),quality_status=$10,observation_count=observation_count+1 WHERE id=$1`,[old.id,c.stars,c.language,c.licenseSpdx,c.defaultBranch,r.commitSha,VERSION,identity,`github:${c.owner.toLowerCase()}/${c.repository.toLowerCase()}`,r.sourceStatus==='verified'?'good':'partial']);return old;}await db.query(`INSERT INTO registry_ingestion_items (id,provider,repository_owner,repository_name,canonical_url,status,discovery_agent,identity_agent,quality_agent,next_refresh_at,default_branch,head_sha,stars,language,license_spdx,identity_id,canonical_key,quality_status,observation_count,refresh_reason) VALUES ($1,'github',$2,$3,$4,'discovered',$5,$5,$5,CURRENT_TIMESTAMP + ($6 * INTERVAL '1 hour'),$7,$8,$9,$10,$11,$12,$13,$14,1,'initial_discovery')`,[id,c.owner,c.repository,c.url,VERSION,DEFAULT_REFRESH_HOURS,c.defaultBranch,r.commitSha,c.stars,c.language,c.licenseSpdx,identity,`github:${c.owner.toLowerCase()}/${c.repository.toLowerCase()}`,r.sourceStatus==='verified'?'good':'partial']);return {id,passport_id:null,status:'discovered',next_refresh_at:new Date(0)};}); }

async function setStatus(pool:Pool,id:string,status:string,passportId?:string){await pool.query(`UPDATE registry_ingestion_items SET status=$2,passport_id=COALESCE($3,passport_id),updated_at=CURRENT_TIMESTAMP,last_success_at=CASE WHEN $2 IN ('queued','refresh_queued') THEN last_success_at ELSE CURRENT_TIMESTAMP END WHERE id=$1`,[id,status,passportId??null]);}

export async function runPublicRepositoryAgentTeamOnce(pool:Pool){
  const q=queries(); const token=process.env.GITHUB_TOKEN?.trim()??''; const batch=envInt('REGISTRY_CRAWL_BATCH',DEFAULT_BATCH,500); const state=(await pool.query(`SELECT strategy_index AS "strategyIndex",query_index AS "queryIndex",page,language_index AS "languageIndex" FROM registry_crawl_state WHERE id='default'`)).rows[0] as TeamCursor|undefined; const cur=state??{strategyIndex:0,queryIndex:0,page:1,languageIndex:0}; const run=`crawl_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; const out={discovered:0,queued:0,refreshed:0,quarantined:0,failed:0}; await pool.query(`INSERT INTO registry_crawl_runs (id,started_at) VALUES ($1,CURRENT_TIMESTAMP)`,[run]);
  try{const backlog=Number((await pool.query(`SELECT count(*)::int n FROM agent_jobs WHERE tenant_id=$1 AND job_type IN ('repository_scan','repository_security_scan') AND status IN ('Pending','Running')`,[FREE_REVIEW_TENANT_ID])).rows[0]?.n??0);const maxBacklog=envInt('REGISTRY_CRAWL_MAX_BACKLOG',50,5000);if(backlog>maxBacklog)return out;let cur2:TeamCursor=cur;let found:SearchResult|undefined;
    // A 422 is GitHub rejecting the query itself, not a transient fault: retrying it
    // next hour would fail identically forever (which is how the crawler wedged on
    // 'topics:security'). Record it, move the cursor on, and try the next strategy
    // in this run -- at most once per configured query, so the loop is bounded.
    for(let attempt=0;attempt<q.length;attempt++){
      const query=buildGithubSearchQuery(q[cur2.queryIndex]??q[0],LANGUAGES[cur2.languageIndex]??LANGUAGES[0]);
      const r=await searchGithub(query,cur2.page,token);
      if(r.outcome==='rate_limited')return out;
      if(r.outcome==='invalid_query'){out.failed++;console.error('[PublicRepositoryTeam] invalid search query skipped',JSON.stringify({query,reason:r.reason}));cur2=advanceCursor(cur2,0,q.length);await saveCursor(pool,cur2);continue;}
      found=r;break;
    }
    if(!found)return out;const conn=await connection(pool);for(const raw of found.items){if(out.queued>=batch)break;out.discovered++;const c=normalizeCandidate(raw);if(!c||c.archived||c.fork){out.quarantined++;continue;}let row:IngestionRow|undefined;try{const reality=await inspectRepositoryReality(c,token);const identity=await recordRegistryReality(pool,c,reality,run);if(reality.manifestPresent===false){out.quarantined++;console.info('[PublicRepositoryTeam] repository observed but excluded: complete tree contains no supported manifest',JSON.stringify({repository:c.url,identityId:identity,commitSha:reality.commitSha,treeEntries:reality.treeEntries}));continue;}row=await upsert(pool,c,reality,identity);const due=!row.next_refresh_at||new Date(row.next_refresh_at).getTime()<=Date.now();if(!row.passport_id){const db=drizzle(pool,{schema});const x=await enqueueFreeReview(db as any,{owner:c.owner,repository:c.repository,ref:null,ipHash:`registry-team:${run}`});await setStatus(pool,row.id,'queued',x.passportId);out.queued++;}else if(due){await refresh(pool,String(row.passport_id),c.owner,c.repository,conn);await pool.query(`UPDATE registry_ingestion_items SET status='refresh_queued',evidence_agent=$2,verification_agent=$2,next_refresh_at=CURRENT_TIMESTAMP + ($3 * INTERVAL '1 hour'),updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[row.id,VERSION,envInt('REGISTRY_CRAWL_REFRESH_HOURS',DEFAULT_REFRESH_HOURS,8760)]);out.refreshed++;}}catch(e){out.failed++;if(row?.id)await setStatus(pool,row.id,'failed').catch(()=>undefined);console.error('[PublicRepositoryTeam] item failed',c.url,e instanceof Error?e.message:String(e));}}
    await saveCursor(pool,advanceCursor(cur2,found.items.length,q.length));
  }finally{await pool.query(`UPDATE registry_crawl_runs SET finished_at=CURRENT_TIMESTAMP,discovered=$2,enqueued=$3,skipped=0,refreshed=$4,quarantined=$5,failed=$6 WHERE id=$1`,[run,out.discovered,out.queued,out.refreshed,out.quarantined,out.failed]).catch(()=>undefined);}return out;
}

export async function runPublicRepositoryAgentTeamLoop(){const interval=envInt('REGISTRY_CRAWL_INTERVAL_MS',60*60*1000,7*24*60*60*1000);if(process.env.REGISTRY_CRAWLER_ENABLED==='false'){await new Promise(r=>setTimeout(r,interval));return;}const pool=(await import('../workers/worker-db.ts')).createWorkerPool();try{const result=await runPublicRepositoryAgentTeamOnce(pool);if(result.discovered||result.queued||result.refreshed||result.quarantined||result.failed)console.info('[PublicRepositoryTeam]',result);}catch(e){console.error('[PublicRepositoryTeam] sweep failed',e instanceof Error?e.message:String(e));}finally{await pool.end();}await new Promise(r=>setTimeout(r,interval));}