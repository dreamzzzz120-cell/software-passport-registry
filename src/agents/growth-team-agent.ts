import { createWorkerPool } from '../workers/worker-db.ts';
import { DISTRIBUTION_TENANT_ID } from '../lib/distribution-engine.ts';

const SWEEP_MS = Math.max(60_000, Number.parseInt(process.env.GROWTH_TEAM_SWEEP_MS ?? '300000', 10) || 300_000);

type AgentId = 'closer'|'lead-finder'|'social-scout'|'followup-crm'|'content-seo'|'partnership-directory'|'retention-expansion';

async function withTenant<T>(pool: ReturnType<typeof createWorkerPool>, fn: (client:any)=>Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [DISTRIBUTION_TENANT_ID]);
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>undefined);
    throw error;
  } finally { client.release(); }
}

async function setAgent(pool: ReturnType<typeof createWorkerPool>, id:AgentId, status:'ACTIVE'|'CONFIG_REQUIRED', notes:string) {
  await withTenant(pool, client => client.query(
    'UPDATE growth_agents SET status=$3, notes=$4, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$1 AND id=$2',
    [DISTRIBUTION_TENANT_ID,id,status,notes.slice(0,4000)]
  ));
}

async function ensureTask(pool: ReturnType<typeof createWorkerPool>, title:string, category:'seo'|'backlinks'|'outreach'|'infra'|'general', notes:string) {
  await withTenant(pool, async client => {
    const exists = await client.query("SELECT 1 FROM founder_tasks WHERE title=$1 AND status IN ('open','in_progress') LIMIT 1",[title]);
    if (!exists.rowCount) await client.query(
      "INSERT INTO founder_tasks(title,category,status,notes) VALUES($1,$2,'open',$3)",
      [title.slice(0,300),category,notes.slice(0,4000)]
    );
  });
}

async function snapshot(pool: ReturnType<typeof createWorkerPool>) {
  return withTenant(pool, async client => {
    const r = await client.query(
      `SELECT
        count(*)::int total,
        count(*) FILTER(WHERE status='active')::int active,
        count(*) FILTER(WHERE replied_at IS NOT NULL)::int replies,
        count(*) FILTER(WHERE demo_at IS NOT NULL)::int demos,
        count(*) FILTER(WHERE pilot_at IS NOT NULL)::int pilots,
        count(*) FILTER(WHERE customer_at IS NOT NULL)::int customers,
        count(*) FILTER(WHERE status='active' AND customer_at IS NULL AND COALESCE(next_followup_at,updated_at) < CURRENT_TIMESTAMP-INTERVAL '3 days')::int stalled
       FROM distribution_contacts WHERE tenant_id=$1`,
      [DISTRIBUTION_TENANT_ID]
    );
    return r.rows[0] ?? {};
  });
}

async function closer(pool: ReturnType<typeof createWorkerPool>, s:any) {
  const hot = await withTenant(pool, async client => (await client.query(
    `SELECT id,company,replied_at,demo_at,pilot_at FROM distribution_contacts
     WHERE tenant_id=$1 AND status='active' AND customer_at IS NULL
       AND (replied_at IS NOT NULL OR demo_at IS NOT NULL OR pilot_at IS NOT NULL)
     ORDER BY CASE WHEN pilot_at IS NOT NULL THEN 1 WHEN demo_at IS NOT NULL THEN 2 ELSE 3 END, updated_at DESC LIMIT 10`,
    [DISTRIBUTION_TENANT_ID]
  )).rows);
  for (const lead of hot) {
    const company = String(lead.company || 'Qualified prospect').slice(0,120);
    const action = lead.pilot_at ? 'Move the pilot to paid or record the blocking objection.'
      : lead.demo_at ? 'Follow up on the demo and ask for a pilot decision.'
      : 'Reply, qualify urgency, and book a demo.';
    await ensureTask(pool,'Closer: '+company,'outreach',action+' Basis: observed SPR pipeline state. Contact id: '+String(lead.id)+'.');
  }
  await setAgent(pool,'closer','ACTIVE','Observed funnel: '+s.replies+' replies, '+s.demos+' demos, '+s.pilots+' pilots, '+s.customers+' customers.');
}

