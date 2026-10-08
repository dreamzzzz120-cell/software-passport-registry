export const GROWTH_CELLS = [
  ['recon','Recon','distribution_jobs','research_url'],
  ['intelligence','Intelligence','q_legion_missions',''],
  ['qualification','Qualification','distribution_jobs','qualify_lead'],
  ['content','Content','growth_content_opportunities',''],
  ['outbound','Outbound','distribution_jobs','send_outreach'],
  ['engagement','Engagement','distribution_jobs','followup_outreach'],
  ['free_review','Free Review','free_review_submissions',''],
  ['conversion','Conversion','distribution_contacts',''],
  ['expansion','Expansion','distribution_contacts',''],
  ['referral','Referral','growth_referral_links',''],
  ['partnerships','Partnerships','growth_referral_links',''],
  ['seo','SEO','growth_content_opportunities',''],
  ['retargeting','Retargeting','growth_experiments',''],
  ['analytics','Analytics','distribution_contacts',''],
  ['quality','Quality Control','distribution_jobs',''],
].map(([id,name,source,kind]) => ({id,name,source,kind,capability:'OBSERVATION_ONLY'}));

export function growthCell(id: unknown) { return GROWTH_CELLS.find(cell => cell.id===id); }
export function cellState(control: string, running: number, queued: number, failed: number, observed: boolean) {
  if(control!=='observing') return control.toUpperCase();
  return running>0?'RUNNING':queued>0?'QUEUED':failed>0?'ATTENTION':observed?'OBSERVED':'UNKNOWN';
}
export const DISTRIBUTION_CLAIM_JOB_SQL = `SELECT id,kind,payload,attempts,max_attempts FROM distribution_jobs
 WHERE tenant_id=$1 AND status='queued' AND available_at<=CURRENT_TIMESTAMP
 AND (kind<>'growth_cell' OR NOT EXISTS (SELECT 1 FROM growth_cell_controls c WHERE c.tenant_id=distribution_jobs.tenant_id AND c.cell_id=distribution_jobs.payload->>'cellId' AND c.state IN ('paused','archived')))
 ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1`;

export function observationSql(id: unknown) {
  const cell=growthCell(id);
  if(!cell) throw new Error('GROWTH_CELL_UNKNOWN');
  let metrics='COUNT(*)::int AS records';
  let filter='';
  let time='updated_at';
  if(cell.source==='distribution_jobs') {
    metrics+=",COUNT(*) FILTER (WHERE status='queued')::int AS queued,COUNT(*) FILTER (WHERE status='running')::int AS running,COUNT(*) FILTER (WHERE status='succeeded')::int AS succeeded,COUNT(*) FILTER (WHERE status='dead_letter')::int AS failed";
    if(cell.kind) filter=' AND kind=$2';
  } else if(cell.source==='distribution_contacts') {
    metrics+=',COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::int AS replies,COUNT(*) FILTER (WHERE checkout_at IS NOT NULL)::int AS checkouts,COUNT(*) FILTER (WHERE customer_at IS NOT NULL)::int AS "recordedCustomers"';
    if(id==='expansion') filter=' AND customer_at IS NOT NULL';
  } else if(cell.source==='growth_referral_links') {
    metrics+=',COALESCE(SUM(visits),0)::int AS visits,COALESCE(SUM(conversions),0)::int AS conversions';
    if(id==='partnerships') filter=" AND owner_type='partner'";
  } else if(cell.source==='growth_content_opportunities') {
    metrics+=",COUNT(*) FILTER (WHERE status IN ('published','monitoring'))::int AS published,COALESCE(SUM(observed_clicks),0)::int AS clicks,COALESCE(SUM(observed_conversions),0)::int AS conversions";
    if(id==='seo') filter=" AND kind='seo'";
  } else if(cell.source==='free_review_submissions') {
    metrics+=",COUNT(*) FILTER (WHERE status='Completed')::int AS completed";time='created_at';
  } else if(cell.source==='growth_experiments') metrics+=",COUNT(*) FILTER (WHERE status='running')::int AS running";
  else metrics+=",COUNT(*) FILTER (WHERE state='HOLD')::int AS held,COUNT(*) FILTER (WHERE state='UNKNOWN')::int AS unknown";
  // Table names and filters are fixed catalog literals. No request value enters SQL text.
  return {text:`SELECT ${metrics},MAX(${time}) AS "lastObservedAt" FROM ${cell.source} WHERE tenant_id=$1${filter}`,kind:cell.kind};
}
export async function observeGrowthCell(client: {query: (...args:any[])=>Promise<any>}, id: unknown, tenantId: string) {
  const query=observationSql(id);
  const result=await client.query(query.text,query.kind?[tenantId,query.kind]:[tenantId]);
  return {cellId:id,metrics:result.rows[0],source:growthCell(id)!.source,observedAt:new Date().toISOString(),costCents:null,execution:'OBSERVATION_ONLY',policy:'Recorded customer stages do not prove payments. This mission performs no outreach, publishing, ad buying or authority grants.'};
}