async function leadFinder(pool: ReturnType<typeof createWorkerPool>, s:any) {
  const configured = process.env.DISTRIBUTION_AUTONOMOUS_DISCOVERY === 'true' && Boolean(
    process.env.GOOGLE_PLACES_API_KEY?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim() || process.env.DISTRIBUTION_DISCOVERY_PROVIDER_URL?.trim()
  );
  if (!configured) await ensureTask(pool,'Growth: enable autonomous Lead Finder','infra','Configure a supported discovery provider and DISTRIBUTION_AUTONOMOUS_DISCOVERY=true.');
  await setAgent(pool,'lead-finder',configured?'ACTIVE':'CONFIG_REQUIRED','Observed '+s.total+' contacts ('+s.active+' active). Discovery configured='+configured+'.');
}

async function socialScout(pool: ReturnType<typeof createWorkerPool>) {
  const configured = Boolean(process.env.SOCIAL_SCOUT_PROVIDER_URL?.trim() && process.env.SOCIAL_SCOUT_API_KEY?.trim());
  if (!configured) await ensureTask(pool,'Growth team: wire Social Scout provider','infra','Connect an approved social/community discovery source before calling Social Scout autonomous.');
  await setAgent(pool,'social-scout',configured?'ACTIVE':'CONFIG_REQUIRED',configured?'Social Scout provider configured.':'No approved social/community provider configured.');
}

async function followup(pool: ReturnType<typeof createWorkerPool>, s:any) {
  if (Number(s.stalled)>0) await ensureTask(pool,'Growth: clear stalled prospect queue','outreach',String(s.stalled)+' active prospect(s) are stale. Work highest pipeline stage first.');
  await setAgent(pool,'followup-crm','ACTIVE','Observed '+s.stalled+' stalled prospect(s). Sending remains owned by the existing distribution worker safety gates.');
}

async function contentSeo(pool: ReturnType<typeof createWorkerPool>) {
  const r = await withTenant(pool, async c => (await c.query("SELECT count(*)::int n FROM founder_tasks WHERE category='seo' AND status IN ('open','in_progress')")).rows[0]);
  await setAgent(pool,'content-seo','ACTIVE','Open SEO founder tasks='+Number(r?.n??0)+'. Use only evidence-backed SPR claims.');
}

async function partnerships(pool: ReturnType<typeof createWorkerPool>) {
  const r = await withTenant(pool, async c => (await c.query(
    "SELECT count(*)::int n FROM founder_tasks WHERE category IN ('backlinks','outreach') AND status IN ('open','in_progress')"
  )).rows[0]);
  await setAgent(pool,'partnership-directory','ACTIVE','Open outreach/backlink tasks='+Number(r?.n??0)+'.');
}

async function retention(pool: ReturnType<typeof createWorkerPool>) {
  const r = await withTenant(pool, async c => (await c.query(
    "SELECT count(*)::int total, count(*) FILTER(WHERE status IN ('active','trialing'))::int active FROM tenant_subscriptions"
  )).rows[0]);
  if (Number(r?.active??0)>0) await ensureTask(pool,'Growth: review active customers for retention and expansion','outreach','Review observed usage, monitoring adoption, evidence gaps, and unresolved unknowns before proposing expansion.');
  await setAgent(pool,'retention-expansion','ACTIVE','Subscription records='+Number(r?.total??0)+'; active/trialing='+Number(r?.active??0)+'.');
}

export async function runGrowthTeamAgentLoop() {
  const pool = createWorkerPool();
  try {
    while (true) {
      const s = await snapshot(pool);
      await closer(pool,s);
      await leadFinder(pool,s);
      await socialScout(pool);
      await followup(pool,s);
      await contentSeo(pool);
      await partnerships(pool);
      await retention(pool);
      console.info('[GrowthTeam] sweep complete',JSON.stringify(s));
      await new Promise(resolve=>setTimeout(resolve,SWEEP_MS));
    }
  } finally { await pool.end(); }
}
